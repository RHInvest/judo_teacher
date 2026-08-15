/**
 * Bus-Signale und Revisionszaehler - der Vertrag zwischen Store und Renderer.
 *
 * Der Renderer diffed nicht das Dokument, sondern verlaesst sich vollstaendig
 * auf diese beiden Kanaele. Was hier fehlt, sieht der Nutzer nicht.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppEvents } from '@/shared/events'
import { bus } from '@/shared/events'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { buildBox, buildQuad, installGeometry } from './helpers'

type EventName = keyof AppEvents

/** Zaehlt Bus-Ereignisse mit, solange der Recorder laeuft. */
function record(names: readonly EventName[]): { counts: Record<string, number>; stop: () => void } {
  const counts: Record<string, number> = {}
  const offs: (() => void)[] = []
  for (const name of names) {
    counts[name] = 0
    // Der Bus ist pro Ereignis typisiert; der Zaehler ignoriert die Nutzlast.
    offs.push(bus.on(name as 'scene:changed', () => { counts[name] += 1 }))
  }
  return { counts, stop: () => offs.forEach((off) => off()) }
}

let recorder: { counts: Record<string, number>; stop: () => void } | null = null

beforeEach(() => {
  resetStoreForTests('metric')
})

afterEach(() => {
  recorder?.stop()
  recorder = null
})

describe('Signale nach einer Operation', () => {
  it('Geometrieaenderung meldet die betroffene Definition', () => {
    const seen: { definitionId: string; full: boolean }[] = []
    const off = bus.on('geometry:changed', (payload) => seen.push(payload))
    const rootId = useStore.getState().doc.rootId

    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    off()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1].definitionId).toBe(rootId)
  })

  it('meldet die Definition der Gruppe, wenn darin gezeichnet wird', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Gemeldet') as string
    useStore.getState().enterContext(instanceId)
    const groupDefId = useStore.getState().context.definitionId

    const seen: string[] = []
    const off = bus.on('geometry:changed', (payload) => seen.push(payload.definitionId))
    useStore.getState().addEdge({ x: 0, y: 0, z: 4 }, { x: 1, y: 0, z: 4 })
    off()

    expect(seen).toContain(groupDefId)
  })

  it('feuert genau einmal pro zusammengefasster Operation', () => {
    const revisionBefore = useStore.getState().geometryRevision
    recorder = record(['geometry:changed', 'render:request'])
    useStore.getState().operation('Drei Kanten', () => {
      const s = useStore.getState()
      s.addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
      s.addEdge({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })
      s.addEdge({ x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 })
    })
    // Drei Kernel-Aufrufe, aber genau ein Signal und ein Revisionsschritt
    expect(recorder.counts['geometry:changed']).toBe(1)
    expect(useStore.getState().geometryRevision).toBe(revisionBefore + 1)
    expect(useStore.getState().history.undoStack).toHaveLength(1)
  })

  it('Material- und Stilaenderungen melden ihren eigenen Kanal', () => {
    recorder = record(['material:changed', 'style:changed', 'scene:changed'])
    useStore.getState().updateStyle({ showGrid: true })
    expect(recorder.counts['style:changed']).toBe(1)
    expect(recorder.counts['material:changed']).toBe(0)

    useStore.getState().addMaterial({
      name: 'Signal',
      color: '#010203',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Farben',
      colorize: false,
    })
    expect(recorder.counts['material:changed']).toBe(1)
  })

  it('Auswahlaenderungen innerhalb einer Operation melden sich ebenfalls', () => {
    const built = installGeometry(buildQuad())
    useStore.getState().setSelection({ ...emptySelection(), faceIds: built.faceIds, edgeIds: built.edgeIds })

    recorder = record(['selection:changed'])
    const revisionBefore = useStore.getState().selectionRevision

    // Loeschen kuerzt die Auswahl um die verschwundenen Ids
    useStore.getState().deletePrimitives({ faceIds: built.faceIds, edgeIds: built.edgeIds })

    expect(useStore.getState().selection).toEqual(emptySelection())
    expect(recorder.counts['selection:changed']).toBeGreaterThan(0)
    expect(useStore.getState().selectionRevision).toBeGreaterThan(revisionBefore)
  })

  it('Kontextwechsel meldet Definition und Tiefe', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Tiefe') as string

    const seen: { definitionId: string; depth: number }[] = []
    const off = bus.on('context:changed', (payload) => seen.push(payload))
    useStore.getState().enterContext(instanceId)
    useStore.getState().exitContext()
    off()

    expect(seen).toHaveLength(2)
    expect(seen[0].depth).toBe(1)
    expect(seen[1].depth).toBe(0)
    expect(seen[1].definitionId).toBe(useStore.getState().doc.rootId)
  })

  it('Undo meldet Geometrie, Auswahl und Kontext', () => {
    useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    recorder = record(['geometry:changed', 'selection:changed', 'context:changed', 'render:request'])
    useStore.getState().undo()

    expect(recorder.counts['geometry:changed']).toBeGreaterThan(0)
    expect(recorder.counts['selection:changed']).toBeGreaterThan(0)
    expect(recorder.counts['context:changed']).toBeGreaterThan(0)
    expect(recorder.counts['render:request']).toBeGreaterThan(0)
  })

  it('Laden eines Dokuments meldet alle Kanaele', () => {
    const doc = useStore.getState().exportDocument()
    recorder = record(['document:loaded', 'geometry:changed', 'scene:changed', 'material:changed', 'style:changed'])
    useStore.getState().loadDocument(doc)

    expect(recorder.counts['document:loaded']).toBe(1)
    expect(recorder.counts['geometry:changed']).toBe(1)
    expect(recorder.counts['scene:changed']).toBe(1)
    expect(recorder.counts['material:changed']).toBe(1)
    expect(recorder.counts['style:changed']).toBe(1)
  })

  it('Werkzeugwechsel meldet sich', () => {
    const seen: string[] = []
    const off = bus.on('tool:changed', (payload) => seen.push(payload.id))
    useStore.getState().setActiveTool('rectangle')
    useStore.getState().setActiveTool('rectangle') // gleiches Werkzeug: kein Signal
    off()
    expect(seen).toEqual(['rectangle'])
  })
})

describe('Kamera und Szenen ueber den Bus', () => {
  it('addScene uebernimmt die zuletzt gemeldete Kamera', () => {
    bus.emit('camera:changed', {
      eye: { x: 30, y: -30, z: 20 },
      target: { x: 1, y: 2, z: 3 },
      up: { x: 0, y: 0, z: 1 },
      fov: 45,
      projection: 'perspective',
      orthoHeight: 10,
    })

    const sceneId = useStore.getState().addScene('Vogelperspektive')
    const scene = useStore.getState().doc.scenes.find((s) => s.id === sceneId)
    expect(scene?.camera.eye).toEqual({ x: 30, y: -30, z: 20 })
    expect(scene?.camera.fov).toBe(45)
  })

  it('activateScene bittet den Viewport um die Kamerafahrt', () => {
    const sceneId = useStore.getState().addScene('Start')
    const seen: string[] = []
    const off = bus.on('scene:activate', (scene) => seen.push(scene.id))
    useStore.getState().activateScene(sceneId)
    off()
    expect(seen).toEqual([sceneId])
  })

  it('updateSceneFromView uebernimmt die neue Kamera, behaelt aber Name und Einstellungen', () => {
    const sceneId = useStore.getState().addScene('Bestand')
    useStore.getState().updateScene(sceneId, { description: 'Wichtig', transitionTime: 4 })

    bus.emit('camera:changed', {
      eye: { x: 5, y: 5, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      fov: 60,
      projection: 'parallel',
      orthoHeight: 8,
    })
    useStore.getState().updateSceneFromView(sceneId)

    const scene = useStore.getState().doc.scenes.find((s) => s.id === sceneId)
    expect(scene?.name).toBe('Bestand')
    expect(scene?.description).toBe('Wichtig')
    expect(scene?.transitionTime).toBe(4)
    expect(scene?.camera.eye).toEqual({ x: 5, y: 5, z: 5 })
    expect(scene?.camera.projection).toBe('parallel')
  })
})

describe('Lesehelfer fuer den Renderer', () => {
  it('getWorldTransform folgt dem Instanzpfad', () => {
    installGeometry(buildQuad({ x: 2, y: 0, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const inner = useStore.getState().makeGroup('Innen') as string
    useStore.getState().setSelection({ ...emptySelection(), entityIds: [inner] })
    const outer = useStore.getState().makeGroup('Aussen') as string

    const outerEntity = useStore.getState().getEntity(outer)
    if (outerEntity?.type !== 'instance') throw new Error('Instanz erwartet')
    const innerEntity = useStore.getState().getEntity(inner)
    if (innerEntity?.type !== 'instance') throw new Error('Instanz erwartet')

    const world = useStore.getState().getWorldTransform([outer, inner])
    expect(M.equals(world, M.multiply(outerEntity.transform, innerEntity.transform))).toBe(true)
    expect(M.isIdentity(useStore.getState().getWorldTransform([]))).toBe(true)
  })

  it('getDefinitionBounds und getModelBounds beziehen Kinder mit ein', () => {
    installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }))
    useStore.getState().selectAll()
    useStore.getState().makeGroup('Im Kasten')

    const rootId = useStore.getState().doc.rootId
    const bounds = useStore.getState().getDefinitionBounds(rootId)
    expect(bounds.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(bounds.max).toEqual({ x: 2, y: 2, z: 2 })
    expect(useStore.getState().getModelBounds()).toEqual(bounds)
  })

  it('getStyle faellt auf einen Standardstil zurueck', () => {
    expect(useStore.getState().getStyle().name).toBeTruthy()
    expect(useStore.getState().getStyle().faceStyle).toBe('shadedWithTextures')
  })

  it('setHover meldet nur echte Wechsel', () => {
    recorder = record(['render:request'])
    useStore.getState().setHover({ kind: 'face', id: 'f1', definitionId: 'd1' })
    const afterFirst = recorder.counts['render:request']
    useStore.getState().setHover({ kind: 'face', id: 'f1', definitionId: 'd1' })
    expect(recorder.counts['render:request']).toBe(afterFirst)

    useStore.getState().setHover(null)
    expect(recorder.counts['render:request']).toBeGreaterThan(afterFirst)
    expect(useStore.getState().hover).toBeNull()
  })
})
