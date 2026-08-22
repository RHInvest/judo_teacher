/**
 * ANNOTATIONS- UND KONSTRUKTIONSWERKZEUGE.
 *
 * Massband, Winkelmesser, Achsen, Bemassung, Text, 3D-Text, Schnittebene.
 *
 * Der Testviewport ist eine Draufsicht mit 100 px pro Meter:
 *   Bildschirm = (400 + 100 * x, 300 - 100 * y)
 * Die Z-Achse zeigt zur Kamera, die Bodenebene ist die Zeichenebene.
 *
 * Zwei Zusicherungen ziehen sich durch alle Werkzeuge:
 *  1. Entartete Eingaben erzeugen NICHTS und werden GEMELDET.
 *  2. Was das Werkzeug in den Store schreibt, sind Weltkoordinaten.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { DimensionEntity, PickHit, SectionPlaneEntity, TextEntity, ToolId, Vec3Like } from '@/shared/types'
import type { DialogState } from '@/shared/store-api'
import { bus } from '@/shared/events'
import { InferenceEngine } from '../inference'
import { ToolManager } from '../toolManager'
import { getModelAxes, resetModelAxes } from '../modelAxes'
import { createFakeStore, createFakeViewport, createGeometry, emptyHit, key, pointer } from './harness'
import type { FakeStore, FakeViewport } from './harness'
import type { Geometry } from '@/shared/types'

/* ------------------------------------------------------------------ */
/* Geruest                                                             */
/* ------------------------------------------------------------------ */

interface Rig {
  store: FakeStore
  viewport: FakeViewport
  manager: ToolManager
  click(x: number, y: number, extra?: Partial<import('@/shared/types').PointerInfo>): void
}

/*
 * Jeder Manager wird nach dem Test abgeraeumt.
 *
 * Grund: `text3d` haelt waehrend seiner Laufzeit ein Bus-Abo auf
 * `text3d:create`. Bleibt ein Manager aus einem frueheren Test am Leben,
 * fischt sein Werkzeug den Auftrag des naechsten Tests weg. In der Anwendung
 * gibt es genau einen Manager; in den Tests muss er entsprechend enden.
 */
const managers: ToolManager[] = []

afterEach(() => {
  while (managers.length > 0) managers.pop()?.dispose()
})

function setup(tool: ToolId, geometry?: Geometry): Rig {
  const store = createFakeStore(geometry)
  const viewport = createFakeViewport()
  const inference = new InferenceEngine(store.handle, viewport.api)
  const manager = new ToolManager({ store: store.handle, viewport: viewport.api, inference })
  managers.push(manager)
  manager.setTool(tool)

  const click = (x: number, y: number, extra: Partial<import('@/shared/types').PointerInfo> = {}): void => {
    manager.handlePointerDown(pointer(x, y, extra))
    manager.handlePointerMove(pointer(x, y, extra))
    manager.handlePointerUp(pointer(x, y, { buttons: 0, ...extra }))
  }

  return { store, viewport, manager, click }
}

function callsOf(store: FakeStore, name: string) {
  return store.calls.filter((c) => c.name === name)
}

function lastEntity<T>(store: FakeStore): T {
  const entries = callsOf(store, 'addEntity')
  return entries[entries.length - 1].args[0] as T
}

/** Nichts entstanden UND der Nutzer weiss, warum. */
function expectAbgebrochenMitMeldung(store: FakeStore): void {
  expect(store.changedGeometry()).toBe(false)
  const warnings = store.warnings()
  expect(warnings.length).toBeGreaterThan(0)
  expect(store.lastStatus()).toBe(warnings[warnings.length - 1])
}

/** Eine Kante von (0,0,0) nach (2,0,0). */
function edgeGeometry() {
  const builder = createGeometry()
  const a = builder.addVertex({ x: 0, y: 0, z: 0 }, 'v1')
  const b = builder.addVertex({ x: 2, y: 0, z: 0 }, 'v2')
  builder.addEdge(a, b, 'e1')
  return builder.geometry
}

/** Ein Quadrat von (0,0,0) bis (2,2,0) in der Bodenebene. */
function quadGeometry() {
  const builder = createGeometry()
  builder.addQuad(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    'f1',
  )
  return builder.geometry
}

/** Geschlossener Kantenring auf einem Kreis um (0,0,0) mit Radius 1. */
function circleGeometry(segments = 12) {
  const builder = createGeometry()
  const vertices = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    vertices.push(builder.addVertex({ x: Math.cos(a), y: Math.sin(a), z: 0 }, `cv${i}`))
  }
  for (let i = 0; i < segments; i++) {
    builder.addEdge(vertices[i], vertices[(i + 1) % segments], `ce${i}`)
  }
  return builder.geometry
}

function edgeHit(id: string, point: Vec3Like): PickHit {
  return { ...emptyHit(), kind: 'edge', id, point }
}

function faceHit(point: Vec3Like, normal: Vec3Like = { x: 0, y: 0, z: 1 }): PickHit {
  return { ...emptyHit(), kind: 'face', id: 'f1', point, normal }
}

/* ================================================================== */
/* Massband                                                           */
/* ================================================================== */

describe('Maßband', () => {
  it('misst zwei Punkte und legt die Messstrecke als Hilfslinie ab', () => {
    const rig = setup('tape')
    rig.click(400, 300) // (0,0,0)
    rig.click(600, 300) // (2,0,0)

    const guides = callsOf(rig.store, 'addEdge')
    expect(guides).toHaveLength(1)
    expect(guides[0].args[2]).toEqual({ guide: true })
    expect(rig.store.operations).toContain('Hilfslinie (Maßband)')
    expect(rig.store.lastStatus()).toContain('2 m')
  })

  it('misst mit Strg nur, ohne Hilfslinie', () => {
    const rig = setup('tape')
    rig.click(400, 300)
    rig.click(600, 300, { ctrl: true })
    expect(callsOf(rig.store, 'addEdge')).toHaveLength(0)
    expect(rig.store.lastStatus()).toContain('2 m')
  })

  it('meldet die Länge 0, statt still zurückzusetzen', () => {
    const rig = setup('tape')
    rig.click(400, 300)
    rig.click(400, 300)
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Länge 0')
  })

  it('erzeugt aus einer Kante eine Parallele im gemessenen Abstand', () => {
    const rig = setup('tape', edgeGeometry())
    rig.viewport.setHit(edgeHit('e1', { x: 1, y: 0, z: 0 }))
    rig.click(500, 300) // auf der Kante, (1,0,0)
    rig.viewport.setHit(null)
    rig.click(500, 200) // 1 m daneben, (1,1,0)

    const guides = callsOf(rig.store, 'addEdge')
    expect(guides).toHaveLength(1)
    const [a, b] = guides[0].args as [Vec3Like, Vec3Like]
    // Die Kante lag von (0,0,0) bis (2,0,0) - die Parallele liegt bei y = 1.
    expect(a.y).toBeCloseTo(1)
    expect(b.y).toBeCloseTo(1)
    expect(Math.min(a.x, b.x)).toBeCloseTo(0)
    expect(Math.max(a.x, b.x)).toBeCloseTo(2)
  })

  it('skaliert das Modell NIE ohne Rückfrage', () => {
    const rig = setup('tape', quadGeometry())
    rig.click(400, 300)
    rig.click(600, 300) // 2 m gemessen

    expect(rig.manager.handleValueEntry('4')).toBe(true)
    // Bis hierher darf nichts passiert sein - nur die Frage steht im Raum.
    expect(callsOf(rig.store, 'transformPrimitives')).toHaveLength(0)
    expect(rig.store.warnings().some((w) => w.includes('skalieren'))).toBe(true)

    const dialog = callsOf(rig.store, 'openDialog')[0].args[0] as DialogState
    expect(dialog.kind).toBe('confirm')
    if (dialog.kind !== 'confirm') throw new Error('Rückfrage fehlt')
    expect(dialog.message).toContain('2')
    expect(dialog.message).toContain('4')

    dialog.onConfirm()
    expect(rig.store.operations).toContain('Modell skalieren (Maßband)')
    expect(callsOf(rig.store, 'transformPrimitives')).toHaveLength(1)
  })

  it('beginnt nach einer Messung eine neue, statt vom alten Punkt weiterzumessen', () => {
    const rig = setup('tape')
    rig.click(400, 300) // Start (0,0,0)
    rig.click(600, 300) // Ende (2,0,0) - fertig gemessen

    // Der naechste Klick ist ein neuer STARTpunkt, kein zweiter Endpunkt.
    rig.click(400, 100) // (0,2,0)
    rig.click(600, 100) // (2,2,0)

    const guides = callsOf(rig.store, 'addEdge')
    expect(guides).toHaveLength(2)
    const [a, b] = guides[1].args as [Vec3Like, Vec3Like]
    expect(a.y).toBeCloseTo(2)
    expect(b.y).toBeCloseTo(2)
    expect(rig.store.lastStatus()).toContain('2 m')
  })

  it('meldet ein unlesbares Zielmaß', () => {
    const rig = setup('tape')
    rig.click(400, 300)
    rig.click(600, 300)
    expect(rig.manager.handleValueEntry('viel')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('kein Zielmaß'))).toBe(true)
    expect(callsOf(rig.store, 'openDialog')).toHaveLength(0)
  })

  it('skaliert nicht, wenn das Zielmaß der Messung entspricht', () => {
    const rig = setup('tape', quadGeometry())
    rig.click(400, 300)
    rig.click(600, 300)
    expect(rig.manager.handleValueEntry('2')).toBe(true)
    expect(callsOf(rig.store, 'openDialog')).toHaveLength(0)
    expect(callsOf(rig.store, 'transformPrimitives')).toHaveLength(0)
  })
})

/* ================================================================== */
/* Winkelmesser                                                       */
/* ================================================================== */

describe('Winkelmesser', () => {
  it('misst 90 Grad und legt den zweiten Schenkel als Hilfslinie ab', () => {
    const rig = setup('protractor')
    rig.click(400, 300) // Scheitel (0,0,0)
    rig.click(600, 300) // erster Schenkel, +x
    rig.click(400, 100) // zweiter Schenkel, +y

    expect(rig.store.lastStatus()).toContain('90')
    const guides = callsOf(rig.store, 'addEdge')
    expect(guides).toHaveLength(1)
    expect(guides[0].args[2]).toEqual({ guide: true })
    const [from, to] = guides[0].args as [Vec3Like, Vec3Like]
    expect(from.x).toBeCloseTo(0)
    expect(from.y).toBeCloseTo(0)
    expect(to.x).toBeCloseTo(0)
    expect(to.y).toBeCloseTo(2)
  })

  it('misst mit Strg nur, ohne Hilfslinie', () => {
    const rig = setup('protractor')
    rig.click(400, 300)
    rig.click(600, 300)
    rig.click(400, 100, { ctrl: true })
    expect(callsOf(rig.store, 'addEdge')).toHaveLength(0)
  })

  it('meldet den Winkel 0', () => {
    const rig = setup('protractor')
    rig.click(400, 300)
    rig.click(600, 300)
    rig.click(600, 300) // zweiter Schenkel auf dem ersten
    expectAbgebrochenMitMeldung(rig.store)
    expect(rig.store.warnings()[0]).toContain('Winkel 0')
  })

  it('nimmt den Winkel aus dem Maßfeld und meldet unlesbare Eingaben', () => {
    const rig = setup('protractor')
    rig.click(400, 300)
    rig.click(600, 300)
    expect(rig.manager.handleValueEntry('schräg')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('kein Winkel'))).toBe(true)

    expect(rig.manager.handleValueEntry('45')).toBe(true)
    const guides = callsOf(rig.store, 'addEdge')
    expect(guides).toHaveLength(1)
    const [from, to] = guides[0].args as [Vec3Like, Vec3Like]
    // 45 Grad um die blaue Achse aus der roten Richtung heraus.
    expect(to.x - from.x).toBeCloseTo(to.y - from.y, 6)
    expect(to.x - from.x).toBeGreaterThan(0)
  })

  it('sperrt die Messebene mit den Pfeiltasten', () => {
    const rig = setup('protractor')
    rig.click(400, 300)
    expect(rig.manager.handleKeyDown(key('ArrowUp'))).toBe(true)
    expect(rig.store.calls.some((c) => c.name === 'toast' && String(c.args[0]).includes('blauen'))).toBe(true)
  })
})

/* ================================================================== */
/* Achsen                                                             */
/* ================================================================== */

describe('Achsen', () => {
  afterEach(() => {
    resetModelAxes()
  })

  it('setzt Ursprung, rote und grüne Richtung', () => {
    const rig = setup('axes')
    rig.click(500, 200) // Ursprung (1,1,0)
    rig.click(600, 200) // rote Richtung +x
    rig.click(500, 100) // gruene Richtung +y

    const axes = getModelAxes()
    expect(axes.custom).toBe(true)
    expect(axes.origin.x).toBeCloseTo(1)
    expect(axes.origin.y).toBeCloseTo(1)
    expect(axes.x.x).toBeCloseTo(1)
    expect(axes.y.y).toBeCloseTo(1)
    expect(axes.z.z).toBeCloseTo(1)
  })

  it('meldet eine grüne Richtung, die auf der roten liegt', () => {
    const rig = setup('axes')
    rig.click(400, 300)
    rig.click(600, 300) // rot = +x
    rig.click(500, 300) // liegt auf der roten Achse
    expect(getModelAxes().custom).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('grüne'))).toBe(true)
  })

  it('stellt mit Doppelklick die Voreinstellung wieder her', () => {
    const rig = setup('axes')
    rig.click(500, 200)
    rig.click(600, 200)
    rig.click(500, 100)
    expect(getModelAxes().custom).toBe(true)

    rig.manager.handleDoubleClick(pointer(400, 300))
    expect(getModelAxes().custom).toBe(false)
    expect(getModelAxes().origin).toEqual({ x: 0, y: 0, z: 0 })
  })
})

/* ================================================================== */
/* Bemassung                                                          */
/* ================================================================== */

describe('Bemaßung', () => {
  it('bemasst zwei Punkte und legt die Masslinie versetzt ab', () => {
    const rig = setup('dimension')
    rig.click(400, 300) // (0,0,0)
    rig.click(600, 300) // (2,0,0)
    rig.click(500, 200) // Versatz nach (1,1,0)

    const entity = lastEntity<DimensionEntity>(rig.store)
    expect(entity.type).toBe('dimension')
    expect(entity.kind).toBe('linear')
    expect(entity.start.x).toBeCloseTo(0)
    expect(entity.end.x).toBeCloseTo(2)
    expect(entity.offset.y).toBeCloseTo(1)
    expect(entity.offset.x).toBeCloseTo(0)
    expect(rig.store.operations).toContain('Bemaßung setzen')
  })

  it('bemasst eine ganze Kante mit einem Klick', () => {
    const rig = setup('dimension', edgeGeometry())
    rig.viewport.setHit(edgeHit('e1', { x: 1, y: 0, z: 0 }))
    rig.click(500, 300)
    rig.viewport.setHit(null)
    rig.click(500, 200) // nur noch der Versatz

    const entity = lastEntity<DimensionEntity>(rig.store)
    expect(entity.kind).toBe('linear')
    expect(Math.min(entity.start.x, entity.end.x)).toBeCloseTo(0)
    expect(Math.max(entity.start.x, entity.end.x)).toBeCloseTo(2)
  })

  it('erkennt einen Kreis und bemasst den Durchmesser', () => {
    const rig = setup('dimension', circleGeometry())
    rig.viewport.setHit(edgeHit('ce0', { x: 1, y: 0, z: 0 }))
    rig.click(500, 300)
    rig.viewport.setHit(null)
    rig.click(500, 150)

    const entity = lastEntity<DimensionEntity>(rig.store)
    expect(entity.kind).toBe('diameter')
    expect(entity.center).toBeDefined()
    expect(entity.center?.x).toBeCloseTo(0)
    expect(entity.center?.y).toBeCloseTo(0)
    // Start und Ende liegen sich auf dem Kreis gegenueber: Durchmesser 2.
    expect(Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y)).toBeCloseTo(2)
  })

  it('übernimmt eine eigene Beschriftung aus dem Maßfeld', () => {
    const rig = setup('dimension')
    rig.click(400, 300)
    rig.click(600, 300)
    expect(rig.manager.handleValueEntry('Lichte Weite')).toBe(true)
    rig.click(500, 200)

    const entity = lastEntity<DimensionEntity>(rig.store)
    expect(entity.text).toBe('Lichte Weite')
    // Das gemessene Mass bleibt, was die Geometrie hergibt.
    expect(Math.abs(entity.end.x - entity.start.x)).toBeCloseTo(2)
  })

  it('meldet zwei Punkte, die aufeinanderliegen', () => {
    const rig = setup('dimension')
    rig.click(400, 300)
    rig.click(400, 300)
    expect(callsOf(rig.store, 'addEntity')).toHaveLength(0)
    expect(rig.store.warnings()[0]).toContain('Länge 0')
    expect(rig.store.lastStatus()).toContain('Länge 0')
  })
})

/* ================================================================== */
/* Text                                                               */
/* ================================================================== */

describe('Text', () => {
  it('füllt beim Klick auf eine Fläche den Flächeninhalt vor', () => {
    const rig = setup('text', quadGeometry())
    rig.viewport.setHit(faceHit({ x: 1, y: 1, z: 0 }))
    rig.click(500, 200) // Ankerpunkt auf der Flaeche
    rig.viewport.setHit(null)
    rig.click(600, 150) // Textposition
    expect(rig.manager.handleKeyDown(key('Enter'))).toBe(true)

    const entity = lastEntity<TextEntity>(rig.store)
    expect(entity.type).toBe('text')
    expect(entity.text).toBe('4 m²')
    expect(entity.leader).toBe('viewBased')
  })

  it('füllt beim Klick auf eine Kante die Länge vor', () => {
    const rig = setup('text', edgeGeometry())
    rig.viewport.setHit(edgeHit('e1', { x: 1, y: 0, z: 0 }))
    rig.click(500, 300)
    rig.viewport.setHit(null)
    rig.click(600, 200)
    rig.manager.handleKeyDown(key('Enter'))

    expect(lastEntity<TextEntity>(rig.store).text).toBe('2 m')
  })

  it('nimmt getippten Text an und bessert mit der Rücktaste aus', () => {
    const rig = setup('text')
    rig.click(400, 300) // ins Leere: Anker = Position, keine Fuehrungslinie
    for (const char of 'HAUSX') rig.manager.handleKeyDown(key(char))
    expect(rig.manager.handleKeyDown(key('Backspace'))).toBe(true)
    rig.manager.handleKeyDown(key('Enter'))

    const entity = lastEntity<TextEntity>(rig.store)
    expect(entity.text).toBe('HAUS')
    expect(entity.leader).toBe('none')
    // Die Ruecktaste darf beim Tippen nicht die Auswahl loeschen.
    expect(callsOf(rig.store, 'deletePrimitives')).toHaveLength(0)
  })

  it('meldet Text ohne Inhalt', () => {
    const rig = setup('text')
    rig.click(400, 300)
    rig.manager.handleKeyDown(key('Enter'))
    expect(callsOf(rig.store, 'addEntity')).toHaveLength(0)
    expect(rig.store.warnings()[0]).toContain('ohne Inhalt')
    expect(rig.store.lastStatus()).toContain('ohne Inhalt')
  })

  it('erwartet rohen Text nur während der Eingabe', () => {
    const rig = setup('text')
    expect(rig.manager.wantsTextInput()).toBe(false)
    rig.click(400, 300)
    expect(rig.manager.wantsTextInput()).toBe(true)
    rig.manager.handleKeyDown(key('A'))
    rig.manager.handleKeyDown(key('Enter'))
    expect(rig.manager.wantsTextInput()).toBe(false)
  })

  it('nimmt den Text auch aus dem Massfeld entgegen', () => {
    const rig = setup('text')
    rig.click(400, 300)
    expect(rig.manager.handleValueEntry('Küche')).toBe(true)
    expect(lastEntity<TextEntity>(rig.store).text).toBe('Küche')
  })
})

/* ================================================================== */
/* 3D-Text                                                            */
/* ================================================================== */

describe('3D-Text', () => {
  it('baut die Geometrie aus dem Dialogauftrag und platziert sie als Gruppe', () => {
    // Der Dialog sendet, BEVOR er auf das Werkzeug umschaltet.
    bus.emit('text3d:create', { text: 'AB', height: 1, extrude: 0.1, filled: true, align: 'left' })
    const rig = setup('text3d')
    rig.click(400, 300)

    const upserts = callsOf(rig.store, 'upsertDefinition')
    expect(upserts).toHaveLength(1)
    const definition = upserts[0].args[0] as import('@/shared/types').Definition
    expect(definition.kind).toBe('group')
    expect(definition.name).toContain('AB')
    expect(Object.keys(definition.geometry.faces).length).toBeGreaterThan(0)
    expect(callsOf(rig.store, 'placeInstance')).toHaveLength(1)
    expect(rig.store.operations).toContain('3D-Text einfügen')
  })

  it('erzeugt ohne Füllung nur Umrisskanten', () => {
    bus.emit('text3d:create', { text: 'A', height: 1, extrude: 0, filled: false, align: 'left' })
    const rig = setup('text3d')
    rig.click(400, 300)

    const definition = callsOf(rig.store, 'upsertDefinition')[0].args[0] as import('@/shared/types').Definition
    expect(Object.keys(definition.geometry.faces)).toHaveLength(0)
    expect(Object.keys(definition.geometry.edges).length).toBeGreaterThan(0)
  })

  it('meldet einen Text ohne darstellbare Zeichen', () => {
    bus.emit('text3d:create', { text: '→→', height: 1, extrude: 0, filled: true, align: 'left' })
    const rig = setup('text3d')
    rig.click(400, 300)

    expect(callsOf(rig.store, 'upsertDefinition')).toHaveLength(0)
    expect(rig.store.changedGeometry()).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('darstellbar'))).toBe(true)
    expect(rig.store.lastStatus()).toContain('darstellbar')
  })

  it('nimmt eine neue Höhe aus dem Maßfeld an', () => {
    bus.emit('text3d:create', { text: 'L', height: 1, extrude: 0, filled: true, align: 'left' })
    const rig = setup('text3d')
    expect(rig.manager.handleValueEntry('2')).toBe(true)
    rig.click(400, 300)

    const definition = callsOf(rig.store, 'upsertDefinition')[0].args[0] as import('@/shared/types').Definition
    const ys = Object.values(definition.geometry.vertices).map((v) => v.p.y)
    // Versalhoehe 2 m: der hoechste Punkt liegt bei 2 m plus halber Strichstaerke.
    expect(Math.max(...ys)).toBeGreaterThan(1.9)
  })

  it('meldet eine unlesbare Höhe', () => {
    bus.emit('text3d:create', { text: 'L', height: 1, extrude: 0, filled: true, align: 'left' })
    const rig = setup('text3d')
    expect(rig.manager.handleValueEntry('hoch')).toBe(false)
    expect(rig.store.warnings().some((w) => w.includes('keine Höhe'))).toBe(true)
  })

  it('öffnet den Dialog, wenn kein Auftrag vorliegt', () => {
    const rig = setup('text3d')
    const dialogs = callsOf(rig.store, 'openDialog')
    expect(dialogs.length).toBeGreaterThan(0)
    expect((dialogs[0].args[0] as DialogState).kind).toBe('text3d')
  })
})

/* ================================================================== */
/* Schnittebene                                                       */
/* ================================================================== */

describe('Schnittebene', () => {
  it('legt die Ebene in die angeklickte Fläche und aktiviert sie', () => {
    const rig = setup('sectionPlane', quadGeometry())
    rig.viewport.setHit(faceHit({ x: 1, y: 1, z: 0 }))
    rig.click(500, 200)

    const entity = lastEntity<SectionPlaneEntity>(rig.store)
    expect(entity.type).toBe('sectionPlane')
    expect(entity.active).toBe(true)
    expect(Math.abs(entity.plane.n.z)).toBeCloseTo(1)
    expect(entity.plane.d).toBeCloseTo(0)
    expect(entity.symbolSize).toBeGreaterThan(0)
    expect(rig.store.operations).toContain('Schnittebene setzen')
  })

  it('legt eine zuvor aktive Schnittebene stumm', () => {
    const rig = setup('sectionPlane', quadGeometry())
    const existingId = rig.store.state.addEntity({
      id: 'p-alt',
      type: 'sectionPlane',
      name: 'Alt',
      tagId: null,
      hidden: false,
      locked: false,
      plane: { n: { x: 1, y: 0, z: 0 }, d: 0 },
      active: true,
      symbolSize: 2,
      color: '#f2a33d',
    })
    rig.viewport.setHit(faceHit({ x: 1, y: 1, z: 0 }))
    rig.click(500, 200)

    const updates = callsOf(rig.store, 'updateEntity')
    expect(updates).toHaveLength(1)
    expect(updates[0].args[0]).toBe(existingId)
    expect(updates[0].args[1]).toEqual({ active: false })
  })

  it('meldet den fehlenden Bezug, statt still nichts zu tun', () => {
    const rig = setup('sectionPlane')
    rig.viewport.setHit(null)
    rig.click(500, 200)
    expect(callsOf(rig.store, 'addEntity')).toHaveLength(0)
    expect(rig.store.warnings()[0]).toContain('Bezugsfläche')
    expect(rig.store.lastStatus()).toContain('Bezugsfläche')
  })

  it('nimmt statt einer Fläche auch eine mit Pfeiltaste gesperrte Achsenebene', () => {
    const rig = setup('sectionPlane')
    rig.viewport.setHit(null)
    expect(rig.manager.handleKeyDown(key('ArrowRight'))).toBe(true)
    rig.click(500, 200)

    const entity = lastEntity<SectionPlaneEntity>(rig.store)
    expect(Math.abs(entity.plane.n.x)).toBeCloseTo(1)
    expect(entity.plane.d).toBeCloseTo(1) // Ebene x = 1 durch den Cursorpunkt
  })
})
