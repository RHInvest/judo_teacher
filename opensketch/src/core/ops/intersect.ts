/**
 * Face/face intersection.
 *
 * Every triangle of the source set is intersected with every triangle of the
 * target set. Two non parallel triangle planes meet in a line; clipping both
 * triangles against the other plane yields two intervals on that line and their
 * overlap is the intersection segment. The segments are merged (collinear
 * neighbours joined, duplicates dropped) and finally inserted as ordinary
 * edges, which makes the normal splitting and face finding machinery do the
 * rest.
 */

import type { Geometry, Id, Vec3Like } from '@/shared/types'
import { MIN_LENGTH, P, PLANAR_TOL, POINT_TOL, V } from '@/core/math'
import { addEdgeMut, runFaceFinding, type ChangeAcc } from '@/core/topology'
import { faceTriangles } from '@/core/query/triangulate'

export type Triangle = [Vec3Like, Vec3Like, Vec3Like]
export type Segment = [Vec3Like, Vec3Like]

/**
 * Interval of the triangle on the intersection line, or null when the triangle
 * does not properly cross `plane`.
 */
function clipTriangle(
  tri: Triangle,
  plane: { n: Vec3Like; d: number },
  origin: Vec3Like,
  dir: Vec3Like,
): [number, number] | null {
  const dist = tri.map((p) => P.signedDistance(plane, p))
  // completely coplanar triangles produce no usable segment
  if (dist.every((v) => Math.abs(v) <= PLANAR_TOL)) return null
  const pts: Vec3Like[] = []
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    const di = dist[i]
    const dj = dist[j]
    if (Math.abs(di) <= PLANAR_TOL) {
      pts.push(tri[i])
      continue
    }
    if (Math.abs(dj) <= PLANAR_TOL) continue
    if (di * dj < 0) pts.push(V.lerpV(tri[i], tri[j], di / (di - dj)))
  }
  if (pts.length < 2) return null
  let lo = Infinity
  let hi = -Infinity
  for (const p of pts) {
    const t = V.dot(V.sub(p, origin), dir)
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return hi - lo <= POINT_TOL ? null : [lo, hi]
}

/** Intersection segment of two triangles, or null. */
export function triangleIntersection(a: Triangle, b: Triangle): Segment | null {
  const pa = P.fromPoints(a[0], a[1], a[2])
  const pb = P.fromPoints(b[0], b[1], b[2])
  if (!pa || !pb) return null
  const line = P.intersectPlane(pa, pb)
  if (!line) return null
  const ia = clipTriangle(a, pb, line.origin, line.dir)
  if (!ia) return null
  const ib = clipTriangle(b, pa, line.origin, line.dir)
  if (!ib) return null
  const lo = Math.max(ia[0], ib[0])
  const hi = Math.min(ia[1], ib[1])
  if (hi - lo <= POINT_TOL) return null
  return [V.addScaled(line.origin, line.dir, lo), V.addScaled(line.origin, line.dir, hi)]
}

/** Drops duplicates and joins collinear neighbours. */
export function mergeSegments(segments: readonly Segment[]): Segment[] {
  const kept: Segment[] = []
  for (const seg of segments) {
    if (V.distance(seg[0], seg[1]) <= POINT_TOL) continue
    let merged = false
    for (let i = 0; i < kept.length; i++) {
      const other = kept[i]
      const joined = joinCollinear(other, seg)
      if (joined) {
        kept[i] = joined
        merged = true
        break
      }
    }
    if (!merged) kept.push(seg)
  }
  return kept
}

/** Union of two segments when they are collinear and touch or overlap. */
function joinCollinear(a: Segment, b: Segment): Segment | null {
  const da = V.sub(a[1], a[0])
  const len = V.length(da)
  if (len < MIN_LENGTH) return null
  const dir = V.div(da, len)
  const onLine = (p: Vec3Like): number | null => {
    const rel = V.sub(p, a[0])
    const t = V.dot(rel, dir)
    return V.distance(V.addScaled(a[0], dir, t), p) <= POINT_TOL ? t : null
  }
  const t0 = onLine(b[0])
  const t1 = onLine(b[1])
  if (t0 === null || t1 === null) return null
  const lo = Math.min(0, t0, t1)
  const hi = Math.max(len, t0, t1)
  // disjoint pieces on the same line stay separate
  if (Math.min(t0, t1) > len + POINT_TOL || Math.max(t0, t1) < -POINT_TOL) return null
  return [V.addScaled(a[0], dir, lo), V.addScaled(a[0], dir, hi)]
}

/** All intersection segments between two face sets of one geometry. */
export function intersectionSegments(
  geom: Geometry,
  sourceFaceIds: readonly Id[],
  targetFaceIds: readonly Id[],
): Segment[] {
  const targets = new Set(targetFaceIds)
  const segments: Segment[] = []
  const cache = new Map<Id, Triangle[]>()
  const trisOf = (id: Id): Triangle[] => {
    let t = cache.get(id)
    if (!t) cache.set(id, (t = faceTriangles(geom, id)))
    return t
  }

  for (const sId of sourceFaceIds) {
    const sFace = geom.faces[sId]
    if (!sFace) continue
    for (const tId of targets) {
      if (tId === sId) continue
      const tFace = geom.faces[tId]
      if (!tFace) continue
      // coplanar faces never produce a cutting edge
      if (P.isCoplanar(sFace.plane, tFace.plane, PLANAR_TOL * 4)) continue
      for (const ta of trisOf(sId)) {
        for (const tb of trisOf(tId)) {
          const seg = triangleIntersection(ta, tb)
          if (seg) segments.push(seg)
        }
      }
    }
  }
  return mergeSegments(segments)
}

export function intersectFacesMut(
  geom: Geometry,
  sourceFaceIds: readonly Id[],
  targetFaceIds: readonly Id[] | undefined,
  acc: ChangeAcc,
): void {
  const sources = sourceFaceIds.filter((id) => !!geom.faces[id])
  if (sources.length === 0) return
  const sourceSet = new Set(sources)
  const targets = (targetFaceIds ?? Object.keys(geom.faces)).filter(
    (id) => !!geom.faces[id] && !sourceSet.has(id),
  )
  if (targets.length === 0) return

  const segments = intersectionSegments(geom, sources, targets)
  if (segments.length === 0) return

  // insert everything first, then run face finding once for the whole batch
  const collect = new Set<Id>()
  for (const [a, b] of segments) {
    addEdgeMut(geom, a, b, { tagId: null, materialId: null }, acc, collect)
  }
  runFaceFinding(geom, collect, {}, acc)
}
