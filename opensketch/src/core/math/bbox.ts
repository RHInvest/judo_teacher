/**
 * Axis aligned bounding boxes.
 * An empty box has min > max on every axis.
 *
 * OWNERSHIP: lead developer.
 */

import type { BBox3Like, Mat4Like, Vec3Like } from '@/shared/types'
import * as V from './vec3'

export function empty(): BBox3Like {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  }
}

export function isEmpty(b: BBox3Like): boolean {
  return b.max.x < b.min.x || b.max.y < b.min.y || b.max.z < b.min.z
}

export function clone(b: BBox3Like): BBox3Like {
  return { min: V.clone(b.min), max: V.clone(b.max) }
}

export function fromPoints(points: readonly Vec3Like[]): BBox3Like {
  const box = empty()
  for (const p of points) expandByPointMut(box, p)
  return box
}

export function fromCenterSize(center: Vec3Like, size: Vec3Like): BBox3Like {
  const half = V.mul(size, 0.5)
  return { min: V.sub(center, half), max: V.add(center, half) }
}

/** mutating variant used in hot loops */
export function expandByPointMut(b: BBox3Like, p: Vec3Like): void {
  const min = b.min as { x: number; y: number; z: number }
  const max = b.max as { x: number; y: number; z: number }
  if (p.x < min.x) min.x = p.x
  if (p.y < min.y) min.y = p.y
  if (p.z < min.z) min.z = p.z
  if (p.x > max.x) max.x = p.x
  if (p.y > max.y) max.y = p.y
  if (p.z > max.z) max.z = p.z
}

export function expandByPoint(b: BBox3Like, p: Vec3Like): BBox3Like {
  return { min: V.minV(b.min, p), max: V.maxV(b.max, p) }
}

export function union(a: BBox3Like, b: BBox3Like): BBox3Like {
  if (isEmpty(a)) return clone(b)
  if (isEmpty(b)) return clone(a)
  return { min: V.minV(a.min, b.min), max: V.maxV(a.max, b.max) }
}

export function expandByScalar(b: BBox3Like, amount: number): BBox3Like {
  if (isEmpty(b)) return clone(b)
  const d = { x: amount, y: amount, z: amount }
  return { min: V.sub(b.min, d), max: V.add(b.max, d) }
}

export function center(b: BBox3Like): Vec3Like {
  if (isEmpty(b)) return V.v3()
  return V.midpoint(b.min, b.max)
}

export function size(b: BBox3Like): Vec3Like {
  if (isEmpty(b)) return V.v3()
  return V.sub(b.max, b.min)
}

export function diagonal(b: BBox3Like): number {
  return isEmpty(b) ? 0 : V.distance(b.min, b.max)
}

export function volume(b: BBox3Like): number {
  if (isEmpty(b)) return 0
  const s = size(b)
  return s.x * s.y * s.z
}

export function containsPoint(b: BBox3Like, p: Vec3Like, tol = 0): boolean {
  return (
    p.x >= b.min.x - tol && p.x <= b.max.x + tol &&
    p.y >= b.min.y - tol && p.y <= b.max.y + tol &&
    p.z >= b.min.z - tol && p.z <= b.max.z + tol
  )
}

export function containsBox(outer: BBox3Like, inner: BBox3Like, tol = 0): boolean {
  return containsPoint(outer, inner.min, tol) && containsPoint(outer, inner.max, tol)
}

export function intersects(a: BBox3Like, b: BBox3Like, tol = 0): boolean {
  return !(
    a.max.x < b.min.x - tol || a.min.x > b.max.x + tol ||
    a.max.y < b.min.y - tol || a.min.y > b.max.y + tol ||
    a.max.z < b.min.z - tol || a.min.z > b.max.z + tol
  )
}

/** the eight corners, order: (min/max)x * (min/max)y * (min/max)z */
export function corners(b: BBox3Like): Vec3Like[] {
  return [
    { x: b.min.x, y: b.min.y, z: b.min.z },
    { x: b.max.x, y: b.min.y, z: b.min.z },
    { x: b.min.x, y: b.max.y, z: b.min.z },
    { x: b.max.x, y: b.max.y, z: b.min.z },
    { x: b.min.x, y: b.min.y, z: b.max.z },
    { x: b.max.x, y: b.min.y, z: b.max.z },
    { x: b.min.x, y: b.max.y, z: b.max.z },
    { x: b.max.x, y: b.max.y, z: b.max.z },
  ]
}

/** axis aligned box enclosing the transformed box */
export function transform(b: BBox3Like, m: Mat4Like): BBox3Like {
  if (isEmpty(b)) return clone(b)
  const out = empty()
  for (const c of corners(b)) expandByPointMut(out, V.applyMat4(c, m))
  return out
}

/** the twelve edges of the box, for drawing selection cages */
export function edgeSegments(b: BBox3Like): [Vec3Like, Vec3Like][] {
  const c = corners(b)
  const idx: [number, number][] = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  return idx.map(([i, j]) => [c[i], c[j]] as [Vec3Like, Vec3Like])
}

/** distance from a point to the box surface, 0 when inside */
export function distanceToPoint(b: BBox3Like, p: Vec3Like): number {
  if (isEmpty(b)) return Infinity
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x)
  const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y)
  const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z)
  return Math.hypot(dx, dy, dz)
}
