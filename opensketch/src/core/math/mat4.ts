/**
 * Column major 4x4 matrices stored as plain number arrays.
 * Layout is identical to THREE.Matrix4.elements, so a matrix can be handed to
 * three.js with `new THREE.Matrix4().fromArray(m)` without conversion.
 *
 *   m[0] m[4] m[8]  m[12]
 *   m[1] m[5] m[9]  m[13]
 *   m[2] m[6] m[10] m[14]
 *   m[3] m[7] m[11] m[15]
 *
 * OWNERSHIP: lead developer.
 */

import type { Mat4Like, Vec3Like } from '@/shared/types'
import { EPS } from './constants'
import * as V from './vec3'

export type Mat4 = Mat4Like

function m4(values: number[]): Mat4 {
  return values as unknown as Mat4
}

export const IDENTITY: Mat4 = m4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

export function identity(): Mat4 {
  return m4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

export function clone(m: Mat4Like): Mat4 {
  return m4(Array.from(m))
}

export function isIdentity(m: Mat4Like, tol = 1e-12): boolean {
  for (let i = 0; i < 16; i++) {
    const expected = i % 5 === 0 ? 1 : 0
    if (Math.abs(m[i] - expected) > tol) return false
  }
  return true
}

export function equals(a: Mat4Like, b: Mat4Like, tol = 1e-10): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > tol) return false
  return true
}

export function translation(t: Vec3Like): Mat4 {
  return m4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t.x, t.y, t.z, 1])
}

export function scaling(s: Vec3Like | number): Mat4 {
  const v = typeof s === 'number' ? { x: s, y: s, z: s } : s
  return m4([v.x, 0, 0, 0, 0, v.y, 0, 0, 0, 0, v.z, 0, 0, 0, 0, 1])
}

/** rotation of `angle` radians around a unit `axis` through the origin */
export function rotation(axis: Vec3Like, angle: number): Mat4 {
  const a = V.normalize(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  const { x, y, z } = a
  return m4([
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ])
}

/** rotation around an arbitrary line */
export function rotationAboutLine(origin: Vec3Like, axis: Vec3Like, angle: number): Mat4 {
  return multiply(translation(origin), multiply(rotation(axis, angle), translation(V.negate(origin))))
}

/** non uniform scaling about a point */
export function scalingAbout(origin: Vec3Like, s: Vec3Like | number): Mat4 {
  return multiply(translation(origin), multiply(scaling(s), translation(V.negate(origin))))
}

/** mirror across a plane defined by a point and a normal */
export function mirror(point: Vec3Like, normal: Vec3Like): Mat4 {
  const n = V.normalize(normal)
  const d = V.dot(n, point)
  const { x, y, z } = n
  return m4([
    1 - 2 * x * x, -2 * x * y, -2 * x * z, 0,
    -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0,
    -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0,
    2 * d * x, 2 * d * y, 2 * d * z, 1,
  ])
}

/** builds a matrix from an orthonormal-ish basis and an origin */
export function fromBasis(origin: Vec3Like, xAxis: Vec3Like, yAxis: Vec3Like, zAxis: Vec3Like): Mat4 {
  return m4([
    xAxis.x, xAxis.y, xAxis.z, 0,
    yAxis.x, yAxis.y, yAxis.z, 0,
    zAxis.x, zAxis.y, zAxis.z, 0,
    origin.x, origin.y, origin.z, 1,
  ])
}

/** a * b (apply b first, then a) */
export function multiply(a: Mat4Like, b: Mat4Like): Mat4 {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++) {
    const c4 = c * 4
    const b0 = b[c4]
    const b1 = b[c4 + 1]
    const b2 = b[c4 + 2]
    const b3 = b[c4 + 3]
    out[c4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
    out[c4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
    out[c4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
    out[c4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
  }
  return m4(out)
}

/** multiplies a chain left to right: chain(a,b,c) === a*b*c */
export function chain(...matrices: Mat4Like[]): Mat4 {
  if (matrices.length === 0) return identity()
  let out = clone(matrices[0])
  for (let i = 1; i < matrices.length; i++) out = multiply(out, matrices[i])
  return out
}

export function transpose(m: Mat4Like): Mat4 {
  return m4([
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ])
}

export function determinant(m: Mat4Like): number {
  const [
    n11, n21, n31, n41,
    n12, n22, n32, n42,
    n13, n23, n33, n43,
    n14, n24, n34, n44,
  ] = m as unknown as number[]

  return (
    n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
    n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
    n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
    n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
  )
}

/** returns the identity when the matrix is singular */
export function invert(m: Mat4Like): Mat4 {
  const te = m as unknown as number[]
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = te

  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34

  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
  if (Math.abs(det) < EPS) return identity()
  const d = 1 / det

  return m4([
    t11 * d,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
    t12 * d,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
    t13 * d,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
    t14 * d,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
  ])
}

/** correct transform for normals: transpose of the inverse upper 3x3 */
export function normalMatrix(m: Mat4Like): Mat4 {
  return transpose(invert(m))
}

export function transformPoint(m: Mat4Like, p: Vec3Like): Vec3Like {
  return V.applyMat4(p, m)
}

export function transformDirection(m: Mat4Like, d: Vec3Like): Vec3Like {
  return V.applyMat4Direction(d, m)
}

/** transforms a normal so it stays perpendicular under non uniform scaling */
export function transformNormal(m: Mat4Like, n: Vec3Like): Vec3Like {
  return V.normalize(V.applyMat4Direction(n, normalMatrix(m)))
}

export function getTranslation(m: Mat4Like): Vec3Like {
  return { x: m[12], y: m[13], z: m[14] }
}

export function getScale(m: Mat4Like): Vec3Like {
  return {
    x: Math.hypot(m[0], m[1], m[2]),
    y: Math.hypot(m[4], m[5], m[6]),
    z: Math.hypot(m[8], m[9], m[10]),
  }
}

export function getAxis(m: Mat4Like, axis: 0 | 1 | 2): Vec3Like {
  const o = axis * 4
  return V.normalize({ x: m[o], y: m[o + 1], z: m[o + 2] })
}

/** true when the transform flips handedness (mirrored) */
export function isMirrored(m: Mat4Like): boolean {
  return determinant(m) < 0
}

/** removes scale, keeping rotation and translation */
export function orthonormalize(m: Mat4Like): Mat4 {
  const x = V.normalizeOr(getAxis(m, 0), V.AXIS_X)
  let y = V.normalizeOr(getAxis(m, 1), V.AXIS_Y)
  const z = V.normalizeOr(V.cross(x, y), V.AXIS_Z)
  y = V.cross(z, x)
  return fromBasis(getTranslation(m), x, y, z)
}

/** camera style look-at matrix (object space -> world) */
export function lookAt(eye: Vec3Like, target: Vec3Like, up: Vec3Like): Mat4 {
  let z = V.sub(eye, target)
  if (V.isZero(z)) z = { x: 0, y: 0, z: 1 }
  z = V.normalize(z)
  let x = V.cross(up, z)
  if (V.isZero(x)) {
    x = V.cross(Math.abs(up.z) > 0.9 ? V.AXIS_Y : V.AXIS_Z, z)
  }
  x = V.normalize(x)
  const y = V.cross(z, x)
  return fromBasis(eye, x, y, z)
}

export function toArray(m: Mat4Like): number[] {
  return Array.from(m)
}

export function fromArray(values: ArrayLike<number>): Mat4 {
  return m4(Array.from(values).slice(0, 16))
}
