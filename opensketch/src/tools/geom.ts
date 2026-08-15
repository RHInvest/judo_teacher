/**
 * Primitivgeneratoren fuer Vorschau und Erzeugung.
 *
 * Zuerst wird immer der Geometriekern (`@/core`) gefragt. Solange der noch
 * nicht implementiert ist (er wird parallel entwickelt), greift eine lokale,
 * mathematisch identische Umsetzung - so bleiben Vorschau und Werkzeuge
 * bereits heute benutzbar.
 *
 * OWNERSHIP: Tools.
 */

import type { Vec3Like } from '@/shared/types'
import {
  buildArc,
  buildArc3Points,
  buildArcBulge,
  buildBezier,
  buildCircle,
  buildPolygon,
  buildRectangle,
} from '@/core'
import { P, V, MIN_LENGTH } from '@/core/math'
import { safeOrNull } from './helpers'

function usable(points: Vec3Like[] | null, min = 2): Vec3Like[] | null {
  if (!points || points.length < min) return null
  return points.every((p) => V.isFinite3(p)) ? points : null
}

/** Orthonormale Basis einer Ebene, optional an einem Startpunkt ausgerichtet. */
export function planeBasis(
  normal: Vec3Like,
  center?: Vec3Like,
  startPoint?: Vec3Like | null,
): { u: Vec3Like; v: Vec3Like; n: Vec3Like } {
  const n = V.normalizeOr(normal, V.AXIS_Z)
  let u: Vec3Like | null = null
  if (startPoint && center) {
    const rel = V.projectOnPlaneNormal(V.sub(startPoint, center), n)
    if (V.length(rel) > MIN_LENGTH) u = V.normalize(rel)
  }
  if (!u) u = P.basis({ n, d: 0 }).u
  const v = V.normalize(V.cross(n, u))
  return { u, v, n }
}

/* ------------------------------------------------------------------ */
/* Kreis, Polygon, Rechteck                                            */
/* ------------------------------------------------------------------ */

export function circlePoints(
  center: Vec3Like,
  normal: Vec3Like,
  radius: number,
  segments: number,
  startPoint?: Vec3Like | null,
): Vec3Like[] {
  const seg = Math.max(3, Math.round(segments))
  const core = usable(safeOrNull(() => buildCircle(center, normal, radius, seg, startPoint ?? undefined)), 3)
  if (core) return core
  const { u, v } = planeBasis(normal, center, startPoint)
  const out: Vec3Like[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    out.push(V.add(center, V.add(V.mul(u, Math.cos(a) * radius), V.mul(v, Math.sin(a) * radius))))
  }
  return out
}

export function polygonPoints(
  center: Vec3Like,
  normal: Vec3Like,
  radius: number,
  sides: number,
  inscribed = true,
  startPoint?: Vec3Like | null,
): Vec3Like[] {
  const n = Math.max(3, Math.round(sides))
  const core = usable(safeOrNull(() => buildPolygon(center, normal, radius, n, inscribed, startPoint ?? undefined)), 3)
  if (core) return core
  const r = inscribed ? radius : radius / Math.cos(Math.PI / n)
  return circlePoints(center, normal, r, n, startPoint)
}

export function rectanglePoints(
  origin: Vec3Like,
  xAxis: Vec3Like,
  yAxis: Vec3Like,
  width: number,
  height: number,
): Vec3Like[] {
  const core = usable(safeOrNull(() => buildRectangle(origin, xAxis, yAxis, width, height)), 4)
  if (core) return core
  const x = V.normalizeOr(xAxis, V.AXIS_X)
  const y = V.normalizeOr(yAxis, V.AXIS_Y)
  return [
    V.clone(origin),
    V.addScaled(origin, x, width),
    V.add(V.addScaled(origin, x, width), V.mul(y, height)),
    V.addScaled(origin, y, height),
  ]
}

/* ------------------------------------------------------------------ */
/* Boegen                                                              */
/* ------------------------------------------------------------------ */

export function arcPoints(
  center: Vec3Like,
  normal: Vec3Like,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  xAxis?: Vec3Like,
): Vec3Like[] {
  const seg = Math.max(1, Math.round(segments))
  const core = usable(safeOrNull(() => buildArc(center, normal, radius, startAngle, endAngle, seg, xAxis)), 2)
  if (core) return core
  const { u, v } = planeBasis(normal, center, xAxis ? V.add(center, xAxis) : null)
  const out: Vec3Like[] = []
  for (let i = 0; i <= seg; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / seg
    out.push(V.add(center, V.add(V.mul(u, Math.cos(a) * radius), V.mul(v, Math.sin(a) * radius))))
  }
  return out
}

/** Mittelpunkt des Kreises durch drei Punkte, null bei Kollinearitaet. */
export function circumcenter(a: Vec3Like, b: Vec3Like, c: Vec3Like): { center: Vec3Like; normal: Vec3Like; radius: number } | null {
  const ab = V.sub(b, a)
  const ac = V.sub(c, a)
  const cross = V.cross(ab, ac)
  const lenSq = V.lengthSq(cross)
  if (lenSq < 1e-18) return null
  const toCenter = V.div(
    V.add(V.mul(V.cross(cross, ab), V.lengthSq(ac)), V.mul(V.cross(ac, cross), V.lengthSq(ab))),
    2 * lenSq,
  )
  const center = V.add(a, toCenter)
  return { center, normal: V.normalize(cross), radius: V.length(toCenter) }
}

export function arc3Points(a: Vec3Like, b: Vec3Like, c: Vec3Like, segments: number): Vec3Like[] {
  const seg = Math.max(1, Math.round(segments))
  const core = usable(safeOrNull(() => buildArc3Points(a, b, c, seg)), 2)
  if (core) return core
  const circle = circumcenter(a, b, c)
  if (!circle) return [V.clone(a), V.clone(b), V.clone(c)]
  const { center, normal, radius } = circle
  const u = V.normalize(V.sub(a, center))
  const v = V.normalize(V.cross(normal, u))
  const angleOf = (p: Vec3Like): number => {
    const rel = V.sub(p, center)
    const angle = Math.atan2(V.dot(rel, v), V.dot(rel, u))
    return angle < 0 ? angle + Math.PI * 2 : angle
  }
  const ab = angleOf(b)
  const ac = angleOf(c)
  // Der Bogen laeuft von a (Winkel 0) ueber b nach c.
  const end = ab <= ac ? ac : ac - Math.PI * 2
  const out: Vec3Like[] = []
  for (let i = 0; i <= seg; i++) {
    const t = (end * i) / seg
    out.push(V.add(center, V.add(V.mul(u, Math.cos(t) * radius), V.mul(v, Math.sin(t) * radius))))
  }
  return out
}

/** Bogen ueber Sehne + Bogenhoehe (SketchUp "2-Punkt-Bogen"). */
export function arcBulgePoints(
  start: Vec3Like,
  end: Vec3Like,
  bulge: number,
  normal: Vec3Like,
  segments: number,
): Vec3Like[] {
  const seg = Math.max(1, Math.round(segments))
  const core = usable(safeOrNull(() => buildArcBulge(start, end, bulge, normal, seg)), 2)
  if (core) return core
  const chord = V.sub(end, start)
  const len = V.length(chord)
  if (len < MIN_LENGTH) return [V.clone(start), V.clone(end)]
  if (Math.abs(bulge) < 1e-9) return [V.clone(start), V.clone(end)]
  const n = V.normalizeOr(normal, V.AXIS_Z)
  let perp = V.cross(n, V.normalize(chord))
  if (V.isZero(perp)) perp = V.anyPerpendicular(chord)
  perp = V.normalize(perp)
  const apex = V.addScaled(V.midpoint(start, end), perp, bulge)
  return arc3Points(start, apex, end, seg)
}

/** Bogenhoehe aus Sehne und Radius (fuer die Anzeige im Massfeld). */
export function bulgeFromRadius(chordLength: number, radius: number): number {
  const half = chordLength / 2
  if (radius <= half) return half
  return radius - Math.sqrt(radius * radius - half * half)
}

/** Radius aus Sehne und Bogenhoehe. */
export function radiusFromBulge(chordLength: number, bulge: number): number {
  const half = chordLength / 2
  if (Math.abs(bulge) < 1e-9) return Number.POSITIVE_INFINITY
  return (half * half + bulge * bulge) / (2 * Math.abs(bulge))
}

/* ------------------------------------------------------------------ */
/* Bezier                                                              */
/* ------------------------------------------------------------------ */

export function bezierPoints(
  p0: Vec3Like,
  p1: Vec3Like,
  p2: Vec3Like,
  p3: Vec3Like,
  segments: number,
): Vec3Like[] {
  const seg = Math.max(1, Math.round(segments))
  const core = usable(safeOrNull(() => buildBezier(p0, p1, p2, p3, seg)), 2)
  if (core) return core
  const out: Vec3Like[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
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

/* ------------------------------------------------------------------ */
/* Versatz                                                             */
/* ------------------------------------------------------------------ */

/**
 * Versetzt einen geschlossenen, ebenen Polygonzug um `distance`.
 *
 * Positive Werte gehen nach aussen (bezogen auf die uebergebene Normale und
 * den Umlaufsinn des Polygons). Die Ecken werden auf Gehrung geschnitten -
 * das ist genau das Verhalten des Versatz-Werkzeugs. Sehr spitze Ecken
 * werden begrenzt, damit der Versatz nicht ins Unendliche schiesst.
 *
 * Nur fuer die VORSCHAU gedacht; die echte Geometrie erzeugt der Kern ueber
 * `offsetFace` / `offsetEdges`.
 */
export function offsetPolygon(
  points: readonly Vec3Like[],
  normal: Vec3Like,
  distance: number,
  closed = true,
): Vec3Like[] {
  if (points.length < 2 || Math.abs(distance) < 1e-9) return points.map(V.clone)
  const n = V.normalizeOr(normal, V.AXIS_Z)
  const count = points.length
  const out: Vec3Like[] = []
  const MITER_LIMIT = 8

  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count]
    const cur = points[i]
    const next = points[(i + 1) % count]

    const hasPrev = closed || i > 0
    const hasNext = closed || i < count - 1

    const inDir = hasPrev ? V.normalizeOr(V.sub(cur, prev), V.AXIS_X) : null
    const outDir = hasNext ? V.normalizeOr(V.sub(next, cur), V.AXIS_X) : null

    // Aussennormale einer Kante: Kantenrichtung x Flaechennormale
    const normalOf = (d: Vec3Like): Vec3Like => V.normalizeOr(V.cross(d, n), V.AXIS_Y)

    if (inDir && outDir) {
      const nA = normalOf(inDir)
      const nB = normalOf(outDir)
      const bisector = V.add(nA, nB)
      const len = V.length(bisector)
      if (len < 1e-9) {
        // 180-Grad-Kehre: gerade heraus versetzen
        out.push(V.addScaled(cur, nA, distance))
        continue
      }
      const unit = V.div(bisector, len)
      const cos = V.dot(unit, nA)
      const scale = Math.abs(cos) < 1 / MITER_LIMIT ? MITER_LIMIT : 1 / cos
      out.push(V.addScaled(cur, unit, distance * scale))
      continue
    }
    const only = inDir ?? outDir
    if (!only) {
      out.push(V.clone(cur))
      continue
    }
    out.push(V.addScaled(cur, normalOf(only), distance))
  }
  return out
}

/** Umlaufsinn eines ebenen Polygons relativ zur Normalen: +1 = gegen den Uhrzeigersinn. */
export function polygonWinding(points: readonly Vec3Like[], normal: Vec3Like): number {
  const raw = P.polygonNormalRaw(points)
  return V.dot(raw, V.normalizeOr(normal, V.AXIS_Z)) >= 0 ? 1 : -1
}

/* ------------------------------------------------------------------ */
/* Vereinfachung (Freihand)                                            */
/* ------------------------------------------------------------------ */

/** Douglas-Peucker fuer Freihandzuege. */
export function simplifyPolyline(points: readonly Vec3Like[], tolerance: number): Vec3Like[] {
  if (points.length <= 2) return points.map(V.clone)
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number]
    if (last <= first + 1) continue
    let maxDist = -1
    let index = first
    for (let i = first + 1; i < last; i++) {
      const a = points[first]
      const b = points[last]
      const ab = V.sub(b, a)
      const lenSq = V.lengthSq(ab)
      const rel = V.sub(points[i], a)
      const t = lenSq > 1e-18 ? Math.max(0, Math.min(1, V.dot(rel, ab) / lenSq)) : 0
      const dist = V.distance(points[i], V.addScaled(a, ab, t))
      if (dist > maxDist) {
        maxDist = dist
        index = i
      }
    }
    if (maxDist > tolerance) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }
  const out: Vec3Like[] = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(V.clone(points[i]))
  return out
}
