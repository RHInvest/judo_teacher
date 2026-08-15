/**
 * Auswahl-Erweiterung (Doppel-/Dreifachklick) und Tag-Verwaltung.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Id } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { buildBox, buildGeometry, buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

const geom = () => useStore.getState().getActiveGeometry()

describe('growSelection', () => {
  it('boundingEdges nimmt die Randkanten einer Flaeche mit (Doppelklick)', () => {
    const built = installGeometry(buildQuad())
    useStore.getState().setSelection({ ...emptySelection(), faceIds: [built.faceIds[0]] })
    useStore.getState().growSelection('boundingEdges')

    const sel = useStore.getState().selection
    expect(sel.faceIds).toEqual([built.faceIds[0]])
    expect(sel.edgeIds.sort()).toEqual(built.edgeIds.slice().sort())
  })

  it('boundingEdges nimmt bei ausgewaehlten Kanten die angrenzenden Flaechen mit', () => {
    const built = installGeometry(buildQuad())
    useStore.getState().setSelection({ ...emptySelection(), edgeIds: [built.edgeIds[0]] })
    useStore.getState().growSelection('boundingEdges')

    const sel = useStore.getState().selection
    expect(sel.faceIds).toEqual([built.faceIds[0]])
    expect(sel.edgeIds).toHaveLength(4)
  })

  it('connected waehlt den ganzen zusammenhaengenden Koerper (Dreifachklick)', () => {
    // Zwei getrennte Koerper im selben Kontext
    const box = buildBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    const far = buildQuad({ x: 50, y: 50, z: 0 }, 1, 1)
    for (const id of Object.keys(far.geometry.vertices)) box.geometry.vertices[id] = far.geometry.vertices[id]
    for (const id of Object.keys(far.geometry.edges)) box.geometry.edges[id] = far.geometry.edges[id]
    for (const id of Object.keys(far.geometry.faces)) box.geometry.faces[id] = far.geometry.faces[id]
    installGeometry(box)

    useStore.getState().setSelection({ ...emptySelection(), faceIds: [box.faceIds[0]] })
    useStore.getState().growSelection('connected')

    const sel = useStore.getState().selection
    expect(sel.faceIds.sort()).toEqual(box.faceIds.slice().sort())
    expect(sel.edgeIds).toHaveLength(box.edgeIds.length)
    // Der entfernte Koerper bleibt draussen
    expect(sel.faceIds).not.toContain(far.faceIds[0])
  })

  it('coplanar nimmt nur die Flaechen in derselben Ebene mit', () => {
    // Zwei Rechtecke nebeneinander in der XY-Ebene, plus eine senkrechte Wand
    const built = buildGeometry(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      [
        [0, 1, 2, 3], // Boden links
        [1, 4, 5, 2], // Boden rechts (koplanar, teilt eine Kante)
        [1, 4, 7, 6], // senkrechte Wand
      ],
    )
    installGeometry(built)

    useStore.getState().setSelection({ ...emptySelection(), faceIds: [built.faceIds[0]] })
    useStore.getState().growSelection('coplanar')

    const sel = useStore.getState().selection
    expect(sel.faceIds).toContain(built.faceIds[0])
    expect(sel.faceIds).toContain(built.faceIds[1])
    expect(sel.faceIds).not.toContain(built.faceIds[2])
  })

  it('sameMaterial waehlt alles mit demselben Material', () => {
    const built = installGeometry(buildBox())
    const materialId = useStore.getState().addMaterial({
      name: 'Holz',
      color: '#a97142',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.8,
      metalness: 0,
      category: 'Holz',
      colorize: false,
    })
    const painted = [built.faceIds[0], built.faceIds[2]]
    useStore.getState().applyMaterial({ faceIds: painted }, materialId, 'front')

    useStore.getState().setSelection({ ...emptySelection(), faceIds: [built.faceIds[0]] })
    useStore.getState().growSelection('sameMaterial')
    expect(useStore.getState().selection.faceIds.sort()).toEqual(painted.slice().sort())
  })

  it('sameTag waehlt alles mit demselben Tag', () => {
    const built = installGeometry(buildBox())
    const tagId = useStore.getState().addTag('Dachflaeche')

    // Tag direkt auf zwei Flaechen setzen (der Kern kennt dafuer keine Aktion)
    const def = useStore.getState().getDefinition(useStore.getState().context.definitionId)
    if (!def) throw new Error('Definition erwartet')
    const patched = structuredClone(def.geometry)
    patched.faces[built.faceIds[1]].tagId = tagId
    patched.faces[built.faceIds[3]].tagId = tagId
    useStore.getState().upsertDefinition({ ...def, geometry: patched })

    useStore.getState().setSelection({ ...emptySelection(), faceIds: [built.faceIds[1]] })
    useStore.getState().growSelection('sameTag')
    const sel = useStore.getState().selection
    expect(sel.faceIds.sort()).toEqual([built.faceIds[1], built.faceIds[3]].sort())
  })

  it('laesst die Auswahl bei leerer Ausgangslage in Ruhe', () => {
    installGeometry(buildQuad())
    useStore.getState().clearSelection()
    useStore.getState().growSelection('boundingEdges')
    expect(useStore.getState().selection).toEqual(emptySelection())
  })
})

describe('Tags', () => {
  it('addTag vergibt eindeutige Namen', () => {
    const s = useStore.getState()
    const a = s.addTag('Waende')
    const b = useStore.getState().addTag('Waende')
    expect(a).not.toBe(b)
    expect(useStore.getState().getTag(a)?.name).toBe('Waende')
    expect(useStore.getState().getTag(b)?.name).not.toBe('Waende')
  })

  it('removeTag weist Geometrie und Entities dem Standard-Tag zu', () => {
    const built = installGeometry(buildQuad())
    const tagId = useStore.getState().addTag('Provisorisch')
    useStore.getState().setActiveTag(tagId)

    // Geometrie mit aktivem Tag zeichnen
    const change = useStore.getState().addEdge({ x: 9, y: 0, z: 0 }, { x: 10, y: 0, z: 0 })
    const edgeId = change.addedEdges[0]
    expect(geom().edges[edgeId].tagId).toBe(tagId)

    // Eine Instanz auf dasselbe Tag legen
    useStore.getState().setSelection({ ...emptySelection(), faceIds: built.faceIds })
    const instanceId = useStore.getState().makeGroup('Getaggt') as string
    useStore.getState().setEntityTag([instanceId], tagId)
    expect(useStore.getState().getEntity(instanceId)?.tagId).toBe(tagId)

    useStore.getState().removeTag(tagId)

    const doc = useStore.getState().doc
    expect(doc.tags[tagId]).toBeUndefined()
    const fallback = doc.activeTagId
    expect(doc.tags[fallback]).toBeDefined()
    expect(geom().edges[edgeId].tagId).toBe(fallback)
    expect(useStore.getState().getEntity(instanceId)?.tagId).toBe(fallback)
  })

  it('removeTag kann gezielt auf ein anderes Tag umhaengen', () => {
    const doomed = useStore.getState().addTag('Alt')
    const target = useStore.getState().addTag('Neu')
    useStore.getState().setActiveTag(doomed)
    const change = useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })

    useStore.getState().removeTag(doomed, target)
    expect(geom().edges[change.addedEdges[0]].tagId).toBe(target)
    expect(useStore.getState().doc.activeTagId).toBe(target)
  })

  it('das Standard-Tag laesst sich nicht loeschen', () => {
    const defaultId = useStore.getState().doc.activeTagId
    useStore.getState().removeTag(defaultId)
    expect(useStore.getState().getTag(defaultId)).toBeDefined()
    expect(useStore.getState().ui.toasts.some((t) => t.kind === 'warn')).toBe(true)
  })

  it('Tag-Loeschung laesst sich rueckgaengig machen', () => {
    const tagId = useStore.getState().addTag('Zurueckholen')
    useStore.getState().setActiveTag(tagId)
    const change = useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const edgeId = change.addedEdges[0]

    useStore.getState().removeTag(tagId)
    expect(useStore.getState().getTag(tagId)).toBeUndefined()

    useStore.getState().undo()
    expect(useStore.getState().getTag(tagId)).toBeDefined()
    expect(geom().edges[edgeId].tagId).toBe(tagId)
  })

  it('setActiveTag ist Werkzeugzustand und erzeugt keinen Undo-Schritt', () => {
    const tagId = useStore.getState().addTag('Aktiv')
    useStore.getState().clearHistory()
    useStore.getState().setActiveTag(tagId)
    expect(useStore.getState().doc.activeTagId).toBe(tagId)
    expect(useStore.getState().canUndo()).toBe(false)
    expect(useStore.getState().dirty).toBe(true)
  })

  it('setActiveMaterial ist ebenfalls kein Undo-Schritt', () => {
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
    useStore.getState().clearHistory()
    useStore.getState().setActiveMaterial(materialId)
    expect(useStore.getState().doc.activeMaterialId).toBe(materialId)
    expect(useStore.getState().canUndo()).toBe(false)
  })
})

describe('Tag-Sichtbarkeit', () => {
  it('isTagVisible beruecksichtigt den uebergeordneten Ordner', () => {
    const folderId = useStore.getState().addTagFolder('Aussenhuelle')
    const tagId = useStore.getState().addTag('Fassade')
    useStore.getState().updateTag(tagId, { folderId })

    expect(useStore.getState().isTagVisible(tagId)).toBe(true)
    useStore.getState().updateTagFolder(folderId, { visible: false })
    expect(useStore.getState().isTagVisible(tagId)).toBe(false)

    useStore.getState().updateTagFolder(folderId, { visible: true })
    useStore.getState().updateTag(tagId, { visible: false })
    expect(useStore.getState().isTagVisible(tagId)).toBe(false)
    expect(useStore.getState().isTagVisible(null)).toBe(true)
  })

  it('removeTagFolder loest die Zuordnung, ohne die Tags zu loeschen', () => {
    const folderId = useStore.getState().addTagFolder('Ordner')
    const tagId = useStore.getState().addTag('Drin')
    useStore.getState().updateTag(tagId, { folderId })

    useStore.getState().removeTagFolder(folderId)
    expect(useStore.getState().doc.tagFolders[folderId]).toBeUndefined()
    expect(useStore.getState().getTag(tagId)?.folderId).toBeNull()
  })

  it('selectAll ueberspringt unsichtbare Tags', () => {
    const built = installGeometry(buildQuad())
    const tagId = useStore.getState().addTag('Versteckt')

    const def = useStore.getState().getDefinition(useStore.getState().context.definitionId)
    if (!def) throw new Error('Definition erwartet')
    const patched = structuredClone(def.geometry)
    patched.faces[built.faceIds[0]].tagId = tagId
    useStore.getState().upsertDefinition({ ...def, geometry: patched })

    useStore.getState().updateTag(tagId, { visible: false })
    useStore.getState().selectAll()
    expect(useStore.getState().selection.faceIds).not.toContain(built.faceIds[0])
  })
})

describe('Objekte verstecken und sperren', () => {
  it('setEntityHidden, setEntityLocked und unhideAll', () => {
    const built = installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Sichtbarkeit') as string

    useStore.getState().setEntityHidden([instanceId], true)
    expect(useStore.getState().getEntity(instanceId)?.hidden).toBe(true)
    useStore.getState().setEntityLocked([instanceId], true)
    expect(useStore.getState().getEntity(instanceId)?.locked).toBe(true)

    useStore.getState().unhideAll()
    expect(useStore.getState().getEntity(instanceId)?.hidden).toBe(false)
    // Sperren bleibt bestehen - das ist eine andere Eigenschaft
    expect(useStore.getState().getEntity(instanceId)?.locked).toBe(true)
    expect(built.faceIds).toHaveLength(1)
  })

  it('setEntityName benennt Gruppen samt ihrer Definition um', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Vorher') as string
    const entity = useStore.getState().getEntity(instanceId)
    if (entity?.type !== 'instance') throw new Error('Instanz erwartet')

    useStore.getState().setEntityName(instanceId, 'Nachher')
    expect(useStore.getState().getEntity(instanceId)?.name).toBe('Nachher')
    expect(useStore.getState().getDefinition(entity.definitionId)?.name).toBe('Nachher')
  })
})

describe('Hilfsobjekte', () => {
  it('addEntity haengt ein Hilfspunkt in den aktiven Kontext', () => {
    const contextId = useStore.getState().context.definitionId
    const id: Id = useStore.getState().addEntity({
      id: '',
      type: 'guidePoint',
      name: 'Messpunkt',
      tagId: null,
      hidden: false,
      locked: false,
      position: { x: 1, y: 2, z: 3 },
    })
    expect(id).toBeTruthy()
    expect(useStore.getState().getDefinition(contextId)?.children).toContain(id)
    const entity = useStore.getState().getEntity(id)
    expect(entity?.type).toBe('guidePoint')

    useStore.getState().removeEntities([id])
    expect(useStore.getState().getEntity(id)).toBeUndefined()
    expect(useStore.getState().getDefinition(contextId)?.children).not.toContain(id)
  })

  it('transformEntities kann Objekte kopieren', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Original') as string

    const copies = useStore.getState().transformEntities(
      [instanceId],
      M.translation({ x: 4, y: 0, z: 0 }),
      true,
    )
    expect(copies).toHaveLength(1)
    expect(copies[0]).not.toBe(instanceId)

    const original = useStore.getState().getEntity(instanceId)
    const copy = useStore.getState().getEntity(copies[0])
    if (original?.type !== 'instance' || copy?.type !== 'instance') throw new Error('Instanzen erwartet')
    // Beide teilen dieselbe Definition, stehen aber woanders
    expect(copy.definitionId).toBe(original.definitionId)
    expect(M.getTranslation(copy.transform).x).toBeCloseTo(M.getTranslation(original.transform).x + 4, 9)
  })
})
