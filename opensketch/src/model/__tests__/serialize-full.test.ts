/**
 * Vollstaendiger Round-Trip und Robustheit beim Laden.
 *
 * Teil 1 baut ein Dokument, in dem WIRKLICH alles vorkommt - Materialien mit
 * Texturen, Tags in Ordnern, Szenen, Schnittebenen, Bemassungen, Texte,
 * Bilder, Hilfsobjekte, verschachtelte Gruppen und eine Komponente mit zwei
 * Instanzen - und prueft, dass Schreiben und Lesen es unveraendert laesst.
 *
 * Teil 2 wirft `normalizeDocument` und `repairGeometryReferences` kaputte
 * Daten hin: fehlende Felder, unbekannte Versionen, Verweise auf Ids, die es
 * nicht gibt. Nichts davon darf die Anwendung lahmlegen - und ein
 * beschaedigtes Autosave darf den Start nicht verhindern.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Id, SketchDocument } from '@/shared/types'
import { M } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import {
  OSK_FORMAT,
  OSK_VERSION,
  deserializeDocument,
  documentFromRaw,
  documentRepairOf,
  normalizeDocument,
  normalizeGeometry,
  repairGeometryReferences,
  serializeDocument,
} from '../serialize'
import {
  AUTOSAVE_ID,
  loadAutosave,
  loadSlot,
  resetPersistenceForTests,
  saveAutosave,
  saveRawForTests,
  saveSlot,
} from '../persistence'
import { loadAutosave as loadAutosaveFacade } from '../index'
import { documentStats } from '../document'
import { buildBox, buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
  resetPersistenceForTests()
})

const state = () => useStore.getState()

/* ------------------------------------------------------------------ */
/* Ein Dokument, in dem alles vorkommt                                 */
/* ------------------------------------------------------------------ */

interface RichDocument {
  doc: SketchDocument
  textureId: Id
  materialId: Id
  folderId: Id
  tagId: Id
  sceneId: Id
  componentDefinitionId: Id
}

function buildEverything(): RichDocument {
  state().setDocumentName('Vollstaendig')
  state().setUnits({ lengthUnit: 'cm', precision: 3 })

  /* --- Geometrie in einer Gruppe, darin eine weitere Gruppe --- */
  installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 2 }))
  state().selectAll()
  const outerId = state().makeGroup('Baukoerper') as string

  /* --- Komponente mit zwei Instanzen --- */
  state().enterContext(outerId)
  state().addFace([
    { x: 0, y: 0, z: 2 },
    { x: 1, y: 0, z: 2 },
    { x: 1, y: 1, z: 2 },
    { x: 0, y: 1, z: 2 },
  ])
  state().exitContext()

  installGeometry(buildQuad({ x: 8, y: 0, z: 0 }, 1, 2))
  state().selectAll()
  const componentId = state().makeComponent({
    name: 'Fenster',
    description: 'Standardfenster',
    behavior: { glueTo: 'vertical', cutsOpening: true, alwaysFaceCamera: false, shadowsFaceSun: true },
  }) as string
  const componentEntity = state().doc.entities[componentId]
  if (!componentEntity || componentEntity.type !== 'instance') throw new Error('Komponente fehlt')
  const componentDefinitionId = componentEntity.definitionId
  state().placeInstance(componentDefinitionId, M.translation({ x: 12, y: 0, z: 0 }))

  /* --- Textur + Material, das sie benutzt --- */
  const textureId = state().addTexture({
    name: 'Ziegel',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    width: 256,
    height: 256,
  })
  const materialId = state().addMaterial({
    name: 'Ziegelwand',
    color: '#a2503c',
    opacity: 0.9,
    textureId,
    textureWidth: 0.24,
    textureHeight: 0.06,
    roughness: 0.8,
    metalness: 0.05,
    category: 'Mauerwerk',
    colorize: true,
  })
  state().setActiveMaterial(materialId)

  /* --- Tag in einem Ordner --- */
  const folderId = state().addTagFolder('Gebaeude')
  const tagId = state().addTag('Aussenwand')
  state().updateTag(tagId, { folderId, color: '#3366aa', dashes: 'dashdot', visible: false })
  state().setEntityTag([outerId], tagId)

  /* --- Annotationen --- */
  state().addEntity({
    id: '',
    type: 'dimension',
    name: 'Breite',
    tagId: null,
    hidden: false,
    locked: false,
    kind: 'linear',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 4, y: 0, z: 0 },
    offset: { x: 0, y: -0.5, z: 0 },
    text: null,
    fontSize: 14,
    color: '#202020',
    screenSpace: true,
    arrowStyle: 'closedArrow',
  })
  state().addEntity({
    id: '',
    type: 'text',
    name: 'Hinweis',
    tagId: null,
    hidden: false,
    locked: false,
    anchor: { x: 2, y: 1.5, z: 2 },
    position: { x: 3, y: 3, z: 3 },
    text: 'Traeger pruefen',
    fontSize: 12,
    color: '#c02020',
    screenSpace: true,
    leader: 'viewBased',
  })
  state().addEntity({
    id: '',
    type: 'sectionPlane',
    name: 'Schnitt A',
    tagId: null,
    hidden: false,
    locked: false,
    plane: { n: { x: 0, y: 1, z: 0 }, d: 1.5 },
    active: true,
    symbolSize: 2.5,
    color: '#d97706',
  })
  state().addEntity({
    id: '',
    type: 'guideLine',
    name: 'Achse',
    tagId: null,
    hidden: false,
    locked: false,
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    length: null,
  })
  state().addEntity({
    id: '',
    type: 'guidePoint',
    name: 'Bezug',
    tagId: null,
    hidden: false,
    locked: false,
    position: { x: 4, y: 3, z: 2 },
    from: { x: 0, y: 0, z: 0 },
  })
  state().addEntity({
    id: '',
    type: 'image',
    name: 'Fassadenfoto',
    tagId: null,
    hidden: false,
    locked: false,
    textureId,
    transform: M.translation({ x: -3, y: 0, z: 0 }),
    width: 2.5,
    height: 1.75,
    usage: 'model',
  })

  /* --- Stil, Sonne, Nebel, Szene --- */
  state().updateStyle({ faceStyle: 'hiddenLine', showGuides: false, showGrid: true, gridSpacing: 0.5 })
  state().updateSun({ enabled: true, time: 16 * 60 + 30, latitude: 48.137, locationName: 'Muenchen' })
  state().updateFog({ enabled: true, near: 12, far: 90, color: '#aabbcc' })
  const sceneId = state().addScene('Suedansicht')
  state().updateScene(sceneId, {
    description: 'Blick von Sueden',
    transitionTime: 2.5,
    delayTime: 1,
    included: false,
    saves: {
      camera: true,
      tagVisibility: true,
      style: false,
      shadows: true,
      hiddenGeometry: true,
      sectionPlanes: true,
    },
  })

  return {
    doc: state().exportDocument(),
    textureId,
    materialId,
    folderId,
    tagId,
    sceneId,
    componentDefinitionId,
  }
}

describe('Round-Trip mit allem', () => {
  it('schreibt und liest ein Dokument mit jedem Bestandteil identisch', () => {
    const { doc } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored).toEqual(doc)
  })

  it('auch mit Einrueckung bleibt es identisch', () => {
    const { doc } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc, { pretty: true }))
    expect(restored).toEqual(doc)
  })

  it('Materialien mit Texturen ueberleben vollstaendig', () => {
    const { doc, materialId, textureId } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    expect(restored.materials[materialId]).toEqual(doc.materials[materialId])
    expect(restored.materials[materialId].textureId).toBe(textureId)
    expect(restored.textures[textureId]).toEqual(doc.textures[textureId])
    expect(restored.textures[textureId].dataUrl).toBe(doc.textures[textureId].dataUrl)
    expect(restored.activeMaterialId).toBe(materialId)
  })

  it('Tags mit Ordnern behalten Zuordnung, Farbe und Sichtbarkeit', () => {
    const { doc, tagId, folderId } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    expect(restored.tagFolders[folderId]).toEqual(doc.tagFolders[folderId])
    expect(restored.tags[tagId].folderId).toBe(folderId)
    expect(restored.tags[tagId].dashes).toBe('dashdot')
    expect(restored.tags[tagId].visible).toBe(false)
    expect(restored.tags).toEqual(doc.tags)
  })

  it('Stile behalten jedes Schaltfeld - auch neu hinzugekommene', () => {
    const { doc } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    expect(restored.styles).toEqual(doc.styles)
    const style = restored.styles[restored.activeStyleId]
    expect(style.faceStyle).toBe('hiddenLine')
    // Ein abgeschaltetes Schaltfeld darf beim Lesen nicht auf den Standard
    // zurueckfallen - `showGuides` hat die Voreinstellung true.
    expect(style.showGuides).toBe(false)
    expect(style.showGrid).toBe(true)
    expect(style.gridSpacing).toBe(0.5)
  })

  it('Szenen behalten Kamera, Speicherflags und Zeiten', () => {
    const { doc, sceneId } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    const before = doc.scenes.find((s) => s.id === sceneId)
    const after = restored.scenes.find((s) => s.id === sceneId)
    expect(after).toEqual(before)
    expect(after?.saves.style).toBe(false)
    expect(after?.transitionTime).toBe(2.5)
    expect(after?.included).toBe(false)
    expect(after?.activeSectionPlaneId).toBe(before?.activeSectionPlaneId)
    expect(after?.activeSectionPlaneId).not.toBeNull()
  })

  it('Schnittebenen, Bemassungen, Texte, Bilder und Hilfsobjekte bleiben erhalten', () => {
    const { doc } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    const typesOf = (d: SketchDocument): string[] =>
      Object.keys(d.entities)
        .map((id) => d.entities[id].type)
        .sort()
    expect(typesOf(restored)).toEqual(typesOf(doc))
    expect(typesOf(doc)).toContain('sectionPlane')
    expect(typesOf(doc)).toContain('dimension')
    expect(typesOf(doc)).toContain('text')
    expect(typesOf(doc)).toContain('image')
    expect(typesOf(doc)).toContain('guideLine')
    expect(typesOf(doc)).toContain('guidePoint')
    expect(restored.entities).toEqual(doc.entities)
  })

  it('die Komponente behaelt Beschreibung, Verhalten und beide Instanzen', () => {
    const { doc, componentDefinitionId } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    const definition = restored.definitions[componentDefinitionId]
    expect(definition.kind).toBe('component')
    expect(definition.description).toBe('Standardfenster')
    expect(definition.behavior).toEqual(doc.definitions[componentDefinitionId].behavior)

    const instances = Object.keys(restored.entities).filter((id) => {
      const entity = restored.entities[id]
      return entity.type === 'instance' && entity.definitionId === componentDefinitionId
    })
    expect(instances).toHaveLength(2)
    expect(documentStats(restored)).toEqual(documentStats(doc))
  })

  it('das wiedergeladene Dokument ist im Store direkt weiterverwendbar', () => {
    const { doc, componentDefinitionId } = buildEverything()
    const restored = deserializeDocument(serializeDocument(doc))

    state().loadDocument(restored)
    expect(state().canUndo()).toBe(false)
    expect(state().doc.rootId).toBe(doc.rootId)

    // Weiterarbeiten erzeugt kollisionsfreie neue Ids.
    const existing = new Set(Object.keys(state().doc.entities))
    const newId = state().placeInstance(componentDefinitionId, M.translation({ x: 0, y: 9, z: 0 })) as string
    expect(existing.has(newId)).toBe(false)
    expect(state().doc.entities[newId]).toBeDefined()
  })
})

/* ------------------------------------------------------------------ */
/* Robustheit                                                          */
/* ------------------------------------------------------------------ */

describe('Kaputte und unvollstaendige Daten', () => {
  it('ein voellig leeres Objekt wird zu einem benutzbaren Dokument', () => {
    const doc = normalizeDocument({})

    expect(doc.rootId).toBeTruthy()
    expect(doc.definitions[doc.rootId].kind).toBe('model')
    expect(Object.keys(doc.tags).length).toBeGreaterThan(0)
    expect(Object.keys(doc.styles).length).toBeGreaterThan(0)
    expect(doc.tags[doc.activeTagId]).toBeDefined()
    expect(doc.styles[doc.activeStyleId]).toBeDefined()
    expect(doc.activeMaterialId).toBeNull()
    expect(doc.scenes).toEqual([])

    // Und der Store kann damit sofort arbeiten.
    state().loadDocument(doc)
    expect(state().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }).addedEdges).toHaveLength(1)
  })

  it('Muell in jedem Feld fuehrt nicht zu einem halben Dokument', () => {
    const doc = normalizeDocument({
      meta: 'kaputt',
      rootId: 42,
      definitions: [1, 2, 3],
      entities: 'nein',
      materials: null,
      textures: 7,
      tags: false,
      tagFolders: 'x',
      styles: [],
      scenes: { keinArray: true },
      units: 'metrisch',
      sun: 0,
      fog: NaN,
      activeStyleId: {},
      activeTagId: [],
      activeMaterialId: 'gibtesnicht',
    })

    expect(doc.definitions[doc.rootId]).toBeDefined()
    expect(doc.entities).toEqual({})
    expect(doc.scenes).toEqual([])
    expect(doc.units.lengthUnit).toBeTruthy()
    expect(doc.sun.locationName).toBeTruthy()
    expect(doc.fog.near).toBeGreaterThan(0)
    expect(doc.activeMaterialId).toBeNull()
  })

  it('eine unbekannte Version wird klar abgewiesen', () => {
    expect(() => documentFromRaw({ format: OSK_FORMAT, version: OSK_VERSION + 5, document: {} })).toThrow(
      /neueren Version/,
    )
    expect(() => documentFromRaw({ format: 'sketchup', version: 1, document: {} })).toThrow(/Dateiformat/)
    expect(() => deserializeDocument('{ das ist kein json')).toThrow(/JSON/)
    expect(() => deserializeDocument('"nur ein String"')).toThrow(/kein Dokument/)

    // Aeltere Versionen laufen durch die (noch leere) Migrationstabelle.
    const older = documentFromRaw({ format: OSK_FORMAT, version: 0, document: {} })
    expect(older.definitions[older.rootId]).toBeDefined()
  })

  it('Verweise auf nicht existierende Ids werden aufgeloest', () => {
    const doc = normalizeDocument({
      rootId: 'd-root',
      definitions: {
        'd-root': { id: 'd-root', name: 'Modell', kind: 'model', children: ['i-weg', 'i-da'], geometry: {} },
        'd-gruppe': { id: 'd-gruppe', name: 'Gruppe', kind: 'group', children: ['i-auchweg'], geometry: {} },
      },
      entities: {
        'i-da': { id: 'i-da', type: 'instance', name: 'Da', definitionId: 'd-gruppe' },
        'kaputt': { id: 'kaputt', type: 'gibtsnicht', name: 'Unfug' },
      },
      tags: { 't-1': { id: 't-1', name: 'Ohne Tag' } },
      activeTagId: 't-999',
      activeStyleId: 'c-999',
      activeMaterialId: 'm-999',
    })

    // Kindverweise auf verschwundene Entities sind weg
    expect(doc.definitions['d-root'].children).toEqual(['i-da'])
    expect(doc.definitions['d-gruppe'].children).toEqual([])
    // Unbekannte Entity-Typen fallen raus
    expect(doc.entities['kaputt']).toBeUndefined()
    // Aktive Ids zeigen wieder auf etwas Vorhandenes
    expect(doc.tags[doc.activeTagId]).toBeDefined()
    expect(doc.styles[doc.activeStyleId]).toBeDefined()
    expect(doc.activeMaterialId).toBeNull()
  })

  it('Instanzen ohne Definition werden entfernt und gemeldet', () => {
    const doc = normalizeDocument({
      rootId: 'd-root',
      definitions: {
        'd-root': {
          id: 'd-root',
          name: 'Modell',
          kind: 'model',
          children: ['i-verwaist', 'i-auchweg', 'g-bleibt'],
        },
      },
      entities: {
        'i-verwaist': { id: 'i-verwaist', type: 'instance', name: 'Geist', definitionId: 'd-gibtsnicht' },
        'i-auchweg': { id: 'i-auchweg', type: 'instance', name: 'Geist 2', definitionId: '' },
        'g-bleibt': { id: 'g-bleibt', type: 'guidePoint', name: 'Bezug', position: { x: 1, y: 1, z: 1 } },
      },
    })

    // Eine unsichtbare, aber anwaehlbare Instanz waere schlimmer als keine.
    expect(doc.entities['i-verwaist']).toBeUndefined()
    expect(doc.entities['i-auchweg']).toBeUndefined()
    expect(doc.entities['g-bleibt']).toBeDefined()
    expect(doc.definitions['d-root'].children).toEqual(['g-bleibt'])
    expect(documentRepairOf(doc)?.removedOrphanInstances).toBe(2)
    expect(documentStats(doc).instances).toBe(0)

    // Beim Laden erfaehrt der Nutzer davon - stilles Wegraeumen waere falsch.
    state().loadDocument(doc)
    const toast = state().ui.toasts.find((t) => t.kind === 'warn')
    expect(toast).toBeDefined()
    expect(toast?.text).toContain('2 Objekte ohne Definition')

    expect(() => state().getModelBounds()).not.toThrow()
    expect(state().addEdge({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }).addedEdges).toHaveLength(1)
  })

  it('ein heiles Dokument loest keine Warnung aus', () => {
    const doc = deserializeDocument(serializeDocument(buildEverything().doc))
    expect(documentRepairOf(doc)).toBeUndefined()

    state().loadDocument(doc)
    expect(state().ui.toasts.filter((t) => t.kind === 'warn')).toEqual([])
  })

  it('auch ein Dokument aus fremder Hand wird beim Laden bereinigt', () => {
    // Kein Round-Trip durch normalizeDocument - so kommen Dokumente von
    // Importeuren oder aus Programmcode.
    installGeometry(buildQuad())
    const doc = state().exportDocument()
    doc.entities['i-geist'] = {
      id: 'i-geist',
      type: 'instance',
      name: 'Geist',
      tagId: null,
      hidden: false,
      locked: false,
      definitionId: 'd-gibtsnicht',
      transform: M.identity(),
      isGroup: true,
      materialId: null,
    }
    doc.definitions[doc.rootId].children.push('i-geist')

    state().loadDocument(doc)

    expect(state().doc.entities['i-geist']).toBeUndefined()
    expect(state().doc.definitions[state().doc.rootId].children).not.toContain('i-geist')
    const toast = state().ui.toasts.find((t) => t.kind === 'warn')
    expect(toast?.text).toContain('Ein Objekt ohne Definition')
  })

  it('Geometrie mit toten Verweisen wird gesaeubert statt uebernommen', () => {
    const geometry = normalizeGeometry({
      vertices: {
        'v-1': { id: 'v-1', p: { x: 0, y: 0, z: 0 }, edges: ['e-gibtsnicht'] },
        'v-2': { id: 'v-2', p: [1, 0, 0], edges: [] },
        'v-3': 'kaputt',
      },
      edges: {
        'e-1': { id: 'e-1', a: 'v-1', b: 'v-2', faces: ['f-gibtsnicht'] },
        'e-2': { id: 'e-2', a: 'v-1', b: 'v-weg' },
      },
      faces: {
        'f-1': { id: 'f-1', outer: { edges: ['e-1', 'e-weg'], vertices: ['v-1', 'v-2', 'v-weg'] } },
        'f-2': { id: 'f-2', outer: { edges: [], vertices: ['v-1'] } },
      },
    })

    expect(Object.keys(geometry.vertices)).toEqual(['v-1', 'v-2'])
    // Kante auf einen verschwundenen Punkt faellt raus
    expect(Object.keys(geometry.edges)).toEqual(['e-1'])
    // Flaechen mit toten Schleifenverweisen ebenfalls
    expect(Object.keys(geometry.faces)).toEqual([])
    // Rueckverweise sind neu aufgebaut, keine Leichen mehr
    expect(geometry.vertices['v-1'].edges).toEqual(['e-1'])
    expect(geometry.edges['e-1'].faces).toEqual([])
    expect(geometry.vertices['v-2'].p).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('repairGeometryReferences stellt Rueckverweise wieder her', () => {
    installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 2, 2))
    const geometry = state().getActiveGeometry()
    const faceId = Object.keys(geometry.faces)[0]

    // Rueckverweise mutwillig zerstoeren
    for (const id of Object.keys(geometry.vertices)) geometry.vertices[id].edges = ['e-unsinn']
    for (const id of Object.keys(geometry.edges)) geometry.edges[id].faces = []

    repairGeometryReferences(geometry)

    for (const id of Object.keys(geometry.vertices)) {
      expect(geometry.vertices[id].edges).toHaveLength(2)
      expect(geometry.vertices[id].edges).not.toContain('e-unsinn')
    }
    for (const id of Object.keys(geometry.edges)) {
      expect(geometry.edges[id].faces).toEqual([faceId])
    }
  })

  it('normalizeGeometry vertraegt fehlende Teilstuecke', () => {
    expect(normalizeGeometry(undefined).vertices).toEqual({})
    expect(normalizeGeometry({ vertices: null, edges: 5, faces: 'nein' }).edges).toEqual({})
    const partial = normalizeGeometry({ faces: { 'f-1': { outer: { vertices: ['a', 'b'] } } } })
    expect(Object.keys(partial.faces)).toEqual([])
  })
})

describe('Beschaedigte Speicherstaende', () => {
  it('ein unlesbarer Slot liefert null und laesst die heilen Slots in Ruhe', async () => {
    await saveSlot('doc-heil', state().exportDocument())
    saveRawForTests('doc-kaputt', '{"format":"opensketch","version":1,"document":{')

    expect(await loadSlot('doc-kaputt')).toBeNull()
    expect(await loadSlot('doc-gibtsnicht')).toBeNull()
    expect(await loadSlot('doc-heil')).not.toBeNull()
  })

  it('ein beschaedigtes Autosave verhindert den Start nicht', async () => {
    await saveAutosave(state().exportDocument())
    expect(await loadAutosave()).not.toBeNull()

    // Autosave mit Muell ueberschreiben, wie es ein abgebrochener Schreibvorgang hinterlaesst
    saveRawForTests(AUTOSAVE_ID, '{"format":"opensketch","version":1,"document":')

    expect(await loadAutosave()).toBeNull()
    expect(await loadAutosaveFacade()).toBeNull()
  })

  it('ein Autosave mit fremdem Format liefert ebenfalls null', async () => {
    saveRawForTests(AUTOSAVE_ID, JSON.stringify({ format: 'sketchup', version: 1, document: {} }))
    expect(await loadAutosave()).toBeNull()

    saveRawForTests(AUTOSAVE_ID, JSON.stringify({ format: OSK_FORMAT, version: 99, document: {} }))
    expect(await loadAutosave()).toBeNull()
  })

  it('ein leeres Autosave liefert null', async () => {
    expect(await loadAutosave()).toBeNull()
    saveRawForTests(AUTOSAVE_ID, '')
    expect(await loadAutosave()).toBeNull()
  })

  it('ein lueckenhaftes Autosave laedt so weit wie moeglich', async () => {
    saveRawForTests(
      AUTOSAVE_ID,
      JSON.stringify({ format: OSK_FORMAT, version: OSK_VERSION, document: { meta: { name: 'Reste' } } }),
    )

    const doc = await loadAutosave()
    expect(doc).not.toBeNull()
    expect(doc?.meta.name).toBe('Reste')
    expect(doc && doc.definitions[doc.rootId]).toBeDefined()
  })
})
