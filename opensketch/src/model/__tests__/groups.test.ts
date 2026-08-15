/**
 * Gruppen, Komponenten, Kontextnavigation und der Uebergang
 * Weltkoordinaten -> Kontextkoordinaten.
 *
 * Punkte, die von Werkzeugen kommen, sind IMMER Weltkoordinaten. Der Store
 * rechnet sie mit der Inversen von `context.worldTransform` in den Kontextraum,
 * bevor der Kernel sie sieht. Diese Datei prueft genau das - gegen den echten
 * Geometriekern, inklusive automatischer Flaechenbildung.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec3Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { B, M, V } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { buildBox, buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

const geom = () => useStore.getState().getActiveGeometry()

/** Alle Punkte der aktiven Geometrie, im Kontextraum. */
function localPoints(): Vec3Like[] {
  const g = geom()
  return Object.keys(g.vertices).map((id) => g.vertices[id].p)
}

function hasPoint(points: readonly Vec3Like[], p: Vec3Like, tol = 1e-9): boolean {
  return points.some((q) => V.equals(q, p, tol))
}

describe('Gruppieren', () => {
  it('verschiebt Geometrie in eine neue Definition, relativ zur Auswahl-Box', () => {
    installGeometry(buildQuad({ x: 4, y: 6, z: 0 }, 2, 2))
    const rootId = useStore.getState().doc.rootId
    useStore.getState().selectAll()

    const instanceId = useStore.getState().makeGroup('Tischplatte')
    expect(instanceId).not.toBeNull()

    const doc = useStore.getState().doc
    // Die Wurzel ist leer
    expect(Object.keys(doc.definitions[rootId].geometry.faces)).toHaveLength(0)
    expect(Object.keys(doc.definitions[rootId].geometry.vertices)).toHaveLength(0)

    const instance = doc.entities[instanceId as string]
    expect(instance.type).toBe('instance')
    if (instance.type !== 'instance') throw new Error('Instanz erwartet')
    expect(instance.isGroup).toBe(true)
    // Ursprung der Gruppe = Minimum der Auswahl-Bounding-Box
    expect(M.getTranslation(instance.transform)).toEqual({ x: 4, y: 6, z: 0 })

    // Geometrie liegt jetzt relativ zu diesem Ursprung
    const groupGeom = doc.definitions[instance.definitionId].geometry
    const points = Object.keys(groupGeom.vertices).map((id) => groupGeom.vertices[id].p)
    expect(hasPoint(points, { x: 0, y: 0, z: 0 })).toBe(true)
    expect(hasPoint(points, { x: 2, y: 2, z: 0 })).toBe(true)
    expect(Object.keys(groupGeom.faces)).toHaveLength(1)

    // Die Instanz ist ausgewaehlt
    expect(useStore.getState().selection.entityIds).toEqual([instanceId])
  })

  it('meldet sich, wenn nichts ausgewaehlt ist', () => {
    expect(useStore.getState().makeGroup()).toBeNull()
    expect(useStore.getState().ui.toasts.some((t) => t.kind === 'warn')).toBe(true)
  })

  it('makeComponent legt eine wiederverwendbare Definition an', () => {
    installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeComponent({ name: 'Stuhl', description: 'Sitzmoebel' })
    expect(instanceId).not.toBeNull()

    const instance = useStore.getState().getEntity(instanceId as string)
    if (instance?.type !== 'instance') throw new Error('Instanz erwartet')
    expect(instance.isGroup).toBe(false)
    const def = useStore.getState().getDefinition(instance.definitionId)
    expect(def?.kind).toBe('component')
    expect(def?.name).toBe('Stuhl')
    expect(def?.description).toBe('Sitzmoebel')
  })
})

describe('Aufloesen', () => {
  it('Gruppieren und Aufloesen ist ein Round-Trip', () => {
    const built = installGeometry(buildBox({ x: 3, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }))
    const rootId = useStore.getState().doc.rootId
    const pointsBefore = localPoints().map((p) => ({ ...p }))
    const faceCountBefore = built.faceIds.length
    const edgeCountBefore = built.edgeIds.length

    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Kiste') as string
    expect(Object.keys(useStore.getState().doc.definitions[rootId].geometry.vertices)).toHaveLength(0)

    useStore.getState().explode([instanceId])

    const doc = useStore.getState().doc
    const rootGeom = doc.definitions[rootId].geometry
    expect(Object.keys(rootGeom.faces)).toHaveLength(faceCountBefore)
    expect(Object.keys(rootGeom.edges)).toHaveLength(edgeCountBefore)

    // Die Geometrie ist wieder an ihrer urspruenglichen Weltposition
    const pointsAfter = Object.keys(rootGeom.vertices).map((id) => rootGeom.vertices[id].p)
    expect(pointsAfter).toHaveLength(pointsBefore.length)
    for (const p of pointsBefore) expect(hasPoint(pointsAfter, p, 1e-6)).toBe(true)

    // Instanz und Gruppendefinition sind verschwunden
    expect(doc.entities[instanceId]).toBeUndefined()
    expect(Object.keys(doc.definitions)).toHaveLength(1)
  })

  it('haengt verschachtelte Objekte eine Ebene nach oben', () => {
    // Aeussere Gruppe mit einer inneren Gruppe darin
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const innerInstance = useStore.getState().makeGroup('Innen') as string

    useStore.getState().setSelection({ ...emptySelection(), entityIds: [innerInstance] })
    const outerInstance = useStore.getState().makeGroup('Aussen') as string

    const outer = useStore.getState().getEntity(outerInstance)
    if (outer?.type !== 'instance') throw new Error('Instanz erwartet')
    expect(useStore.getState().getDefinition(outer.definitionId)?.children).toHaveLength(1)

    useStore.getState().explode([outerInstance])

    const rootId = useStore.getState().doc.rootId
    const rootChildren = useStore.getState().getDefinition(rootId)?.children ?? []
    expect(rootChildren).toHaveLength(1)
    const promoted = useStore.getState().getEntity(rootChildren[0])
    expect(promoted?.type).toBe('instance')
    if (promoted?.type === 'instance') expect(promoted.isGroup).toBe(true)
  })

  it('laesst die Definition einer Komponente stehen, wenn sie noch benutzt wird', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const first = useStore.getState().makeComponent({ name: 'Fenster' }) as string
    const instance = useStore.getState().getEntity(first)
    if (instance?.type !== 'instance') throw new Error('Instanz erwartet')
    const definitionId = instance.definitionId

    useStore.getState().placeInstance(definitionId, M.translation({ x: 5, y: 0, z: 0 }))
    expect(useStore.getState().getDefinition(definitionId)).toBeDefined()

    useStore.getState().explode([first])
    // Die zweite Instanz lebt weiter, die Definition bleibt erhalten
    expect(useStore.getState().getDefinition(definitionId)).toBeDefined()
    expect(useStore.getState().getEntity(first)).toBeUndefined()
  })
})

describe('Kontextnavigation', () => {
  it('akkumuliert die worldTransform ueber zwei Ebenen', () => {
    installGeometry(buildQuad({ x: 2, y: 0, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const inner = useStore.getState().makeGroup('Innen') as string

    useStore.getState().setSelection({ ...emptySelection(), entityIds: [inner] })
    const outer = useStore.getState().makeGroup('Aussen') as string

    const rootId = useStore.getState().doc.rootId
    expect(useStore.getState().context.definitionId).toBe(rootId)

    useStore.getState().enterContext(outer)
    const outerWorld = useStore.getState().context.worldTransform
    expect(useStore.getState().context.instancePath).toEqual([outer])

    const innerChild = useStore.getState().getDefinition(useStore.getState().context.definitionId)?.children ?? []
    expect(innerChild).toHaveLength(1)
    useStore.getState().enterContext(innerChild[0])

    const ctx = useStore.getState().context
    expect(ctx.instancePath).toHaveLength(2)
    expect(ctx.definitionPath).toHaveLength(3)
    expect(ctx.definitionPath[0]).toBe(rootId)

    // Gesamt-Weltmatrix = aussen * innen und insgesamt die Ursprungsverschiebung
    const innerEntity = useStore.getState().getEntity(innerChild[0])
    if (innerEntity?.type !== 'instance') throw new Error('Instanz erwartet')
    const expected = M.multiply(outerWorld, innerEntity.transform)
    expect(M.equals(ctx.worldTransform, expected)).toBe(true)
    expect(M.getTranslation(ctx.worldTransform).x).toBeCloseTo(2, 9)

    // Verlassen fuehrt Schritt fuer Schritt zurueck
    expect(useStore.getState().exitContext()).toBe(true)
    expect(useStore.getState().context.instancePath).toEqual([outer])
    expect(useStore.getState().exitContext()).toBe(true)
    expect(useStore.getState().context.definitionId).toBe(rootId)
    expect(useStore.getState().exitContext()).toBe(false)
  })

  it('leert die Auswahl beim Betreten und Verlassen', () => {
    const built = installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Leergeraeumt') as string

    useStore.getState().enterContext(instanceId)
    expect(useStore.getState().selection).toEqual(emptySelection())

    const inside = useStore.getState().getActiveGeometry()
    useStore.getState().setSelection({ ...emptySelection(), faceIds: Object.keys(inside.faces) })
    expect(useStore.getState().selection.faceIds).toHaveLength(1)

    useStore.getState().exitContext()
    expect(useStore.getState().selection).toEqual(emptySelection())
    expect(built.faceIds).toHaveLength(1)
  })

  it('exitAllContexts springt direkt zur Wurzel', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const inner = useStore.getState().makeGroup('Innen') as string
    useStore.getState().setSelection({ ...emptySelection(), entityIds: [inner] })
    const outer = useStore.getState().makeGroup('Aussen') as string

    useStore.getState().enterContext(outer)
    const children = useStore.getState().getDefinition(useStore.getState().context.definitionId)?.children ?? []
    useStore.getState().enterContext(children[0])
    expect(useStore.getState().context.instancePath).toHaveLength(2)

    useStore.getState().exitAllContexts()
    expect(useStore.getState().context.definitionId).toBe(useStore.getState().doc.rootId)
    expect(useStore.getState().context.instancePath).toHaveLength(0)
    expect(M.isIdentity(useStore.getState().context.worldTransform)).toBe(true)
  })

  it('betritt gesperrte Objekte nicht', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Gesperrt') as string
    useStore.getState().setEntityLocked([instanceId], true)

    useStore.getState().enterContext(instanceId)
    expect(useStore.getState().context.definitionId).toBe(useStore.getState().doc.rootId)
    expect(useStore.getState().ui.toasts.some((t) => t.text.includes('gesperrt'))).toBe(true)
  })
})

describe('Weltkoordinaten im Kontext', () => {
  it('zeichnet ein Rechteck in Weltkoordinaten korrekt in den Gruppenraum', () => {
    installGeometry(buildQuad({ x: 10, y: 20, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Verschoben') as string

    useStore.getState().enterContext(instanceId)
    expect(M.getTranslation(useStore.getState().context.worldTransform)).toEqual({ x: 10, y: 20, z: 0 })

    // geschlossener Linienzug in WELTkoordinaten
    useStore.getState().addPolyline(
      [
        { x: 12, y: 20, z: 0 },
        { x: 14, y: 20, z: 0 },
        { x: 14, y: 23, z: 0 },
        { x: 12, y: 23, z: 0 },
      ],
      true,
    )

    const points = localPoints()
    // ... landet lokal bei (2,0,0) .. (4,3,0)
    expect(hasPoint(points, { x: 2, y: 0, z: 0 }, 1e-6)).toBe(true)
    expect(hasPoint(points, { x: 4, y: 0, z: 0 }, 1e-6)).toBe(true)
    expect(hasPoint(points, { x: 4, y: 3, z: 0 }, 1e-6)).toBe(true)
    expect(hasPoint(points, { x: 2, y: 3, z: 0 }, 1e-6)).toBe(true)
    // kein Punkt darf in Weltkoordinaten liegen geblieben sein
    expect(hasPoint(points, { x: 12, y: 20, z: 0 }, 1e-6)).toBe(false)

    // Der Kern bildet die Flaeche automatisch - im Kontextraum, Ebene z=0
    const faces = Object.keys(geom().faces).map((id) => geom().faces[id])
    expect(faces.length).toBeGreaterThanOrEqual(2)
    for (const face of faces) {
      expect(Math.abs(face.plane.d)).toBeLessThan(1e-6)
      expect(Math.abs(face.normal.z)).toBeCloseTo(1, 6)
    }
  })

  it('addFace erzeugt eine Flaeche im Kontextraum mit korrekter Ebene', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 5 }, 1, 1))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Hoch oben') as string
    useStore.getState().enterContext(instanceId)
    const world = useStore.getState().context.worldTransform
    expect(M.getTranslation(world).z).toBeCloseTo(5, 9)

    const before = Object.keys(geom().faces).length
    useStore.getState().addFace([
      { x: 0, y: 0, z: 7 },
      { x: 2, y: 0, z: 7 },
      { x: 2, y: 2, z: 7 },
      { x: 0, y: 2, z: 7 },
    ])
    const faces = Object.keys(geom().faces)
    expect(faces.length).toBeGreaterThan(before)

    const newFace = geom().faces[faces[faces.length - 1]]
    // Weltebene z=7, Gruppenursprung z=5  ->  lokale Ebene z=2
    expect(Math.abs(newFace.plane.d)).toBeCloseTo(2, 6)
    expect(Math.abs(newFace.normal.z)).toBeCloseTo(1, 6)
  })

  it('getSelectionBounds rechnet aus dem Kontext zurueck in die Welt', () => {
    installGeometry(buildBox({ x: 7, y: 1, z: 0 }, { x: 2, y: 2, z: 2 }))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Weit weg') as string

    useStore.getState().enterContext(instanceId)
    useStore.getState().selectAll()
    const bounds = useStore.getState().getSelectionBounds()
    expect(bounds).not.toBeNull()
    if (!bounds) return
    expect(bounds.min.x).toBeCloseTo(7, 6)
    expect(bounds.min.y).toBeCloseTo(1, 6)
    expect(bounds.max.x).toBeCloseTo(9, 6)
    expect(B.size(bounds).z).toBeCloseTo(2, 6)
  })

  it('verschiebt Geometrie im Kontext mit einer Weltmatrix', () => {
    installGeometry(buildQuad({ x: 5, y: 5, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Innen bewegen') as string
    useStore.getState().enterContext(instanceId)
    useStore.getState().selectAll()

    useStore.getState().transformPrimitives(
      useStore.getState().selection,
      M.translation({ x: 0, y: 0, z: 3 }),
      false,
    )
    // Die Verschiebung ist rein translatorisch, also im Kontext identisch
    expect(hasPoint(localPoints(), { x: 0, y: 0, z: 3 }, 1e-6)).toBe(true)

    // Und in Weltkoordinaten liegt sie bei z = 3
    const bounds = useStore.getState().getSelectionBounds()
    expect(bounds?.min.z).toBeCloseTo(3, 6)
    expect(bounds?.min.x).toBeCloseTo(5, 6)
  })
})

describe('Komponenten eindeutig machen', () => {
  it('makeUnique klont die Definition nur fuer die gewaehlte Instanz', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const first = useStore.getState().makeComponent({ name: 'Tuer' }) as string
    const instance = useStore.getState().getEntity(first)
    if (instance?.type !== 'instance') throw new Error('Instanz erwartet')
    const sharedId = instance.definitionId

    const second = useStore.getState().placeInstance(sharedId, M.translation({ x: 3, y: 0, z: 0 }))
    expect(useStore.getState().getDefinition(sharedId)?.instanceCount).toBe(2)

    useStore.getState().makeUnique([second])
    const secondEntity = useStore.getState().getEntity(second)
    if (secondEntity?.type !== 'instance') throw new Error('Instanz erwartet')
    expect(secondEntity.definitionId).not.toBe(sharedId)
    expect(useStore.getState().getDefinition(sharedId)?.instanceCount).toBe(1)
    expect(useStore.getState().getDefinition(secondEntity.definitionId)?.instanceCount).toBe(1)

    // Aenderung an der neuen Definition laesst das Original unberuehrt
    const cloneDefId = secondEntity.definitionId
    const originalFaces = Object.keys(useStore.getState().getDefinition(sharedId)?.geometry.faces ?? {}).length
    const cloneDef = useStore.getState().getDefinition(cloneDefId)
    if (!cloneDef) throw new Error('Definition erwartet')
    useStore.getState().upsertDefinition({ ...cloneDef, geometry: buildQuad({ x: 0, y: 0, z: 0 }, 5, 5).geometry })
    expect(Object.keys(useStore.getState().getDefinition(sharedId)?.geometry.faces ?? {})).toHaveLength(
      originalFaces,
    )
  })

  it('macht nichts bei einer einzigen Instanz', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const only = useStore.getState().makeComponent({ name: 'Einzeln' }) as string
    const before = useStore.getState().getEntity(only)
    if (before?.type !== 'instance') throw new Error('Instanz erwartet')

    useStore.getState().makeUnique([only])
    const after = useStore.getState().getEntity(only)
    if (after?.type !== 'instance') throw new Error('Instanz erwartet')
    expect(after.definitionId).toBe(before.definitionId)
  })
})

describe('Aufraeumen', () => {
  it('purgeUnused entfernt unbenutzte Definitionen, Materialien und Tags', () => {
    const s = useStore.getState()
    installGeometry(buildQuad())
    s.selectAll()
    const instanceId = useStore.getState().makeComponent({ name: 'Weg' }) as string
    const instance = useStore.getState().getEntity(instanceId)
    if (instance?.type !== 'instance') throw new Error('Instanz erwartet')

    useStore.getState().addTag('Unbenutzt')
    useStore.getState().removeEntities([instanceId])

    const removed = useStore.getState().purgeUnused()
    expect(removed.definitions).toBeGreaterThanOrEqual(1)
    expect(removed.tags).toBeGreaterThanOrEqual(1)
    expect(useStore.getState().getDefinition(instance.definitionId)).toBeUndefined()
    // Das Standard-Tag bleibt immer erhalten
    expect(Object.keys(useStore.getState().doc.tags).length).toBeGreaterThanOrEqual(1)
  })
})
