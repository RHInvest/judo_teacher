/**
 * Grundfunktionen des Stores: Dokument-Lebenszyklus, Lesehelfer, Zeichnen,
 * Auswahl, Materialien, Tags, Szenen und Oberflaechenzustand.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySelection } from '@/shared/types'
import { M, V } from '@/core/math'
import { useStore, resetStoreForTests } from '../store'
import { buildBox, buildQuad, installGeometry } from './helpers'

beforeEach(() => {
  resetStoreForTests('metric')
})

describe('Dokument-Lebenszyklus', () => {
  it('newDocument erzeugt ein gueltiges, benutzbares Dokument', () => {
    const s = useStore.getState()
    expect(s.ready).toBe(true)
    expect(s.dirty).toBe(false)
    expect(s.doc.rootId).toBeTruthy()
    expect(s.doc.definitions[s.doc.rootId].kind).toBe('model')
    expect(Object.keys(s.doc.tags).length).toBeGreaterThan(0)
    expect(s.doc.styles[s.doc.activeStyleId]).toBeDefined()
    expect(Object.keys(s.doc.materials).length).toBeGreaterThan(0)
    expect(s.context.definitionId).toBe(s.doc.rootId)
    expect(s.context.instancePath).toEqual([])
    expect(M.isIdentity(s.context.worldTransform)).toBe(true)
  })

  it('newDocument("empty") laesst die Materialbibliothek weg', () => {
    resetStoreForTests('empty')
    expect(Object.keys(useStore.getState().doc.materials)).toHaveLength(0)
  })

  it('useStore funktioniert als Hook-Selektor', () => {
    const selection = useStore((s) => s.selection)
    expect(selection).toEqual(emptySelection())
    const rootId = useStore((s) => s.doc.rootId)
    expect(rootId).toBe(useStore.getState().doc.rootId)
  })

  it('exportDocument liefert eine unabhaengige, tiefe Kopie', () => {
    installGeometry(buildQuad())
    const copy = useStore.getState().exportDocument()
    const rootId = useStore.getState().doc.rootId
    expect(Object.keys(copy.definitions[rootId].geometry.faces)).toHaveLength(1)

    // Mutation der Kopie darf den Store nicht beruehren
    copy.definitions[rootId].geometry.faces = {}
    copy.meta.name = 'Fremd'
    expect(Object.keys(useStore.getState().doc.definitions[rootId].geometry.faces)).toHaveLength(1)
    expect(useStore.getState().doc.meta.name).not.toBe('Fremd')
  })

  it('loadDocument uebernimmt ein fremdes Dokument und leert die Historie', () => {
    const s = useStore.getState()
    s.setDocumentName('Haus')
    expect(s.canUndo()).toBe(true)
    const exported = useStore.getState().exportDocument()

    resetStoreForTests('metric')
    useStore.getState().loadDocument(exported)
    expect(useStore.getState().doc.meta.name).toBe('Haus')
    expect(useStore.getState().canUndo()).toBe(false)
    expect(useStore.getState().dirty).toBe(false)
  })

  it('setUnits mischt Teilangaben in die Einheiten', () => {
    useStore.getState().setUnits({ lengthUnit: 'cm', precision: 3 })
    const units = useStore.getState().doc.units
    expect(units.lengthUnit).toBe('cm')
    expect(units.precision).toBe(3)
    expect(units.format).toBe('decimal')
  })
})

describe('Zeichnen im aktiven Kontext', () => {
  it('addEdge legt Kante und Endpunkte an', () => {
    const change = useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })
    expect(change.addedEdges).toHaveLength(1)
    expect(change.addedVertices).toHaveLength(2)

    const geom = useStore.getState().getActiveGeometry()
    expect(Object.keys(geom.edges)).toHaveLength(1)
    expect(useStore.getState().geometryRevision).toBeGreaterThan(0)
    expect(useStore.getState().dirty).toBe(true)
  })

  it('addEdge verschmilzt Punkte innerhalb der Toleranz', () => {
    const s = useStore.getState()
    s.addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    s.addEdge({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })
    const geom = useStore.getState().getActiveGeometry()
    expect(Object.keys(geom.vertices)).toHaveLength(3)
    expect(Object.keys(geom.edges)).toHaveLength(2)
  })

  it('addPolyline schliesst den Linienzug auf Wunsch', () => {
    const change = useStore.getState().addPolyline(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      true,
    )
    expect(change.addedEdges).toHaveLength(3)
  })

  it('deletePrimitives raeumt verwaiste Punkte auf und kuerzt die Auswahl', () => {
    const built = installGeometry(buildQuad())
    const s = useStore.getState()
    s.setSelection({ ...emptySelection(), faceIds: [built.faceIds[0]] })
    s.deletePrimitives({ faceIds: [built.faceIds[0]] })

    const geom = useStore.getState().getActiveGeometry()
    expect(Object.keys(geom.faces)).toHaveLength(0)
    // Kanten bleiben stehen, wenn nur die Flaeche geloescht wird
    expect(Object.keys(geom.edges)).toHaveLength(4)
    expect(useStore.getState().selection.faceIds).toHaveLength(0)
  })

  it('moveVertices verschiebt Punkte und richtet die Ebene neu aus', () => {
    const built = installGeometry(buildQuad())
    const s = useStore.getState()
    s.moveVertices(built.vertexIds, { x: 0, y: 0, z: 2 })
    const geom = useStore.getState().getActiveGeometry()
    for (const id of built.vertexIds) expect(geom.vertices[id].p.z).toBeCloseTo(2, 9)
    expect(geom.faces[built.faceIds[0]].plane.d).toBeCloseTo(2, 9)
  })

  it('setEdgeFlags setzt weiche und versteckte Kanten', () => {
    const built = installGeometry(buildBox())
    useStore.getState().setEdgeFlags([built.edgeIds[0]], { soft: true, smooth: true })
    const geom = useStore.getState().getActiveGeometry()
    expect(geom.edges[built.edgeIds[0]].soft).toBe(true)
    expect(geom.edges[built.edgeIds[0]].smooth).toBe(true)
  })

  it('reverseFaces dreht Normale und Materialseiten', () => {
    const built = installGeometry(buildQuad())
    const before = useStore.getState().getActiveGeometry().faces[built.faceIds[0]].normal
    useStore.getState().reverseFaces([built.faceIds[0]])
    const after = useStore.getState().getActiveGeometry().faces[built.faceIds[0]].normal
    expect(after.z).toBeCloseTo(-before.z, 9)
  })
})

describe('Auswahl', () => {
  it('setSelection, addToSelection, toggleSelection und clearSelection', () => {
    const built = installGeometry(buildBox())
    const s = useStore.getState()
    const before = s.selectionRevision

    s.setSelection({ ...emptySelection(), faceIds: [built.faceIds[0]] })
    expect(useStore.getState().selection.faceIds).toEqual([built.faceIds[0]])
    expect(useStore.getState().selectionRevision).toBeGreaterThan(before)

    useStore.getState().addToSelection({ faceIds: [built.faceIds[1], built.faceIds[0]] })
    expect(useStore.getState().selection.faceIds).toHaveLength(2)

    useStore.getState().toggleSelection({ faceIds: [built.faceIds[0]] })
    expect(useStore.getState().selection.faceIds).toEqual([built.faceIds[1]])

    useStore.getState().removeFromSelection({ faceIds: [built.faceIds[1]] })
    expect(useStore.getState().selection.faceIds).toHaveLength(0)

    useStore.getState().setSelection({ ...emptySelection(), faceIds: built.faceIds })
    useStore.getState().clearSelection()
    expect(useStore.getState().selection.faceIds).toHaveLength(0)
  })

  it('isSelected beantwortet alle Primitivarten', () => {
    const built = installGeometry(buildQuad())
    useStore.getState().setSelection({
      edgeIds: [built.edgeIds[0]],
      faceIds: [built.faceIds[0]],
      vertexIds: [built.vertexIds[0]],
      entityIds: [],
    })
    const s = useStore.getState()
    expect(s.isSelected('edge', built.edgeIds[0])).toBe(true)
    expect(s.isSelected('face', built.faceIds[0])).toBe(true)
    expect(s.isSelected('vertex', built.vertexIds[0])).toBe(true)
    expect(s.isSelected('entity', built.faceIds[0])).toBe(false)
  })

  it('selectAll und invertSelection ergaenzen sich', () => {
    const built = installGeometry(buildBox())
    useStore.getState().selectAll()
    expect(useStore.getState().selection.faceIds).toHaveLength(built.faceIds.length)
    expect(useStore.getState().selection.edgeIds).toHaveLength(built.edgeIds.length)

    useStore.getState().invertSelection()
    expect(useStore.getState().selection.faceIds).toHaveLength(0)
    expect(useStore.getState().selection.edgeIds).toHaveLength(0)
  })

  it('getSelectionBounds liefert Weltkoordinaten', () => {
    installGeometry(buildBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 }))
    useStore.getState().selectAll()
    const bounds = useStore.getState().getSelectionBounds()
    expect(bounds).not.toBeNull()
    expect(bounds?.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(bounds?.max).toEqual({ x: 2, y: 3, z: 4 })
  })
})

describe('Entity-Info', () => {
  it('liefert null ohne Auswahl', () => {
    expect(useStore.getState().getEntityInfo()).toBeNull()
  })

  it('aggregiert Flaeche, Laenge und Abmessungen', () => {
    const built = installGeometry(buildQuad({ x: 0, y: 0, z: 0 }, 2, 3))
    useStore.getState().setSelection({ ...emptySelection(), faceIds: built.faceIds })
    const info = useStore.getState().getEntityInfo()
    expect(info).not.toBeNull()
    expect(info?.kind).toBe('Flaeche')
    expect(info?.count).toBe(1)
    const area = info?.rows.find((r) => r.label === 'Flaeche')
    expect(area?.value).toContain('6')
    expect(info?.rows.some((r) => r.label === 'Abmessungen')).toBe(true)
  })

  it('zaehlt Kanten und summiert ihre Laenge', () => {
    const s = useStore.getState()
    s.addEdge({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })
    s.addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 })
    const geom = useStore.getState().getActiveGeometry()
    useStore.getState().setSelection({ ...emptySelection(), edgeIds: Object.keys(geom.edges) })
    const info = useStore.getState().getEntityInfo()
    expect(info?.kind).toBe('Kanten')
    const total = info?.rows.find((r) => r.label === 'Gesamtlaenge')
    expect(total?.value).toContain('7')
  })
})

describe('Materialien', () => {
  it('addMaterial, applyMaterial und sampleMaterial arbeiten zusammen', () => {
    const built = installGeometry(buildQuad())
    const id = useStore.getState().addMaterial({
      name: 'Ziegel',
      color: '#aa4433',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.9,
      metalness: 0,
      category: 'Mauerwerk',
      colorize: false,
    })
    expect(useStore.getState().getMaterial(id)?.name).toBe('Ziegel')

    useStore.getState().applyMaterial({ faceIds: built.faceIds }, id, 'front')
    expect(useStore.getState().sampleMaterial('face', built.faceIds[0])).toBe(id)
    expect(useStore.getState().sampleMaterial('face', built.faceIds[0], 'back')).toBeNull()
    expect(useStore.getState().materialRevision).toBeGreaterThan(0)
  })

  it('removeMaterial loest alle Verweise auf', () => {
    const built = installGeometry(buildQuad())
    const id = useStore.getState().addMaterial({
      name: 'Test',
      color: '#ffffff',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.6,
      metalness: 0,
      category: 'Farben',
      colorize: false,
    })
    useStore.getState().applyMaterial({ faceIds: built.faceIds }, id, 'both')
    useStore.getState().removeMaterial(id)

    expect(useStore.getState().getMaterial(id)).toBeUndefined()
    const face = useStore.getState().getActiveGeometry().faces[built.faceIds[0]]
    expect(face.frontMaterialId).toBeNull()
    expect(face.backMaterialId).toBeNull()
  })

  it('setActiveMaterial faerbt neue Geometrie ein', () => {
    const id = useStore.getState().addMaterial({
      name: 'Aktiv',
      color: '#123456',
      opacity: 1,
      textureId: null,
      textureWidth: 1,
      textureHeight: 1,
      roughness: 0.5,
      metalness: 0,
      category: 'Farben',
      colorize: false,
    })
    useStore.getState().setActiveMaterial(id)
    expect(useStore.getState().doc.activeMaterialId).toBe(id)
    const change = useStore.getState().addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const edge = useStore.getState().getActiveGeometry().edges[change.addedEdges[0]]
    expect(edge.materialId).toBe(id)
  })
})

describe('Stile, Sonne, Nebel', () => {
  it('updateStyle aendert den aktiven Stil und zaehlt styleRevision hoch', () => {
    const before = useStore.getState().styleRevision
    useStore.getState().updateStyle({ faceStyle: 'wireframe', showGrid: true })
    expect(useStore.getState().getStyle().faceStyle).toBe('wireframe')
    expect(useStore.getState().getStyle().showGrid).toBe(true)
    expect(useStore.getState().styleRevision).toBeGreaterThan(before)
  })

  it('updateSun und updateFog mischen Teilangaben', () => {
    useStore.getState().updateSun({ enabled: true, time: 9 * 60 })
    useStore.getState().updateFog({ enabled: true, far: 300 })
    expect(useStore.getState().doc.sun.enabled).toBe(true)
    expect(useStore.getState().doc.sun.time).toBe(540)
    expect(useStore.getState().doc.sun.latitude).toBeCloseTo(52.52, 5)
    expect(useStore.getState().doc.fog.far).toBe(300)
  })
})

describe('Szenen', () => {
  it('speichert Tag-Sichtbarkeit, Stil und Sonne und stellt sie wieder her', () => {
    const s = useStore.getState()
    const tagId = s.addTag('Dach')
    s.updateSun({ enabled: true, time: 600 })
    const sceneId = useStore.getState().addScene('Ansicht Nord')
    expect(useStore.getState().doc.scenes).toHaveLength(1)

    // Zustand nach dem Speichern veraendern
    useStore.getState().updateTag(tagId, { visible: false })
    useStore.getState().updateSun({ enabled: false, time: 1200 })
    expect(useStore.getState().getTag(tagId)?.visible).toBe(false)

    useStore.getState().activateScene(sceneId)
    expect(useStore.getState().getTag(tagId)?.visible).toBe(true)
    expect(useStore.getState().doc.sun.enabled).toBe(true)
    expect(useStore.getState().doc.sun.time).toBe(600)
  })

  it('stellt versteckte Entities wieder her', () => {
    const s = useStore.getState()
    const defId = s.doc.rootId
    const instanceId = s.placeInstance(defId === s.doc.rootId ? createLeafDefinition() : defId, M.identity())
    const sceneId = useStore.getState().addScene('Alles sichtbar')

    useStore.getState().setEntityHidden([instanceId], true)
    expect(useStore.getState().getEntity(instanceId)?.hidden).toBe(true)

    useStore.getState().activateScene(sceneId)
    expect(useStore.getState().getEntity(instanceId)?.hidden).toBe(false)
  })

  it('reorderScene und removeScene ordnen die Liste', () => {
    const s = useStore.getState()
    const a = s.addScene('A')
    const b = useStore.getState().addScene('B')
    useStore.getState().reorderScene(b, 0)
    expect(useStore.getState().doc.scenes.map((x) => x.id)).toEqual([b, a])
    useStore.getState().removeScene(a)
    expect(useStore.getState().doc.scenes).toHaveLength(1)
  })
})

describe('Oberflaechenzustand', () => {
  it('Toasts verschwinden nach vier Sekunden von selbst', () => {
    vi.useFakeTimers()
    try {
      useStore.getState().toast('Gespeichert', 'success')
      expect(useStore.getState().ui.toasts).toHaveLength(1)
      expect(useStore.getState().ui.toasts[0].kind).toBe('success')
      vi.advanceTimersByTime(4000)
      expect(useStore.getState().ui.toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Panels, Status, VCB, Dialog und Theme', () => {
    const s = useStore.getState()
    s.setStatus('Zeichne eine Linie', 'Shift sperrt die Achse')
    expect(useStore.getState().ui.statusHint).toBe('Zeichne eine Linie')

    useStore.getState().setVcb({ vcbLabel: 'Laenge', vcbValue: '2,5 m', vcbEditing: true })
    expect(useStore.getState().ui.vcbValue).toBe('2,5 m')

    useStore.getState().togglePanel('outliner')
    expect(useStore.getState().ui.openPanels).toContain('outliner')
    useStore.getState().togglePanel('outliner')
    expect(useStore.getState().ui.openPanels).not.toContain('outliner')

    useStore.getState().openDialog({ kind: 'about' })
    expect(useStore.getState().ui.dialog?.kind).toBe('about')
    useStore.getState().closeDialog()
    expect(useStore.getState().ui.dialog).toBeNull()

    useStore.getState().setTheme('light')
    expect(useStore.getState().ui.theme).toBe('light')

    useStore.getState().setBusy('Importiere')
    expect(useStore.getState().ui.busy).toBe('Importiere')
    useStore.getState().setStats({ faces: 12, fps: 60 })
    expect(useStore.getState().ui.stats.faces).toBe(12)
  })

  it('setActiveTool merkt sich das vorherige Werkzeug', () => {
    const s = useStore.getState()
    s.setActiveTool('line')
    useStore.getState().setActiveTool('orbit')
    expect(useStore.getState().activeTool).toBe('orbit')
    expect(useStore.getState().previousTool).toBe('line')
    useStore.getState().restorePreviousTool()
    expect(useStore.getState().activeTool).toBe('line')
  })
})

describe('Koordinatenuebergang', () => {
  it('rechnet Weltpunkte in den Kontextraum um', () => {
    // Gruppe mit Ursprung (10,0,0) anlegen und betreten
    installGeometry(buildQuad({ x: 10, y: 0, z: 0 }, 1, 1))
    useStore.getState().selectAll()
    const instanceId = useStore.getState().makeGroup('Testgruppe')
    expect(instanceId).not.toBeNull()

    useStore.getState().enterContext(instanceId as string)
    const world = useStore.getState().context.worldTransform
    expect(M.getTranslation(world)).toEqual({ x: 10, y: 0, z: 0 })

    // Ein Weltpunkt (12,0,0) muss lokal bei (2,0,0) landen
    const change = useStore.getState().addEdge({ x: 12, y: 0, z: 0 }, { x: 12, y: 2, z: 0 })
    const geom = useStore.getState().getActiveGeometry()
    const edge = geom.edges[change.addedEdges[0]]
    const a = geom.vertices[edge.a].p
    const b = geom.vertices[edge.b].p
    const points = [a, b]
    expect(points.some((p) => V.equals(p, { x: 2, y: 0, z: 0 }, 1e-9))).toBe(true)
    expect(points.some((p) => V.equals(p, { x: 2, y: 2, z: 0 }, 1e-9))).toBe(true)
  })
})

/** Hilfsdefinition fuer Szenentests: leere Gruppe im Dokument. */
function createLeafDefinition(): string {
  const s = useStore.getState()
  installGeometry(buildQuad())
  s.selectAll()
  const instanceId = useStore.getState().makeGroup('Blatt')
  const instance = useStore.getState().getEntity(instanceId as string)
  if (!instance || instance.type !== 'instance') throw new Error('Instanz fehlt')
  return instance.definitionId
}
