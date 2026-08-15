/**
 * Barrel for the math layer.
 *
 * Usage:
 *   import { V, M, P, R, B, V2, EPS, POINT_TOL } from '@/core/math'
 *   const p = V.add(a, V.mul(dir, 2))
 *   const m = M.multiply(M.translation(t), M.rotation(V.AXIS_Z, angle))
 *
 * OWNERSHIP: lead developer.
 */

export * as V from './vec3'
export * as V2 from './vec2'
export * as M from './mat4'
export * as P from './plane'
export * as R from './ray'
export * as B from './bbox'

export * from './constants'
export type { Ray } from './ray'
export type { Mat4 } from './mat4'
export type { PlaneFrame } from './plane'
