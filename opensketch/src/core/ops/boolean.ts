/**
 * Boolean operations between two closed volumes.
 *
 * Pragmatic, robustness-first approach (no exact predicates, no BSP):
 *   1. both operands are cloned and every face/face intersection segment is
 *      inserted into BOTH clones as an ordinary edge - the existing splitting
 *      and face finding machinery then cuts every face that straddles the other
 *      solid into pieces that lie completely inside or completely outside
 *   2. each resulting face is classified with a parity raycast from a point in
 *      its interior against the other solid
 *   3. the kept faces are re-assembled into a fresh geometry, with the faces
 *      taken from B reversed for `subtract`
 *
 * Known limitation: faces of A and B that are exactly coplanar and overlapping
 * are ambiguous. They are classified as 'on' and only the copy coming from A
 * survives (union) or both are dropped (intersect), which is right for stacked
 * boxes but can leave a seam in more exotic configurations.
 */

import type { Geometry, Id, Vec3Like } from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { MIN_LENGTH, POINT_TOL, R, V } from '@/core/math'
import {
  addEdgeMut,
  addFacePolygonMut,
  cleanupMut,
  cloneGeometryDeep,
  newAcc,
  runFaceFinding,
  type ChangeAcc,
} from '@/core/topology'
import { faceHoleVertices, faceVertices, isSolid } from '@/core/query'
import { faceTriangles } from '@/core/query/triangulate'
import { mergeSegments, triangleIntersection, type Segment, type Triangle } from './intersect'

export type BooleanOp = 'union' | 'subtract' | 'intersect'
export type PointClass = 'inside' | 'outside' | 'on'

/** A direction that is unlikely to graze an edge or a vertex. */
const PROBE_DIR: Vec3Like = V.normalize({ x: 0.5211, y: 0.3117, z: 0.7943 })

/**
 * Parity test: a ray from `p` crosses an odd number of faces exactly when p is
 * enclosed by the shell. Hits at distance ~0 mean the point sits ON a face.
 */
export function classifyPoint(geom: Geometry, p: Vec3Like, dir: Vec3Like = PROBE_DIR): PointClass {
  const ray = R.ray(p, dir)
  let crossings = 0
  for (const fId in geom.faces) {
    let nearest: number | null = null
    for (const [a, b, c] of faceTriangles(geom, fId)) {
      const hit = R.intersectTriangle(ray, a, b, c, false)
      if (!hit) continue
      if (nearest === null || hit.t < nearest) nearest = hit.t
    }
    if (nearest === null) continue
    if (nearest <= POINT_TOL) return 'on'
    // one planar face can be crossed at most once
    crossings++
  }
  return crossings % 2 === 1 ? 'inside' : 'outside'
}

/** A point in the interior of the face, holes excluded. */
function faceProbePoint(geom: Geometry, faceId: Id): Vec3Like | null {
  let best: Vec3Like | null = null
  let bestArea = 0
  for (const [a, b, c] of faceTriangles(geom, faceId)) {
    const area = V.length(V.cross(V.sub(b, a), V.sub(c, a))) * 0.5
    if (area <= bestArea) continue
    bestArea = area
    best = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 }
  }
  return bestArea > MIN_LENGTH ? best : null
}

/** Intersection segments between the faces of two separate geometries. */
export function crossIntersectionSegments(ga: Geometry, gb: Geometry): Segment[] {
  const trisA = new Map<Id, Triangle[]>()
  for (const id in ga.faces) trisA.set(id, faceTriangles(ga, id))
  const trisB = new Map<Id, Triangle[]>()
  for (const id in gb.faces) trisB.set(id, faceTriangles(gb, id))

  const segments: Segment[] = []
  for (const [, ta] of trisA) {
    for (const [, tb] of trisB) {
      for (const x of ta) {
        for (const y of tb) {
          const seg = triangleIntersection(x, y)
          if (seg) segments.push(seg)
        }
      }
    }
  }
  return mergeSegments(segments)
}

/** Inserts the cutting segments and lets the face finder rebuild the surface. */
function imprint(geom: Geometry, segments: readonly Segment[], acc: ChangeAcc): void {
  if (segments.length === 0) return
  const collect = new Set<Id>()
  for (const [a, b] of segments) {
    if (V.distance(a, b) <= POINT_TOL) continue
    addEdgeMut(geom, a, b, { tagId: null, materialId: null }, acc, collect)
  }
  runFaceFinding(geom, collect, {}, acc)
}

/** Copies a face (optionally reversed) into the result geometry. */
function emitFace(target: Geometry, source: Geometry, faceId: Id, reverse: boolean, acc: ChangeAcc): void {
  const face = source.faces[faceId]
  if (!face) return
  let outer = faceVertices(source, faceId)
  let holes = face.inner.map((_, i) => faceHoleVertices(source, faceId, i))
  if (reverse) {
    outer = [...outer].reverse()
    holes = holes.map((h) => [...h].reverse())
  }
  if (outer.length < 3) return
  addFacePolygonMut(target, outer, holes, { tagId: face.tagId, materialId: face.frontMaterialId }, acc)
}

/**
 * Union / subtract / intersect of two closed volumes. Returns null when the
 * operands are not usable solids or the result would be empty.
 */
export function booleanSolidOp(a: Geometry, b: Geometry, op: BooleanOp): Geometry | null {
  if (!isSolid(a) || !isSolid(b)) return null

  const workA = cloneGeometryDeep(a)
  const workB = cloneGeometryDeep(b)
  const segments = crossIntersectionSegments(workA, workB)

  const scratch = newAcc()
  imprint(workA, segments, scratch)
  imprint(workB, segments, scratch)

  const result = emptyGeometry()
  const acc = newAcc()

  // faces of A, classified against the ORIGINAL b (its shell is unchanged)
  for (const fId of Object.keys(workA.faces)) {
    const probe = faceProbePoint(workA, fId)
    if (!probe) continue
    const cls = classifyPoint(b, probe)
    const keep =
      op === 'union' ? cls !== 'inside' : op === 'intersect' ? cls === 'inside' : cls !== 'inside'
    if (keep) emitFace(result, workA, fId, false, acc)
  }

  // faces of B
  for (const fId of Object.keys(workB.faces)) {
    const probe = faceProbePoint(workB, fId)
    if (!probe) continue
    const cls = classifyPoint(a, probe)
    // 'on' faces of B duplicate a face of A that was already emitted
    if (cls === 'on') continue
    const keep =
      op === 'union' ? cls === 'outside' : op === 'intersect' ? cls === 'inside' : cls === 'inside'
    if (!keep) continue
    // subtracting turns the inner shell inside out
    emitFace(result, workB, fId, op === 'subtract', acc)
  }

  cleanupMut(result, acc)
  if (Object.keys(result.faces).length === 0) return null
  return result
}
