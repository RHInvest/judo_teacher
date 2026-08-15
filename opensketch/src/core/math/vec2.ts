/**
 * 2D helpers used for planar polygon work (triangulation, offsetting, boolean
 * loops) and for screen space math.
 *
 * OWNERSHIP: lead developer.
 */

import type { Vec2Like } from '@/shared/types'
import { EPS, clamp } from './constants'

export function v2(x = 0, y = 0): Vec2Like {
  return { x, y }
}

export function add(a: Vec2Like, b: Vec2Like): Vec2Like {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2Like, b: Vec2Like): Vec2Like {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function mul(a: Vec2Like, s: number): Vec2Like {
  return { x: a.x * s, y: a.y * s }
}

export function dot(a: Vec2Like, b: Vec2Like): number {
  return a.x * b.x + a.y * b.y
}

/** z component of the 3d cross product - positive when b is left of a */
export function cross(a: Vec2Like, b: Vec2Like): number {
  return a.x * b.y - a.y * b.x
}

export function length(a: Vec2Like): number {
  return Math.hypot(a.x, a.y)
}

export function lengthSq(a: Vec2Like): number {
  return a.x * a.x + a.y * a.y
}

export function distance(a: Vec2Like, b: Vec2Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function normalize(a: Vec2Like): Vec2Like {
  const l = length(a)
  return l < EPS ? v2() : { x: a.x / l, y: a.y / l }
}

export function perp(a: Vec2Like): Vec2Like {
  return { x: -a.y, y: a.x }
}

export function lerp(a: Vec2Like, b: Vec2Like, t: number): Vec2Like {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function angle(a: Vec2Like): number {
  return Math.atan2(a.y, a.x)
}

export function rotate(a: Vec2Like, radians: number): Vec2Like {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export function equals(a: Vec2Like, b: Vec2Like, tol = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
}

/* ------------------------------------------------------------------ */
/* Polygon helpers                                                     */
/* ------------------------------------------------------------------ */

/** positive for counter clockwise loops */
export function signedArea(points: readonly Vec2Like[]): number {
  let sum = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    sum += a.x * b.y - b.x * a.y
  }
  return sum * 0.5
}

export function isCounterClockwise(points: readonly Vec2Like[]): boolean {
  return signedArea(points) > 0
}

export function perimeter(points: readonly Vec2Like[], closed = true): number {
  let sum = 0
  const n = points.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) sum += distance(points[i], points[(i + 1) % n])
  return sum
}

export function centroid(points: readonly Vec2Like[]): Vec2Like {
  const area = signedArea(points)
  if (Math.abs(area) < EPS) {
    let x = 0
    let y = 0
    for (const p of points) {
      x += p.x
      y += p.y
    }
    return { x: x / (points.length || 1), y: y / (points.length || 1) }
  }
  let cx = 0
  let cy = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const f = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * f
    cy += (a.y + b.y) * f
  }
  return { x: cx / (6 * area), y: cy / (6 * area) }
}

/** even-odd ray casting; points exactly on the boundary count as inside */
export function pointInPolygon(p: Vec2Like, polygon: readonly Vec2Like[], tol = 1e-12): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (distanceToSegment(p, a, b) <= tol) return true
    const intersect = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

export function distanceToSegment(p: Vec2Like, a: Vec2Like, b: Vec2Like): number {
  const ab = sub(b, a)
  const lsq = lengthSq(ab)
  if (lsq < EPS) return distance(p, a)
  const t = clamp(dot(sub(p, a), ab) / lsq, 0, 1)
  return distance(p, add(a, mul(ab, t)))
}

/** intersection of two 2d segments, null when they do not cross */
export function intersectSegments(
  a0: Vec2Like,
  a1: Vec2Like,
  b0: Vec2Like,
  b1: Vec2Like,
  tol = 1e-12,
): { point: Vec2Like; ta: number; tb: number } | null {
  const da = sub(a1, a0)
  const db = sub(b1, b0)
  const denom = cross(da, db)
  if (Math.abs(denom) < tol) return null
  const diff = sub(b0, a0)
  const ta = cross(diff, db) / denom
  const tb = cross(diff, da) / denom
  if (ta < -1e-9 || ta > 1 + 1e-9 || tb < -1e-9 || tb > 1 + 1e-9) return null
  return { point: add(a0, mul(da, clamp(ta, 0, 1))), ta: clamp(ta, 0, 1), tb: clamp(tb, 0, 1) }
}

/** true when the polygon has no self intersections */
export function isSimplePolygon(points: readonly Vec2Like[]): boolean {
  const n = points.length
  if (n < 4) return true
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const hit = intersectSegments(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])
      if (hit) return false
    }
  }
  return true
}

/** removes duplicate and collinear points */
export function cleanPolygon(points: readonly Vec2Like[], tol = 1e-9): Vec2Like[] {
  const out: Vec2Like[] = []
  for (const p of points) {
    if (out.length === 0 || !equals(out[out.length - 1], p, tol)) out.push({ x: p.x, y: p.y })
  }
  while (out.length > 1 && equals(out[0], out[out.length - 1], tol)) out.pop()
  return out
}
