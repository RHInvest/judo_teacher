/**
 * Ray / segment / triangle intersection helpers used by picking, inference and
 * the geometry kernel.
 *
 * OWNERSHIP: lead developer.
 */

import type { BBox3Like, Vec3Like } from '@/shared/types'
import { EPS, MIN_LENGTH, clamp } from './constants'
import * as V from './vec3'

export interface Ray {
  origin: Vec3Like
  dir: Vec3Like
}

export function ray(origin: Vec3Like, dir: Vec3Like): Ray {
  return { origin, dir: V.normalize(dir) }
}

export function at(r: Ray, t: number): Vec3Like {
  return V.addScaled(r.origin, r.dir, t)
}

/** closest point on the infinite line through a-b to point p */
export function closestPointOnLine(a: Vec3Like, b: Vec3Like, p: Vec3Like): { point: Vec3Like; t: number } {
  const ab = V.sub(b, a)
  const lsq = V.lengthSq(ab)
  if (lsq < EPS) return { point: V.clone(a), t: 0 }
  const t = V.dot(V.sub(p, a), ab) / lsq
  return { point: V.addScaled(a, ab, t), t }
}

/** closest point on the SEGMENT a-b to point p, t clamped to [0,1] */
export function closestPointOnSegment(a: Vec3Like, b: Vec3Like, p: Vec3Like): { point: Vec3Like; t: number } {
  const res = closestPointOnLine(a, b, p)
  const t = clamp(res.t, 0, 1)
  return { point: V.lerpV(a, b, t), t }
}

export function distanceToSegment(a: Vec3Like, b: Vec3Like, p: Vec3Like): number {
  return V.distance(closestPointOnSegment(a, b, p).point, p)
}

/**
 * Closest points between two infinite lines.
 * Returns null when the lines are (nearly) parallel.
 */
export function closestPointsBetweenLines(
  p1: Vec3Like,
  d1: Vec3Like,
  p2: Vec3Like,
  d2: Vec3Like,
): { t1: number; t2: number; point1: Vec3Like; point2: Vec3Like } | null {
  const r = V.sub(p1, p2)
  const a = V.dot(d1, d1)
  const b = V.dot(d1, d2)
  const c = V.dot(d2, d2)
  const d = V.dot(d1, r)
  const e = V.dot(d2, r)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-12) return null
  const t1 = (b * e - c * d) / denom
  const t2 = (a * e - b * d) / denom
  return {
    t1,
    t2,
    point1: V.addScaled(p1, d1, t1),
    point2: V.addScaled(p2, d2, t2),
  }
}

/**
 * Intersection of two SEGMENTS in 3d within `tol`.
 * Returns the point plus the parameters on both segments, or null.
 */
export function intersectSegments(
  a0: Vec3Like,
  a1: Vec3Like,
  b0: Vec3Like,
  b1: Vec3Like,
  tol: number,
): { point: Vec3Like; ta: number; tb: number } | null {
  const da = V.sub(a1, a0)
  const db = V.sub(b1, b0)
  const la = V.length(da)
  const lb = V.length(db)
  if (la < MIN_LENGTH || lb < MIN_LENGTH) return null
  const res = closestPointsBetweenLines(a0, da, b0, db)
  if (!res) return null
  if (res.t1 < -tol / la || res.t1 > 1 + tol / la) return null
  if (res.t2 < -tol / lb || res.t2 > 1 + tol / lb) return null
  if (V.distance(res.point1, res.point2) > tol) return null
  return {
    point: V.midpoint(res.point1, res.point2),
    ta: clamp(res.t1, 0, 1),
    tb: clamp(res.t2, 0, 1),
  }
}

/** distance from a ray to a segment plus the closest point on the segment */
export function rayToSegment(
  r: Ray,
  a: Vec3Like,
  b: Vec3Like,
): { distance: number; pointOnSegment: Vec3Like; t: number; rayT: number } {
  const ab = V.sub(b, a)
  const res = closestPointsBetweenLines(r.origin, r.dir, a, ab)
  if (!res) {
    const c = closestPointOnSegment(a, b, r.origin)
    return { distance: V.distance(c.point, r.origin), pointOnSegment: c.point, t: c.t, rayT: 0 }
  }
  const t = clamp(res.t2, 0, 1)
  const pointOnSegment = V.lerpV(a, b, t)
  // recompute the closest ray point for the clamped segment point
  const rayT = Math.max(0, V.dot(V.sub(pointOnSegment, r.origin), r.dir))
  const pointOnRay = at(r, rayT)
  return { distance: V.distance(pointOnRay, pointOnSegment), pointOnSegment, t, rayT }
}

/** Moeller-Trumbore. Returns the ray parameter t, or null. */
export function intersectTriangle(
  r: Ray,
  a: Vec3Like,
  b: Vec3Like,
  c: Vec3Like,
  backfaceCulling = false,
): { t: number; u: number; v: number; point: Vec3Like } | null {
  const edge1 = V.sub(b, a)
  const edge2 = V.sub(c, a)
  const pvec = V.cross(r.dir, edge2)
  const det = V.dot(edge1, pvec)
  if (backfaceCulling) {
    if (det < EPS) return null
  } else if (Math.abs(det) < EPS) {
    return null
  }
  const invDet = 1 / det
  const tvec = V.sub(r.origin, a)
  const u = V.dot(tvec, pvec) * invDet
  if (u < -1e-9 || u > 1 + 1e-9) return null
  const qvec = V.cross(tvec, edge1)
  const v = V.dot(r.dir, qvec) * invDet
  if (v < -1e-9 || u + v > 1 + 1e-9) return null
  const t = V.dot(edge2, qvec) * invDet
  if (t < 0) return null
  return { t, u, v, point: at(r, t) }
}

/** slab test; returns entry/exit parameters or null */
export function intersectBox(r: Ray, box: BBox3Like): { tMin: number; tMax: number } | null {
  let tMin = -Infinity
  let tMax = Infinity
  const o = [r.origin.x, r.origin.y, r.origin.z]
  const d = [r.dir.x, r.dir.y, r.dir.z]
  const lo = [box.min.x, box.min.y, box.min.z]
  const hi = [box.max.x, box.max.y, box.max.z]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < EPS) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null
      continue
    }
    const inv = 1 / d[i]
    let t1 = (lo[i] - o[i]) * inv
    let t2 = (hi[i] - o[i]) * inv
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }
  if (tMax < 0) return null
  return { tMin, tMax }
}

export function intersectSphere(r: Ray, center: Vec3Like, radius: number): number | null {
  const oc = V.sub(r.origin, center)
  const b = V.dot(oc, r.dir)
  const c = V.lengthSq(oc) - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t0 = -b - sq
  const t1 = -b + sq
  if (t0 >= 0) return t0
  if (t1 >= 0) return t1
  return null
}

/** cylinder around the segment a-b, used for thick edge picking in 3d */
export function intersectCapsule(r: Ray, a: Vec3Like, b: Vec3Like, radius: number): number | null {
  const res = rayToSegment(r, a, b)
  if (res.distance > radius) return null
  return res.rayT
}
