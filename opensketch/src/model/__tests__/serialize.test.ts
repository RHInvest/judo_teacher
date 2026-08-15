/**
 * Serialisierung: Round-Trip des nativen .osk-Formats, Robustheit gegen
 * kaputte Dateien und Persistenz-Slots.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { SketchDocument } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { M } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import {
  OSK_FORMAT,
  OSK_VERSION,
  deserializeDocument,
  documentFromRaw,
  normalizeGeometry,
  repairGeometryReferences,
  serializeDocument,
} from '../serialize'
import { AUTOSAVE_ID, listSlots, loadSlot, resetPersistenceForTests, saveSlot, deleteSlot } from '../persistence'
import { saveAutosave, loadAutosave } from '../persistence'
import { documentStats } from '../document'
import { buildBox, buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
  resetPersistenceForTests()
})

/** Baut ein Dokument mit Geometrie, Gruppe, Material, Tag und Szene. */
function buildRichDocument(): SketchDocument {
  const s = useStore.getState()
  s.setDocumentName('Reihenhaus')

  installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 4, y: 6, z: 3 }))
  useStore.getState().selectAll()
  const instanceId = useStore.getState().makeGroup('Baukoerper') as string

  const materialId = useStore.getState().addMaterial({
    name: 'Putz',
    color: '#efeae1',
    opacity: 1,
    textureId: null,
    textureWidth: 1,
    textureHeight: 1,
    roughness: 0.85,
    metalness: 0,
    category: 'Putz',
    colorize: false,
  })
  const tagId = useStore.getState().addTag('Aussenwand')
  useStore.getState().setEntityTag([instanceId], tagId)

  useStore.getState().enterContext(instanceId)
  const inner = useStore.getState().getActiveGeometry()
  useStore.getState().applyMaterial({ faceIds: Object.keys(inner.faces) }, materialId, 'front')
  useStore.getState().exitContext()

  useStore.getState().addEntity({
    id: '',
    type: 'guidePoint',
    name: 'Eckpunkt',
    tagId: null,
    hidden: false,
    locked: false,
    position: { x: 4, y: 6, z: 0 },
  })
  useStore.getState().addScene('Strassenansicht')
  useStore.getState().updateSun({ enabled: true, time: 15 * 60 })

  return useStore.getState().exportDocument()
}

describe('Round-Trip', () => {
  it('serialisiert und liest ein vollstaendiges Dokument verlustfrei', () => {
    const original = buildRichDocument()
    const json = serializeDocument(original)
    const restored = deserializeDocument(json)

    expect(restored.meta.name).toBe('Reihenhaus')
    expect(restored.rootId).toBe(original.rootId)
    expect(documentStats(restored)).toEqual(documentStats(original))
    expect(Object.keys(restored.materials).sort()).toEqual(Object.keys(original.materials).sort())
    expect(Object.keys(restored.tags).sort()).toEqual(Object.keys(original.tags).sort())
    expect(restored.scenes).toHaveLength(original.scenes.length)
    expect(restored.scenes[0].name).toBe('Strassenansicht')
    expect(restored.sun.enabled).toBe(true)
    expect(restored.sun.time).toBe(900)
    expect(restored.units).toEqual(original.units)
    expect(restored.activeStyleId).toBe(original.activeStyleId)
    expect(restored.activeTagId).toBe(original.activeTagId)
  })

  it('haelt Geometrie, Topologie und Transformationen exakt', () => {
    const original = buildRichDocument()
    const restored = deserializeDocument(serializeDocument(original))

    for (const defId of Object.keys(original.definitions)) {
      const before = original.definitions[defId].geometry
      const after = restored.definitions[defId].geometry
      expect(Object.keys(after.vertices).sort()).toEqual(Object.keys(before.vertices).sort())
      expect(Object.keys(after.edges).sort()).toEqual(Object.keys(before.edges).sort())
      expect(Object.keys(after.faces).sort()).toEqual(Object.keys(before.faces).sort())

      for (const vid of Object.keys(before.vertices)) {
        expect(after.vertices[vid].p).toEqual(before.vertices[vid].p)
        expect(after.vertices[vid].edges.slice().sort()).toEqual(before.vertices[vid].edges.slice().sort())
      }
      for (const eid of Object.keys(before.edges)) {
        expect(after.edges[eid].a).toBe(before.edges[eid].a)
        expect(after.edges[eid].b).toBe(before.edges[eid].b)
        expect(after.edges[eid].faces.slice().sort()).toEqual(before.edges[eid].faces.slice().sort())
      }
      for (const fid of Object.keys(before.faces)) {
        expect(after.faces[fid].outer).toEqual(before.faces[fid].outer)
        expect(after.faces[fid].normal).toEqual(before.faces[fid].normal)
        expect(after.faces[fid].frontMaterialId).toBe(before.faces[fid].frontMaterialId)
      }
    }

    for (const id of Object.keys(original.entities)) {
      const before = original.entities[id]
      const after = restored.entities[id]
      expect(after.type).toBe(before.type)
      expect(after.tagId).toBe(before.tagId)
      if (before.type === 'instance' && after.type === 'instance') {
        expect(Array.from(after.transform)).toEqual(Array.from(before.transform))
        expect(after.definitionId).toBe(before.definitionId)
      }
    }
  })

  it('das wiedergeladene Dokument ist im Store sofort benutzbar', () => {
    const json = serializeDocument(buildRichDocument())
    resetStoreForTests('metric')
    useStore.getState().loadDocument(deserializeDocument(json))

    const s = useStore.getState()
    expect(s.ready).toBe(true)
    expect(s.context.definitionId).toBe(s.doc.rootId)
    expect(s.canUndo()).toBe(false)

    // Weiterarbeiten muss ohne Id-Kollision funktionieren
    const change = useStore.getState().addEdge({ x: 30, y: 0, z: 0 }, { x: 31, y: 0, z: 0 })
    expect(change.addedEdges).toHaveLength(1)
    const geom = useStore.getState().getActiveGeometry()
    expect(geom.edges[change.addedEdges[0]]).toBeDefined()
    expect(change.addedVertices.every((id) => geom.vertices[id])).toBe(true)
  })

  it('schreibt Format und Version in die Datei', () => {
    const raw = JSON.parse(serializeDocument(useStore.getState().exportDocument())) as Record<string, unknown>
    expect(raw.format).toBe(OSK_FORMAT)
    expect(raw.version).toBe(OSK_VERSION)
    expect(typeof raw.savedAt).toBe('string')
  })

  it('pretty erzeugt eingerueckte, aber inhaltsgleiche Ausgabe', () => {
    const doc = useStore.getState().exportDocument()
    const compact = serializeDocument(doc)
    const pretty = serializeDocument(doc, { pretty: true })
    expect(pretty.length).toBeGreaterThan(compact.length)
    expect(pretty).toContain('\n')
    expect(deserializeDocument(pretty).rootId).toBe(deserializeDocument(compact).rootId)
  })
})

describe('Robustheit beim Lesen', () => {
  it('weist ungueltiges JSON und fremde Formate ab', () => {
    expect(() => deserializeDocument('kein json')).toThrow(/JSON/)
    expect(() => documentFromRaw({ format: 'sketchup', document: {} })).toThrow(/Dateiformat/)
    expect(() => documentFromRaw(null)).toThrow(/Dokument/)
  })

  it('weist eine zu neue Version ab', () => {
    expect(() => documentFromRaw({ format: OSK_FORMAT, version: OSK_VERSION + 5, document: {} })).toThrow(
      /neueren Version/,
    )
  })

  it('ergaenzt fehlende Felder mit Standardwerten', () => {
    const doc = documentFromRaw({ format: OSK_FORMAT, version: OSK_VERSION, document: {} })
    expect(doc.rootId).toBeTruthy()
    expect(doc.definitions[doc.rootId].kind).toBe('model')
    expect(Object.keys(doc.tags).length).toBeGreaterThan(0)
    expect(doc.styles[doc.activeStyleId]).toBeDefined()
    expect(doc.units.lengthUnit).toBeTruthy()
  })

  it('entfernt Kindverweise auf verschwundene Objekte', () => {
    const doc = useStore.getState().exportDocument()
    doc.definitions[doc.rootId].children = ['gibtesnicht']
    const restored = documentFromRaw({ format: OSK_FORMAT, version: OSK_VERSION, document: doc })
    expect(restored.definitions[restored.rootId].children).toHaveLength(0)
  })

  it('normalizeGeometry und repairGeometryReferences saeubern kaputte Topologie', () => {
    const built = buildQuad()
    const broken = JSON.parse(JSON.stringify(built.geometry)) as Record<string, unknown>
    const geom = normalizeGeometry(broken)
    expect(Object.keys(geom.faces)).toHaveLength(1)

    // Eine Kante herausreissen und reparieren lassen
    const edgeId = built.edgeIds[0]
    delete geom.edges[edgeId]
    repairGeometryReferences(geom)

    for (const vid of Object.keys(geom.vertices)) {
      expect(geom.vertices[vid].edges.every((id) => geom.edges[id])).toBe(true)
    }
    for (const eid of Object.keys(geom.edges)) {
      expect(geom.vertices[geom.edges[eid].a]).toBeDefined()
      expect(geom.edges[eid].faces.every((id) => geom.faces[id])).toBe(true)
    }
    // Die Flaeche mit der fehlenden Kante darf nicht mehr dastehen
    expect(Object.keys(geom.faces)).toHaveLength(0)
  })

  it('normalizeGeometry vertraegt voelligen Unsinn', () => {
    const geom = normalizeGeometry({ vertices: 42, edges: null, faces: 'x' })
    expect(Object.keys(geom.vertices)).toHaveLength(0)
    expect(Object.keys(geom.edges)).toHaveLength(0)
    expect(Object.keys(geom.faces)).toHaveLength(0)
  })
})

describe('Persistenz', () => {
  it('speichert und laedt einen benannten Slot (Speicher-Fallback ohne IndexedDB)', async () => {
    const doc = buildRichDocument()
    await saveSlot('haus-1', doc)

    const slots = await listSlots()
    expect(slots.map((s) => s.id)).toContain('haus-1')
    expect(slots.find((s) => s.id === 'haus-1')?.name).toBe('Reihenhaus')

    const loaded = await loadSlot('haus-1')
    expect(loaded).not.toBeNull()
    expect(loaded?.meta.name).toBe('Reihenhaus')
    expect(documentStats(loaded as SketchDocument)).toEqual(documentStats(doc))

    await deleteSlot('haus-1')
    expect((await listSlots()).map((s) => s.id)).not.toContain('haus-1')
    expect(await loadSlot('haus-1')).toBeNull()
  })

  it('Autosave schreibt in einen eigenen Slot, der nicht in der Liste auftaucht', async () => {
    const doc = useStore.getState().exportDocument()
    await saveAutosave(doc)

    const restored = await loadAutosave()
    expect(restored?.rootId).toBe(doc.rootId)
    expect((await listSlots()).map((s) => s.id)).not.toContain(AUTOSAVE_ID)
    expect((await listSlots({ includeAutosave: true })).map((s) => s.id)).toContain(AUTOSAVE_ID)
  })

  it('ein fehlender Slot liefert null statt zu werfen', async () => {
    expect(await loadSlot('gibtesnicht')).toBeNull()
    await expect(deleteSlot('gibtesnicht')).resolves.toBeUndefined()
  })

  it('derselbe Name ueberschreibt den bestehenden Slot', async () => {
    const first = useStore.getState().exportDocument()
    await saveSlot('einziger', first)
    useStore.getState().setDocumentName('Zweiter Stand')
    await saveSlot('einziger', useStore.getState().exportDocument())

    const slots = await listSlots()
    expect(slots.filter((s) => s.id === 'einziger')).toHaveLength(1)
    expect((await loadSlot('einziger'))?.meta.name).toBe('Zweiter Stand')
  })
})

describe('Dokumentstatistik', () => {
  it('zaehlt Primitive, Instanzen und Definitionen', () => {
    installGeometry(buildBox())
    useStore.getState().selectAll()
    useStore.getState().makeGroup('Gezaehlt')

    const stats = documentStats(useStore.getState().doc)
    expect(stats.definitions).toBe(2)
    expect(stats.groups).toBe(1)
    expect(stats.instances).toBe(1)
    expect(stats.faces).toBe(6)
    expect(stats.edges).toBe(12)
    expect(stats.vertices).toBe(8)
  })

  it('exportDocument bleibt strukturell klonbar', () => {
    buildRichDocument()
    const doc = useStore.getState().exportDocument()
    const cloned = structuredClone(doc)
    expect(documentStats(cloned)).toEqual(documentStats(doc))
    expect(JSON.parse(serializeDocument(cloned)).document.rootId).toBe(doc.rootId)
  })

  it('Instanztransformationen ueberleben den Round-Trip exakt', () => {
    installGeometry(buildQuad())
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Gedreht') as string
    useStore.getState().transformEntities(
      [instanceId],
      M.multiply(M.translation({ x: 1.5, y: -2.25, z: 0.125 }), M.rotation({ x: 0, y: 0, z: 1 }, Math.PI / 4)),
      false,
    )
    useStore.getState().setSelection(emptySelection())

    const doc = useStore.getState().exportDocument()
    const restored = deserializeDocument(serializeDocument(doc))
    const before = doc.entities[instanceId]
    const after = restored.entities[instanceId]
    if (before.type !== 'instance' || after.type !== 'instance') throw new Error('Instanz erwartet')
    for (let i = 0; i < 16; i++) expect(after.transform[i]).toBeCloseTo(before.transform[i], 9)
  })
})
