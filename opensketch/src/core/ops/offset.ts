/**
 * Polygon offsetting in the plane of a face or of a planar edge path.
 *
 * The ring is projected into the plane basis, every segment is shifted sideways
 * by `distance` and the neighbouring shifted lines are intersected again. That
 * produces correct miters on convex AND concave corners. Segments that turned
 * around during the shift have collapsed (the offset ate them) and are dropped;
 * the process repeats until the ring is stable.
 *
 * Sign convention: positive `distance` moves OUTWARDS, away from the interior
 * of the ring. For open edge paths "outwards" is the right hand side seen along
 * the path with the best fit plane normal pointing at the viewer.
 */

import type { Geometry, Id, Vec2Like, Vec3Like } from '@/shared/types'
import { MIN_LENGTH, P, POINT_TOL, V, V2 } from '@/core/math'
import {
  addPolylineMut,
  loopPoints,
  orderEdgePath,
  pathVertices,
  vertexPoint,
  type AddOptions,
  type ChangeAcc,
} from '@/core/topology'

/** Outward unit normal of the segment a->b for a counter clockwise ring. */
function outwardNormal(a: Vec2Like, b: Vec2Like): Vec2Like | null {
  const d = V2.sub(b, a)
  if (V2.length(d) < MIN_LENGTH) return null
  const n = V2.normalize({ x: d.y, y: -d.x })
  return n
}

/** Intersection of the two infinite lines (p0,d0) and (p1,d1). */
function lineIntersection(p0: Vec2Like, d0: Vec2Like, p1: Vec2Like, d1: Vec2Like): Vec2Like | null {
  const denom = V2.cross(d0, d1)
  if (Math.abs(denom) < 1e-12) return null
  const t = V2.cross(V2.sub(p1, p0), d1) / denom
  return V2.add(p0, V2.mul(d0, t))
}

/**
 * One offset pass over a closed ring. Returns the shifted corner points, or
 * null when the ring degenerated completely.
 */
function offsetClosedOnce(ring: readonly Vec2Like[], distance: number): Vec2Like[] | null {
  const n = ring.length
  if (n < 3) return null
  interface Shifted {
    a: Vec2Like
    b: Vec2Like
    dir: Vec2Like
  }
  const segs: Shifted[] = []
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const nrm = outwardNormal(a, b)
    if (!nrm) continue
    segs.push({
      a: V2.add(a, V2.mul(nrm, distance)),
      b: V2.add(b, V2.mul(nrm, distance)),
      dir: V2.normalize(V2.sub(b, a)),
    })
  }
  if (segs.length < 3) return null

  const out: Vec2Like[] = []
  for (let i = 0; i < segs.length; i++) {
    const prev = segs[(i - 1 + segs.length) % segs.length]
    const cur = segs[i]
    const hit = lineIntersection(prev.a, prev.dir, cur.a, cur.dir)
    // parallel neighbours (collinear corner) simply keep the shifted point
    out.push(hit ?? cur.a)
  }
  return out
}

/** Drops corners whose segment flipped direction - those parts collapsed. */
function pruneCollapsed(original: readonly Vec2Like[], offset: readonly Vec2Like[]): Vec2Like[] {
  const n = offset.length
  const keep = new Array<boolean>(n).fill(true)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const oldDir = V2.sub(original[j % original.length], original[i % original.length])
    const newDir = V2.sub(offset[j], offset[i])
    if (V2.length(newDir) < POINT_TOL) continue
    if (V2.dot(oldDir, newDir) < 0) {
      // the segment turned around: drop its shorter end
      keep[V2.lengthSq(offset[i]) <= V2.lengthSq(offset[j]) ? i : j] = false
    }
  }
  const out: Vec2Like[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(offset[i])
  return out
}

/** Removes duplicate corners. */
function compact(ring: readonly Vec2Like[]): Vec2Like[] {
  const out: Vec2Like[] = []
  for (const p of ring) {
    if (out.length === 0 || V2.distance(out[out.length - 1], p) > POINT_TOL) out.push(p)
  }
  while (out.length > 1 && V2.distance(out[0], out[out.length - 1]) <= POINT_TOL) out.pop()
  return out
}

/** Offsets a closed 2d ring; returns null when it collapses. */
export function offsetRing2D(ring: readonly Vec2Like[], distance: number): Vec2Like[] | null {
  let current = compact(ring)
  if (current.length < 3) return null
  const ccw = V2.signedArea(current) > 0
  if (!ccw) current = [...current].reverse()

  for (let attempt = 0; attempt < 8; attempt++) {
    const shifted = offsetClosedOnce(current, distance)
    if (!shifted) return null
    const pruned = compact(pruneCollapsed(current, shifted))
    if (pruned.length < 3) return null
    if (pruned.length === shifted.length) {
      // a completely inverted ring means the offset consumed the polygon
      if (V2.signedArea(pruned) <= 0) return null
      return ccw ? pruned : pruned.reverse()
    }
    // the ring lost corners - offset the reduced ring from scratch
    current = pruned
  }
  return null
}

/** Offsets an open 2d polyline to one side. */
export function offsetPath2D(path: readonly Vec2Like[], distance: number): Vec2Like[] | null {
  const pts = compact2Open(path)
  if (pts.length < 2) return null
  interface Shifted {
    a: Vec2Like
    dir: Vec2Like
  }
  const segs: Shifted[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const nrm = outwardNormal(pts[i], pts[i + 1])
    if (!nrm) continue
    segs.push({ a: V2.add(pts[i], V2.mul(nrm, distance)), dir: V2.normalize(V2.sub(pts[i + 1], pts[i])) })
  }
  if (segs.length === 0) return null

  const out: Vec2Like[] = [segs[0].a]
  for (let i = 1; i < segs.length; i++) {
    const hit = lineIntersection(segs[i - 1].a, segs[i - 1].dir, segs[i].a, segs[i].dir)
    out.push(hit ?? segs[i].a)
  }
  const last = segs[segs.length - 1]
  const lastLen = V2.distance(pts[pts.length - 2], pts[pts.length - 1])
  out.push(V2.add(last.a, V2.mul(last.dir, lastLen)))
  return compact2Open(out)
}

function compact2Open(ring: readonly Vec2Like[]): Vec2Like[] {
  const out: Vec2Like[] = []
  for (const p of ring) {
    if (out.length === 0 || V2.distance(out[out.length - 1], p) > POINT_TOL) out.push(p)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Geometry level                                                      */
/* ------------------------------------------------------------------ */

/**
 * Offsets the outer loop of a face inside its own plane and inserts the result
 * as new edges. Positive distance grows the face, negative shrinks it.
 */
export function offsetFaceMut(
  geom: Geometry,
  faceId: Id,
  distance: number,
  acc: ChangeAcc,
): void {
  const face = geom.faces[faceId]
  if (!face) return
  if (Math.abs(distance) <= POINT_TOL) return
  const pts3 = loopPoints(geom, face.outer)
  if (pts3.length < 3) return

  const frame = P.frame(face.plane)
  const ring = pts3.map(frame.to2d)
  const offset = offsetRing2D(ring, distance)
  if (!offset || offset.length < 3) return

  const opts: AddOptions = { tagId: face.tagId, materialId: null }
  addPolylineMut(geom, offset.map(frame.from2d), true, opts, acc)
}

/**
 * Offsets a connected planar edge path. Closed paths are offset like a ring,
 * open paths sideways with square ends.
 */
export function offsetEdgesMut(
  geom: Geometry,
  edgeIds: readonly Id[],
  distance: number,
  acc: ChangeAcc,
): void {
  if (Math.abs(distance) <= POINT_TOL) return
  const path = orderEdgePath(geom, edgeIds)
  if (!path || path.length === 0) return
  const chain = pathVertices(geom, path)
  if (chain.length < 2) return
  const closed = chain.length > 2 && chain[0] === chain[chain.length - 1]
  const nodeIds = closed ? chain.slice(0, -1) : chain
  const pts3 = nodeIds.map((id) => vertexPoint(geom, id))
  if (pts3.length < 2) return

  const plane = closed ? P.fromPolygon(pts3) : P.bestFit(pts3)
  if (!plane) return
  const frame = P.frame(plane)
  const ring = pts3.map(frame.to2d)

  const source = geom.edges[path[0]]
  const opts: AddOptions = { tagId: source?.tagId ?? null, materialId: null }

  if (closed) {
    const offset = offsetRing2D(ring, distance)
    if (!offset || offset.length < 3) return
    addPolylineMut(geom, offset.map(frame.from2d), true, opts, acc)
    return
  }
  const offset = offsetPath2D(ring, distance)
  if (!offset || offset.length < 2) return
  addPolylineMut(geom, offset.map(frame.from2d), false, opts, acc)
}

/** Convenience for callers that only need the offset points of a face. */
export function offsetFacePoints(geom: Geometry, faceId: Id, distance: number): Vec3Like[] | null {
  const face = geom.faces[faceId]
  if (!face) return null
  const frame = P.frame(face.plane)
  const ring = loopPoints(geom, face.outer).map(frame.to2d)
  const offset = offsetRing2D(ring, distance)
  return offset ? offset.map(frame.from2d) : null
}
