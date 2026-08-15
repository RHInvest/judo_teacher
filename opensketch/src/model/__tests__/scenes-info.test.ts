/**
 * Randfaelle: Szenen, purgeUnused, Entity-Info bei gemischter Auswahl und
 * die Obergrenze der Historie.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import { HISTORY_LIMIT } from '../history'
import { useStore, resetStoreForTests } from '../store'
import { buildBox, buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

/** Legt eine Gruppe aus einem Quader an und liefert Instanz- und Definitions-Id. */
function boxGroup(name = 'Kasten'): { instanceId: string; definitionId: string } {
  installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 }))
  useStore.getState().selectAll()
  const instanceId = useStore.getState().makeGroup(name) as string
  const instance = useStore.getState().getEntity(instanceId)
  if (instance?.type !== 'instance') throw new Error('Instanz erwartet')
  return { instanceId, definitionId: instance.definitionId }
}

describe('Szenen-Randfaelle', () => {
  it('stellt nur wieder her, was die Szene auch speichert', () => {
    const tagId = useStore.getState().addTag('Schaltbar')
    const sceneId = useStore.getState().addScene('Nur Kamera')
    useStore.getState().updateScene(sceneId, {
      saves: {
        camera: true,
        tagVisibility: false,
        style: false,
        shadows: false,
        hiddenGeometry: false,
        sectionPlanes: false,
      },
    })

    useStore.getState().updateTag(tagId, { visible: false })
    useStore.getState().updateSun({ enabled: true })

    useStore.getState().activateScene(sceneId)
    // Tag und Sonne bleiben, wie sie sind
    expect(useStore.getState().getTag(tagId)?.visible).toBe(false)
    expect(useStore.getState().doc.sun.enabled).toBe(true)
  })

  it('vertraegt Szenen mit verschwundenen Tags und Stilen', () => {
    const tagId = useStore.getState().addTag('Kurzlebig')
    const sceneId = useStore.getState().addScene('Mit Tag')

    useStore.getState().removeTag(tagId)
    // Die Szene verweist noch auf das geloeschte Tag ...
    useStore.getState().updateScene(sceneId, { styleId: 'gibtesnicht' })

    expect(() => useStore.getState().activateScene(sceneId)).not.toThrow()
    // ... und der aktive Stil bleibt gueltig
    expect(useStore.getState().doc.styles[useStore.getState().doc.activeStyleId]).toBeDefined()
  })

  it('entfernt geloeschte Tags aus der Sichtbarkeitstabelle der Szenen', () => {
    const tagId = useStore.getState().addTag('Wird geloescht')
    const sceneId = useStore.getState().addScene('Vorher')
    expect(useStore.getState().doc.scenes[0].tagVisibility[tagId]).toBe(true)

    useStore.getState().removeTag(tagId)
    const scene = useStore.getState().doc.scenes.find((s) => s.id === sceneId)
    expect(scene?.tagVisibility[tagId]).toBeUndefined()
  })

  it('activateScene ist ein Undo-Schritt, wenn sie das Dokument aendert', () => {
    const tagId = useStore.getState().addTag('Umschalter')
    const sceneId = useStore.getState().addScene('Alles an')
    useStore.getState().updateTag(tagId, { visible: false })
    useStore.getState().clearHistory()

    useStore.getState().activateScene(sceneId)
    expect(useStore.getState().getTag(tagId)?.visible).toBe(true)
    expect(useStore.getState().canUndo()).toBe(true)

    useStore.getState().undo()
    expect(useStore.getState().getTag(tagId)?.visible).toBe(false)
  })

  it('eine unbekannte Szene tut nichts', () => {
    useStore.getState().clearHistory()
    expect(() => useStore.getState().activateScene('gibtesnicht')).not.toThrow()
    useStore.getState().updateScene('gibtesnicht', { name: 'X' })
    useStore.getState().removeScene('gibtesnicht')
    useStore.getState().reorderScene('gibtesnicht', 0)
    expect(useStore.getState().canUndo()).toBe(false)
  })

  it('vergibt fortlaufende Standardnamen', () => {
    useStore.getState().addScene()
    useStore.getState().addScene()
    expect(useStore.getState().doc.scenes.map((s) => s.name)).toEqual(['Szene 1', 'Szene 2'])
  })

  it('speichert versteckte Objekte namentlich', () => {
    const { instanceId } = boxGroup('Versteckbar')
    useStore.getState().setEntityHidden([instanceId], true)
    const sceneId = useStore.getState().addScene('Mit verstecktem Objekt')

    const scene = useStore.getState().doc.scenes.find((s) => s.id === sceneId)
    expect(scene?.hiddenEntityIds).toContain(instanceId)

    useStore.getState().setEntityHidden([instanceId], false)
    useStore.getState().activateScene(sceneId)
    expect(useStore.getState().getEntity(instanceId)?.hidden).toBe(true)
  })
})

describe('purgeUnused', () => {
  it('laesst benutzte Definitionen, Materialien und Tags in Ruhe', () => {
    const { definitionId } = boxGroup('Benutzt')
    const materialId = useStore.getState().addMaterial({
      name: 'Benutzt',
      color: '#334455',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Farben',
      colorize: false,
    })
    useStore.getState().applyMaterial({ entityIds: [useStore.getState().doc.entities ? Object.keys(useStore.getState().doc.entities)[0] : ''] }, materialId)
    const tagId = useStore.getState().addTag('Benutzt')
    useStore.getState().setEntityTag(Object.keys(useStore.getState().doc.entities), tagId)

    const removed = useStore.getState().purgeUnused()
    expect(removed.definitions).toBe(0)
    expect(useStore.getState().getDefinition(definitionId)).toBeDefined()
    expect(useStore.getState().getMaterial(materialId)).toBeDefined()
    expect(useStore.getState().getTag(tagId)).toBeDefined()
  })

  it('entfernt verwaiste Definitionen samt verschachtelter Gruppen', () => {
    const { instanceId, definitionId } = boxGroup('Wegwerf')
    // Instanz entfernen: die Gruppendefinition wird sofort mit aufgeraeumt
    useStore.getState().removeEntities([instanceId])
    expect(useStore.getState().getDefinition(definitionId)).toBeUndefined()

    // Eine Komponente ueberlebt das Entfernen ihrer Instanz ...
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const componentInstance = useStore.getState().makeComponent({ name: 'Waise' }) as string
    const component = useStore.getState().getEntity(componentInstance)
    if (component?.type !== 'instance') throw new Error('Instanz erwartet')
    useStore.getState().removeEntities([componentInstance])
    expect(useStore.getState().getDefinition(component.definitionId)).toBeDefined()

    // ... bis aufgeraeumt wird
    const removed = useStore.getState().purgeUnused()
    expect(removed.definitions).toBeGreaterThanOrEqual(1)
    expect(useStore.getState().getDefinition(component.definitionId)).toBeUndefined()
  })

  it('behaelt Bibliothekskomponenten', () => {
    const libraryId = 'lib-definition'
    useStore.getState().upsertDefinition({
      id: libraryId,
      name: 'Bibliotheksstuhl',
      kind: 'component',
      geometry: buildQuad().geometry,
      children: [],
      isLibrary: true,
    })
    useStore.getState().purgeUnused()
    expect(useStore.getState().getDefinition(libraryId)).toBeDefined()
  })

  it('behaelt das aktive Material und das aktive Tag', () => {
    const materialId = useStore.getState().addMaterial({
      name: 'Aktiv',
      color: '#ffffff',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Farben',
      colorize: false,
    })
    const tagId = useStore.getState().addTag('Aktiv')
    useStore.getState().setActiveMaterial(materialId)
    useStore.getState().setActiveTag(tagId)

    useStore.getState().purgeUnused()
    expect(useStore.getState().getMaterial(materialId)).toBeDefined()
    expect(useStore.getState().getTag(tagId)).toBeDefined()
  })

  it('laesst sich rueckgaengig machen', () => {
    const materialCountBefore = Object.keys(useStore.getState().doc.materials).length
    expect(materialCountBefore).toBeGreaterThan(0)

    useStore.getState().purgeUnused()
    expect(Object.keys(useStore.getState().doc.materials).length).toBeLessThan(materialCountBefore)

    useStore.getState().undo()
    expect(Object.keys(useStore.getState().doc.materials)).toHaveLength(materialCountBefore)
  })
})

describe('Entity-Info bei gemischter Auswahl', () => {
  it('zaehlt jede Art einzeln auf', () => {
    const built = installGeometry(buildBox())
    useStore.getState().setSelection({
      edgeIds: [built.edgeIds[0], built.edgeIds[1]],
      faceIds: [built.faceIds[0]],
      vertexIds: [built.vertexIds[0]],
      entityIds: [],
    })
    const info = useStore.getState().getEntityInfo()
    expect(info?.kind).toBe('Auswahl')
    expect(info?.count).toBe(4)
    expect(info?.rows.find((r) => r.label === 'Kanten')?.value).toBe('2')
    expect(info?.rows.find((r) => r.label === 'Flaechen')?.value).toBe('1')
    expect(info?.rows.find((r) => r.label === 'Punkte')?.value).toBe('1')
    // Flaeche und Laenge werden trotzdem ausgewiesen
    expect(info?.rows.some((r) => r.label === 'Flaeche')).toBe(true)
    expect(info?.rows.some((r) => r.label === 'Gesamtlaenge')).toBe(true)
  })

  it('zeigt das Volumen einer Gruppe, die ein Volumenkoerper ist', () => {
    const { instanceId } = boxGroup('Solid')
    useStore.getState().setSelection({ ...emptySelection(), entityIds: [instanceId] })

    const info = useStore.getState().getEntityInfo()
    expect(info?.kind).toBe('Gruppe')
    expect(info?.rows.some((r) => r.label === 'Definition')).toBe(true)
    const volume = info?.rows.find((r) => r.label === 'Volumen')
    expect(volume).toBeDefined()
    // 2 x 3 x 4 Meter
    expect(volume?.value).toContain('24')
  })

  it('zeigt bei Komponenten die Anzahl der Instanzen im Modell', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const first = useStore.getState().makeComponent({ name: 'Serie' }) as string
    const instance = useStore.getState().getEntity(first)
    if (instance?.type !== 'instance') throw new Error('Instanz erwartet')
    useStore.getState().placeInstance(instance.definitionId, M.translation({ x: 5, y: 0, z: 0 }))

    useStore.getState().setSelection({ ...emptySelection(), entityIds: [first] })
    const info = useStore.getState().getEntityInfo()
    expect(info?.kind).toBe('Komponente')
    expect(info?.rows.find((r) => r.label === 'Instanzen im Modell')?.value).toBe('2')
  })

  it('meldet gemeinsame Attribute nur, wenn sie wirklich gemeinsam sind', () => {
    const built = installGeometry(buildBox())
    const materialId = useStore.getState().addMaterial({
      name: 'Nur eine',
      color: '#ff0000',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Farben',
      colorize: false,
    })
    useStore.getState().applyMaterial({ faceIds: [built.faceIds[0]] }, materialId, 'front')

    // Beide Flaechen zusammen: kein gemeinsames Material
    useStore.getState().setSelection({ ...emptySelection(), faceIds: [built.faceIds[0], built.faceIds[1]] })
    expect(useStore.getState().getEntityInfo()?.materialId).toBeUndefined()

    // Nur die gestrichene: eindeutig
    useStore.getState().setSelection({ ...emptySelection(), faceIds: [built.faceIds[0]] })
    expect(useStore.getState().getEntityInfo()?.materialId).toBe(materialId)
  })

  it('meldet weiche und geglaettete Kanten als gemeinsames Attribut', () => {
    const built = installGeometry(buildBox())
    useStore.getState().setEdgeFlags([built.edgeIds[0], built.edgeIds[1]], { soft: true, smooth: false })
    useStore.getState().setSelection({ ...emptySelection(), edgeIds: [built.edgeIds[0], built.edgeIds[1]] })

    const info = useStore.getState().getEntityInfo()
    expect(info?.softEdges).toBe(true)
    expect(info?.smoothEdges).toBe(false)
  })

  it('nennt bei genau einem Objekt dessen Namen', () => {
    const { instanceId } = boxGroup('Einzelstueck')
    useStore.getState().setSelection({ ...emptySelection(), entityIds: [instanceId] })
    expect(useStore.getState().getEntityInfo()?.name).toBe('Einzelstueck')

    useStore.getState().addToSelection({ faceIds: [] })
    const second = useStore.getState().transformEntities([instanceId], M.translation({ x: 9, y: 0, z: 0 }), true)
    useStore.getState().setSelection({ ...emptySelection(), entityIds: [instanceId, second[0]] })
    expect(useStore.getState().getEntityInfo()?.name).toBeUndefined()
    expect(useStore.getState().getEntityInfo()?.count).toBe(2)
  })

  it('benennt Hilfsobjekte richtig', () => {
    const id = useStore.getState().addEntity({
      id: '',
      type: 'guidePoint',
      name: 'Messpunkt',
      tagId: null,
      hidden: false,
      locked: false,
      position: { x: 0, y: 0, z: 0 },
    })
    useStore.getState().setSelection({ ...emptySelection(), entityIds: [id] })
    expect(useStore.getState().getEntityInfo()?.kind).toBe('Hilfspunkt')
  })
})

describe('Obergrenze der Historie', () => {
  it('haelt hoechstens HISTORY_LIMIT Schritte vor', () => {
    const steps = HISTORY_LIMIT + 5
    for (let i = 0; i < steps; i++) {
      useStore.getState().addEdge({ x: i, y: 0, z: 0 }, { x: i, y: 1, z: 0 })
    }
    expect(useStore.getState().history.undoStack.length).toBe(HISTORY_LIMIT)

    // Der aelteste Stand ist nicht mehr erreichbar, aber alles bleibt konsistent
    for (let i = 0; i < HISTORY_LIMIT; i++) useStore.getState().undo()
    expect(useStore.getState().canUndo()).toBe(false)
    expect(Object.keys(useStore.getState().getActiveGeometry().edges).length).toBe(5)
  })
})
