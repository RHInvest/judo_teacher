/**
 * Global tolerances. The whole application works in METRES.
 *
 * Getting these right matters: too tight and coincident geometry never merges,
 * too loose and small models collapse. The values mirror SketchUp's internal
 * tolerance of ~0.001 inch.
 *
 * OWNERSHIP: lead developer.
 */

/** numerical noise level for normalized quantities */
export const EPS = 1e-9

/** two points closer than this are the same point (0.01 mm) */
export const POINT_TOL = 1e-5
export const POINT_TOL_SQ = POINT_TOL * POINT_TOL

/** a point closer than this to a plane is considered on the plane */
export const PLANAR_TOL = 2e-5

/** lengths below this are degenerate */
export const MIN_LENGTH = 1e-7

/** angles below this (radians) are considered zero, ~0.0006 degrees */
export const ANGULAR_TOL = 1e-5

/** area below this is a degenerate face (1 mm^2 / 1000) */
export const MIN_AREA = 1e-9

/** default number of segments for a full circle */
export const DEFAULT_CIRCLE_SEGMENTS = 24

/** upper limit accepted from the measurement box */
export const MAX_CIRCLE_SEGMENTS = 999

/** default softening angle in degrees */
export const DEFAULT_SOFTEN_ANGLE = 20

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** true when |a - b| <= tol */
export function nearly(a: number, b: number, tol = POINT_TOL): boolean {
  return Math.abs(a - b) <= tol
}

/** wraps an angle into [0, 2pi) */
export function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2
  let r = a % twoPi
  if (r < 0) r += twoPi
  return r
}

/** shortest signed difference between two angles, in (-pi, pi] */
export function angleDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2
  let d = (to - from) % twoPi
  if (d > Math.PI) d -= twoPi
  if (d <= -Math.PI) d += twoPi
  return d
}
