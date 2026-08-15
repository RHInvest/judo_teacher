/**
 * Folge-mir, Rotationskoerper, Versatz, Flaechenschnitt.
 */

import { describe, expect, it } from 'vitest'
import {
  addPolyline,
  booleanSolid,
  buildCircle,
  edgeLength,
  faceArea,
  followMe,
  intersectFaces,
  isSolid,
  mergeCoplanarFaces,
  offsetEdges,
  offsetFace,
  pushPull,
  revolve,
  softenEdges,
  solidVolume,
  totalArea,
} from '@/core'
import { countEdges, countFaces, edgeIds, expectValid, faceIds, geom, p, rect } from './helpers'

/** Die zuletzt entstandene Flaeche. */
function lastFace(g: ReturnType<typeof geom>): string {
  const ids = faceIds(g)
  return ids[ids.length - 1]
}

describe('followMe', () => {
  it('sweept ein Profil ueber einen L-Pfad', () => {
    const g = geom()
    // Profil: 1 x 1 in der YZ-Ebene bei x = 0
    addPolyline(g, [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], true)
    const profile = lastFace(g)
    expect(faceArea(g, profile)).toBeCloseTo(1, 9)

    // Pfad: von (0,0,0) nach (4,0,0), dann nach (4,4,0)
    addPolyline(g, [p(0, 0, 0), p(4, 0, 0), p(4, 4, 0)], false, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)
    expect(path.length).toBe(2)

    followMe(g, profile, path)

    // 4 Mantelflaechen pro Segment (2 Segmente, an der Ecke zusammengefuehrt)
    // plus Start- und Enddeckel
    expect(countFaces(g)).toBe(10)
    // Hilfskanten zaehlen bei isSolid() nicht mit, der Koerper ist geschlossen
    expect(isSolid(g)).toBe(true)
    expectValid(g, 'followMe L-Pfad')
  })

  it('erzeugt aus einem geschlossenen Pfad einen geschlossenen Koerper', () => {
    const g = geom()
    // 1 x 1 Profil in der Ebene x = 3, senkrecht zum ersten Pfadsegment
    addPolyline(
      g,
      [p(3, -0.5, -0.5), p(3, 0.5, -0.5), p(3, 0.5, 0.5), p(3, -0.5, 0.5)],
      true,
    )
    const profile = lastFace(g)
    expect(faceArea(g, profile)).toBeCloseTo(1, 9)

    // geschlossener quadratischer Pfad, Mittellinie 4 x 6 = 24 lang
    addPolyline(g, [p(0, 0, 0), p(6, 0, 0), p(6, 6, 0), p(0, 6, 0)], true, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)
    expect(path.length).toBe(4)

    followMe(g, profile, path)

    // 4 Profilkanten x 4 Pfadsegmente, keine Deckel
    expect(countFaces(g)).toBe(16)
    expect(isSolid(g)).toBe(true)
    // Gehrungsstoesse erhalten das Volumen: Querschnitt x Mittellinienlaenge
    expect(solidVolume(g)).toBeCloseTo(24, 6)
    expectValid(g, 'followMe geschlossen')
  })

  it('haelt bei einem geraden Pfad die Profilflaeche konstant', () => {
    const g = geom()
    addPolyline(g, [p(0, 0, 0), p(0, 2, 0), p(0, 2, 2), p(0, 0, 2)], true)
    const profile = lastFace(g)
    addPolyline(g, [p(0, 1, 1), p(5, 1, 1)], false, { guide: true })
    const path = edgeIds(g).filter((id) => g.edges[id].guide === true)

    followMe(g, profile, path)

    // Mantel 4 + 2 Deckel
    expect(countFaces(g)).toBe(6)
    const caps = faceIds(g).filter((id) => Math.abs(faceArea(g, id) - 4) < 1e-6)
    expect(caps.length).toBe(2)
    expectValid(g, 'followMe gerade')
  })
})

describe('revolve', () => {
  it('erzeugt aus einem Rechteck einen Rotationskoerper', () => {
    const g = geom()
    // Rechteck im Abstand 2 von der Z-Achse, 1 breit, 1 hoch
    addPolyline(g, [p(2, 0, 0), p(3, 0, 0), p(3, 0, 1), p(2, 0, 1)], true)
    const profile = lastFace(g)

    revolve(g, profile, p(0, 0, 0), p(0, 0, 1), Math.PI * 2, 24)

    expect(countFaces(g)).toBe(4 * 24)
    expect(isSolid(g)).toBe(true)
    // exaktes Volumen eines 24-eckigen Rings: Prismenformel ueber die Sehnen
    const exact = Math.PI * (3 * 3 - 2 * 2) * 1
    expect(solidVolume(g)).toBeGreaterThan(exact * 0.97)
    expect(solidVolume(g)).toBeLessThan(exact)
    expectValid(g, 'revolve')
  })

  it('setzt bei einer Teildrehung Deckel', () => {
    const g = geom()
    addPolyline(g, [p(2, 0, 0), p(3, 0, 0), p(3, 0, 1), p(2, 0, 1)], true)
    const profile = lastFace(g)

    revolve(g, profile, p(0, 0, 0), p(0, 0, 1), Math.PI / 2, 6)

    // 4 Mantelstreifen x 6 Segmente + 2 Deckel
    expect(countFaces(g)).toBe(4 * 6 + 2)
    expect(isSolid(g)).toBe(true)
    expectValid(g, 'revolve Teildrehung')
  })
})

describe('offsetFace', () => {
  it('versetzt nach innen', () => {
    const g = geom()
    addPolyline(g, rect(10, 10), true)
    const f = lastFace(g)

    offsetFace(g, f, -2)

    expect(countFaces(g)).toBe(2)
    const areas = faceIds(g)
      .map((id) => faceArea(g, id))
      .sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(36, 6) // 6 x 6 Innenflaeche
    expect(areas[1]).toBeCloseTo(64, 6) // Rahmen
    expectValid(g, 'offset innen')
  })

  it('versetzt nach aussen', () => {
    const g = geom()
    addPolyline(g, rect(4, 4), true)
    const f = lastFace(g)

    offsetFace(g, f, 1)

    expect(countFaces(g)).toBe(2)
    const areas = faceIds(g)
      .map((id) => faceArea(g, id))
      .sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(16, 6) // Original
    expect(areas[1]).toBeCloseTo(36 - 16, 6) // Ring 6x6 minus 4x4
    expectValid(g, 'offset aussen')
  })

  it('taet nichts, wenn der Versatz die Flaeche auffrisst', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    const f = lastFace(g)

    offsetFace(g, f, -5)

    expect(countFaces(g)).toBe(1)
    expect(faceArea(g, f)).toBeCloseTo(4, 9)
    expectValid(g, 'offset kollabiert')
  })

  it('behandelt konkave Ecken', () => {
    const g = geom()
    // L-Form
    addPolyline(g, [p(0, 0), p(6, 0), p(6, 2), p(2, 2), p(2, 6), p(0, 6)], true)
    const f = lastFace(g)
    const before = faceArea(g, f)
    expect(before).toBeCloseTo(20, 9)

    offsetFace(g, f, -0.5)

    expect(countFaces(g)).toBe(2)
    const inner = faceIds(g)
      .map((id) => faceArea(g, id))
      .sort((a, b) => a - b)[0]
    // L-Form 0,5 nach innen: 5 x 1 + 1 x 4 = 9
    expect(inner).toBeCloseTo(9, 6)
    expectValid(g, 'offset konkav')
  })

  it('versetzt einen Kreis nach innen', () => {
    const g = geom()
    addPolyline(g, buildCircle(p(0, 0), p(0, 0, 1), 5, 24), true)
    const f = lastFace(g)

    offsetFace(g, f, -1)

    expect(countFaces(g)).toBe(2)
    expectValid(g, 'offset Kreis')
  })
})

describe('offsetEdges', () => {
  it('versetzt einen offenen Kantenzug zur Seite', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(4, 0), p(4, 3)], false)
    const path = edgeIds(g)

    const change = offsetEdges(g, path, 1)

    expect(change.addedEdges.length).toBeGreaterThan(0)
    expectValid(g, 'offsetEdges offen')
  })

  it('versetzt einen geschlossenen Kantenzug', () => {
    const g = geom()
    addPolyline(g, rect(6, 6), true)
    const ring = faceIds(g).length > 0 ? g.faces[lastFace(g)].outer.edges : []

    offsetEdges(g, ring, -1)

    expect(countFaces(g)).toBe(2)
    expectValid(g, 'offsetEdges geschlossen')
  })
})

describe('intersectFaces', () => {
  it('erzeugt Schnittkanten zwischen zwei sich durchdringenden Quadern', () => {
    const g = geom()
    addPolyline(g, rect(4, 4), true)
    const a = lastFace(g)
    pushPull(g, a, 4)

    // zweiter Quader, quer durch den ersten
    addPolyline(g, [p(-1, 1, 1), p(5, 1, 1), p(5, 3, 1), p(-1, 3, 1)], true)
    const b = faceIds(g).find((id) => Math.abs(faceArea(g, id) - 12) < 1e-6)
    expect(b).toBeDefined()
    pushPull(g, b as string, 2)

    const edgesBefore = countEdges(g)
    const solidA = faceIds(g).filter((id) => Math.abs(g.faces[id].plane.d) < 1e-9)
    const change = intersectFaces(g, solidA)

    expect(countEdges(g)).toBeGreaterThan(edgesBefore)
    expect(change.addedEdges.length).toBeGreaterThan(0)
    expectValid(g, 'intersectFaces')
  })

  it('erzeugt nichts fuer koplanare Flaechen', () => {
    const g = geom()
    addPolyline(g, rect(4, 2), true)
    const f = faceIds(g)
    const change = intersectFaces(g, f)
    expect(change.addedEdges.length).toBe(0)
  })
})

describe('mergeCoplanarFaces und softenEdges', () => {
  it('fuehrt zwei koplanare Haelften wieder zusammen', () => {
    const g = geom()
    addPolyline(g, rect(6, 2), true)
    addPolyline(g, [p(3, 0), p(3, 2)], false)
    expect(countFaces(g)).toBe(2)

    mergeCoplanarFaces(g)

    expect(countFaces(g)).toBe(1)
    expect(faceArea(g, lastFace(g))).toBeCloseTo(12, 6)
    expectValid(g, 'mergeCoplanar')
  })

  it('weicht Kanten unterhalb des Grenzwinkels', () => {
    const g = geom()
    addPolyline(g, buildCircle(p(0, 0), p(0, 0, 1), 3, 24), true)
    const f = lastFace(g)
    pushPull(g, f, 2)

    const vertical = edgeIds(g).filter((id) => {
      const e = g.edges[id]
      return Math.abs(g.vertices[e.a].p.z - g.vertices[e.b].p.z) > 1e-9
    })
    softenEdges(g, vertical, Math.PI / 4)

    expect(vertical.every((id) => g.edges[id].soft)).toBe(true)
    expect(vertical.every((id) => g.edges[id].smooth)).toBe(true)
    expectValid(g, 'softenEdges')
  })
})

describe('booleanSolid', () => {
  /** Achsparalleler Quader als eigenstaendige Geometrie. */
  function box(x0: number, y0: number, z0: number, sx: number, sy: number, sz: number) {
    const g = geom()
    addPolyline(
      g,
      [p(x0, y0, z0), p(x0 + sx, y0, z0), p(x0 + sx, y0 + sy, z0), p(x0, y0 + sy, z0)],
      true,
    )
    pushPull(g, faceIds(g)[0], sz)
    return g
  }

  it('vereinigt zwei ueberlappende Quader', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(1, 1, 1, 2, 2, 2)
    expect(solidVolume(a)).toBeCloseTo(8, 9)

    const res = booleanSolid(a, b, 'union')
    expect(res).not.toBeNull()
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(8 + 8 - 1, 6)
    expectValid(res as never, 'union')
  })

  it('schneidet zwei ueberlappende Quader', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(1, 1, 1, 2, 2, 2)

    const res = booleanSolid(a, b, 'intersect')
    expect(res).not.toBeNull()
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(1, 6)
    expectValid(res as never, 'intersect')
  })

  it('subtrahiert einen Quader vom anderen', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(1, 1, 1, 2, 2, 2)

    const res = booleanSolid(a, b, 'subtract')
    expect(res).not.toBeNull()
    expect(isSolid(res as never)).toBe(true)
    expect(solidVolume(res as never)).toBeCloseTo(7, 6)
    expectValid(res as never, 'subtract')
  })

  it('liefert null, wenn sich disjunkte Koerper schneiden sollen', () => {
    const a = box(0, 0, 0, 1, 1, 1)
    const b = box(5, 5, 5, 1, 1, 1)
    expect(booleanSolid(a, b, 'intersect')).toBeNull()
  })

  it('liefert null fuer offene Geometrie', () => {
    const open = geom()
    addPolyline(open, rect(2, 2), true)
    const solid = box(0, 0, 0, 1, 1, 1)
    expect(booleanSolid(open, solid, 'union')).toBeNull()
  })

  it('laesst die Operanden unveraendert', () => {
    const a = box(0, 0, 0, 2, 2, 2)
    const b = box(1, 1, 1, 2, 2, 2)
    const facesBefore = countFaces(a)
    const areaBefore = totalArea(a)

    booleanSolid(a, b, 'union')

    expect(countFaces(a)).toBe(facesBefore)
    expect(totalArea(a)).toBeCloseTo(areaBefore, 9)
  })
})

describe('Kantenlaengen', () => {
  it('misst die Kantenlaenge', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(3, 4)], false)
    expect(edgeLength(g, edgeIds(g)[0])).toBeCloseTo(5, 9)
  })
})
