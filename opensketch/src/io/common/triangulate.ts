/**
 * Eigenstaendige 2D-Triangulierung (Ohren-Clipping mit Loch-Bruecken).
 *
 * Der Geometriekern hat mit `core.triangulatePolygon2D` eine eigene Variante.
 * Die IO-Schicht benutzt sie bewusst NICHT: die Exporter (STL, glTF, DAE, SVG)
 * haengen komplett an der Triangulierung, und sie sollen ohne den Kern
 * lauffaehig bleiben - auch beim Export in einem Worker oder wenn der Kern
 * gerade eine andere Toleranz fuer Koplanaritaet ansetzt. Die Ergebnisse
 * muessen nicht identisch sein, nur beide korrekt.
 */

import type { Vec3Like } from '@/shared/types'
import { P, V } from '@/core/math'

export interface Pt2 {
  x: number
  y: number
}

const AREA_EPS = 1e-14

export function signedArea(points: readonly Pt2[]): number {
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y)
  }
  return sum * 0.5
}

/**
 * Trianguliert ein einfaches Polygon mit optionalen Loechern.
 * Rueckgabe: Indextripel in `outer.concat(...holes)`.
 */
export function triangulate2D(
  outer: readonly Pt2[],
  holes?: readonly (readonly Pt2[])[],
): number[] {
  if (outer.length < 3) return []
  const pts: Pt2[] = outer.map((p) => ({ x: p.x, y: p.y }))
  let ring: number[] = outer.map((_, i) => i)
  // `signedArea` ist positiv fuer Gegenuhrzeigersinn - so erwartet es earClip.
  if (signedArea(outer) < 0) ring.reverse()

  const holeRings: number[][] = []
  for (const hole of holes ?? []) {
    if (hole.length < 3) continue
    const start = pts.length
    for (const p of hole) pts.push({ x: p.x, y: p.y })
    const hr = hole.map((_, i) => start + i)
    // Loecher laufen im Uhrzeigersinn
    if (signedArea(hole) > 0) hr.reverse()
    holeRings.push(hr)
  }

  if (holeRings.length > 0) {
    holeRings.sort((a, b) => maxXOf(b, pts) - maxXOf(a, pts))
    for (const hr of holeRings) ring = spliceHole(ring, hr, pts)
  }

  return earClip(ring, pts)
}

function maxXOf(ring: readonly number[], pts: readonly Pt2[]): number {
  let best = -Infinity
  for (const i of ring) if (pts[i].x > best) best = pts[i].x
  return best
}

/** Verbindet ein Loch per Bruecke mit der Aussenschleife (Earcut-Verfahren). */
function spliceHole(ring: number[], hole: number[], pts: readonly Pt2[]): number[] {
  let holeStart = 0
  let bestX = -Infinity
  for (let i = 0; i < hole.length; i++) {
    if (pts[hole[i]].x > bestX) {
      bestX = pts[hole[i]].x
      holeStart = i
    }
  }
  const m = pts[hole[holeStart]]

  // Strahl von m nach +x auf die Aussenschleife schiessen
  let bridge = -1
  let bridgeX = -Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = pts[ring[i]]
    const b = pts[ring[(i + 1) % ring.length]]
    if (a.y > m.y === b.y > m.y) continue
    const x = a.x + ((m.y - a.y) / (b.y - a.y)) * (b.x - a.x)
    if (x < m.x) continue
    if (x > bridgeX) {
      bridgeX = x
      bridge = a.x > b.x ? i : (i + 1) % ring.length
    }
  }
  if (bridge < 0) {
    // Fallback: naechstgelegener Punkt der Aussenschleife
    let bestDist = Infinity
    for (let i = 0; i < ring.length; i++) {
      const d = dist2(pts[ring[i]], m)
      if (d < bestDist) {
        bestDist = d
        bridge = i
      }
    }
  }
  if (bridge < 0) return ring

  const rotated: number[] = []
  for (let k = 0; k < hole.length; k++) rotated.push(hole[(holeStart + k) % hole.length])
  rotated.push(hole[holeStart])

  return [...ring.slice(0, bridge + 1), ...rotated, ...ring.slice(bridge)]
}

function dist2(a: Pt2, b: Pt2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function cross2(a: Pt2, b: Pt2, c: Pt2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function pointInTriangle(a: Pt2, b: Pt2, c: Pt2, p: Pt2): boolean {
  const d1 = cross2(a, b, p)
  const d2 = cross2(b, c, p)
  const d3 = cross2(c, a, p)
  const hasNeg = d1 < -AREA_EPS || d2 < -AREA_EPS || d3 < -AREA_EPS
  const hasPos = d1 > AREA_EPS || d2 > AREA_EPS || d3 > AREA_EPS
  return !(hasNeg && hasPos)
}

/** Klassisches Ohren-Clipping, O(n^2), fuer eine einzelne CCW-Schleife. */
function earClip(ring: readonly number[], pts: readonly Pt2[]): number[] {
  const indices = [...ring]
  const out: number[] = []
  let guard = indices.length * indices.length + 16

  while (indices.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i + indices.length - 1) % indices.length]
      const i1 = indices[i]
      const i2 = indices[(i + 1) % indices.length]
      const a = pts[i0]
      const b = pts[i1]
      const c = pts[i2]
      if (cross2(a, b, c) <= AREA_EPS) continue // reflex oder entartet

      let containsOther = false
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k]
        if (idx === i0 || idx === i1 || idx === i2) continue
        if (pointInTriangle(a, b, c, pts[idx])) {
          containsOther = true
          break
        }
      }
      if (containsOther) continue

      out.push(i0, i1, i2)
      indices.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) {
      // Entartetes Polygon: den spitzesten Punkt abschneiden und weitermachen.
      const i0 = indices[indices.length - 1]
      const i1 = indices[0]
      const i2 = indices[1]
      out.push(i0, i1, i2)
      indices.splice(0, 1)
    }
  }
  if (indices.length === 3) out.push(indices[0], indices[1], indices[2])
  return out
}

/* ------------------------------------------------------------------ */
/* 3D-Bruecke                                                          */
/* ------------------------------------------------------------------ */

export interface Polygon3 {
  outer: Vec3Like[]
  holes: Vec3Like[][]
  normal: Vec3Like
}

/**
 * Trianguliert ein planares 3D-Polygon. Die Indizes beziehen sich auf
 * `outer.concat(...holes)`, die Umlaufrichtung passt zur uebergebenen Normalen.
 */
export function triangulatePolygon3(poly: Polygon3): number[] {
  const { outer, holes, normal } = poly
  if (outer.length < 3) return []
  if (outer.length === 3 && holes.length === 0) return [0, 1, 2]

  const plane = { n: normal, d: V.dot(normal, outer[0]) }
  const frame = P.frame(plane, outer[0])
  const to2 = (p: Vec3Like): Pt2 => frame.to2d(p)

  const outer2 = outer.map(to2)
  const holes2 = holes.map((h) => h.map(to2))
  // (u, v, n) ist rechtshaendig, also entspricht "gegen den Uhrzeigersinn in
  // (u, v)" genau der Vorderseite entlang +n. triangulate2D normalisiert die
  // Aussenschleife bereits auf CCW, die Dreiecke zeigen damit zur Normalen.
  return triangulate2D(outer2, holes2)
}
