/**
 * GENERATOREN ERFINDEN NICHTS.
 *
 * `src/tools/geom.ts` hatte einen Rueckfall aus der Zeit, als der Geometrie-
 * kern noch nicht implementiert war: lieferte der Kern nichts, sprang eine
 * lokale Zweitimplementierung ein. Seit der Kern entartete Eingaben mit einem
 * LEEREN Array beantwortet, ist dieser Rueckfall kein Sicherheitsnetz mehr,
 * sondern verschluckt die Antwort - aus "Radius 0, geht nicht" wuerden 24
 * identische Punkte, aus zwei Segmenten ein Dreieck.
 *
 * Hier wird beides festgenagelt: der Generator reicht das leere Ergebnis
 * durch, UND das Werkzeug meldet es dem Nutzer.
 */

import { describe, expect, it } from 'vitest'
import type { ToolId } from '@/shared/types'
import { InferenceEngine } from '../inference'
import { ToolManager } from '../toolManager'
import {
  arc3Points,
  arcBulgePoints,
  arcPoints,
  bezierPoints,
  circlePoints,
  polygonPoints,
  rectanglePoints,
  usablePoints,
} from '../geom'
import { createFakeStore, createFakeViewport, pointer } from './harness'

const O = { x: 0, y: 0, z: 0 }
const X = { x: 1, y: 0, z: 0 }
const Y = { x: 0, y: 1, z: 0 }
const Z = { x: 0, y: 0, z: 1 }
const NAN_POINT = { x: Number.NaN, y: 0, z: 0 }

describe('Kreis und Polygon', () => {
  it('liefert nichts bei Radius 0 - statt 24 gleicher Punkte', () => {
    expect(circlePoints(O, Z, 0, 24)).toEqual([])
    expect(polygonPoints(O, Z, 0, 6)).toEqual([])
  })

  it('liefert nichts bei weniger als drei Segmenten - statt eines Dreiecks', () => {
    expect(circlePoints(O, Z, 1, 2)).toEqual([])
    expect(polygonPoints(O, Z, 1, 2)).toEqual([])
  })

  it('liefert nichts bei NaN in der Eingabe', () => {
    expect(circlePoints(NAN_POINT, Z, 1, 24)).toEqual([])
    expect(circlePoints(O, Z, Number.NaN, 24)).toEqual([])
  })

  it('baut den regulaeren Fall weiterhin', () => {
    expect(circlePoints(O, Z, 1, 24)).toHaveLength(24)
    expect(polygonPoints(O, Z, 1, 6)).toHaveLength(6)
  })
})

describe('Rechteck, Bogen und Bezier', () => {
  it('liefert nichts bei Breite oder Hoehe 0', () => {
    expect(rectanglePoints(O, X, Y, 0, 3)).toEqual([])
    expect(rectanglePoints(O, X, Y, 2, 0)).toEqual([])
    expect(rectanglePoints(O, X, Y, 2, 3)).toHaveLength(4)
  })

  it('liefert nichts bei Winkel 0 oder Radius 0', () => {
    expect(arcPoints(O, Z, 1, 0, 0, 12)).toEqual([])
    expect(arcPoints(O, Z, 0, 0, Math.PI, 12)).toEqual([])
    expect(arcPoints(O, Z, 1, 0, Math.PI, 12).length).toBeGreaterThan(2)
  })

  it('liefert nichts bei einer Sehne der Laenge 0', () => {
    expect(arcBulgePoints(O, O, 0.5, Z, 12)).toEqual([])
  })

  it('liefert nichts bei NaN in den Stuetzpunkten', () => {
    expect(arc3Points(O, NAN_POINT, X, 12)).toEqual([])
    expect(bezierPoints(O, NAN_POINT, X, Y, 12)).toEqual([])
  })
})

describe('usablePoints', () => {
  it('macht aus dem leeren Kernergebnis ein ehrliches null', () => {
    expect(usablePoints([], 3)).toBeNull()
    expect(usablePoints(circlePoints(O, Z, 0, 24), 3)).toBeNull()
    expect(usablePoints([O, X], 3)).toBeNull()
    expect(usablePoints([O, NAN_POINT, X], 3)).toBeNull()
    expect(usablePoints([O, X, Y], 3)).toHaveLength(3)
  })
})

/* ================================================================== */
/* Das Werkzeug meldet es                                             */
/* ================================================================== */

function setup(tool: ToolId) {
  const store = createFakeStore()
  const viewport = createFakeViewport()
  const inference = new InferenceEngine(store.handle, viewport.api)
  const manager = new ToolManager({ store: store.handle, viewport: viewport.api, inference })
  manager.setTool(tool)
  const click = (x: number, y: number): void => {
    manager.handlePointerDown(pointer(x, y))
    manager.handlePointerMove(pointer(x, y))
    manager.handlePointerUp(pointer(x, y, { buttons: 0 }))
  }
  return { store, manager, click }
}

describe('Kreiswerkzeug ohne Rueckfall', () => {
  it('erzeugt bei Radius 0 nichts und meldet den Grund', () => {
    const rig = setup('circle')
    rig.click(400, 300) // Mittelpunkt
    rig.click(400, 300) // Radiuspunkt darauf
    expect(rig.store.changedGeometry()).toBe(false)
    const warnings = rig.store.warnings()
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[warnings.length - 1]).toContain('Radius 0')
    // Die Statuszeile bleibt auf dem Grund stehen, nicht auf dem Hinweistext.
    expect(rig.store.lastStatus()).toBe(warnings[warnings.length - 1])
  })

  it('erzeugt eine Segmentzahl unter 3 nicht still als Dreieck', () => {
    const rig = setup('circle')
    // "2s" wird auf das Minimum 3 geklemmt - genau deshalb kommt hier ein
    // gueltiger Kreis heraus. Die Klemmung ist die richtige Stelle dafuer:
    // sie passiert VOR dem Kern und ist dem Nutzer im Massfeld sichtbar.
    rig.manager.handleValueEntry('2s')
    rig.click(400, 300)
    rig.click(500, 300)
    expect(rig.store.calls.some((c) => c.name === 'addFace')).toBe(true)
    const face = rig.store.calls.find((c) => c.name === 'addFace')
    expect((face?.args[0] as unknown[]).length).toBe(3)
  })
})
