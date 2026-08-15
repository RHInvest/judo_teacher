/**
 * ENTARTETE EINGABEN.
 *
 * Zwei Regeln werden hier festgenagelt:
 *
 *  1. Eine Richtungsinferenz darf die Form, die gerade gezeichnet wird, nicht
 *     zum Verschwinden bringen. Der Fall aus dem Browser: Rechteck, zweiter
 *     Eckpunkt rastet auf die gruene Achse durch die erste Ecke, Breite exakt
 *     null - und es entsteht nichts.
 *  2. Bricht ein Werkzeug ab, weil die Eingabe entartet ist, MUSS der Nutzer es
 *     erfahren. Kein stilles `reset()`.
 *
 * Der Testviewport ist eine Draufsicht mit 100 px pro Meter:
 *   Bildschirm = (400 + 100 * x, 300 - 100 * y)
 * Die Z-Achse zeigt zur Kamera, die Bodenebene ist die Zeichenebene.
 */

import { describe, expect, it } from 'vitest'
import type { PickHit, ToolId, Vec3Like } from '@/shared/types'
import { InferenceEngine } from '../inference'
import { DIRECTION_TOL_PX } from '../inference/directions'
import { isGeometryPoint } from '../inference/points'
import { ToolManager } from '../toolManager'
import { circumcenter } from '../geom'
import { createFakeStore, createFakeViewport, createGeometry, emptyHit, key, pointer } from './harness'
import type { FakeStore, FakeStoreOptions, FakeViewport } from './harness'
import type { Geometry } from '@/shared/types'

/* ------------------------------------------------------------------ */
/* Gemeinsames Geruest                                                 */
/* ------------------------------------------------------------------ */

interface Rig {
  store: FakeStore
  viewport: FakeViewport
  manager: ToolManager
  /** Klick an einer Bildschirmposition (Druecken, Bewegen, Loslassen) */
  click(x: number, y: number): void
  /** Zug von einer Position zur anderen, mit Zwischenbewegung */
  drag(from: [number, number], to: [number, number]): void
}

function setup(tool: ToolId, opts: { geometry?: Geometry; store?: FakeStoreOptions } = {}): Rig {
  const store = createFakeStore(opts.geometry, opts.store)
  const viewport = createFakeViewport()
  const inference = new InferenceEngine(store.handle, viewport.api)
  const manager = new ToolManager({ store: store.handle, viewport: viewport.api, inference })
  manager.setTool(tool)

  const click = (x: number, y: number): void => {
    manager.handlePointerDown(pointer(x, y))
    manager.handlePointerMove(pointer(x, y))
    manager.handlePointerUp(pointer(x, y, { buttons: 0 }))
  }

  const drag = (from: [number, number], to: [number, number]): void => {
    manager.handlePointerDown(pointer(from[0], from[1]))
    // In mehreren kleinen Schritten - genau so, wie es im Browser passiert ist.
    for (let i = 1; i <= 4; i++) {
      manager.handlePointerMove(
        pointer(from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4),
      )
    }
    manager.handlePointerUp(pointer(to[0], to[1], { buttons: 0 }))
  }

  return { store, viewport, manager, click, drag }
}

/** Ein Quadrat von (0,0,0) bis (2,2,0) in der Bodenebene. */
function quadGeometry() {
  const builder = createGeometry()
  const face = builder.addQuad(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    'f1',
  )
  return { geometry: builder.geometry, faceId: face.id }
}

function faceHit(point: Vec3Like): PickHit {
  return { ...emptyHit(), kind: 'face', id: 'f1', point, normal: { x: 0, y: 0, z: 1 } }
}

/**
 * Die Zusicherung, um die es in diesem ganzen Auftrag geht: es ist keine
 * Geometrie entstanden UND der Nutzer hat erfahren, warum.
 */
function expectAbgebrochenMitMeldung(store: FakeStore): void {
  expect(store.changedGeometry()).toBe(false)
  const warnings = store.warnings()
  expect(warnings.length).toBeGreaterThan(0)
  // Die Statuszeile bleibt auf dem Grund stehen, nicht auf dem Hinweistext.
  expect(store.lastStatus()).toBe(warnings[warnings.length - 1])
}

/* ================================================================== */
/* 1. Die Inferenzmaschine                                            */
/* ================================================================== */

describe('Richtungsinferenzen abschaltbar', () => {
  const origin = { x: 0, y: 0, z: 0 }

  function engineOnly() {
    const store = createFakeStore()
    const viewport = createFakeViewport()
    return { viewport, engine: new InferenceEngine(store.handle, viewport.api) }
  }

  it('rastet ohne Sperre auf die gruene Achse - der gemeldete Fall', () => {
    const { viewport, engine } = engineOnly()
    viewport.setHit(null)
    // 4 px neben der gruenen Achse durch den Ursprung
    const result = engine.infer(404, 100, { from: origin })
    expect(result.type).toBe('onAxisY')
    expect(result.point.x).toBeCloseTo(0)
  })

  it('laesst den Punkt mit allowDirections:false stehen, wo der Cursor ist', () => {
    const { viewport, engine } = engineOnly()
    viewport.setHit(null)
    const result = engine.infer(404, 100, { from: origin, allowDirections: false })
    expect(result.type).toBe('onPlane')
    expect(result.point.x).toBeCloseTo(0.04)
    expect(result.point.y).toBeCloseTo(2)
  })

  it('achtet weiter auf die vom Nutzer gesetzte Sperre', () => {
    const { viewport, engine } = engineOnly()
    viewport.setHit(null)
    engine.handleKey(key('ArrowLeft'), true, origin) // gruene Achse sperren
    const result = engine.infer(404, 100, { from: origin, allowDirections: false })
    expect(result.type).toBe('onAxisY')
    expect(result.locked).toBe(true)
  })
})

describe('Fangradius der Richtungsinferenz', () => {
  it('liegt im Bereich, in dem der Cursor wirklich an der Geraden steht', () => {
    expect(DIRECTION_TOL_PX).toBeGreaterThanOrEqual(6)
    expect(DIRECTION_TOL_PX).toBeLessThanOrEqual(8)
  })

  it('faengt knapp innerhalb und laesst knapp ausserhalb los', () => {
    const store = createFakeStore()
    const viewport = createFakeViewport()
    const engine = new InferenceEngine(store.handle, viewport.api)
    viewport.setHit(null)
    const from = { x: 0, y: 0, z: 0 }

    const innen = engine.infer(400 + DIRECTION_TOL_PX - 1, 100, { from })
    expect(innen.type).toBe('onAxisY')

    const aussen = engine.infer(400 + DIRECTION_TOL_PX + 2, 100, { from })
    expect(aussen.type).toBe('onPlane')
  })
})

describe('Echte Geometrie vor Richtung', () => {
  /** Kante von (0,0,0) nach (2,0,0), plus eine Kante als Referenz. */
  function edgeRig() {
    const builder = createGeometry()
    const a = builder.addVertex({ x: 0, y: 1, z: 0 }, 'v1')
    const b = builder.addVertex({ x: 2, y: 1, z: 0 }, 'v2')
    builder.addEdge(a, b, 'e1')
    const store = createFakeStore(builder.geometry)
    const viewport = createFakeViewport()
    return { viewport, engine: new InferenceEngine(store.handle, viewport.api) }
  }

  it('zaehlt Kante und Hilfslinie als echte Geometrie, Flaeche und Ebene nicht', () => {
    expect(isGeometryPoint('endpoint')).toBe(true)
    expect(isGeometryPoint('onGuide')).toBe(true)
    expect(isGeometryPoint('onEdge')).toBe(true)
    expect(isGeometryPoint('onFace')).toBe(false)
    expect(isGeometryPoint('onPlane')).toBe(false)
  })

  it('waehlt die Kante unter dem Cursor statt der Achse daneben', () => {
    const { viewport, engine } = edgeRig()
    /*
     * Die Kante liegt bei y = 1, also auf der Bildschirmzeile 200. Der
     * Referenzpunkt (0; 0,95; 0) liegt 5 px darunter; die rote Achse durch ihn
     * laeuft parallel zur Kante und faengt bei 5 px Abstand noch (Toleranz 7).
     * Der Cursor steht bei (560, 200) exakt AUF der Kante - und weit genug von
     * Endpunkt und Mitte entfernt, dass kein starker Punkt mitredet.
     *
     * Parallel heisst: die Achse kreuzt die Kante nirgends, der
     * Schnittpunktfall greift also nicht. Uebrig bleibt die Frage, um die es
     * geht - Kante oder Achse. Vor der Reparatur gewann hier die Achse.
     */
    viewport.setHit({ ...emptyHit(), kind: 'edge', id: 'e1', point: { x: 1.6, y: 1, z: 0 } })
    const result = engine.infer(560, 200, { from: { x: 0, y: 0.95, z: 0 } })
    expect(result.type).toBe('onEdge')
    expect(result.onGeometry).toBe(true)
    expect(result.point.y).toBeCloseTo(1)
  })
})

/* ================================================================== */
/* 2. Rechteck - der gemeldete Bedienfehler                           */
/* ================================================================== */

describe('Rechteck', () => {
  it('erzeugt jetzt ein Rechteck, wo vorher nichts entstand', () => {
    const rig = setup('rectangle')
    // Erste Ecke im Ursprung, zweite knapp neben der gruenen Achse - das ist
    // die Bewegung aus dem Fehlerbericht.
    rig.drag([400, 300], [404, 100])
    expect(rig.store.calls.some((c) => c.name === 'addFace')).toBe(true)
    expect(rig.store.operations).toContain('Rechteck zeichnen')
  })

  it('meldet es, wenn die Ecke wirklich keine Flaeche hergibt', () => {
    const rig = setup('rectangle')
    // Zweiter Punkt EXAKT ueber dem ersten: Breite null, auch ohne Inferenz.
    rig.drag([400, 300], [400, 100])
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Breite 0')
  })

  it('meldet es, wenn beide Ecken aufeinanderliegen', () => {
    const rig = setup('rectangle')
    // Klicken, nicht ziehen: der erste Klick setzt die Ecke, der zweite an
    // derselben Stelle schliesst ab.
    rig.click(400, 300)
    rig.click(400, 300)
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('aufeinander')
  })
})

describe('Gedrehtes Rechteck', () => {
  it('meldet die Breite null, statt still zu verschwinden', () => {
    const rig = setup('rotatedRectangle')
    rig.click(400, 300) // Startpunkt (0,0,0)
    rig.click(600, 300) // Ende der Grundkante (2,0,0)
    rig.click(500, 300) // Breite: liegt auf der Grundkante -> 0
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Breite')
  })
})

/* ================================================================== */
/* 3. Runde Formen                                                    */
/* ================================================================== */

describe('Kreis und Polygon', () => {
  for (const tool of ['circle', 'polygon'] as const) {
    it(`${tool}: meldet den Radius null`, () => {
      const rig = setup(tool)
      rig.click(400, 300) // Mittelpunkt
      rig.click(400, 300) // Radiuspunkt auf dem Mittelpunkt
      expectAbgebrochenMitMeldung(rig.store)
      expect(rig.store.warnings()[0]).toContain('Radius 0')
    })
  }
})

describe('Bogen (Mittelpunkt, Radius, Winkel)', () => {
  it('meldet den Winkel null', () => {
    const rig = setup('arc')
    rig.click(400, 300) // Mittelpunkt
    rig.click(600, 300) // Radius und Startschenkel
    rig.click(600, 300) // Endschenkel auf dem Startschenkel -> Winkel 0
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Winkel 0')
  })

  it('meldet den Radius null', () => {
    const rig = setup('arc')
    rig.click(400, 300)
    rig.click(400, 300) // kein Radius -> das Werkzeug bleibt stehen
    rig.manager.getTool()?.cancel()
    expect(rig.store.changedGeometry()).toBe(false)
  })
})

describe('2-Punkt-Bogen', () => {
  it('meldet die Bogenhoehe null, statt still zu verschwinden', () => {
    const rig = setup('arc2')
    rig.click(400, 300) // Sehnenanfang (0,0,0)
    rig.click(600, 300) // Sehnenende (2,0,0) - rastet auf die rote Achse
    rig.click(500, 300) // Bogenhoehe: Punkt liegt auf der Sehne -> 0
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Bogenhöhe 0')
  })
})

describe('3-Punkt-Bogen', () => {
  it('erkennt kollineare Punkte, ohne sich an circumcenter zu verschlucken', () => {
    // Der rechnerische Kern zuerst: kein Umkreis, kein Absturz, keine Division.
    expect(
      circumcenter({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }),
    ).toBeNull()

    const rig = setup('arc3')
    rig.click(400, 300) // (0,0,0)
    rig.click(500, 300) // (1,0,0)
    rig.click(600, 300) // (2,0,0) - alle drei auf der roten Achse
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Geraden')
  })
})

/* ================================================================== */
/* 4. Werkzeuge, die vorhandene Geometrie veraendern                   */
/* ================================================================== */

describe('Verschieben', () => {
  it('meldet die Nullbewegung', () => {
    const rig = setup('move')
    rig.store.state.setSelection({ edgeIds: ['e1'], faceIds: [], vertexIds: [], entityIds: [] })
    rig.click(400, 300) // Basispunkt
    rig.click(400, 300) // Zielpunkt = Basispunkt
    expect(rig.store.calls.some((c) => c.name === 'transformPrimitives')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('Nichts verschoben'))).toBe(true)
  })
})

describe('Drehen', () => {
  it('meldet den Winkel null', () => {
    const rig = setup('rotate')
    rig.store.state.setSelection({ edgeIds: ['e1'], faceIds: [], vertexIds: [], entityIds: [] })
    rig.click(400, 300) // Drehmittelpunkt
    rig.click(600, 300) // Startschenkel
    rig.click(600, 300) // Endschenkel darauf -> Winkel 0
    expect(rig.store.calls.some((c) => c.name === 'transformPrimitives')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('Winkel 0'))).toBe(true)
  })
})

describe('Skalieren', () => {
  it('meldet den Faktor null', () => {
    const rig = setup('scale', {
      store: { selectionBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } } },
    })
    rig.store.state.setSelection({ edgeIds: ['e1'], faceIds: [], vertexIds: [], entityIds: [] })
    // Eckgriff greifen und exakt auf den Gegengriff ziehen -> Faktor 0
    rig.manager.handlePointerDown(pointer(600, 100))
    rig.manager.handlePointerMove(pointer(500, 200))
    rig.manager.handlePointerUp(pointer(400, 300, { buttons: 0 }))
    expect(rig.store.calls.some((c) => c.name === 'transformPrimitives')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('Faktor 0'))).toBe(true)
    expect(rig.store.lastStatus()).toContain('Faktor 0')
  })
})

describe('Drücken/Ziehen', () => {
  it('meldet die Distanz null', () => {
    const { geometry } = quadGeometry()
    const rig = setup('pushpull', { geometry })
    rig.viewport.setHit(faceHit({ x: 1, y: 1, z: 0 }))
    rig.manager.handlePointerDown(pointer(500, 200))
    rig.manager.handlePointerMove(pointer(540, 200))
    rig.manager.handlePointerUp(pointer(540, 200, { buttons: 0 }))
    expect(rig.store.calls.some((c) => c.name === 'pushPull')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('Distanz ist 0'))).toBe(true)
  })
})

describe('Versatz', () => {
  it('meldet den Abstand null', () => {
    const { geometry } = quadGeometry()
    const rig = setup('offset', { geometry })
    rig.viewport.setHit(faceHit({ x: 1, y: 0, z: 0 }))
    rig.manager.handlePointerDown(pointer(500, 300))
    // Cursor bleibt auf der Kante y = 0 -> der Versatz ist exakt null
    rig.viewport.setHit(faceHit({ x: 1.2, y: 0, z: 0 }))
    rig.manager.handlePointerMove(pointer(520, 300))
    rig.manager.handlePointerUp(pointer(520, 300, { buttons: 0 }))
    expect(rig.store.calls.some((c) => c.name === 'offsetFace')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('Abstand ist 0'))).toBe(true)
  })
})

/* ================================================================== */
/* 5. Freihand und Bezier                                             */
/* ================================================================== */

describe('Freihand', () => {
  it('meldet den zu kurzen Zug', () => {
    const rig = setup('freehand')
    rig.manager.handlePointerDown(pointer(400, 300))
    rig.manager.handlePointerUp(pointer(400, 300, { buttons: 0 }))
    expect(rig.store.calls.some((c) => c.name === 'addPolyline')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('zu kurz'))).toBe(true)
  })
})

describe('Bezier', () => {
  it('meldet Start und Ende aufeinander', () => {
    const rig = setup('bezier')
    rig.click(400, 300) // Start
    rig.click(400, 300) // Ende - auf dem Start
    rig.click(500, 200) // Kontrollpunkt 1
    rig.click(520, 220) // Kontrollpunkt 2 -> Abschluss
    expect(rig.store.calls.some((c) => c.name === 'addPolyline')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('aufeinander'))).toBe(true)
  })
})
