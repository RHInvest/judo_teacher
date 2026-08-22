/**
 * Unsinnseingaben an den Contract-Funktionen.
 *
 * Grundsatz: Keine Kernfunktion wirft, und keine hinterlaesst eine beschaedigte
 * Geometrie. Eine leere `GeometryChange` ist die richtige Antwort auf eine
 * Eingabe, aus der nichts Sinnvolles folgt - kaputte Topologie ist es nie.
 * Deshalb steht hinter fast jedem Fall ein `expectValid`.
 *
 * Die Werkzeugschicht meldet dem Nutzer, dass nichts passiert ist
 * (`BaseTool.abortDegenerate`); der Kern schweigt und bleibt heil.
 */

import { describe, expect, it } from 'vitest'
import {
  addEdge,
  addFacePolygon,
  addPolyline,
  boundingEdges,
  booleanSolid,
  buildArc,
  buildArc3Points,
  buildArcBulge,
  buildBezier,
  buildCircle,
  buildPolygon,
  buildRectangle,
  cleanup,
  cloneGeometry,
  deletePrimitives,
  edgeLength,
  edgePoints,
  faceArea,
  faceHoleVertices,
  facePlane,
  faceVertices,
  findConnected,
  findCoplanar,
  followMe,
  geometryBounds,
  intersectFaces,
  isSolid,
  mergeCoplanarFaces,
  mergeGeometry,
  moveVertices,
  offsetEdges,
  offsetFace,
  orderEdgePath,
  orientFacesConsistently,
  pushPull,
  reverseFaces,
  revolve,
  softenEdges,
  solidVolume,
  totalArea,
  transformGeometry,
  transformPrimitives,
  triangulateFace,
  triangulatePolygon2D,
  validate,
} from '@/core'
import { M } from '@/core/math'
import type { GeometryChange } from '@/shared/store-api'
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

const UNBEKANNT = 'gibtsnicht'
const NAN_POINT = p(NaN, 0, 0)

/** true, wenn die Aenderung nichts hinzugefuegt und nichts entfernt hat. */
function isEmptyChange(c: GeometryChange): boolean {
  return (
    c.addedVertices.length === 0 &&
    c.addedEdges.length === 0 &&
    c.addedFaces.length === 0 &&
    c.removedVertices.length === 0 &&
    c.removedEdges.length === 0 &&
    c.removedFaces.length === 0
  )
}

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

/** Zaehlt alle Primitive - fuer "die Geometrie hat sich nicht veraendert". */
function counts(g: ReturnType<typeof geom>): string {
  return `${countVertices(g)}/${countEdges(g)}/${countFaces(g)}`
}

/* ------------------------------------------------------------------ */

describe('Aufbau mit entarteten Eingaben', () => {
  it('erzeugt aus einer Kante der Laenge 0 nichts', () => {
    const g = geom()
    const change = addEdge(g, p(1, 1, 1), p(1, 1, 1))
    expect(isEmptyChange(change)).toBe(true)
    expect(counts(g)).toBe('0/0/0')
    expectValid(g, 'Kante Laenge 0')
  })

  it('erzeugt aus einer Kante mit NaN nichts', () => {
    const g = geom()
    addEdge(g, NAN_POINT, p(1, 0, 0))
    addEdge(g, p(0, 0, 0), p(NaN, NaN, NaN))
    expect(counts(g)).toBe('0/0/0')
    expectValid(g, 'Kante NaN')
  })

  it('vertraegt eine leere Punktliste', () => {
    const g = geom()
    expect(isEmptyChange(addPolyline(g, [], false))).toBe(true)
    expect(isEmptyChange(addPolyline(g, [], true))).toBe(true)
    expect(isEmptyChange(addPolyline(g, [p(1, 1)], true))).toBe(true)
    expect(counts(g)).toBe('0/0/0')
    expectValid(g, 'leere Punktliste')
  })

  it('vertraegt einen Kantenzug aus lauter gleichen Punkten', () => {
    const g = geom()
    addPolyline(g, [p(2, 2), p(2, 2), p(2, 2), p(2, 2)], true)
    expect(countFaces(g)).toBe(0)
    expectValid(g, 'Kantenzug entartet')
  })

  it('erzeugt aus einem kollinearen Kantenzug keine Flaeche', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(1, 0), p(2, 0), p(3, 0)], true)
    expect(countFaces(g)).toBe(0)
    expectValid(g, 'kollinear')
  })

  it('erzeugt aus einem entarteten Polygon keine Flaeche', () => {
    const g = geom()
    expect(isEmptyChange(addFacePolygon(g, []))).toBe(true)
    expect(isEmptyChange(addFacePolygon(g, [p(0, 0), p(1, 0)]))).toBe(true)
    addFacePolygon(g, [p(0, 0), p(1, 0), p(2, 0)])
    expect(countFaces(g)).toBe(0)
    expectValid(g, 'Polygon entartet')
  })

  it('ignoriert entartete Loecher, statt die Flaeche zu verlieren', () => {
    const g = geom()
    addFacePolygon(g, rect(6, 6), [[p(1, 1), p(1, 1)], []])
    expect(countFaces(g)).toBe(1)
    expect(faceArea(g, faceIds(g)[0])).toBeCloseTo(36, 6)
    expectValid(g, 'Loch entartet')
  })

  it('vertraegt NaN in einem Polygon', () => {
    const g = geom()
    addFacePolygon(g, [p(0, 0), p(4, 0), NAN_POINT, p(0, 4)])
    expectValid(g, 'Polygon NaN')
  })

  it('vertraegt das Zusammenfuehren mit einer leeren Geometrie', () => {
    const g = geom()
    addPolyline(g, rect(2, 2), true)
    const before = counts(g)
    expect(isEmptyChange(mergeGeometry(g, geom()))).toBe(true)
    expect(counts(g)).toBe(before)
    expectValid(g, 'merge leer')
  })
})

describe('Loeschen und Aufraeumen mit unbekannten Ids', () => {
  it('ignoriert unbekannte Ids beim Loeschen', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const before = counts(g)

    const change = deletePrimitives(g, {
      edgeIds: [UNBEKANNT],
      faceIds: [UNBEKANNT],
      vertexIds: [UNBEKANNT],
    })

    expect(isEmptyChange(change)).toBe(true)
    expect(counts(g)).toBe(before)
    expectValid(g, 'delete unbekannt')
  })

  it('vertraegt Loeschen ohne Angaben und auf leerer Geometrie', () => {
    const g = geom()
    expect(isEmptyChange(deletePrimitives(g, {}))).toBe(true)
    expect(isEmptyChange(cleanup(g))).toBe(true)
    expect(isEmptyChange(mergeCoplanarFaces(g))).toBe(true)
    expectValid(g, 'leer aufraeumen')
  })

  it('vertraegt mergeCoplanarFaces mit unbekannten Ids', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    expect(() => mergeCoplanarFaces(g, [UNBEKANNT])).not.toThrow()
    expect(countFaces(g)).toBe(1)
    expectValid(g, 'mergeCoplanar unbekannt')
  })

  it('haelt die Geometrie nach dem Loeschen einer Flaeche gueltig', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    deletePrimitives(g, { faceIds: faceIds(g) })
    expect(countFaces(g)).toBe(0)
    expect(countEdges(g)).toBe(4)
    expectValid(g, 'Flaeche geloescht')
  })
})

describe('Transformationen mit Unsinn', () => {
  it('vertraegt moveVertices mit unbekannten Ids und Delta 0', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const before = counts(g)

    expect(isEmptyChange(moveVertices(g, [UNBEKANNT], p(1, 0, 0)))).toBe(true)
    moveVertices(g, Object.keys(g.vertices), p(0, 0, 0))

    expect(counts(g)).toBe(before)
    expect(faceArea(g, faceIds(g)[0])).toBeCloseTo(12, 9)
    expectValid(g, 'moveVertices')
  })

  it('bewegt bei NaN im Delta nichts', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    moveVertices(g, Object.keys(g.vertices), NAN_POINT)

    for (const id in g.vertices) {
      expect(Number.isFinite(g.vertices[id].p.x)).toBe(true)
      expect(Number.isFinite(g.vertices[id].p.y)).toBe(true)
      expect(Number.isFinite(g.vertices[id].p.z)).toBe(true)
    }
    expectValid(g, 'moveVertices NaN')
  })

  it('vertraegt transformPrimitives mit unbekannten Ids', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const before = counts(g)

    expect(
      isEmptyChange(transformPrimitives(g, { faceIds: [UNBEKANNT] }, M.translation(p(1, 0, 0)), false)),
    ).toBe(true)
    expect(counts(g)).toBe(before)
    expectValid(g, 'transform unbekannt')
  })

  it('vertraegt eine entartete Matrix', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const flat = M.scaling(p(1, 1, 0))

    expect(() => transformPrimitives(g, { faceIds: faceIds(g) }, flat, false)).not.toThrow()
    expect(() => validate(g)).not.toThrow()
  })

  it('kopiert die Geometrie unabhaengig', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const copy = cloneGeometry(g)
    moveVertices(g, Object.keys(g.vertices), p(10, 0, 0))

    expect(geometryBounds(copy).min.x).toBeCloseTo(0, 9)
    expectValid(copy, 'clone')
    const moved = transformGeometry(copy, M.translation(p(0, 0, 5)))
    expect(geometryBounds(moved).min.z).toBeCloseTo(5, 9)
    expectValid(moved, 'transformGeometry')
  })

  it('vertraegt transformGeometry und cloneGeometry auf leerer Geometrie', () => {
    expect(countVertices(cloneGeometry(geom()))).toBe(0)
    expect(countVertices(transformGeometry(geom(), M.identity()))).toBe(0)
  })
})

describe('Modellierwerkzeuge mit Unsinn', () => {
  it('vertraegt pushPull mit unbekannter Flaeche und Distanz 0', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const before = counts(g)

    expect(isEmptyChange(pushPull(g, UNBEKANNT, 2))).toBe(true)
    expect(isEmptyChange(pushPull(g, faceIds(g)[0], 0))).toBe(true)
    expect(isEmptyChange(pushPull(g, faceIds(g)[0], NaN))).toBe(true)

    expect(counts(g)).toBe(before)
    expectValid(g, 'pushPull entartet')
  })

  it('vertraegt followMe mit leerem, unbekanntem und unzusammenhaengendem Pfad', () => {
    const g = geom()
    addPolyline(g, [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], true)
    const profile = faceIds(g)[0]
    const before = counts(g)

    expect(isEmptyChange(followMe(g, profile, []))).toBe(true)
    expect(isEmptyChange(followMe(g, profile, [UNBEKANNT]))).toBe(true)
    expect(isEmptyChange(followMe(g, UNBEKANNT, []))).toBe(true)

    // zwei Kanten, die sich nicht beruehren
    addPolyline(g, [p(3, 0, 0), p(4, 0, 0)], false, { guide: true })
    addPolyline(g, [p(8, 0, 0), p(9, 0, 0)], false, { guide: true })
    const lose = edgeIds(g).filter((id) => g.edges[id].guide === true)
    expect(() => followMe(g, profile, lose)).not.toThrow()

    expectValid(g, 'followMe entartet')
    expect(counts(g).split('/')[2]).toBe(before.split('/')[2])
  })

  it('vertraegt revolve mit Winkel 0, Achse 0 und zu wenig Segmenten', () => {
    const g = geom()
    addPolyline(g, [p(2, 0, 0), p(3, 0, 0), p(3, 0, 1), p(2, 0, 1)], true)
    const profile = faceIds(g)[0]
    const before = counts(g)

    expect(isEmptyChange(revolve(g, profile, p(0, 0, 0), p(0, 0, 1), 0, 12))).toBe(true)
    expect(isEmptyChange(revolve(g, profile, p(0, 0, 0), p(0, 0, 0), Math.PI, 12))).toBe(true)
    expect(isEmptyChange(revolve(g, profile, p(0, 0, 0), p(0, 0, 1), Math.PI, 0))).toBe(true)
    expect(isEmptyChange(revolve(g, profile, p(0, 0, 0), p(0, 0, 1), NaN, 12))).toBe(true)
    expect(isEmptyChange(revolve(g, UNBEKANNT, p(0, 0, 0), p(0, 0, 1), Math.PI, 12))).toBe(true)

    expect(counts(g)).toBe(before)
    expectValid(g, 'revolve entartet')
  })

  it('vertraegt offsetFace mit Distanz 0 und unbekannter Flaeche', () => {
    const g = geom()
    addPolyline(g, rect(4, 4), true)
    const before = counts(g)

    expect(isEmptyChange(offsetFace(g, faceIds(g)[0], 0))).toBe(true)
    expect(isEmptyChange(offsetFace(g, faceIds(g)[0], NaN))).toBe(true)
    expect(isEmptyChange(offsetFace(g, UNBEKANNT, 1))).toBe(true)

    expect(counts(g)).toBe(before)
    expectValid(g, 'offsetFace entartet')
  })

  it('vertraegt offsetEdges mit leerer, unbekannter und wirrer Kantenmenge', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(4, 0), p(4, 3)], false)
    const path = edgeIds(g)
    const before = counts(g)

    expect(isEmptyChange(offsetEdges(g, [], 1))).toBe(true)
    expect(isEmptyChange(offsetEdges(g, [UNBEKANNT], 1))).toBe(true)
    expect(isEmptyChange(offsetEdges(g, path, 0))).toBe(true)
    expect(isEmptyChange(offsetEdges(g, path, NaN))).toBe(true)

    expect(counts(g)).toBe(before)

    // zwei Kanten ohne gemeinsamen Punkt bilden keinen Pfad
    addPolyline(g, [p(10, 10), p(12, 10)], false)
    const wirr = [path[0], edgeIds(g)[edgeIds(g).length - 1]]
    expect(() => offsetEdges(g, wirr, 1)).not.toThrow()
    expectValid(g, 'offsetEdges entartet')
  })

  it('vertraegt intersectFaces mit leeren und unbekannten Mengen', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const before = counts(g)

    expect(isEmptyChange(intersectFaces(g, []))).toBe(true)
    expect(isEmptyChange(intersectFaces(g, [UNBEKANNT]))).toBe(true)
    expect(isEmptyChange(intersectFaces(g, faceIds(g), [UNBEKANNT]))).toBe(true)
    // eine Flaeche gegen sich selbst erzeugt keine Kanten
    expect(isEmptyChange(intersectFaces(g, faceIds(g), faceIds(g)))).toBe(true)

    expect(counts(g)).toBe(before)
    expectValid(g, 'intersectFaces entartet')
  })

  it('vertraegt reverseFaces, orientFacesConsistently und softenEdges mit Unsinn', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    expect(() => reverseFaces(g, [UNBEKANNT])).not.toThrow()
    expect(() => reverseFaces(g, [])).not.toThrow()
    expect(() => orientFacesConsistently(g, UNBEKANNT)).not.toThrow()
    expect(() => softenEdges(g, [UNBEKANNT], Math.PI / 4)).not.toThrow()
    expect(() => softenEdges(g, edgeIds(g), NaN)).not.toThrow()
    expect(() => softenEdges(g, [], Math.PI / 4)).not.toThrow()

    expectValid(g, 'orientierung entartet')
  })

  it('dreht mit reverseFaces die Normale wirklich um', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    const f = faceIds(g)[0]
    const before = { ...g.faces[f].normal }

    reverseFaces(g, [f])

    expect(g.faces[f].normal.z).toBeCloseTo(-before.z, 9)
    expect(faceArea(g, f)).toBeCloseTo(12, 6)
    expectValid(g, 'reverseFaces')
  })

  it('liefert booleanSolid bei Unsinn null, statt zu werfen', () => {
    const solid = box(0, 0, 0, 2, 2, 2)
    const leer = geom()

    expect(booleanSolid(leer, leer, 'union')).toBeNull()
    expect(booleanSolid(solid, leer, 'union')).toBeNull()
    expect(booleanSolid(leer, solid, 'subtract')).toBeNull()
    // Der Operand bleibt unangetastet
    expect(solidVolume(solid)).toBeCloseTo(8, 9)
    expectValid(solid, 'boolean Operand');
  })
})

describe('Abfragen mit unbekannten Ids', () => {
  it('liefert leere oder neutrale Werte statt zu werfen', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)

    expect(faceVertices(g, UNBEKANNT)).toEqual([])
    expect(faceHoleVertices(g, UNBEKANNT, 0)).toEqual([])
    expect(faceHoleVertices(g, faceIds(g)[0], 7)).toEqual([])
    expect(faceHoleVertices(g, faceIds(g)[0], -1)).toEqual([])
    expect(faceArea(g, UNBEKANNT)).toBe(0)
    expect(edgeLength(g, UNBEKANNT)).toBe(0)
    expect(triangulateFace(g, UNBEKANNT).indices.length).toBe(0)
    expect(totalArea(g, [UNBEKANNT])).toBe(0)

    expect(() => facePlane(g, UNBEKANNT)).not.toThrow()
    expect(() => edgePoints(g, UNBEKANNT)).not.toThrow()

    expect(findConnected(g, { faceIds: [UNBEKANNT] }).faceIds).toEqual([])
    expect(findCoplanar(g, UNBEKANNT)).toEqual([])
    expect(boundingEdges(g, [UNBEKANNT])).toEqual([])
    expect(orderEdgePath(g, [UNBEKANNT])).toBeNull()
    expect(orderEdgePath(g, [])).toBeNull()
  })

  it('vertraegt Abfragen auf leerer Geometrie', () => {
    const g = geom()
    expect(isSolid(g)).toBe(false)
    expect(solidVolume(g)).toBe(0)
    expect(totalArea(g)).toBe(0)
    expect(validate(g)).toEqual([])
    expect(() => geometryBounds(g)).not.toThrow()
    expect(findConnected(g, {}).edgeIds).toEqual([])
  })

  it('liefert fuer eine offene Geometrie kein Volumen', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    expect(isSolid(g)).toBe(false)
    expect(solidVolume(g)).toBe(0)
  })

  it('erkennt einen Pfad nur, wenn die Kanten wirklich einen bilden', () => {
    const g = geom()
    addPolyline(g, [p(0, 0), p(1, 0), p(2, 0)], false)
    expect(orderEdgePath(g, edgeIds(g))?.length).toBe(2)

    addPolyline(g, [p(10, 0), p(11, 0)], false)
    expect(orderEdgePath(g, edgeIds(g))).toBeNull()
  })
})

describe('Primitivgeneratoren mit Unsinn', () => {
  it('liefert leere Punktlisten statt entarteter Schleifen', () => {
    const z = p(0, 0, 1)
    expect(buildCircle(p(0, 0), z, 0, 24)).toEqual([])
    expect(buildCircle(p(0, 0), z, -1, 24)).toEqual([])
    expect(buildCircle(p(0, 0), z, 5, 2)).toEqual([])
    expect(buildCircle(p(0, 0), z, NaN, 24)).toEqual([])
    expect(buildCircle(p(0, 0), p(0, 0, 0), 5, 24)).toEqual([])

    expect(buildPolygon(p(0, 0), z, 5, 2)).toEqual([])
    expect(buildPolygon(p(0, 0), z, 0, 6)).toEqual([])

    expect(buildArc(p(0, 0), z, 5, 0, 0, 12)).toEqual([])
    expect(buildArc(p(0, 0), z, 0, 0, Math.PI, 12)).toEqual([])

    expect(buildArc3Points(p(0, 0), p(1, 0), p(2, 0), 12)).toEqual([])
    expect(buildArc3Points(p(0, 0), p(0, 0), p(0, 0), 12)).toEqual([])

    expect(buildArcBulge(p(0, 0), p(0, 0), 1, z, 12)).toEqual([])
    expect(buildRectangle(p(0, 0), p(1, 0, 0), p(0, 1, 0), 0, 3)).toEqual([])
    expect(buildRectangle(p(0, 0), p(1, 0, 0), p(0, 1, 0), NaN, 3)).toEqual([])
  })

  it('liefert bei gueltigen Eingaben brauchbare Schleifen', () => {
    const z = p(0, 0, 1)
    expect(buildCircle(p(0, 0), z, 5, 24).length).toBe(24)
    expect(buildPolygon(p(0, 0), z, 5, 6).length).toBe(6)
    expect(buildRectangle(p(0, 0), p(1, 0, 0), p(0, 1, 0), 4, 3).length).toBe(4)
    expect(buildBezier(p(0, 0), p(1, 2), p(3, 2), p(4, 0), 8).length).toBe(9)
    expect(buildArc3Points(p(0, 0), p(1, 1), p(2, 0), 8).length).toBeGreaterThan(2)
  })

  it('vertraegt entartete Polygone bei der 2D-Triangulierung', () => {
    expect(triangulatePolygon2D([])).toEqual([])
    expect(triangulatePolygon2D([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual([])
    expect(triangulatePolygon2D([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toEqual([])

    const quadrat = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    // ein entartetes Loch darf die Aussenflaeche nicht zerstoeren
    expect(triangulatePolygon2D(quadrat, [[{ x: 1, y: 1 }]]).length).toBe(6)
  })
})

describe('Wiederholte Operationen bleiben stabil', () => {
  it('haelt einen Koerper nach mehrfachem Druecken und Ziehen gueltig', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    pushPull(g, faceIds(g)[0], 2)
    expect(solidVolume(g)).toBeCloseTo(24, 6)
    expectValid(g, 'pushPull 1')

    const deckel = faceIds(g).find(
      (id) => Math.abs(g.faces[id].normal.z - 1) < 1e-9 && faceArea(g, id) > 11,
    )
    expect(deckel).toBeDefined()
    pushPull(g, deckel as string, 1)
    expect(solidVolume(g)).toBeCloseTo(36, 6)
    expect(isSolid(g)).toBe(true)
    expectValid(g, 'pushPull 2')

    pushPull(g, deckel as string, -1)
    expect(solidVolume(g)).toBeCloseTo(24, 6)
    expectValid(g, 'pushPull zurueck')
  })

  it('bleibt nach Loeschen und Aufraeumen gueltig', () => {
    const g = geom()
    addPolyline(g, rect(4, 3), true)
    pushPull(g, faceIds(g)[0], 2)

    deletePrimitives(g, { faceIds: [faceIds(g)[0]] })
    cleanup(g)
    expect(isSolid(g)).toBe(false)
    expectValid(g, 'Loch im Koerper')

    deletePrimitives(g, { faceIds: faceIds(g), edgeIds: edgeIds(g) })
    cleanup(g)
    expect(counts(g)).toBe('0/0/0')
    expectValid(g, 'alles weg')
  })
})
