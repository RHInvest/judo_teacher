/**
 * Primitive generators. They return plain point loops - turning them into
 * geometry is the caller's job (usually `addPolyline`).
 */

import type { Vec3Like } from '@/shared/types'
import { MIN_LENGTH, P, V } from '@/core/math'

function planeAxes(normal: Vec3Like, startPoint: Vec3Like | undefined, center: Vec3Like) {
  const n = V.normalizeOr(normal, V.AXIS_Z)
  let u: Vec3Like
  if (startPoint) {
    const radial = V.projectOnPlaneNormal(V.sub(startPoint, center), n)
    u = V.length(radial) > MIN_LENGTH ? V.normalize(radial) : P.basis({ n, d: 0 }).u
  } else {
    u = P.basis({ n, d: 0 }).u
  }
  const v = V.normalize(V.cross(n, u))
  return { n, u, v }
}

/** Counter clockwise circle seen from +normal. */
export function buildCircle(
  center: Vec3Like,
  normal: Vec3Like,
  radius: number,
  segments: number,
  startPoint?: Vec3Like,
): Vec3Like[] {
  const count = Math.max(3, Math.floor(segments))
  const { u, v } = planeAxes(normal, startPoint, center)
  const out: Vec3Like[] = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    out.push(V.add(center, V.add(V.mul(u, Math.cos(a) * radius), V.mul(v, Math.sin(a) * radius))))
  }
  return out
}

/**
 * Regular polygon. `inscribed` (default) puts the corners on the radius,
 * otherwise the edge midpoints touch it (circumscribed).
 */
export function buildPolygon(
  center: Vec3Like,
  normal: Vec3Like,
  radius: number,
  sides: number,
  inscribed = true,
  startPoint?: Vec3Like,
): Vec3Like[] {
  const count = Math.max(3, Math.floor(sides))
  const r = inscribed ? radius : radius / Math.cos(Math.PI / count)
  return buildCircle(center, normal, r, count, startPoint)
}

/** Arc from `startAngle` to `endAngle` measured in the plane basis. */
export function buildArc(
  center: Vec3Like,
  normal: Vec3Like,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  xAxis?: Vec3Like,
): Vec3Like[] {
  const count = Math.max(1, Math.floor(segments))
  const n = V.normalizeOr(normal, V.AXIS_Z)
  let u = xAxis ? V.projectOnPlaneNormal(xAxis, n) : P.basis({ n, d: 0 }).u
  if (V.length(u) < MIN_LENGTH) u = P.basis({ n, d: 0 }).u
  u = V.normalize(u)
  const v = V.normalize(V.cross(n, u))
  const out: Vec3Like[] = []
  for (let i = 0; i <= count; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / count
    out.push(V.add(center, V.add(V.mul(u, Math.cos(a) * radius), V.mul(v, Math.sin(a) * radius))))
  }
  return out
}

/** Arc through three points, using the circumcentre. */
export function buildArc3Points(
  a: Vec3Like,
  b: Vec3Like,
  c: Vec3Like,
  segments: number,
): Vec3Like[] {
  const plane = P.fromPoints(a, b, c)
  if (!plane) return [{ ...a }, { ...c }]
  const ab = V.sub(b, a)
  const ac = V.sub(c, a)
  const abLenSq = V.lengthSq(ab)
  const acLenSq = V.lengthSq(ac)
  const cross = V.cross(ab, ac)
  const crossLenSq = V.lengthSq(cross)
  if (crossLenSq < MIN_LENGTH * MIN_LENGTH) return [{ ...a }, { ...b }, { ...c }]
  const offset = V.div(
    V.cross(V.sub(V.mul(ac, abLenSq), V.mul(ab, acLenSq)), cross),
    2 * crossLenSq,
  )
  const centre = V.add(a, offset)
  const radius = V.length(offset)
  const n = plane.n
  const u = V.normalize(V.sub(a, centre))
  const v = V.normalize(V.cross(n, u))
  const angleOf = (p: Vec3Like): number => {
    const rel = V.sub(p, centre)
    return Math.atan2(V.dot(rel, v), V.dot(rel, u))
  }
  const twoPi = Math.PI * 2
  const norm = (x: number): number => ((x % twoPi) + twoPi) % twoPi
  const angB = norm(angleOf(b))
  let angC = norm(angleOf(c))
  // walk from a (angle 0) through b to c
  if (angC < angB) angC += twoPi
  return buildArc(centre, n, radius, 0, angC, Math.max(1, Math.floor(segments)), u)
}

/** Arc defined by a chord and its bulge height (SketchUp's arc tool). */
export function buildArcBulge(
  start: Vec3Like,
  end: Vec3Like,
  bulge: number,
  normal: Vec3Like,
  segments: number,
): Vec3Like[] {
  const chord = V.sub(end, start)
  const chordLen = V.length(chord)
  if (chordLen < MIN_LENGTH) return [{ ...start }, { ...end }]
  const n = V.normalizeOr(normal, V.AXIS_Z)
  const side = V.normalize(V.cross(n, chord))
  const mid = V.midpoint(start, end)
  if (Math.abs(bulge) < MIN_LENGTH) return [{ ...start }, { ...end }]
  const apex = V.addScaled(mid, side, bulge)
  return buildArc3Points(start, apex, end, segments)
}

export function buildRectangle(
  origin: Vec3Like,
  xAxis: Vec3Like,
  yAxis: Vec3Like,
  width: number,
  height: number,
): Vec3Like[] {
  const x = V.normalizeOr(xAxis, V.AXIS_X)
  const y = V.normalizeOr(yAxis, V.AXIS_Y)
  return [
    { ...origin },
    V.addScaled(origin, x, width),
    V.add(V.addScaled(origin, x, width), V.mul(y, height)),
    V.addScaled(origin, y, height),
  ]
}

export function buildBezier(
  p0: Vec3Like,
  p1: Vec3Like,
  p2: Vec3Like,
  p3: Vec3Like,
  segments: number,
): Vec3Like[] {
  const count = Math.max(1, Math.floor(segments))
  const out: Vec3Like[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const mt = 1 - t
    const w0 = mt * mt * mt
    const w1 = 3 * mt * mt * t
    const w2 = 3 * mt * t * t
    const w3 = t * t * t
    out.push({
      x: p0.x * w0 + p1.x * w1 + p2.x * w2 + p3.x * w3,
      y: p0.y * w0 + p1.y * w1 + p2.y * w2 + p3.y * w3,
      z: p0.z * w0 + p1.z * w1 + p2.z * w2 + p3.z * w3,
    })
  }
  return out
}
