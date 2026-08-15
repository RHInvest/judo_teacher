/**
 * Automatische Flaechenbildung: Verschmelzen, Teilen, Zyklensuche, Loecher.
 */

import { describe, expect, it } from 'vitest'
import {
  addEdge,
  addFacePolygon,
  addPolyline,
  cleanup,
  deletePrimitives,
  faceArea,
  faceVertices,
  findConnected,
  findCoplanar,
  geometryBounds,
  orderEdgePath,
  totalArea,
} from '@/core'
import { POINT_TOL } from '@/core/math'
import {
  countEdges,
  countFaces,
  countVertices,
  edgeIds,
  expectValid,
  faceIds,
  geom,
  p,
  rect,
} from './helpers'

describe('Flaechenbildung aus Kanten', () => {
  it('erzeugt aus vier Kanten genau eine Flaeche', () => {
    const g = geom()
    const r = rect(4, 3)
    addEdge(g, r[0], r[1])
    expect(countFaces(g)).toBe(0)
    addEdge(g, r[1], r[2])
    addEdge(g, r[2], r[3])
    expect(countFaces(g)).toBe(0)
    addEdge(g, r[3], r[0])

    expect(countFaces(g)).toBe(1)
    expect(countEdges(g)).toBe(4)
    expect(countVertices(g)).toBe(4)
    expect(faceArea(g, faceIds(g)[0])).toBeCloseTo(12, 9)
    expectValid(g, 'Rechteck')
  })

  it('teilt das Rechteck mit einer Diagonalen in zwei Flaechen', () => {
    const g = geom()
    const r = rect(4, 3)
    addPolyline(g, r, true)
    expect(countFaces(g)).toBe(1)

    addEdge(g, r[0], r[2])

    expect(countFaces(g)).toBe(2)
    expect(countEdges(g)).toBe(5)
    expect(countVertices(g)).toBe(4)
    expect(totalArea(g)).toBeCloseTo(12, 9)
    for (const id of faceIds(g)) expect(faceArea(g, id)).toBeCloseTo(6, 9)
    expectValid(g, 'Diagonale')
  })

  it('teilt zwei sich kreuzende Kanten in vier Kanten mit einem neuen Vertex', () => {
    const g = geom()
    addEdge(g, p(-1, 0), p(1, 0))
    expect(countEdges(g)).toBe(1)
    expect(countVertices(g)).toBe(2)

    addEdge(g, p(0, -1), p(0, 1))

    expect(countEdges(g)).toBe(4)
    expect(countVertices(g)).toBe(5)
    expect(countFaces(g)).toBe(0)
    expectValid(g, 'Kreuzung')
  })

  it('teilt eine Kante, die durch einen bestehenden Vertex laeuft', () => {
    const g = geom()
    addEdge(g, p(0, 0), p(1, 0))
    addEdge(g, p(1, 0), p(2, 0))
    // eine Kante ueber beide hinweg darf keine Duplikate erzeugen
    addEdge(g, p(0, 0), p(2, 0))

    expect(countEdges(g)).toBe(2)
    expect(countVertices(g)).toBe(3)
    expectValid(g, 'Durchlaufender Vertex')
  })

  it('fuehrt kollineare Ueberlappungen zusammen statt zu duplizieren', () => {
    const g = geom()
    addEdge(g, p(0, 0), p(4, 0))
    addEdge(g, p(2, 0), p(6, 0))

    expect(countEdges(g)).toBe(3)
    expect(countVertices(g)).toBe(4)
    expectValid(g, 'Kollinear')
  })

  it('bleibt idempotent, wenn dieselbe Kante zweimal gezogen wird', () => {
    const g = geom()
    const r = rect(2, 2)
    addPolyline(g, r, true)
    const before = { v: countVertices(g), e: countEdges(g), f: countFaces(g) }

    addPolyline(g, r, true)
    addEdge(g, r[0], r[1])
    addEdge(g, r[1], r[0])

    expect(countVertices(g)).toBe(before.v)
    expect(countEdges(g)).toBe(before.e)
    expect(countFaces(g)).toBe(before.f)
    expectValid(g, 'Idempotenz')
  })

  it('verschmilzt Endpunkte innerhalb von POINT_TOL', () => {
    const g = geom()
    addEdge(g, p(0, 0), p(1, 0))
    addEdge(g, p(1 + POINT_TOL / 4, 0), p(1, 1))

    expect(countVertices(g)).toBe(3)
    expect(countEdges(g)).toBe(2)
    expectValid(g, 'Verschmelzung')
  })

  it('erzeugt keine Flaechen fuer Konstruktionskanten', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true, { guide: true })
    expect(countFaces(g)).toBe(0)
    expectValid(g, 'Guide')
  })

  it('findet auch geneigte Flaechen', () => {
    const g = geom()
    const tri = [p(0, 0, 0), p(2, 0, 1), p(0, 2, 1)]
    addPolyline(g, tri, true)

    expect(countFaces(g)).toBe(1)
    expect(faceVertices(g, faceIds(g)[0]).length).toBe(3)
    expectValid(g, 'Schraege')
  })
})

describe('Flaechen mit Loechern', () => {
  it('macht eine innenliegende Schleife zum Loch', () => {
    const g = geom()
    addPolyline(g, rect(10, 10), true)
    expect(countFaces(g)).toBe(1)

    addPolyline(g, [p(3, 3), p(7, 3), p(7, 7), p(3, 7)], true)

    // aussen mit Loch + die innere Flaeche selbst
    expect(countFaces(g)).toBe(2)
    const areas = faceIds(g)
      .map((id) => faceArea(g, id))
      .sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(16, 6)
    expect(areas[1]).toBeCloseTo(84, 6)
    expectValid(g, 'Loch')
  })

  it('baut eine Flaeche mit Loch direkt aus Punktschleifen', () => {
    const g = geom()
    addFacePolygon(g, rect(10, 10), [[p(3, 3), p(7, 3), p(7, 7), p(3, 7)]])

    expect(countFaces(g)).toBe(1)
    const id = faceIds(g)[0]
    expect(g.faces[id].inner.length).toBe(1)
    expect(faceArea(g, id)).toBeCloseTo(84, 6)
    expectValid(g, 'addFacePolygon mit Loch')
  })
})

describe('Loeschen und Aufraeumen', () => {
  it('entfernt mit einer Kante auch die anliegende Flaeche', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    const eId = edgeIds(g)[0]

    deletePrimitives(g, { edgeIds: [eId] })

    expect(countFaces(g)).toBe(0)
    expect(countEdges(g)).toBe(3)
    expectValid(g, 'Kante geloescht')
  })

  it('loescht eine Flaeche ohne ihre Kanten', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)

    deletePrimitives(g, { faceIds: faceIds(g) })

    expect(countFaces(g)).toBe(0)
    expect(countEdges(g)).toBe(4)
    expectValid(g, 'Flaeche geloescht')
  })

  it('cleanup meldet keine Fehler auf gesunder Geometrie', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    cleanup(g)
    expect(countFaces(g)).toBe(1)
    expectValid(g, 'cleanup')
  })
})

describe('Graph-Abfragen', () => {
  it('findet zusammenhaengende Primitive', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    addPolyline(g, [p(10, 10), p(12, 10), p(12, 12), p(10, 12)], true)

    const found = findConnected(g, { faceIds: [faceIds(g)[0]] })
    expect(found.edgeIds.length).toBe(4)
    expect(found.vertexIds.length).toBe(4)
    expect(found.faceIds.length).toBe(1)
  })

  it('findet koplanare Nachbarflaechen', () => {
    const g = geom()
    const r = rect(4, 2)
    addPolyline(g, r, true)
    addEdge(g, p(2, 0), p(2, 2))

    expect(countFaces(g)).toBe(2)
    expect(findCoplanar(g, faceIds(g)[0]).length).toBe(2)
  })

  it('ordnet lose Kanten zu einem Pfad', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(1, 0), p(1, 1), p(2, 1)], false)
    const path = orderEdgePath(g, edgeIds(g))
    expect(path).not.toBeNull()
    expect(path?.length).toBe(3)
  })

  it('liefert null fuer Kanten ohne einfachen Pfad', () => {
    const g = geom()
    addEdge(g, p(0, 0), p(1, 0))
    addEdge(g, p(5, 5), p(6, 5))
    expect(orderEdgePath(g, edgeIds(g))).toBeNull()
  })

  it('berechnet die Bounding Box', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const b = geometryBounds(g)
    expect(b.min.x).toBeCloseTo(0)
    expect(b.max.x).toBeCloseTo(4)
    expect(b.max.y).toBeCloseTo(3)
  })
})
