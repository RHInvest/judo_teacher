/**
 * Bauteile fuer die Komponentenbibliothek.
 *
 * Alle Funktionen schreiben in einen `GeomBuilder` und erzeugen geschlossene,
 * korrekt orientierte Koerper (Normalen zeigen nach aussen). Masse sind Meter,
 * Z ist oben.
 */

import type { Id, Vec3Like } from '@/shared/types'
import { V } from '@/core/math'
import { GeomBuilder } from '../common/geom'

export interface Pt2 {
  x: number
  y: number
}

const TAU = Math.PI * 2

function p3(x: number, y: number, z: number): Vec3Like {
  return { x, y, z }
}

/* ------------------------------------------------------------------ */
/* Quader                                                              */
/* ------------------------------------------------------------------ */

/** Achsparalleler Quader ueber zwei Eckpunkte. */
export function box(
  g: GeomBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  materialId: Id | null = null,
): void {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0]
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0]
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0]
  if (bx - ax < 1e-9 || by - ay < 1e-9 || bz - az < 1e-9) return
  const opts = { materialId }

  // unten (-Z)
  g.face([p3(ax, ay, az), p3(ax, by, az), p3(bx, by, az), p3(bx, ay, az)], [], opts)
  // oben (+Z)
  g.face([p3(ax, ay, bz), p3(bx, ay, bz), p3(bx, by, bz), p3(ax, by, bz)], [], opts)
  // vorn (-Y)
  g.face([p3(ax, ay, az), p3(bx, ay, az), p3(bx, ay, bz), p3(ax, ay, bz)], [], opts)
  // hinten (+Y)
  g.face([p3(ax, by, az), p3(ax, by, bz), p3(bx, by, bz), p3(bx, by, az)], [], opts)
  // links (-X)
  g.face([p3(ax, ay, az), p3(ax, ay, bz), p3(ax, by, bz), p3(ax, by, az)], [], opts)
  // rechts (+X)
  g.face([p3(bx, ay, az), p3(bx, by, az), p3(bx, by, bz), p3(bx, ay, bz)], [], opts)
}

/** Quader ueber Mittelpunkt (x, y), Unterkante z und Abmessungen. */
export function boxAt(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  materialId: Id | null = null,
): void {
  box(g, cx - width / 2, cy - depth / 2, z, cx + width / 2, cy + depth / 2, z + height, materialId)
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function circleProfile(cx: number, cy: number, radius: number, segments = 24): Pt2[] {
  const out: Pt2[] = []
  const n = Math.max(3, Math.round(segments))
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    out.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius })
  }
  return out
}

export function rectProfile(cx: number, cy: number, width: number, depth: number): Pt2[] {
  const hw = width / 2
  const hd = depth / 2
  return [
    { x: cx - hw, y: cy - hd },
    { x: cx + hw, y: cy - hd },
    { x: cx + hw, y: cy + hd },
    { x: cx - hw, y: cy + hd },
  ]
}

/** Rechteck mit abgerundeten Ecken (Tischplatten, Sitzflaechen, Wannen). */
export function roundedRectProfile(
  cx: number,
  cy: number,
  width: number,
  depth: number,
  radius: number,
  cornerSegments = 4,
): Pt2[] {
  const r = Math.max(0, Math.min(radius, Math.min(width, depth) / 2 - 1e-6))
  if (r <= 1e-6) return rectProfile(cx, cy, width, depth)
  const hw = width / 2 - r
  const hd = depth / 2 - r
  const out: Pt2[] = []
  const corners: [number, number, number][] = [
    [cx + hw, cy - hd, -Math.PI / 2],
    [cx + hw, cy + hd, 0],
    [cx - hw, cy + hd, Math.PI / 2],
    [cx - hw, cy - hd, Math.PI],
  ]
  for (const [ox, oy, start] of corners) {
    for (let i = 0; i <= cornerSegments; i++) {
      const t = start + (i / cornerSegments) * (Math.PI / 2)
      out.push({ x: ox + Math.cos(t) * r, y: oy + Math.sin(t) * r })
    }
  }
  return out
}

/** Regelmaessiges n-Eck. */
export function polygonProfile(cx: number, cy: number, radius: number, sides: number): Pt2[] {
  return circleProfile(cx, cy, radius, Math.max(3, Math.round(sides)))
}

/* ------------------------------------------------------------------ */
/* Extrusion                                                           */
/* ------------------------------------------------------------------ */

/**
 * Extrudiert ein 2D-Profil (gegen den Uhrzeigersinn in der Basis `u`/`v`)
 * entlang `cross(u, v)`. `holes` sind Innenprofile und erzeugen Innenwaende.
 */
export function prismOn(
  g: GeomBuilder,
  profile: readonly Pt2[],
  origin: Vec3Like,
  u: Vec3Like,
  v: Vec3Like,
  height: number,
  materialId: Id | null = null,
  holes: readonly (readonly Pt2[])[] = [],
): void {
  if (profile.length < 3 || Math.abs(height) < 1e-9) return
  const n = V.mul(V.normalize(V.cross(u, v)), height)
  const at = (p: Pt2, top: boolean): Vec3Like => {
    const base = V.add(origin, V.add(V.mul(u, p.x), V.mul(v, p.y)))
    return top ? V.add(base, n) : base
  }
  const opts = { materialId }
  const lo = profile.map((p) => at(p, false))
  const hi = profile.map((p) => at(p, true))
  const holesLo = holes.map((h) => h.map((p) => at(p, false)))
  const holesHi = holes.map((h) => h.map((p) => at(p, true)))

  // Deckel
  g.face([...lo].reverse(), holesLo.map((h) => [...h].reverse()), opts)
  g.face(hi, holesHi, opts)
  // Aussenwand
  sideWall(g, profile, at, opts, false)
  // Innenwaende
  for (const hole of holes) sideWall(g, hole, at, opts, true)
}

/** Extrudiert ein XY-Profil (gegen den Uhrzeigersinn) nach +Z. */
export function prismZ(
  g: GeomBuilder,
  profile: readonly Pt2[],
  z0: number,
  height: number,
  materialId: Id | null = null,
  holes: readonly (readonly Pt2[])[] = [],
): void {
  prismOn(g, profile, p3(0, 0, z0), V.AXIS_X, V.AXIS_Y, height, materialId, holes)
}

/** Extrudiert ein XZ-Profil entlang -Y (Treppen, Dachprofile, Sockelleisten). */
export function prismXZ(
  g: GeomBuilder,
  profile: readonly Pt2[],
  y0: number,
  depth: number,
  materialId: Id | null = null,
  holes: readonly (readonly Pt2[])[] = [],
): void {
  prismOn(g, profile, p3(0, y0, 0), V.AXIS_X, V.AXIS_Z, depth, materialId, holes)
}

function sideWall(
  g: GeomBuilder,
  profile: readonly Pt2[],
  at: (p: Pt2, top: boolean) => Vec3Like,
  opts: { materialId: Id | null },
  inward: boolean,
): void {
  const ring = inward ? [...profile].reverse() : [...profile]
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    g.face([at(a, false), at(b, false), at(b, true), at(a, true)], [], opts)
  }
}

/* ------------------------------------------------------------------ */
/* Rotationskoerper                                                    */
/* ------------------------------------------------------------------ */

/** Kegelstumpf entlang Z; `r1 = 0` ergibt einen Kegel. */
export function frustumZ(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z0: number,
  r0: number,
  r1: number,
  height: number,
  segments = 24,
  materialId: Id | null = null,
  caps: { bottom?: boolean; top?: boolean } = {},
): void {
  frustumBetween(g, p3(cx, cy, z0), p3(cx, cy, z0 + height), r0, r1, segments, materialId, caps)
}

export function cylinderZ(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z0: number,
  radius: number,
  height: number,
  segments = 24,
  materialId: Id | null = null,
): void {
  frustumZ(g, cx, cy, z0, radius, radius, height, segments, materialId)
}

/** Zylinder entlang einer beliebigen Achse - fuer Beine, Aeste, Rohre. */
export function cylinderBetween(
  g: GeomBuilder,
  a: Vec3Like,
  b: Vec3Like,
  radius: number,
  segments = 12,
  materialId: Id | null = null,
): void {
  frustumBetween(g, a, b, radius, radius, segments, materialId)
}

export function frustumBetween(
  g: GeomBuilder,
  a: Vec3Like,
  b: Vec3Like,
  r0: number,
  r1: number,
  segments = 24,
  materialId: Id | null = null,
  caps: { bottom?: boolean; top?: boolean } = {},
): void {
  const axis = V.sub(b, a)
  const len = V.length(axis)
  if (len < 1e-9) return
  const dir = V.mul(axis, 1 / len)
  const u = V.anyPerpendicular(dir)
  const v = V.cross(dir, u)
  const n = Math.max(3, Math.round(segments))
  const opts = { materialId }

  const ringA: Vec3Like[] = []
  const ringB: Vec3Like[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    const c = Math.cos(t)
    const s = Math.sin(t)
    ringA.push(V.add(a, V.add(V.mul(u, c * r0), V.mul(v, s * r0))))
    ringB.push(V.add(b, V.add(V.mul(u, c * r1), V.mul(v, s * r1))))
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (r0 < 1e-9 && r1 < 1e-9) continue
    if (r0 < 1e-9) g.face([ringB[j], ringB[i], a], [], opts)
    else if (r1 < 1e-9) g.face([ringA[i], ringA[j], b], [], opts)
    else g.face([ringA[i], ringA[j], ringB[j], ringB[i]], [], opts)
  }

  if (r0 > 1e-9 && caps.bottom !== false) g.face([...ringA].reverse(), [], opts)
  if (r1 > 1e-9 && caps.top !== false) g.face(ringB, [], opts)
}

/** Rohr / Hohlzylinder entlang Z. */
export function tubeZ(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z0: number,
  outerRadius: number,
  innerRadius: number,
  height: number,
  segments = 24,
  materialId: Id | null = null,
): void {
  const outer = circleProfile(cx, cy, outerRadius, segments)
  const inner = circleProfile(cx, cy, Math.min(innerRadius, outerRadius - 1e-4), segments)
  prismZ(g, outer, z0, height, materialId, [inner])
}

/** UV-Kugel. */
export function sphere(
  g: GeomBuilder,
  center: Vec3Like,
  radius: number,
  segmentsU = 20,
  segmentsV = 12,
  materialId: Id | null = null,
  scale: Vec3Like = { x: 1, y: 1, z: 1 },
): void {
  const nu = Math.max(3, Math.round(segmentsU))
  const nv = Math.max(2, Math.round(segmentsV))
  const opts = { materialId, soft: true, smooth: true }
  const at = (iu: number, iv: number): Vec3Like => {
    const theta = (iu / nu) * TAU
    const phi = -Math.PI / 2 + (iv / nv) * Math.PI
    const cp = Math.cos(phi)
    return p3(
      center.x + Math.cos(theta) * cp * radius * scale.x,
      center.y + Math.sin(theta) * cp * radius * scale.y,
      center.z + Math.sin(phi) * radius * scale.z,
    )
  }
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = at(iu, iv)
      const b = at(iu + 1, iv)
      const c = at(iu + 1, iv + 1)
      const d = at(iu, iv + 1)
      if (iv === 0) g.face([b, c, d], [], opts)
      else if (iv === nv - 1) g.face([a, b, c], [], opts)
      else g.face([a, b, c, d], [], opts)
    }
  }
}

/** Torus in der XY-Ebene. */
export function torus(
  g: GeomBuilder,
  center: Vec3Like,
  majorRadius: number,
  minorRadius: number,
  segmentsU = 24,
  segmentsV = 12,
  materialId: Id | null = null,
): void {
  const nu = Math.max(3, Math.round(segmentsU))
  const nv = Math.max(3, Math.round(segmentsV))
  const opts = { materialId, soft: true, smooth: true }
  const at = (iu: number, iv: number): Vec3Like => {
    const u = (iu / nu) * TAU
    const v = (iv / nv) * TAU
    const r = majorRadius + Math.cos(v) * minorRadius
    return p3(center.x + Math.cos(u) * r, center.y + Math.sin(u) * r, center.z + Math.sin(v) * minorRadius)
  }
  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      g.face([at(iu, iv), at(iu + 1, iv), at(iu + 1, iv + 1), at(iu, iv + 1)], [], opts)
    }
  }
}

/** Pyramide ueber rechteckiger Grundflaeche. */
export function pyramid(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z0: number,
  width: number,
  depth: number,
  height: number,
  materialId: Id | null = null,
): void {
  const base = rectProfile(cx, cy, width, depth).map((p) => p3(p.x, p.y, z0))
  const apex = p3(cx, cy, z0 + height)
  const opts = { materialId }
  g.face([...base].reverse(), [], opts)
  for (let i = 0; i < base.length; i++) {
    g.face([base[i], base[(i + 1) % base.length], apex], [], opts)
  }
}

/** Keil / Rampe, ansteigend in +X. */
export function wedge(
  g: GeomBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  materialId: Id | null = null,
): void {
  const opts = { materialId }
  g.face([p3(x0, y0, z0), p3(x0, y1, z0), p3(x1, y1, z0), p3(x1, y0, z0)], [], opts) // unten
  g.face([p3(x1, y0, z0), p3(x1, y1, z0), p3(x1, y1, z1), p3(x1, y0, z1)], [], opts) // senkrecht
  g.face([p3(x0, y0, z0), p3(x1, y0, z1), p3(x1, y1, z1), p3(x0, y1, z0)], [], opts) // Schraege
  g.face([p3(x0, y0, z0), p3(x1, y0, z0), p3(x1, y0, z1)], [], opts) // Seite -Y
  g.face([p3(x0, y1, z0), p3(x1, y1, z1), p3(x1, y1, z0)], [], opts) // Seite +Y
}

/* ------------------------------------------------------------------ */
/* Zusammengesetzte Standardteile                                      */
/* ------------------------------------------------------------------ */

/** Vier Beine an den Ecken einer Platte. */
export function legs(
  g: GeomBuilder,
  width: number,
  depth: number,
  height: number,
  legSize: number,
  inset: number,
  materialId: Id | null,
  round = false,
): void {
  const hx = width / 2 - inset - legSize / 2
  const hy = depth / 2 - inset - legSize / 2
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      if (round) cylinderZ(g, sx * hx, sy * hy, 0, legSize / 2, height, 12, materialId)
      else boxAt(g, sx * hx, sy * hy, 0, legSize, legSize, height, materialId)
    }
  }
}

/** Platte mit abgerundeten Ecken. */
export function slab(
  g: GeomBuilder,
  cx: number,
  cy: number,
  z: number,
  width: number,
  depth: number,
  thickness: number,
  radius: number,
  materialId: Id | null,
): void {
  prismZ(g, roundedRectProfile(cx, cy, width, depth, radius), z, thickness, materialId)
}

/** Rahmen (z. B. Tuerzarge, Fensterrahmen) in der XZ-Ebene bei y = 0. */
export function frameXZ(
  g: GeomBuilder,
  width: number,
  height: number,
  depth: number,
  profile: number,
  z0: number,
  materialId: Id | null,
): void {
  const hw = width / 2
  const hd = depth / 2
  // links
  box(g, -hw, -hd, z0, -hw + profile, hd, z0 + height, materialId)
  // rechts
  box(g, hw - profile, -hd, z0, hw, hd, z0 + height, materialId)
  // oben
  box(g, -hw + profile, -hd, z0 + height - profile, hw - profile, hd, z0 + height, materialId)
}

/** Fuellung/Glasscheibe in der XZ-Ebene. */
export function panelXZ(
  g: GeomBuilder,
  width: number,
  height: number,
  thickness: number,
  z0: number,
  materialId: Id | null,
): void {
  box(g, -width / 2, -thickness / 2, z0, width / 2, thickness / 2, z0 + height, materialId)
}
