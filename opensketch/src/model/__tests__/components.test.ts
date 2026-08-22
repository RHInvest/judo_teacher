/**
 * Komponenten mit gemeinsamer Definition, tiefe Verschachtelung und
 * `explode` unter Transformation.
 *
 * Das Kernversprechen einer Komponente: mehrere Instanzen teilen sich EINE
 * Definition. Wer die Geometrie im Kontext einer Instanz aendert, aendert sie
 * fuer alle; `makeUnique` loest genau diese Kopplung wieder auf.
 *
 * Beim Aufloesen gilt: die Geometrie muss an derselben WELTposition landen -
 * auch wenn die Instanz gedreht und skaliert ist oder selbst wieder Instanzen
 * enthaelt.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Id, InstanceEntity, Vec3Like } from '@/shared/types'
import { M, V } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { instanceCount, worldTransformOf } from '../document'
import { buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

const state = () => useStore.getState()

/** Instanz-Entity, mit Typpruefung. */
function instance(id: Id): InstanceEntity {
  const entity = state().doc.entities[id]
  if (!entity || entity.type !== 'instance') throw new Error(`Instanz "${id}" fehlt`)
  return entity
}

/** Punkte einer Definition, im Definitionsraum. */
function definitionPoints(definitionId: Id): Vec3Like[] {
  const geometry = state().doc.definitions[definitionId].geometry
  return Object.keys(geometry.vertices).map((id) => geometry.vertices[id].p)
}

/** Punkte der aktiven Geometrie, im Kontextraum. */
function localPoints(): Vec3Like[] {
  const geometry = state().getActiveGeometry()
  return Object.keys(geometry.vertices).map((id) => geometry.vertices[id].p)
}

function hasPoint(points: readonly Vec3Like[], p: Vec3Like, tol = 1e-9): boolean {
  return points.some((q) => V.equals(q, p, tol))
}

/** Alle Weltpunkte, die eine Instanz aus ihrer Definition zeigt. */
function worldPointsOf(instanceId: Id): Vec3Like[] {
  const entity = instance(instanceId)
  return definitionPoints(entity.definitionId).map((p) => M.transformPoint(entity.transform, p))
}

/**
 * Legt eine Komponente aus einem Quadrat an und stellt eine zweite Instanz
 * daneben. Beide zeigen auf dieselbe Definition.
 */
function twoInstancesOfOneComponent(): { first: Id; second: Id; definitionId: Id } {
  installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
  state().selectAll()
  const first = state().makeComponent({ name: 'Fenster' }) as string
  expect(first).not.toBeNull()

  const definitionId = instance(first).definitionId
  const second = state().placeInstance(definitionId, M.translation({ x: 10, y: 0, z: 0 })) as string
  expect(second).toBeTruthy()

  return { first, second, definitionId }
}

describe('Komponenten mit gemeinsamer Definition', () => {
  it('zwei Instanzen zeigen auf dieselbe Definition', () => {
    const { first, second, definitionId } = twoInstancesOfOneComponent()

    expect(instance(first).definitionId).toBe(definitionId)
    expect(instance(second).definitionId).toBe(definitionId)
    expect(instance(second).isGroup).toBe(false)
    expect(instanceCount(state().doc, definitionId)).toBe(2)
    expect(state().doc.definitions[definitionId].instanceCount).toBe(2)
    // Genau eine Definition zusaetzlich zur Wurzel
    expect(Object.keys(state().doc.definitions)).toHaveLength(2)
  })

  it('Geometrie im Kontext einer Instanz zu aendern zieht die andere mit', () => {
    const { first, second, definitionId } = twoInstancesOfOneComponent()
    const before = definitionPoints(definitionId).length

    // Im Kontext der ERSTEN Instanz zeichnen - in Weltkoordinaten.
    state().enterContext(first)
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 })
    state().exitContext()

    // Die eine gemeinsame Definition hat den Punkt bekommen ...
    const points = definitionPoints(definitionId)
    expect(points.length).toBe(before + 1)
    expect(hasPoint(points, { x: 0, y: 0, z: 3 })).toBe(true)

    // ... und die zweite Instanz zeigt ihn an ihrer eigenen Stelle.
    expect(hasPoint(worldPointsOf(first), { x: 0, y: 0, z: 3 })).toBe(true)
    expect(hasPoint(worldPointsOf(second), { x: 10, y: 0, z: 3 })).toBe(true)
  })

  it('das gilt auch aus dem Kontext der zweiten Instanz heraus', () => {
    const { first, second, definitionId } = twoInstancesOfOneComponent()

    // Die zweite Instanz steht bei x = 10; der Weltpunkt (11, 0, 0) ist dort
    // der lokale Punkt (1, 0, 0) - also die bereits vorhandene Ecke.
    state().enterContext(second)
    expect(M.getTranslation(state().context.worldTransform)).toEqual({ x: 10, y: 0, z: 0 })
    state().addEdge({ x: 11, y: 0, z: 0 }, { x: 11, y: 0, z: 2 })
    state().exitContext()

    expect(hasPoint(definitionPoints(definitionId), { x: 1, y: 0, z: 2 })).toBe(true)
    expect(hasPoint(worldPointsOf(first), { x: 1, y: 0, z: 2 })).toBe(true)
  })

  it('makeUnique trennt die gewaehlte Instanz von der gemeinsamen Definition', () => {
    const { first, second, definitionId } = twoInstancesOfOneComponent()

    state().makeUnique([second])

    const newDefinitionId = instance(second).definitionId
    expect(newDefinitionId).not.toBe(definitionId)
    expect(instance(first).definitionId).toBe(definitionId)
    expect(instanceCount(state().doc, definitionId)).toBe(1)
    expect(instanceCount(state().doc, newDefinitionId)).toBe(1)
    expect(state().doc.definitions[definitionId].instanceCount).toBe(1)
    expect(state().doc.definitions[newDefinitionId].instanceCount).toBe(1)
    // Die Kopie traegt einen eigenen, freien Namen
    expect(state().doc.definitions[newDefinitionId].name).not.toBe(
      state().doc.definitions[definitionId].name,
    )
  })

  it('die abgetrennte Kopie hat dieselbe Geometrie, aber ein eigenes Schicksal', () => {
    const { first, second, definitionId } = twoInstancesOfOneComponent()
    state().makeUnique([second])
    const copyId = instance(second).definitionId

    // Inhaltlich gleich ...
    const originalPoints = definitionPoints(definitionId)
    const copyPoints = definitionPoints(copyId)
    expect(copyPoints).toHaveLength(originalPoints.length)
    for (const p of originalPoints) expect(hasPoint(copyPoints, p)).toBe(true)
    expect(Object.keys(state().doc.definitions[copyId].geometry.faces)).toHaveLength(1)

    // ... aber nicht mehr gekoppelt.
    state().enterContext(first)
    state().addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 })
    state().exitContext()

    expect(hasPoint(definitionPoints(definitionId), { x: 0, y: 0, z: 5 })).toBe(true)
    expect(hasPoint(definitionPoints(copyId), { x: 0, y: 0, z: 5 })).toBe(false)
    expect(definitionPoints(copyId)).toHaveLength(originalPoints.length)
  })

  it('makeUnique laesst sich rueckgaengig machen', () => {
    const { second, definitionId } = twoInstancesOfOneComponent()
    state().makeUnique([second])
    expect(instance(second).definitionId).not.toBe(definitionId)

    state().undo()

    expect(instance(second).definitionId).toBe(definitionId)
    expect(instanceCount(state().doc, definitionId)).toBe(2)
  })

  it('eine Gruppe bleibt einmalig - eine Kopie bekommt eine eigene Definition', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    state().selectAll()
    const groupId = state().makeGroup('Stuetze') as string
    const definitionId = instance(groupId).definitionId

    const copies = state().transformEntities([groupId], M.translation({ x: 4, y: 0, z: 0 }), true)
    expect(copies).toHaveLength(1)
    // Kopieren einer Gruppe teilt zunaechst die Definition - erst makeUnique trennt.
    expect(instance(copies[0]).definitionId).toBe(definitionId)

    state().makeUnique([copies[0]])
    expect(instance(copies[0]).definitionId).not.toBe(definitionId)
  })
})

/* ------------------------------------------------------------------ */

/** Gruppe in Gruppe in Gruppe, mit je eigener Verschiebung. */
function buildThreeLevels(): { outer: Id; middle: Id; inner: Id } {
  installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
  state().selectAll()
  const inner = state().makeGroup('Ebene 3') as string
  state().selectAll()
  const middle = state().makeGroup('Ebene 2') as string
  state().selectAll()
  const outer = state().makeGroup('Ebene 1') as string

  // Innere Verschiebungen setzen, damit sich die Matrizen wirklich stapeln.
  state().enterContext(outer)
  const middleId = state().doc.definitions[state().context.definitionId].children[0]
  state().transformEntities([middleId], M.translation({ x: 0, y: 0, z: 2 }), false)
  state().enterContext(middleId)
  const innerId = state().doc.definitions[state().context.definitionId].children[0]
  state().transformEntities([innerId], M.translation({ x: 0, y: 4, z: 0 }), false)
  state().exitAllContexts()

  state().transformEntities([outer], M.translation({ x: 1, y: 0, z: 0 }), false)

  return { outer, middle: middleId, inner: innerId }
}

describe('Verschachtelung ueber drei Ebenen', () => {
  it('enterContext stapelt Pfad und Weltmatrix bis nach unten', () => {
    const { outer, middle, inner } = buildThreeLevels()
    const rootId = state().doc.rootId

    state().enterContext(outer)
    expect(state().context.instancePath).toEqual([outer])
    state().enterContext(middle)
    state().enterContext(inner)

    const context = state().context
    expect(context.instancePath).toEqual([outer, middle, inner])
    expect(context.definitionPath).toHaveLength(4)
    expect(context.definitionPath[0]).toBe(rootId)
    expect(context.definitionId).toBe(instance(inner).definitionId)

    // 1 nach rechts, 2 nach oben, 4 nach hinten - genau die Summe der Ebenen.
    expect(M.getTranslation(context.worldTransform)).toEqual({ x: 1, y: 4, z: 2 })
    expect(context.worldTransform).toEqual(worldTransformOf(state().doc, context.instancePath))
  })

  it('zeichnet unten in Weltkoordinaten und legt es lokal richtig ab', () => {
    const { outer, middle, inner } = buildThreeLevels()

    state().enterContext(outer)
    state().enterContext(middle)
    state().enterContext(inner)

    // Weltpunkt -> Kontextpunkt ist genau die Inverse der Weltmatrix.
    const world = { x: 6, y: 9, z: 5 }
    state().addEdge({ x: 1, y: 4, z: 2 }, world)

    const local = { x: 5, y: 5, z: 3 }
    expect(hasPoint(localPoints(), local)).toBe(true)
    expect(hasPoint(localPoints(), { x: 0, y: 0, z: 0 })).toBe(true)

    // Rueckrechnung: lokal -> Welt trifft wieder den Ausgangspunkt.
    const back = M.transformPoint(state().context.worldTransform, local)
    expect(V.equals(back, world, 1e-9)).toBe(true)

    // Die Geometrie liegt in der INNERSTEN Definition, nicht in der Wurzel.
    const rootGeometry = state().doc.definitions[state().doc.rootId].geometry
    expect(Object.keys(rootGeometry.vertices)).toHaveLength(0)
    expect(Object.keys(state().getActiveGeometry().edges)).toHaveLength(5)
  })

  it('exitAllContexts springt aus allen drei Ebenen zurueck zur Wurzel', () => {
    const { outer, middle, inner } = buildThreeLevels()
    state().enterContext(outer)
    state().enterContext(middle)
    state().enterContext(inner)
    state().selectAll()
    expect(state().selection.faceIds.length).toBeGreaterThan(0)

    state().exitAllContexts()

    const context = state().context
    expect(context.instancePath).toEqual([])
    expect(context.definitionPath).toEqual([state().doc.rootId])
    expect(context.definitionId).toBe(state().doc.rootId)
    expect(M.isIdentity(context.worldTransform)).toBe(true)
    expect(state().selection.faceIds).toEqual([])
  })

  it('exitContext geht Ebene fuer Ebene zurueck', () => {
    const { outer, middle, inner } = buildThreeLevels()
    state().enterContext(outer)
    state().enterContext(middle)
    state().enterContext(inner)

    expect(state().exitContext()).toBe(true)
    expect(state().context.instancePath).toEqual([outer, middle])
    expect(M.getTranslation(state().context.worldTransform)).toEqual({ x: 1, y: 0, z: 2 })

    expect(state().exitContext()).toBe(true)
    expect(state().context.instancePath).toEqual([outer])

    expect(state().exitContext()).toBe(true)
    expect(state().context.instancePath).toEqual([])
    // An der Wurzel gibt es nichts mehr zu verlassen.
    expect(state().exitContext()).toBe(false)
  })
})

/* ------------------------------------------------------------------ */

describe('Aufloesen unter Transformation', () => {
  it('gedrehte und skalierte Geometrie landet an derselben Weltposition', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    state().selectAll()
    const groupId = state().makeGroup('Platte') as string

    const transform = M.chain(
      M.translation({ x: 3, y: 1, z: 0 }),
      M.rotation(V.AXIS_Z, Math.PI / 2),
      M.scaling(2),
    )
    state().transformEntities([groupId], transform, false)

    const expected = worldPointsOf(groupId)
    expect(expected).toHaveLength(4)
    // Konkret nachgerechnet: (1,0,0) -> skaliert (2,0,0) -> gedreht (0,2,0) -> (3,3,0)
    expect(hasPoint(expected, { x: 3, y: 3, z: 0 })).toBe(true)
    expect(hasPoint(expected, { x: 1, y: 1, z: 0 })).toBe(true)

    state().explode([groupId])

    const after = localPoints()
    expect(after).toHaveLength(4)
    for (const p of expected) expect(hasPoint(after, p, 1e-9)).toBe(true)
    expect(Object.keys(state().getActiveGeometry().faces)).toHaveLength(1)
    expect(state().doc.entities[groupId]).toBeUndefined()
  })

  it('eine verschachtelte Instanz behaelt ihre Weltlage', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    state().selectAll()
    state().makeGroup('Innen')
    state().selectAll()
    const outer = state().makeGroup('Aussen') as string

    state().transformEntities(
      [outer],
      M.chain(M.translation({ x: 5, y: 0, z: 0 }), M.rotation(V.AXIS_Z, Math.PI / 2)),
      false,
    )
    state().enterContext(outer)
    const innerId = state().doc.definitions[state().context.definitionId].children[0]
    state().transformEntities([innerId], M.translation({ x: 2, y: 0, z: 0 }), false)
    const innerDefinitionId = instance(innerId).definitionId
    state().exitContext()

    // Weltlage der inneren Ecke (0,0,0) vor dem Aufloesen.
    // `transformEntities` erwartet eine WELTmatrix und rechnet sie in den
    // Kontext um - die innere Gruppe ruecht also um 2 in Welt-X, nicht in der
    // gedrehten Achse der aeusseren Gruppe.
    const worldBefore = M.transformPoint(
      M.multiply(instance(outer).transform, instance(innerId).transform),
      { x: 0, y: 0, z: 0 },
    )
    expect(V.equals(worldBefore, { x: 7, y: 0, z: 0 }, 1e-9)).toBe(true)

    state().explode([outer])

    // Die innere Gruppe haengt jetzt direkt in der Wurzel - als KOPIE mit neuer Id.
    const rootChildren = state().doc.definitions[state().doc.rootId].children
    expect(rootChildren).toHaveLength(1)
    const moved = instance(rootChildren[0])
    expect(moved.definitionId).toBe(innerDefinitionId)
    expect(V.equals(M.transformPoint(moved.transform, { x: 0, y: 0, z: 0 }), worldBefore, 1e-9)).toBe(true)

    // Die aeussere Gruppendefinition ist weg, die innere steht noch.
    expect(state().doc.entities[outer]).toBeUndefined()
    expect(state().doc.definitions[innerDefinitionId]).toBeDefined()
    // Die Wurzel selbst hat keine eigene Geometrie bekommen.
    expect(Object.keys(state().doc.definitions[state().doc.rootId].geometry.vertices)).toHaveLength(0)
  })

  it('Aufloesen einer Komponente laesst die Definition fuer die anderen Instanzen stehen', () => {
    const { first, second, definitionId } = twoInstancesOfOneComponent()

    state().explode([first])

    expect(state().doc.definitions[definitionId]).toBeDefined()
    expect(instance(second).definitionId).toBe(definitionId)
    expect(instanceCount(state().doc, definitionId)).toBe(1)
    expect(state().doc.definitions[definitionId].instanceCount).toBe(1)
    // Die Geometrie der aufgeloesten Instanz liegt jetzt in der Wurzel.
    expect(Object.keys(state().getActiveGeometry().faces)).toHaveLength(1)
  })

  it('Aufloesen laesst sich rueckgaengig machen', () => {
    installGeometry(buildQuad({ x: 2, y: 2, z: 0 }, 1, 1))
    state().selectAll()
    const groupId = state().makeGroup('Feld') as string
    state().transformEntities([groupId], M.rotation(V.AXIS_Z, Math.PI / 4), false)
    const before = worldPointsOf(groupId)

    state().explode([groupId])
    expect(state().doc.entities[groupId]).toBeUndefined()

    state().undo()

    expect(state().doc.entities[groupId]).toBeDefined()
    expect(Object.keys(state().getActiveGeometry().vertices)).toHaveLength(0)
    const restored = worldPointsOf(groupId)
    for (const p of before) expect(hasPoint(restored, p, 1e-9)).toBe(true)
  })
})
