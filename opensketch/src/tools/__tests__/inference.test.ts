/**
 * Inferenzmaschine: Priorisierung der Punkte, Richtungsinferenz, Sperren.
 *
 * Der Testviewport projiziert in einer Draufsicht mit 100 px pro Meter:
 *   Bildschirm = (400 + 100 * x, 300 - 100 * y)
 * Damit sind alle Bildschirmabstaende exakt nachrechenbar.
 */

import { describe, expect, it } from 'vitest'
import { InferenceEngine } from '../inference/engine'
import { pickBestPoint, pointPriority, isStrongPoint, snapRadiusFor } from '../inference/points'
import type { PointCandidate } from '../inference/points'
import { pickBestDirection, screenLineDistance } from '../inference/directions'
import { AXIS_COLORS } from '../colors'
import { createFakeStore, createFakeViewport, createGeometry, emptyHit, key } from './harness'
import type { PickHit, Vec3Like } from '@/shared/types'

/* ------------------------------------------------------------------ */
/* Reine Priorisierung                                                 */
/* ------------------------------------------------------------------ */

function candidate(type: PointCandidate['type'], screenDist: number, point: Vec3Like = { x: 0, y: 0, z: 0 }): PointCandidate {
  return { point, type, screenDist, radius: snapRadiusFor(type), onGeometry: true }
}

describe('Punktpriorisierung', () => {
  it('haelt die SketchUp-Reihenfolge ein', () => {
    const order = ['endpoint', 'midpoint', 'center', 'intersection', 'onGuide', 'onEdge', 'onFace'] as const
    for (let i = 1; i < order.length; i++) {
      expect(pointPriority(order[i - 1])).toBeLessThan(pointPriority(order[i]))
    }
  })

  it('zaehlt Endpunkt, Mittelpunkt, Zentrum und Schnittpunkt als starke Punkte', () => {
    expect(isStrongPoint('endpoint')).toBe(true)
    expect(isStrongPoint('midpoint')).toBe(true)
    expect(isStrongPoint('center')).toBe(true)
    expect(isStrongPoint('intersection')).toBe(true)
    expect(isStrongPoint('onEdge')).toBe(false)
    expect(isStrongPoint('onFace')).toBe(false)
  })

  it('bevorzugt den Endpunkt, auch wenn ein schwacher Punkt naeher liegt', () => {
    const best = pickBestPoint([candidate('onEdge', 0), candidate('endpoint', 9)])
    expect(best?.type).toBe('endpoint')
  })

  it('entscheidet bei gleicher Prioritaet nach Bildschirmabstand', () => {
    const near = candidate('endpoint', 2, { x: 1, y: 0, z: 0 })
    const far = candidate('endpoint', 8, { x: 5, y: 0, z: 0 })
    expect(pickBestPoint([far, near])?.point.x).toBe(1)
  })

  it('verwirft Kandidaten ausserhalb ihres Fangradius', () => {
    expect(pickBestPoint([candidate('endpoint', 40)])).toBeNull()
    expect(pickBestPoint([])).toBeNull()
  })

  it('faengt Endpunkte weiter als Mittelpunkte', () => {
    expect(snapRadiusFor('endpoint')).toBeGreaterThan(snapRadiusFor('midpoint'))
  })
})

describe('Richtungsauswahl', () => {
  it('misst den Abstand zur projizierten Geraden', () => {
    const measured = screenLineDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 7 })
    expect(measured?.dist).toBeCloseTo(7)
    expect(measured?.t).toBeCloseTo(50)
  })

  it('liefert nichts, wenn die Gerade zur Kamera zeigt', () => {
    expect(screenLineDistance({ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 20, y: 20 })).toBeNull()
  })

  it('bevorzugt die Achse gegenueber Parallel/Senkrecht', () => {
    const base = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, origin: { x: 0, y: 0, z: 0 } }
    const best = pickBestDirection([
      { ...base, type: 'parallel', screenDist: 1, priority: 3 },
      { ...base, type: 'onAxisX', screenDist: 5, priority: 0 },
    ])
    expect(best?.type).toBe('onAxisX')
  })
})

/* ------------------------------------------------------------------ */
/* Maschine am Modell                                                  */
/* ------------------------------------------------------------------ */

/** Kante von (0,0,0) nach (2,0,0): Bildschirm (400,300) .. (600,300). */
function setupEdge() {
  const builder = createGeometry()
  const a = builder.addVertex({ x: 0, y: 0, z: 0 }, 'v1')
  const b = builder.addVertex({ x: 2, y: 0, z: 0 }, 'v2')
  builder.addEdge(a, b, 'e1')
  const store = createFakeStore(builder.geometry)
  const viewport = createFakeViewport()
  const engine = new InferenceEngine(store.handle, viewport.api)

  const hoverEdge = (world: Vec3Like): PickHit => ({
    ...emptyHit(),
    kind: 'edge',
    id: 'e1',
    point: world,
  })

  return { store, viewport, engine, hoverEdge }
}

describe('InferenceEngine am Modell', () => {
  it('erkennt den Endpunkt', () => {
    const { viewport, engine, hoverEdge } = setupEdge()
    viewport.setHit(hoverEdge({ x: 0.05, y: 0, z: 0 }))
    const result = engine.infer(405, 300)
    expect(result.type).toBe('endpoint')
    expect(result.label).toBe('Endpunkt')
    expect(result.point.x).toBeCloseTo(0)
    expect(result.onGeometry).toBe(true)
  })

  it('erkennt den Mittelpunkt der Kante', () => {
    const { viewport, engine, hoverEdge } = setupEdge()
    viewport.setHit(hoverEdge({ x: 1, y: 0, z: 0 }))
    const result = engine.infer(500, 300)
    expect(result.type).toBe('midpoint')
    expect(result.label).toBe('Mittelpunkt')
    expect(result.point.x).toBeCloseTo(1)
  })

  it('faellt in der Kantenmitte auf "Auf Kante" zurueck', () => {
    const { viewport, engine, hoverEdge } = setupEdge()
    viewport.setHit(hoverEdge({ x: 0.5, y: 0, z: 0 }))
    const result = engine.infer(450, 300)
    expect(result.type).toBe('onEdge')
    expect(result.label).toBe('Auf Kante')
  })

  it('liefert ohne Treffer die Zeichenebene', () => {
    const { viewport, engine } = setupEdge()
    viewport.setHit(null)
    const result = engine.infer(700, 200)
    expect(result.type).toBe('onPlane')
    expect(result.onGeometry).toBe(false)
    expect(result.point.z).toBeCloseTo(0)
  })

  it('faengt die rote Achse durch den Referenzpunkt', () => {
    const { viewport, engine } = setupEdge()
    viewport.setHit(null)
    const result = engine.infer(700, 300, { from: { x: 0, y: 0, z: 0 } })
    expect(result.type).toBe('onAxisX')
    expect(result.label).toBe('Auf roter Achse')
    expect(result.color).toBe(AXIS_COLORS.x)
    expect(result.direction?.x).toBeCloseTo(1)
  })

  it('starke Punkte schlagen die Richtungsinferenz', () => {
    const { viewport, engine, hoverEdge } = setupEdge()
    // Cursor genau auf dem Endpunkt UND auf der roten Achse durch den Ursprung
    viewport.setHit(hoverEdge({ x: 2, y: 0, z: 0 }))
    const result = engine.infer(600, 300, { from: { x: 0, y: 0, z: 0 } })
    expect(result.type).toBe('endpoint')
  })

  it('zwingt das Ergebnis auf die vorgegebene Ebene', () => {
    const { viewport, engine, hoverEdge } = setupEdge()
    viewport.setHit(hoverEdge({ x: 0.05, y: 0, z: 0 }))
    const plane = { n: { x: 0, y: 0, z: 1 }, d: 5 }
    const result = engine.infer(405, 300, { plane })
    expect(result.point.z).toBeCloseTo(5)
    expect(result.plane).toEqual(plane)
  })
})

/* ------------------------------------------------------------------ */
/* Sperren                                                             */
/* ------------------------------------------------------------------ */

describe('Inferenzsperren', () => {
  it('Pfeiltasten sperren die zugehoerige Achse und heben sie wieder auf', () => {
    const { engine } = setupEdge()
    const from = { x: 0, y: 0, z: 0 }

    expect(engine.handleKey(key('ArrowRight'), true, from)).toBe(true)
    expect(engine.getLock()).toEqual({ kind: 'axis', axis: 'x', direction: { x: 1, y: 0, z: 0 } })

    expect(engine.handleKey(key('ArrowRight'), true, from)).toBe(true)
    expect(engine.getLock().kind).toBe('none')

    engine.handleKey(key('ArrowLeft'), true, from)
    expect(engine.getLock()).toMatchObject({ kind: 'axis', axis: 'y' })
    engine.clearLock()

    engine.handleKey(key('ArrowUp'), true, from)
    expect(engine.getLock()).toMatchObject({ kind: 'axis', axis: 'z' })
  })

  it('projiziert den Mauspunkt auf die gesperrte Achse', () => {
    const { viewport, engine } = setupEdge()
    viewport.setHit(null)
    const from = { x: 0, y: 0, z: 0 }
    engine.handleKey(key('ArrowRight'), true, from)

    // Cursor deutlich neben der roten Achse
    const result = engine.infer(600, 200, { from })
    expect(result.type).toBe('onAxisX')
    expect(result.locked).toBe(true)
    expect(result.color).toBe(AXIS_COLORS.x)
    expect(result.point.y).toBeCloseTo(0)
    expect(result.point.z).toBeCloseTo(0)
    expect(result.point.x).toBeCloseTo(2)
  })

  it('Umschalt friert die aktuelle Inferenz ein und gibt sie beim Loslassen frei', () => {
    const { viewport, engine } = setupEdge()
    viewport.setHit(null)
    const from = { x: 0, y: 0, z: 0 }
    engine.infer(700, 300, { from })

    engine.handleKey(key('Shift'), true, from)
    expect(engine.getLock().kind).toBe('direction')
    const locked = engine.infer(500, 120, { from })
    expect(locked.locked).toBe(true)
    expect(locked.point.y).toBeCloseTo(0)

    engine.handleKey(key('Shift'), false, from)
    expect(engine.getLock().kind).toBe('none')
  })

  it('meldet unbekannte Tasten als nicht behandelt', () => {
    const { engine } = setupEdge()
    expect(engine.handleKey(key('q'), true, null)).toBe(false)
  })

  it('merkt sich Referenzpunkte und vergisst sie auf Wunsch', () => {
    const { engine } = setupEdge()
    engine.addReferencePoint({ x: 1, y: 1, z: 0 })
    engine.addReferencePoint({ x: 1, y: 1, z: 0 })
    engine.clearReferencePoints()
    expect(engine.getLock().kind).toBe('none')
  })
})
