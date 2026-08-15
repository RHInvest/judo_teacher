/**
 * Plane helpers. A plane is `{ n, d }` with a UNIT normal and
 * `dot(n, p) - d === 0` for every point p on the plane.
 *
 * OWNERSHIP: lead developer.
 */

import type { PlaneLike, Vec3Like } from '@/shared/types'
import { EPS, MIN_LENGTH, PLANAR_TOL } from './constants'
import * as V from './vec3'

export function fromNormalAndPoint(normal: Vec3Like, point: Vec3Like): PlaneLike {
  const n = V.normalize(normal)
  return { n, d: V.dot(n, point) }
}

export function fromNormalAndDistance(normal: Vec3Like, d: number): PlaneLike {
  return { n: V.normalize(normal), d }
}

/** plane through three points, null when they are collinear */
export function fromPoints(a: Vec3Like, b: Vec3Like, c: Vec3Like): PlaneLike | null {
  const n = V.cross(V.sub(b, a), V.sub(c, a))
  if (V.length(n) < MIN_LENGTH) return null
  return fromNormalAndPoint(n, a)
}

/**
 * Newell's method: robust best fit plane through an arbitrary polygon, also
 * correct for slightly non planar and concave loops. Returns null for
 * degenerate input.
 */
export function fromPolygon(points: readonly Vec3Like[]): PlaneLike | null {
  const n = polygonNormal(points)
  if (!n) return null
  return fromNormalAndPoint(n, V.centroid(points))
}

/** Newell normal of a polygon loop (not normalized length = 2 * area) */
export function polygonNormalRaw(points: readonly Vec3Like[]): Vec3Like {
  let nx = 0
  let ny = 0
  let nz = 0
  const count = points.length
  for (let i = 0; i < count; i++) {
    const cur = points[i]
    const next = points[(i + 1) % count]
    nx += (cur.y - next.y) * (cur.z + next.z)
    ny += (cur.z - next.z) * (cur.x + next.x)
    nz += (cur.x - next.x) * (cur.y + next.y)
  }
  return { x: nx, y: ny, z: nz }
}

export function polygonNormal(points: readonly Vec3Like[]): Vec3Like | null {
  if (points.length < 3) return null
  const raw = polygonNormalRaw(points)
  if (V.length(raw) < MIN_LENGTH) return null
  return V.normalize(raw)
}

/** area of a planar polygon in 3d */
export function polygonArea(points: readonly Vec3Like[]): number {
  if (points.length < 3) return 0
  return V.length(polygonNormalRaw(points)) * 0.5
}

export function signedDistance(plane: PlaneLike, p: Vec3Like): number {
  return V.dot(plane.n, p) - plane.d
}

export function containsPoint(plane: PlaneLike, p: Vec3Like, tol = PLANAR_TOL): boolean {
  return Math.abs(signedDistance(plane, p)) <= tol
}

export function projectPoint(plane: PlaneLike, p: Vec3Like): Vec3Like {
  return V.addScaled(p, plane.n, -signedDistance(plane, p))
}

/** projects a direction so it lies in the plane */
export function projectDirection(plane: PlaneLike, d: Vec3Like): Vec3Like {
  return V.sub(d, V.mul(plane.n, V.dot(d, plane.n)))
}

export function flip(plane: PlaneLike): PlaneLike {
  return { n: V.negate(plane.n), d: -plane.d }
}

export function equals(a: PlaneLike, b: PlaneLike, tol = PLANAR_TOL): boolean {
  return V.equals(a.n, b.n, 1e-6) && Math.abs(a.d - b.d) <= tol
}

/** same plane, ignoring the normal direction */
export function isCoplanar(a: PlaneLike, b: PlaneLike, tol = PLANAR_TOL): boolean {
  return equals(a, b, tol) || equals(a, flip(b), tol)
}

/** intersection parameter t of a ray with a plane, null when parallel */
export function intersectRay(plane: PlaneLike, origin: Vec3Like, dir: Vec3Like): number | null {
  const denom = V.dot(plane.n, dir)
  if (Math.abs(denom) < EPS) return null
  return (plane.d - V.dot(plane.n, origin)) / denom
}

export function intersectRayPoint(plane: PlaneLike, origin: Vec3Like, dir: Vec3Like): Vec3Like | null {
  const t = intersectRay(plane, origin, dir)
  if (t === null) return null
  return V.addScaled(origin, dir, t)
}

/** intersection of a finite segment with a plane */
export function intersectSegment(plane: PlaneLike, a: Vec3Like, b: Vec3Like, tol = PLANAR_TOL): Vec3Like | null {
  const da = signedDistance(plane, a)
  const db = signedDistance(plane, b)
  if (Math.abs(da) <= tol) return V.clone(a)
  if (Math.abs(db) <= tol) return V.clone(b)
  if (da * db > 0) return null
  const t = da / (da - db)
  return V.lerpV(a, b, t)
}

/** line of intersection of two planes, null when parallel */
export function intersectPlane(a: PlaneLike, b: PlaneLike): { origin: Vec3Like; dir: Vec3Like } | null {
  const dir = V.cross(a.n, b.n)
  const len = V.length(dir)
  if (len < 1e-8) return null
  const d = V.normalize(dir)
  // point on both planes, closest to the origin
  const n1n2 = V.dot(a.n, b.n)
  const det = 1 - n1n2 * n1n2
  const c1 = (a.d - b.d * n1n2) / det
  const c2 = (b.d - a.d * n1n2) / det
  const origin = V.add(V.mul(a.n, c1), V.mul(b.n, c2))
  return { origin, dir: d }
}

/**
 * An orthonormal 2d basis for the plane. `u` is chosen so that it aligns with
 * the world axes whenever possible, which keeps generated UVs and 2d
 * projections stable and predictable.
 */
export function basis(plane: PlaneLike): { u: Vec3Like; v: Vec3Like } {
  const n = plane.n
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  // prefer a world axis that is not (nearly) parallel to the normal
  const reference = az <= ax && az <= ay ? V.AXIS_Z : ay <= ax ? V.AXIS_Y : V.AXIS_X
  let u = V.cross(reference, n)
  if (V.length(u) < 1e-8) u = V.anyPerpendicular(n)
  u = V.normalize(u)
  const v = V.normalize(V.cross(n, u))
  return { u, v }
}

/** projects a 3d point onto the plane's 2d basis, relative to `origin` */
export function to2d(p: Vec3Like, origin: Vec3Like, u: Vec3Like, v: Vec3Like): { x: number; y: number } {
  const rel = V.sub(p, origin)
  return { x: V.dot(rel, u), y: V.dot(rel, v) }
}

export function from2d(p: { x: number; y: number }, origin: Vec3Like, u: Vec3Like, v: Vec3Like): Vec3Like {
  return V.add(origin, V.add(V.mul(u, p.x), V.mul(v, p.y)))
}

/** convenience: full 2d projection context for a plane */
export interface PlaneFrame {
  plane: PlaneLike
  origin: Vec3Like
  u: Vec3Like
  v: Vec3Like
  to2d(p: Vec3Like): { x: number; y: number }
  from2d(p: { x: number; y: number }): Vec3Like
}

export function frame(plane: PlaneLike, origin?: Vec3Like): PlaneFrame {
  const o = origin ?? V.mul(plane.n, plane.d)
  const { u, v } = basis(plane)
  return {
    plane,
    origin: o,
    u,
    v,
    to2d: (p: Vec3Like) => to2d(p, o, u, v),
    from2d: (p: { x: number; y: number }) => from2d(p, o, u, v),
  }
}

/** best fit plane through a point cloud; falls back to the XY plane */
export function bestFit(points: readonly Vec3Like[]): PlaneLike {
  const plane = fromPolygon(points)
  if (plane) return plane
  if (points.length >= 2) {
    const dir = V.normalize(V.sub(points[1], points[0]))
    return fromNormalAndPoint(V.anyPerpendicular(dir), points[0])
  }
  return { n: { x: 0, y: 0, z: 1 }, d: points.length ? points[0].z : 0 }
}

/** true when every point lies within `tol` of the plane */
export function arePointsCoplanar(points: readonly Vec3Like[], tol = PLANAR_TOL): boolean {
  if (points.length <= 3) return true
  const plane = fromPolygon(points)
  if (!plane) return true
  return points.every((p) => containsPoint(plane, p, tol))
}
