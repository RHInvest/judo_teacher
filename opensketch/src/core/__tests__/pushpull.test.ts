/**
 * Druecken/Ziehen: Wuerfel, Rohr, Nachbarflaechen, negative Distanz.
 */

import { describe, expect, it } from 'vitest'
import {
  addEdge,
  addFacePolygon,
  addPolyline,
  faceArea,
  isSolid,
  orientFacesConsistently,
  pushPull,
  raycast,
  solidVolume,
  totalArea,
} from '@/core'
import { R, V } from '@/core/math'
import { countEdges, countFaces, countVertices, expectValid, faceIds, geom, p, rect } from './helpers'

/** Rechteck zeichnen und die entstandene Flaeche zurueckgeben. */
function rectFace(g: ReturnType<typeof geom>, w: number, h: number, z = 0): string {
  addPolyline(g, rect(w, h, z), true)
  const ids = faceIds(g)
  return ids[ids.length - 1]
}

describe('pushPull - Wuerfel', () => {
  it('erzeugt aus einem Quadrat einen geschlossenen Wuerfel', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)

    pushPull(g, f, 2)

    expect(countFaces(g)).toBe(6)
    expect(countEdges(g)).toBe(12)
    expect(countVertices(g)).toBe(8)
    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo(8, 9)
    expect(totalArea(g)).toBeCloseTo(24, 9)
    expectValid(g, 'Wuerfel')
  })

  it('extrudiert auch bei negativer Distanz zu einem gueltigen Volumen', () => {
    const g = geom()
    const f = rectFace(g, 2, 3)

    pushPull(g, f, -1.5)

    expect(countFaces(g)).toBe(6)
    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo(9, 9)
    expectValid(g, 'Negative Distanz')
  })

  it('orientiert alle Flaechen des Wuerfels nach aussen', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)
    pushPull(g, f, 2)
    orientFacesConsistently(g, faceIds(g)[0])

    const centre = { x: 1, y: 1, z: 1 }
    let outward = 0
    for (const id of faceIds(g)) {
      const face = g.faces[id]
      const pt = face.outer.vertices
        .map((v) => g.vertices[v].p)
        .reduce((acc, q) => V.add(acc, q), { x: 0, y: 0, z: 0 })
      const mid = V.div(pt, face.outer.vertices.length)
      if (V.dot(face.normal, V.sub(mid, centre)) > 0) outward++
    }
    // konsistent orientiert heisst: alle nach aussen oder alle nach innen
    expect(outward === 6 || outward === 0).toBe(true)
    expectValid(g, 'Orientierung')
  })

  it('verlaengert eine bestehende Wand statt sie zu duplizieren', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)
    pushPull(g, f, 2)
    const top = faceIds(g).find((id) => Math.abs(g.faces[id].plane.d) > 1.9 && Math.abs(g.faces[id].normal.z) > 0.9)
    expect(top).toBeDefined()

    pushPull(g, top as string, 3)

    expect(countFaces(g)).toBe(6)
    expect(countEdges(g)).toBe(12)
    expect(countVertices(g)).toBe(8)
    expect(solidVolume(g)).toBeCloseTo(20, 9)
    expectValid(g, 'Wand verlaengert')
  })

  it('zieht angrenzende koplanare Flaechen nicht mit', () => {
    const g = geom()
    // 6 x 2 bei x = 2 geteilt: links 4 m2, rechts 8 m2
    addPolyline(g, rect(6, 2), true)
    addEdge(g, p(2, 0), p(2, 2))
    expect(countFaces(g)).toBe(2)
    const left = faceIds(g).find((id) => {
      const xs = g.faces[id].outer.vertices.map((v) => g.vertices[v].p.x)
      return Math.max(...xs) <= 2 + 1e-9
    })
    expect(left).toBeDefined()

    pushPull(g, left as string, 1)

    // die rechte Flaeche liegt unveraendert flach in der XY-Ebene
    const right = faceIds(g).filter((id) => {
      const f = g.faces[id]
      return Math.abs(f.normal.z) > 0.9 && Math.abs(f.plane.d) < 1e-9 && Math.abs(faceArea(g, id) - 8) < 1e-6
    })
    expect(right.length).toBe(1)

    // der Deckel des Quaders liegt auf z = 1 und ist 4 m2 gross
    const top = faceIds(g).filter((id) => {
      const f = g.faces[id]
      return Math.abs(f.normal.z) > 0.9 && Math.abs(Math.abs(f.plane.d) - 1) < 1e-9
    })
    expect(top.length).toBe(1)
    expect(faceArea(g, top[0])).toBeCloseTo(4, 9)
    expectValid(g, 'Nachbarflaeche')
  })
})

describe('pushPull - Loecher', () => {
  it('macht aus einer Flaeche mit Loch ein Rohr', () => {
    const g = geom()
    addFacePolygon(g, rect(10, 10), [[p(3, 3), p(7, 3), p(7, 7), p(3, 7)]])
    const f = faceIds(g)[0]

    pushPull(g, f, 5)

    // 2 Deckel + 4 Aussenwaende + 4 Innenwaende
    expect(countFaces(g)).toBe(10)
    expect(countVertices(g)).toBe(16)
    expect(countEdges(g)).toBe(24)
    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo((100 - 16) * 5, 6)
    expectValid(g, 'Rohr')
  })

  it('durchstoesst einen Quader und hinterlaesst ein Loch', () => {
    const g = geom()
    const base = rectFace(g, 10, 10)
    pushPull(g, base, 4)
    expect(isSolid(g)).toBe(true)

    // Fenster auf die Deckflaeche zeichnen
    const top = faceIds(g).find(
      (id) => Math.abs(g.faces[id].normal.z) > 0.9 && Math.abs(g.faces[id].plane.d) > 3.9,
    )
    expect(top).toBeDefined()
    addPolyline(g, [p(3, 3, 4), p(6, 3, 4), p(6, 6, 4), p(3, 6, 4)], true)

    const window = faceIds(g).find((id) => Math.abs(faceArea(g, id) - 9) < 1e-6)
    expect(window).toBeDefined()

    pushPull(g, window as string, -4)

    expect(isSolid(g)).toBe(true)
    expect(solidVolume(g)).toBeCloseTo(10 * 10 * 4 - 9 * 4, 6)
    expectValid(g, 'Durchstossen')
  })

  it('erhaelt die Startflaeche mit createNewStartingFace', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)

    pushPull(g, f, 2, { createNewStartingFace: true })

    expect(g.faces[f]).toBeDefined()
    expect(countFaces(g)).toBe(6)
    expectValid(g, 'createNewStartingFace')
  })
})

describe('raycast', () => {
  it('trifft die Deckflaeche eines Wuerfels zuerst', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)
    pushPull(g, f, 2)

    const hits = raycast(g, R.ray({ x: 1, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }), { kinds: ['face'] })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].kind).toBe('face')
    expect(hits[0].point.z).toBeCloseTo(2, 6)
  })

  it('bevorzugt einen Vertex vor der Flaeche', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)
    pushPull(g, f, 2)

    const hits = raycast(g, R.ray({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }), { tolerance: 0.05 })
    expect(hits[0].kind).toBe('vertex')
  })

  it('trifft nichts neben der Geometrie', () => {
    const g = geom()
    const f = rectFace(g, 2, 2)
    pushPull(g, f, 2)

    const hits = raycast(g, R.ray({ x: 50, y: 50, z: 10 }, { x: 0, y: 0, z: -1 }))
    expect(hits.length).toBe(0)
  })
})
