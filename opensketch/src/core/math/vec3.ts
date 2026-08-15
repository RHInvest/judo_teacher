/**
 * Immutable 3D vector helpers operating on plain `{x,y,z}` objects.
 *
 * Plain objects (instead of a class) keep every value structurally cloneable,
 * JSON serializable and directly usable in the undo system.
 *
 * COORDINATE SYSTEM: right handed, Z is UP (like SketchUp).
 *   +X = red axis (right), +Y = green axis (into the screen / north), +Z = blue axis (up)
 *
 * OWNERSHIP: lead developer.
 */

import type { Mat4Like, Vec3Like } from '@/shared/types'
import { EPS, MIN_LENGTH, POINT_TOL, POINT_TOL_SQ, clamp } from './constants'

export const ORIGIN: Vec3Like = Object.freeze({ x: 0, y: 0, z: 0 })
export const AXIS_X: Vec3Like = Object.freeze({ x: 1, y: 0, z: 0 })
export const AXIS_Y: Vec3Like = Object.freeze({ x: 0, y: 1, z: 0 })
export const AXIS_Z: Vec3Like = Object.freeze({ x: 0, y: 0, z: 1 })
export const AXES: readonly Vec3Like[] = Object.freeze([AXIS_X, AXIS_Y, AXIS_Z])

export function v3(x = 0, y = 0, z = 0): Vec3Like {
  return { x, y, z }
}

export function clone(a: Vec3Like): Vec3Like {
  return { x: a.x, y: a.y, z: a.z }
}

export function add(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function mul(a: Vec3Like, s: number): Vec3Like {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function mulVec(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z }
}

export function div(a: Vec3Like, s: number): Vec3Like {
  return s === 0 ? v3() : { x: a.x / s, y: a.y / s, z: a.z / s }
}

export function negate(a: Vec3Like): Vec3Like {
  return { x: -a.x, y: -a.y, z: -a.z }
}

/** a + b * s - the workhorse for "move along a direction" */
export function addScaled(a: Vec3Like, b: Vec3Like, s: number): Vec3Like {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }
}

export function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3Like, b: Vec3Like): Vec3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function lengthSq(a: Vec3Like): number {
  return a.x * a.x + a.y * a.y + a.z * a.z
}

export function length(a: Vec3Like): number {
  return Math.sqrt(lengthSq(a))
}

export function distanceSq(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.sqrt(distanceSq(a, b))
}

export function normalize(a: Vec3Like): Vec3Like {
  const len = length(a)
  if (len < MIN_LENGTH) return v3()
  return { x: a.x / len, y: a.y / len, z: a.z / len }
}

/** normalize, falling back to `fallback` for degenerate input */
export function normalizeOr(a: Vec3Like, fallback: Vec3Like): Vec3Like {
  const len = length(a)
  if (len < MIN_LENGTH) return clone(fallback)
  return { x: a.x / len, y: a.y / len, z: a.z / len }
}

export function lerpV(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

export function midpoint(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 }
}

export function equals(a: Vec3Like, b: Vec3Like, tol = POINT_TOL): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol
}

export function equalsSq(a: Vec3Like, b: Vec3Like, tolSq = POINT_TOL_SQ): boolean {
  return distanceSq(a, b) <= tolSq
}

export function isZero(a: Vec3Like, tol = MIN_LENGTH): boolean {
  return lengthSq(a) <= tol * tol
}

export function minV(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }
}

export function maxV(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) }
}

export function absV(a: Vec3Like): Vec3Like {
  return { x: Math.abs(a.x), y: Math.abs(a.y), z: Math.abs(a.z) }
}

/** angle between two vectors in radians, 0..pi */
export function angleBetween(a: Vec3Like, b: Vec3Like): number {
  const la = length(a)
  const lb = length(b)
  if (la < MIN_LENGTH || lb < MIN_LENGTH) return 0
  return Math.acos(clamp(dot(a, b) / (la * lb), -1, 1))
}

/** signed angle from a to b around `axis` (right hand rule), -pi..pi */
export function signedAngle(a: Vec3Like, b: Vec3Like, axis: Vec3Like): number {
  const angle = angleBetween(a, b)
  return dot(cross(a, b), axis) < 0 ? -angle : angle
}

/** true when the vectors point along the same line (either direction) */
export function isParallel(a: Vec3Like, b: Vec3Like, tol = 1e-6): boolean {
  return lengthSq(cross(normalize(a), normalize(b))) <= tol * tol
}

export function isPerpendicular(a: Vec3Like, b: Vec3Like, tol = 1e-6): boolean {
  return Math.abs(dot(normalize(a), normalize(b))) <= tol
}

/** projection of a onto b */
export function projectOnVector(a: Vec3Like, b: Vec3Like): Vec3Like {
  const lsq = lengthSq(b)
  if (lsq < EPS) return v3()
  return mul(b, dot(a, b) / lsq)
}

/** component of a perpendicular to `normal` */
export function projectOnPlaneNormal(a: Vec3Like, normal: Vec3Like): Vec3Like {
  const n = normalize(normal)
  return sub(a, mul(n, dot(a, n)))
}

export function reflect(a: Vec3Like, normal: Vec3Like): Vec3Like {
  const n = normalize(normal)
  return sub(a, mul(n, 2 * dot(a, n)))
}

/** any unit vector perpendicular to `a` (stable for all inputs) */
export function anyPerpendicular(a: Vec3Like): Vec3Like {
  const n = normalize(a)
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  const other = ax <= ay && ax <= az ? AXIS_X : ay <= az ? AXIS_Y : AXIS_Z
  return normalize(cross(n, other))
}

/** rotates `a` around a unit `axis` through the origin by `angle` radians */
export function rotateAround(a: Vec3Like, axis: Vec3Like, angle: number): Vec3Like {
  const k = normalize(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const kd = dot(k, a)
  const kc = cross(k, a)
  return {
    x: a.x * c + kc.x * s + k.x * kd * (1 - c),
    y: a.y * c + kc.y * s + k.y * kd * (1 - c),
    z: a.z * c + kc.z * s + k.z * kd * (1 - c),
  }
}

/** rotates `p` around the line (`origin`, `axis`) */
export function rotateAboutLine(p: Vec3Like, origin: Vec3Like, axis: Vec3Like, angle: number): Vec3Like {
  return add(origin, rotateAround(sub(p, origin), axis, angle))
}

/** applies a full 4x4 matrix (with translation) to a point */
export function applyMat4(p: Vec3Like, m: Mat4Like): Vec3Like {
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15] || 1
  return {
    x: (m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w,
    y: (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w,
    z: (m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]) / w,
  }
}

/** applies only the rotation/scale part - use for directions and normals */
export function applyMat4Direction(d: Vec3Like, m: Mat4Like): Vec3Like {
  return {
    x: m[0] * d.x + m[4] * d.y + m[8] * d.z,
    y: m[1] * d.x + m[5] * d.y + m[9] * d.z,
    z: m[2] * d.x + m[6] * d.y + m[10] * d.z,
  }
}

export function toArray(a: Vec3Like): [number, number, number] {
  return [a.x, a.y, a.z]
}

export function fromArray(arr: ArrayLike<number>, offset = 0): Vec3Like {
  return { x: arr[offset], y: arr[offset + 1], z: arr[offset + 2] }
}

/** rounds each component to `decimals` - used to stabilize serialization */
export function round(a: Vec3Like, decimals = 9): Vec3Like {
  const f = Math.pow(10, decimals)
  return { x: Math.round(a.x * f) / f, y: Math.round(a.y * f) / f, z: Math.round(a.z * f) / f }
}

/** hash key for spatial deduplication at POINT_TOL resolution */
export function key(a: Vec3Like, tol = POINT_TOL): string {
  const q = 1 / tol
  return `${Math.round(a.x * q)},${Math.round(a.y * q)},${Math.round(a.z * q)}`
}

/** centroid of a point list */
export function centroid(points: readonly Vec3Like[]): Vec3Like {
  if (points.length === 0) return v3()
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = points.length
  return { x: x / n, y: y / n, z: z / n }
}

/** which of the three main axes the direction is closest to */
export function dominantAxis(d: Vec3Like): 0 | 1 | 2 {
  const a = absV(d)
  if (a.x >= a.y && a.x >= a.z) return 0
  return a.y >= a.z ? 1 : 2
}

export function isFinite3(a: Vec3Like): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)
}
