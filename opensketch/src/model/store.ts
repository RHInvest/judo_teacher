/**
 * Die zustand-Implementierung von `AppState`.
 *
 * REGELN, die in dieser Datei ueberall gelten:
 *
 * 1. Jede Dokumentaenderung laeuft durch `operation(...)`. Verschachtelte
 *    Operationen sind referenzgezaehlt, es entsteht genau ein Undo-Schritt.
 * 2. Vor jeder Aenderung an einer Definition wird `touchDefinition` gerufen
 *    (Copy-on-Write), damit der Kernel die Geometrie in place mutieren darf,
 *    ohne den Undo-Snapshot zu beschaedigen.
 * 3. `editDoc` ersetzt IMMER das oberste `doc`-Objekt. Daran haengt die
 *    Memoisierung der Bounding-Boxen.
 * 4. **Punkte von Werkzeugen sind WELTKOORDINATEN.** Vor jedem Kernel-Aufruf
 *    werden sie mit der Inversen von `context.worldTransform` in den Raum des
 *    aktiven Kontexts geholt (`toLocalPoint` / `toLocalDir` / `toLocalMatrix`).
 *    Das gilt ausnahmefrei, auch fuer Entities, die ein Werkzeug anlegt
 *    (`toLocalEntityMut`), und fuer die Matrix von `placeInstance`.
 *
 * OWNERSHIP: Model.
 */

import { create } from 'zustand'
import type {
  BBox3Like,
  CameraState,
  Definition,
  Edge,
  EditContext,
  Entity,
  EntityInfoSummary,
  Face,
  FogSettings,
  Geometry,
  Id,
  InstanceEntity,
  Mat4Like,
  Material,
  Scene,
  Selection,
  SketchDocument,
  StyleSettings,
  SunSettings,
  Tag,
  TagFolder,
  Texture,
  ToolId,
  UnitSettings,
  Vec3Like,
  Vertex,
} from '@/shared/types'
import { emptySelection, selectionCount, selectionIsEmpty } from '@/shared/types'
import type { AppState, DialogState, GeometryChange, PanelId, StoreHandle, UiState } from '@/shared/store-api'
import { emptyChange } from '@/shared/store-api'
import { newId } from '@/shared/ids'
import { bus } from '@/shared/events'
import { formatArea, formatLength, formatVolume } from '@/shared/units'
import { B, M, V, degToRad } from '@/core/math'
import * as core from '@/core'
import * as G from './geometry-utils'
import {
  DEFAULT_TAG_NAME,
  cloneDocument,
  cloneEntity,
  createDefaultCamera,
  createDefaultStyle,
  createEmptyDocument,
  createSceneFromDocument,
  defaultTagId,
  definitionBounds,
  definitionContains,
  definitionPathOf,
  entityBounds,
  instanceCount,
  isTagVisible as isTagVisibleIn,
  modelBounds,
  ownerDefinitionOf,
  reachableDefinitionIds,
  syncIdCounter,
  uniqueDefinitionName,
  uniqueTagName,
  worldTransformOf,
} from './document'
import { createDefaultMaterials, normalizeMaterial } from './materials'
import { documentRepairOf } from './serialize'
import {
  History,
  touchDefinition,
  touchEntity,
  touchMap,
  touchMaterial,
  touchScenes,
  touchStyle,
  touchTag,
  touchTagFolder,
  touchTexture,
} from './history'

/* ------------------------------------------------------------------ */
/* Modulzustand ausserhalb des Stores                                  */
/* ------------------------------------------------------------------ */

const history = new History({ limit: 100 })

/** Letzte bekannte Kamera - der Viewport meldet sie ueber den Bus. */
let lastCamera: CameraState = createDefaultCamera()
bus.on('camera:changed', (camera) => {
  lastCamera = camera
})

/** Bereits gemeldete Kernel-Luecken, damit keine Toast-Flut entsteht. */
const reportedGaps = new Set<string>()

function isNotImplemented(err: unknown): boolean {
  return err instanceof Error && /nicht implementiert|not implemented/i.test(err.message)
}

/**
 * Ruft eine Kernel-Funktion auf.
 *  - `fallback` vorhanden: wird benutzt, solange der Kernel die Funktion noch
 *    nicht kennt (das Modell bleibt dadurch waehrend der Parallelentwicklung
 *    benutzbar).
 *  - ohne `fallback`: es gibt genau einen Hinweis-Toast und `null` zurueck.
 * Echte Kernel-Fehler werden immer durchgereicht.
 */
function kernelCall<T>(run: () => T, fallback: (() => T) | null, label: string): T | null {
  try {
    return run()
  } catch (err) {
    if (!isNotImplemented(err)) throw err
    if (fallback) return fallback()
    if (!reportedGaps.has(label)) {
      reportedGaps.add(label)
      queueMicrotask(() => {
        try {
          useStore.getState().toast(`${label} ist noch nicht verfuegbar (Geometriekern in Arbeit)`, 'warn')
        } catch {
          /* Store noch nicht bereit */
        }
      })
    }
    return null
  }
}

function hasChange(change: GeometryChange | null | undefined): boolean {
  if (!change) return false
  return (
    change.addedVertices.length > 0 ||
    change.addedEdges.length > 0 ||
    change.addedFaces.length > 0 ||
    change.removedVertices.length > 0 ||
    change.removedEdges.length > 0 ||
    change.removedFaces.length > 0 ||
    change.modifiedEdges.length > 0 ||
    change.modifiedFaces.length > 0
  )
}

/* ------------------------------------------------------------------ */
/* Reine Helfer                                                        */
/* ------------------------------------------------------------------ */

function uniqueIds(ids: readonly Id[]): Id[] {
  return Array.from(new Set(ids))
}

function normalizeSelection(sel: Partial<Selection>): Selection {
  return {
    edgeIds: uniqueIds(sel.edgeIds ?? []),
    faceIds: uniqueIds(sel.faceIds ?? []),
    vertexIds: uniqueIds(sel.vertexIds ?? []),
    entityIds: uniqueIds(sel.entityIds ?? []),
  }
}

/** Transformiert eine Entity in place (Matrix im Raum der Elterndefinition). */
function transformEntityMut(entity: Entity, m: Mat4Like): void {
  switch (entity.type) {
    case 'instance':
    case 'image':
      entity.transform = M.multiply(m, entity.transform)
      break
    case 'dimension':
      entity.start = M.transformPoint(m, entity.start)
      entity.end = M.transformPoint(m, entity.end)
      entity.offset = M.transformDirection(m, entity.offset)
      if (entity.center) entity.center = M.transformPoint(m, entity.center)
      break
    case 'text':
      entity.anchor = M.transformPoint(m, entity.anchor)
      entity.position = M.transformPoint(m, entity.position)
      break
    case 'sectionPlane': {
      const n = M.transformNormal(m, entity.plane.n)
      const onPlane = M.transformPoint(m, V.mul(entity.plane.n, entity.plane.d))
      entity.plane = { n, d: V.dot(n, onPlane) }
      break
    }
    case 'guidePoint':
      entity.position = M.transformPoint(m, entity.position)
      if (entity.from) entity.from = M.transformPoint(m, entity.from)
      break
    case 'guideLine':
      entity.origin = M.transformPoint(m, entity.origin)
      entity.direction = V.normalizeOr(M.transformDirection(m, entity.direction), entity.direction)
      break
  }
}

function entityPrefix(type: Entity['type']): string {
  switch (type) {
    case 'instance':
      return 'i'
    case 'sectionPlane':
      return 'p'
    case 'guidePoint':
    case 'guideLine':
      return 'g'
    default:
      return 'n'
  }
}

/** Prueft den Editierkontext gegen das Dokument und repariert ihn notfalls. */
function validateContext(doc: SketchDocument, context: EditContext): EditContext {
  const instancePath: Id[] = []
  let definitionId = doc.rootId
  let owner = doc.definitions[doc.rootId]
  let world: Mat4Like = M.identity()

  for (const instanceId of context.instancePath) {
    const entity = doc.entities[instanceId]
    if (!entity || entity.type !== 'instance') break
    if (!owner || !owner.children.includes(instanceId)) break
    const def = doc.definitions[entity.definitionId]
    if (!def) break
    instancePath.push(instanceId)
    definitionId = def.id
    owner = def
    world = M.multiply(world, entity.transform)
  }

  if (
    instancePath.length === context.instancePath.length &&
    definitionId === context.definitionId &&
    context.definitionPath.length === instancePath.length + 1
  ) {
    return context
  }
  return {
    definitionId,
    instancePath,
    definitionPath: definitionPathOf(doc, instancePath),
    worldTransform: world,
  }
}

function commonValue<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined
  const first = values[0]
  return values.every((v) => v === first) ? first : undefined
}

function pluralKind(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/* ------------------------------------------------------------------ */
/* Anfangszustand                                                      */
/* ------------------------------------------------------------------ */

function initialUi(): UiState {
  return {
    openPanels: ['entityInfo', 'materials', 'tags'],
    activePanel: 'entityInfo',
    trayVisible: true,
    theme: 'dark',
    statusHint: 'Bereit',
    statusModifiers: '',
    vcbLabel: 'Masse',
    vcbValue: '',
    vcbEditing: false,
    vcbPlaceholder: '',
    toasts: [],
    dialog: null,
    busy: null,
    stats: { faces: 0, edges: 0, instances: 0, triangles: 0, fps: 0 },
  }
}

function rootContext(doc: SketchDocument): EditContext {
  return {
    definitionId: doc.rootId,
    instancePath: [],
    definitionPath: [doc.rootId],
    worldTransform: M.identity(),
  }
}

/**
 * Entfernt Instanzen, deren Definition fehlt.
 *
 * `normalizeDocument` tut das bereits fuer alles, was aus einer `.osk`-Datei
 * kommt. Diese zweite Runde faengt Dokumente ab, die auf anderem Weg entstehen
 * (Importeure, Tests, Programmcode) - sonst haette der Outliner unsichtbare,
 * anwaehlbare Eintraege, die nichts tun.
 *
 * Ohne Fund wird das Dokument unveraendert durchgereicht.
 */
function withoutOrphanInstances(doc: SketchDocument): { doc: SketchDocument; removed: number } {
  const orphans = Object.keys(doc.entities).filter((id) => {
    const entity = doc.entities[id]
    return entity.type === 'instance' && !doc.definitions[entity.definitionId]
  })
  if (orphans.length === 0) return { doc, removed: 0 }

  const entities = { ...doc.entities }
  for (const id of orphans) delete entities[id]
  const definitions: Record<Id, Definition> = {}
  for (const id of Object.keys(doc.definitions)) {
    const def = doc.definitions[id]
    definitions[id] = { ...def, children: def.children.filter((child) => entities[child] !== undefined) }
  }
  return { doc: { ...doc, entities, definitions }, removed: orphans.length }
}

const initialDocument = createEmptyDocument('metric')

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useStore = create<AppState>()((set, get) => {
  /* ---------------- Transaktions-Infrastruktur ---------------- */

  const snapshot = () => {
    const s = get()
    return { doc: s.doc, context: s.context, selection: s.selection }
  }

  /**
   * Fuehrt eine Dokumentaenderung aus. Das oberste `doc`-Objekt wird immer
   * ersetzt; alles Unveraenderte darin bleibt geteilt (Structural Sharing).
   */
  function editDoc<T>(fn: (doc: SketchDocument) => T): T {
    const doc: SketchDocument = { ...get().doc }
    const result = fn(doc)
    set({ doc, dirty: true })
    return result
  }

  /** Privatisiert die Definition des aktiven Kontexts und markiert Geometrie. */
  function touchActive(doc: SketchDocument): Definition | undefined {
    const defId = get().context.definitionId
    const def = touchDefinition(doc, defId, history.touch)
    if (def) history.marks.definitions.add(defId)
    return def
  }

  function markGeometry(definitionId?: Id): void {
    history.marks.geometry = true
    history.marks.document = true
    if (definitionId) history.marks.definitions.add(definitionId)
  }

  /**
   * Meldet dem Kern, dass eine Geometrie AM KERNEL VORBEI veraendert wurde.
   *
   * `@/core` cached die Triangulierung pro Flaechen-Id und einen BVH pro
   * `Geometry`-Objekt und verwirft beides nach seinen eigenen Operationen.
   * Alles, was der Store selbst in `def.geometry` schreibt (Kantenflags,
   * Materialien, Tags, Sichtbarkeit, UVs, ganze Geometrien), muss die Caches
   * hier von Hand verwerfen - sonst zeigt der Renderer alte Dreiecke und das
   * Picking trifft daneben.
   */
  function invalidateCaches(geometry: Geometry, faceIds?: Iterable<Id>): void {
    G.invalidateGeometryCaches(geometry, faceIds)
  }

  function markScene(): void {
    history.marks.scene = true
    history.marks.document = true
  }

  function markMaterial(): void {
    history.marks.material = true
    history.marks.document = true
  }

  function markStyle(): void {
    history.marks.style = true
    history.marks.document = true
  }

  /* ---------------- Koordinatenwechsel Welt -> Kontext ---------------- */

  function inverseWorld(): Mat4Like {
    return M.invert(get().context.worldTransform)
  }

  const toLocalPoint = (p: Vec3Like): Vec3Like => M.transformPoint(inverseWorld(), p)
  const toLocalDir = (d: Vec3Like): Vec3Like => M.transformDirection(inverseWorld(), d)

  /** Weltmatrix -> aequivalente Matrix im Raum des aktiven Kontexts. */
  function toLocalMatrix(world: Mat4Like): Mat4Like {
    const w = get().context.worldTransform
    return M.chain(M.invert(w), world, w)
  }

  /**
   * Holt ALLE Punktfelder einer Entity aus der Welt in den aktiven Kontext -
   * Bemassungspunkte, Textanker, Schnittebene (Punkt und Normale),
   * Hilfsobjekte, Bild- und Instanzmatrizen.
   *
   * `transformEntityMut` behandelt jede Entity-Art bereits richtig, inklusive
   * der Normalenmatrix fuer `sectionPlane`; hier wird sie nur mit der Inversen
   * der Weltmatrix gefuettert. An der Modellwurzel ist das die Einheitsmatrix
   * und der Aufruf kostet nichts.
   */
  function toLocalEntityMut(entity: Entity): void {
    const world = get().context.worldTransform
    if (M.isIdentity(world)) return
    transformEntityMut(entity, M.invert(world))
  }

  /* ---------------- Auswahl ---------------- */

  function applySelection(sel: Selection): void {
    set({ selection: sel, selectionRevision: get().selectionRevision + 1 })
    bus.emit('selection:changed')
    bus.emit('render:request')
  }

  /** Entfernt Ids aus der Auswahl, die es im aktuellen Kontext nicht mehr gibt. */
  function pruneSelection(doc: SketchDocument, sel: Selection, definitionId: Id): Selection {
    const geom = doc.definitions[definitionId]?.geometry
    if (!geom) return emptySelection()
    return {
      edgeIds: sel.edgeIds.filter((id) => geom.edges[id]),
      faceIds: sel.faceIds.filter((id) => geom.faces[id]),
      vertexIds: sel.vertexIds.filter((id) => geom.vertices[id]),
      entityIds: sel.entityIds.filter((id) => doc.entities[id]),
    }
  }

  /* ---------------- Bus-Signale nach einer Operation ---------------- */

  function emitMarks(marks: {
    definitions: Set<Id>
    geometry: boolean
    scene: boolean
    material: boolean
    style: boolean
    selection: boolean
  }): void {
    if (marks.geometry) {
      if (marks.definitions.size === 0) {
        bus.emit('geometry:changed', { definitionId: get().context.definitionId, full: true })
      } else {
        for (const definitionId of marks.definitions) bus.emit('geometry:changed', { definitionId, full: true })
      }
    }
    if (marks.scene) bus.emit('scene:changed')
    if (marks.material) bus.emit('material:changed', {})
    if (marks.style) bus.emit('style:changed')
    // Auswahl kann sich INNERHALB einer Operation aendern (z.B. weil Loeschen
    // verschwundene Ids aus ihr entfernt) - ohne dieses Signal bliebe die
    // Hervorhebung im Viewport stehen.
    if (marks.selection) bus.emit('selection:changed')
    bus.emit('render:request')
  }

  function applyRevisions(marks: {
    geometry: boolean
    scene: boolean
    material: boolean
    style: boolean
    selection: boolean
  }): void {
    const s = get()
    const patch: Partial<AppState> = {}
    if (marks.geometry) patch.geometryRevision = s.geometryRevision + 1
    if (marks.scene) patch.sceneRevision = s.sceneRevision + 1
    if (marks.material) patch.materialRevision = s.materialRevision + 1
    if (marks.style) patch.styleRevision = s.styleRevision + 1
    if (marks.selection) patch.selectionRevision = s.selectionRevision + 1
    if (Object.keys(patch).length > 0) set(patch)
  }

  /** Setzt Dokument + Kontext + Auswahl frisch (neu, laden, undo, redo). */
  function installDocument(doc: SketchDocument, context: EditContext, selection: Selection): void {
    // Undo/Redo/Laden tauscht ganze Geometrieobjekte aus, die dieselben
    // Flaechen-Ids tragen wie der bisherige Stand. Der Flaechen-Cache des Kerns
    // ist nach Id geschluesselt und wird deshalb komplett verworfen.
    core.invalidateCaches()
    set({
      doc,
      context: validateContext(doc, context),
      selection,
      selectionRevision: get().selectionRevision + 1,
    })
    bus.emit('selection:changed')
  }

  /* ---------------- Entities ---------------- */

  function addEntityTo(doc: SketchDocument, definitionId: Id, entity: Entity): void {
    touchMap(doc, 'entities', history.touch)
    doc.entities[entity.id] = entity
    const def = touchDefinition(doc, definitionId, history.touch)
    if (def && !def.children.includes(entity.id)) def.children.push(entity.id)
    if (entity.type === 'instance') {
      const target = touchDefinition(doc, entity.definitionId, history.touch)
      if (target) target.instanceCount = instanceCount(doc, entity.definitionId)
    }
  }

  /** Entfernt eine Definition samt der ihr gehoerenden Entities. */
  function purgeDefinition(doc: SketchDocument, definitionId: Id): void {
    const def = doc.definitions[definitionId]
    if (!def || definitionId === doc.rootId) return
    touchMap(doc, 'definitions', history.touch)
    touchMap(doc, 'entities', history.touch)
    for (const childId of def.children.slice()) {
      const child = doc.entities[childId]
      if (!child) continue
      delete doc.entities[childId]
      if (child.type === 'instance') {
        const nested = doc.definitions[child.definitionId]
        if (nested && nested.kind === 'group' && instanceCount(doc, child.definitionId) === 0) {
          purgeDefinition(doc, child.definitionId)
        }
      }
    }
    delete doc.definitions[definitionId]
  }

  function removeEntityFrom(doc: SketchDocument, entityId: Id): void {
    const entity = doc.entities[entityId]
    if (!entity) return
    const owner = ownerDefinitionOf(doc, entityId)
    if (owner) {
      const def = touchDefinition(doc, owner.id, history.touch)
      if (def) def.children = def.children.filter((id) => id !== entityId)
    }
    touchMap(doc, 'entities', history.touch)
    delete doc.entities[entityId]
    if (entity.type === 'instance') {
      const target = doc.definitions[entity.definitionId]
      if (target) {
        const count = instanceCount(doc, entity.definitionId)
        if (target.kind === 'group' && count === 0) {
          purgeDefinition(doc, entity.definitionId)
        } else {
          const touched = touchDefinition(doc, entity.definitionId, history.touch)
          if (touched) touched.instanceCount = count
        }
      }
    }
  }

  /**
   * Transformiert Entities innerhalb EINES `doc`-Objekts.
   *
   * Bewusst kein `get().transformEntities(...)`: das wuerde ein zweites,
   * verschachteltes `editDoc` oeffnen, das seine Kopie von `get().doc` zieht -
   * die aeussere Operation wuerde die Aenderung beim Zurueckschreiben wieder
   * verwerfen. `matrix` liegt bereits im Raum der besitzenden Definition.
   */
  function transformEntitiesIn(doc: SketchDocument, ids: readonly Id[], matrix: Mat4Like, copy: boolean): Id[] {
    const contextId = get().context.definitionId
    const out: Id[] = []
    for (const id of ids) {
      const source = doc.entities[id]
      if (!source) continue
      if (copy) {
        const clone = cloneEntity(source)
        clone.id = newId(entityPrefix(source.type))
        transformEntityMut(clone, matrix)
        const owner = ownerDefinitionOf(doc, id)
        addEntityTo(doc, owner?.id ?? contextId, clone)
        out.push(clone.id)
      } else {
        const entity = touchEntity(doc, id, history.touch)
        if (!entity) continue
        transformEntityMut(entity, matrix)
        out.push(entity.id)
      }
    }
    if (out.length > 0) markScene()
    return out
  }

  /** Tiefe Kopie einer Definition; verschachtelte Gruppen werden mitkopiert. */
  function cloneDefinitionDeep(doc: SketchDocument, definitionId: Id, nameHint?: string): Definition | null {
    const source = doc.definitions[definitionId]
    if (!source) return null
    touchMap(doc, 'definitions', history.touch)
    touchMap(doc, 'entities', history.touch)

    const copy: Definition = {
      ...source,
      id: newId('d'),
      name: uniqueDefinitionName(doc, nameHint ?? source.name),
      geometry: G.cloneGeometry(source.geometry),
      children: [],
      instanceCount: 0,
    }
    doc.definitions[copy.id] = copy

    for (const childId of source.children) {
      const child = doc.entities[childId]
      if (!child) continue
      const childCopy = cloneEntity(child)
      childCopy.id = newId(entityPrefix(child.type))
      if (childCopy.type === 'instance') {
        const nested = doc.definitions[childCopy.definitionId]
        // Gruppen sind per Definition einmalig -> mitkopieren, Komponenten teilen
        if (nested && nested.kind === 'group') {
          const nestedCopy = cloneDefinitionDeep(doc, nested.id, nested.name)
          if (nestedCopy) childCopy.definitionId = nestedCopy.id
        }
      }
      doc.entities[childCopy.id] = childCopy
      copy.children.push(childCopy.id)
    }
    for (const childId of copy.children) {
      const child = doc.entities[childId]
      if (child && child.type === 'instance') {
        const target = doc.definitions[child.definitionId]
        if (target) target.instanceCount = instanceCount(doc, child.definitionId)
      }
    }
    return copy
  }

  /** Gemeinsamer Kern von `makeGroup` und `makeComponent`. */
  function wrapSelection(opts: {
    name: string
    kind: 'group' | 'component'
    description?: string
    behavior?: Definition['behavior']
  }): Id | null {
    const sel = get().selection
    if (selectionIsEmpty(sel)) return null

    return editDoc((doc) => {
      const parentId = get().context.definitionId
      const parent = touchDefinition(doc, parentId, history.touch)
      if (!parent) return null

      const sets = G.expandPrimitives(parent.geometry, sel)
      const entityIds = sel.entityIds.filter((id) => parent.children.includes(id) && !doc.entities[id]?.locked)
      if (sets.edgeIds.size === 0 && sets.faceIds.size === 0 && entityIds.length === 0) return null

      /* Ursprung = Minimum der Auswahl-Bounding-Box im Kontextraum */
      let box = B.empty()
      for (const vid of sets.vertexIds) {
        const vertex = parent.geometry.vertices[vid]
        if (vertex) B.expandByPointMut(box, vertex.p)
      }
      for (const id of entityIds) {
        const entity = doc.entities[id]
        if (!entity) continue
        const childBox = entityBounds(doc, entity)
        if (!B.isEmpty(childBox)) box = B.union(box, childBox)
      }
      const origin = B.isEmpty(box) ? V.clone(V.ORIGIN) : V.clone(box.min)
      const shift = M.translation(V.negate(origin))

      /* Geometrie umziehen */
      const extracted = G.extractGeometry(parent.geometry, sets)
      G.transformGeometryMut(extracted, shift)
      G.removePrimitives(
        parent.geometry,
        { edgeIds: Array.from(sets.edgeIds), faceIds: Array.from(sets.faceIds) },
        { pruneOrphanVertices: true },
      )

      const def: Definition = {
        id: newId('d'),
        name: uniqueDefinitionName(doc, opts.name),
        kind: opts.kind,
        description: opts.description,
        geometry: extracted,
        children: [],
        behavior: opts.behavior,
        instanceCount: 1,
      }
      touchMap(doc, 'definitions', history.touch)
      doc.definitions[def.id] = def

      /* Kind-Entities umhaengen */
      touchMap(doc, 'entities', history.touch)
      for (const id of entityIds) {
        const entity = touchEntity(doc, id, history.touch)
        if (!entity) continue
        transformEntityMut(entity, shift)
        parent.children = parent.children.filter((child) => child !== id)
        def.children.push(id)
      }

      /* Instanz platzieren */
      const instance: InstanceEntity = {
        id: newId('i'),
        type: 'instance',
        name: def.name,
        tagId: null,
        hidden: false,
        locked: false,
        definitionId: def.id,
        transform: M.translation(origin),
        isGroup: opts.kind === 'group',
        materialId: null,
      }
      doc.entities[instance.id] = instance
      parent.children.push(instance.id)

      markGeometry(parentId)
      markScene()
      return instance.id
    })
  }

  /* ---------------- Materialien / Tags ---------------- */

  function clearMaterialReferences(doc: SketchDocument, materialId: Id): void {
    for (const defId of Object.keys(doc.definitions)) {
      const def = doc.definitions[defId]
      let dirty = false
      for (const fid of Object.keys(def.geometry.faces)) {
        const face = def.geometry.faces[fid]
        if (face.frontMaterialId === materialId || face.backMaterialId === materialId) dirty = true
      }
      for (const eid of Object.keys(def.geometry.edges)) {
        if (def.geometry.edges[eid].materialId === materialId) dirty = true
      }
      if (!dirty) continue
      const touched = touchDefinition(doc, defId, history.touch)
      if (!touched) continue
      for (const fid of Object.keys(touched.geometry.faces)) {
        const face = touched.geometry.faces[fid]
        if (face.frontMaterialId === materialId) face.frontMaterialId = null
        if (face.backMaterialId === materialId) face.backMaterialId = null
      }
      for (const eid of Object.keys(touched.geometry.edges)) {
        if (touched.geometry.edges[eid].materialId === materialId) touched.geometry.edges[eid].materialId = null
      }
      invalidateCaches(touched.geometry, [])
      history.marks.definitions.add(defId)
    }
    for (const id of Object.keys(doc.entities)) {
      const entity = doc.entities[id]
      if (entity.type === 'instance' && entity.materialId === materialId) {
        const touched = touchEntity(doc, id, history.touch)
        if (touched && touched.type === 'instance') touched.materialId = null
      }
    }
  }

  function reassignTag(doc: SketchDocument, from: Id, to: Id | null): void {
    for (const defId of Object.keys(doc.definitions)) {
      const def = doc.definitions[defId]
      let dirty = false
      for (const fid of Object.keys(def.geometry.faces)) if (def.geometry.faces[fid].tagId === from) dirty = true
      for (const eid of Object.keys(def.geometry.edges)) if (def.geometry.edges[eid].tagId === from) dirty = true
      if (!dirty) continue
      const touched = touchDefinition(doc, defId, history.touch)
      if (!touched) continue
      for (const fid of Object.keys(touched.geometry.faces)) {
        if (touched.geometry.faces[fid].tagId === from) touched.geometry.faces[fid].tagId = to
      }
      for (const eid of Object.keys(touched.geometry.edges)) {
        if (touched.geometry.edges[eid].tagId === from) touched.geometry.edges[eid].tagId = to
      }
      invalidateCaches(touched.geometry, [])
      history.marks.definitions.add(defId)
    }
    for (const id of Object.keys(doc.entities)) {
      if (doc.entities[id].tagId === from) {
        const touched = touchEntity(doc, id, history.touch)
        if (touched) touched.tagId = to
      }
    }
  }

  /* ---------------- Der eigentliche State ---------------- */

  return {
    doc: initialDocument,
    geometryRevision: 0,
    sceneRevision: 0,
    materialRevision: 0,
    styleRevision: 0,
    selectionRevision: 0,

    context: rootContext(initialDocument),
    selection: emptySelection(),
    hover: null,
    activeTool: 'select',
    previousTool: 'select',
    history: history.state(),
    ui: initialUi(),
    ready: false,
    dirty: false,

    /* ================================================================ */
    /* Dokument-Lebenszyklus                                            */
    /* ================================================================ */

    newDocument(template = 'metric') {
      const doc = createEmptyDocument(template)
      history.clear()
      installDocument(doc, rootContext(doc), emptySelection())
      set({
        history: history.state(),
        ready: true,
        dirty: false,
        hover: null,
        geometryRevision: get().geometryRevision + 1,
        sceneRevision: get().sceneRevision + 1,
        materialRevision: get().materialRevision + 1,
        styleRevision: get().styleRevision + 1,
      })
      bus.emit('document:loaded')
      bus.emit('geometry:changed', { definitionId: doc.rootId, full: true })
      bus.emit('scene:changed')
      bus.emit('material:changed', {})
      bus.emit('style:changed')
      bus.emit('render:request')
    },

    loadDocument(incoming) {
      // Beim Einlesen entfernte Instanzen ohne Definition, plus die, die erst
      // hier auffallen. Stilles Wegraeumen waere falsch: wer eine kaputte
      // Datei oeffnet, muss erfahren, dass etwas gefehlt hat.
      const reported = documentRepairOf(incoming)?.removedOrphanInstances ?? 0
      const swept = withoutOrphanInstances(incoming)
      const orphans = reported + swept.removed
      const doc = swept.doc

      syncIdCounter(doc)
      history.clear()
      installDocument(doc, rootContext(doc), emptySelection())
      set({
        history: history.state(),
        ready: true,
        dirty: false,
        hover: null,
        geometryRevision: get().geometryRevision + 1,
        sceneRevision: get().sceneRevision + 1,
        materialRevision: get().materialRevision + 1,
        styleRevision: get().styleRevision + 1,
      })
      bus.emit('document:loaded')
      bus.emit('geometry:changed', { definitionId: doc.rootId, full: true })
      bus.emit('scene:changed')
      bus.emit('material:changed', {})
      bus.emit('style:changed')
      bus.emit('render:request')

      if (orphans > 0) {
        get().toast(
          orphans === 1
            ? 'Ein Objekt ohne Definition wurde beim Laden entfernt'
            : `${orphans} Objekte ohne Definition wurden beim Laden entfernt`,
          'warn',
        )
      }
    },

    exportDocument() {
      return cloneDocument(get().doc)
    },

    setDocumentName(name) {
      get().operation('Dokument umbenennen', () => {
        editDoc((doc) => {
          doc.meta = { ...doc.meta, name }
        })
        history.marks.document = true
      })
    },

    setUnits(units) {
      get().operation('Einheiten aendern', () => {
        editDoc((doc) => {
          doc.units = { ...doc.units, ...units }
        })
        markStyle()
      })
    },

    /* ================================================================ */
    /* Lesehelfer                                                       */
    /* ================================================================ */

    getDefinition(id) {
      return get().doc.definitions[id]
    },

    getActiveGeometry() {
      const s = get()
      return s.doc.definitions[s.context.definitionId]?.geometry ?? s.doc.definitions[s.doc.rootId].geometry
    },

    getGeometry(definitionId) {
      return get().doc.definitions[definitionId]?.geometry
    },

    getVertex(id, definitionId) {
      const s = get()
      const geom = definitionId ? s.doc.definitions[definitionId]?.geometry : s.getActiveGeometry()
      return geom?.vertices[id]
    },

    getEdge(id, definitionId) {
      const s = get()
      const geom = definitionId ? s.doc.definitions[definitionId]?.geometry : s.getActiveGeometry()
      return geom?.edges[id]
    },

    getFace(id, definitionId) {
      const s = get()
      const geom = definitionId ? s.doc.definitions[definitionId]?.geometry : s.getActiveGeometry()
      return geom?.faces[id]
    },

    getEntity(id) {
      return get().doc.entities[id]
    },

    getMaterial(id) {
      return id ? get().doc.materials[id] : undefined
    },

    getTexture(id) {
      return id ? get().doc.textures[id] : undefined
    },

    getTag(id) {
      return id ? get().doc.tags[id] : undefined
    },

    getStyle() {
      const doc = get().doc
      return doc.styles[doc.activeStyleId] ?? doc.styles[Object.keys(doc.styles)[0]] ?? createDefaultStyle()
    },

    getWorldTransform(instancePath) {
      return worldTransformOf(get().doc, instancePath)
    },

    getDefinitionBounds(definitionId) {
      return definitionBounds(get().doc, definitionId)
    },

    getSelectionBounds() {
      const s = get()
      const sel = s.selection
      if (selectionIsEmpty(sel)) return null
      const geom = s.getActiveGeometry()
      const sets = G.expandPrimitives(geom, sel, { includeImpliedFaces: false })

      let box = B.empty()
      for (const vid of sets.vertexIds) {
        const vertex = geom.vertices[vid]
        if (vertex) B.expandByPointMut(box, vertex.p)
      }
      for (const id of sel.entityIds) {
        const entity = s.doc.entities[id]
        if (!entity) continue
        const childBox = entityBounds(s.doc, entity)
        if (!B.isEmpty(childBox)) box = B.union(box, childBox)
      }
      if (B.isEmpty(box)) return null
      return B.transform(box, s.context.worldTransform)
    },

    getModelBounds() {
      return modelBounds(get().doc)
    },

    getEntityInfo() {
      const s = get()
      const sel = s.selection
      const total = selectionCount(sel)
      if (total === 0) return null

      const doc = s.doc
      const units = doc.units
      const geom = s.getActiveGeometry()

      const faces = sel.faceIds.map((id) => geom.faces[id]).filter((f): f is Face => f !== undefined)
      const edges = sel.edgeIds.map((id) => geom.edges[id]).filter((e): e is Edge => e !== undefined)
      const vertices = sel.vertexIds.map((id) => geom.vertices[id]).filter((v): v is Vertex => v !== undefined)
      const entities = sel.entityIds.map((id) => doc.entities[id]).filter((e): e is Entity => e !== undefined)
      const instances = entities.filter((e): e is InstanceEntity => e.type === 'instance')

      const rows: { label: string; value: string }[] = []

      /* --- Art der Auswahl --- */
      let kind = 'Auswahl'
      const kinds = [faces.length > 0, edges.length > 0, vertices.length > 0, entities.length > 0].filter(Boolean)
      if (kinds.length === 1) {
        if (faces.length > 0) kind = pluralKind(faces.length, 'Flaeche', 'Flaechen')
        else if (edges.length > 0) kind = pluralKind(edges.length, 'Kante', 'Kanten')
        else if (vertices.length > 0) kind = pluralKind(vertices.length, 'Punkt', 'Punkte')
        else if (instances.length === entities.length && instances.length > 0) {
          const allGroups = instances.every((i) => i.isGroup)
          const allComponents = instances.every((i) => !i.isGroup)
          if (allGroups) kind = pluralKind(instances.length, 'Gruppe', 'Gruppen')
          else if (allComponents) kind = pluralKind(instances.length, 'Komponente', 'Komponenten')
          else kind = 'Objekte'
        } else {
          const type = commonValue(entities.map((e) => e.type))
          kind = type ? entityTypeLabel(type, entities.length) : 'Objekte'
        }
      }

      /* --- Kennzahlen --- */
      if (kinds.length > 1) {
        if (faces.length > 0) rows.push({ label: 'Flaechen', value: String(faces.length) })
        if (edges.length > 0) rows.push({ label: 'Kanten', value: String(edges.length) })
        if (vertices.length > 0) rows.push({ label: 'Punkte', value: String(vertices.length) })
        if (entities.length > 0) rows.push({ label: 'Objekte', value: String(entities.length) })
      } else if (total > 1) {
        rows.push({ label: 'Anzahl', value: String(total) })
      }

      if (faces.length > 0) {
        const area = G.totalArea(geom, sel.faceIds)
        rows.push({ label: 'Flaeche', value: formatArea(area, units) })
      }
      if (edges.length > 0) {
        const length = G.totalEdgeLength(geom, sel.edgeIds)
        rows.push({ label: edges.length === 1 ? 'Laenge' : 'Gesamtlaenge', value: formatLength(length, units) })
      }
      if (instances.length > 0) {
        const definitionIds = instances.map((i) => i.definitionId)
        const commonDefinition = commonValue(definitionIds)
        if (commonDefinition) {
          const def = doc.definitions[commonDefinition]
          if (def) {
            rows.push({ label: 'Definition', value: def.name })
            if (def.kind === 'component') {
              rows.push({ label: 'Instanzen im Modell', value: String(instanceCount(doc, def.id)) })
            }
            if (G.isSolid(def.geometry)) {
              rows.push({ label: 'Volumen', value: formatVolume(G.solidVolume(def.geometry), units) })
            }
          }
        }
      }

      const bounds = s.getSelectionBounds()
      if (bounds && !B.isEmpty(bounds)) {
        const size = B.size(bounds)
        const f = (v: number) => formatLength(v, units, { suffix: false })
        rows.push({ label: 'Abmessungen', value: `${f(size.x)} x ${f(size.y)} x ${f(size.z)}` })
      }

      /* --- gemeinsame Attribute --- */
      const tagValues: (Id | null)[] = [
        ...faces.map((f) => f.tagId),
        ...edges.map((e) => e.tagId),
        ...entities.map((e) => e.tagId),
      ]
      const materialValues: (Id | null)[] = [
        ...faces.map((f) => f.frontMaterialId),
        ...edges.map((e) => e.materialId),
        ...instances.map((i) => i.materialId),
      ]
      const hiddenValues: boolean[] = [
        ...faces.map((f) => f.hidden),
        ...edges.map((e) => e.hidden),
        ...entities.map((e) => e.hidden),
      ]

      const summary: EntityInfoSummary = {
        kind,
        count: total,
        rows,
        tagId: commonValue(tagValues),
        materialId: commonValue(materialValues),
        hidden: commonValue(hiddenValues),
        locked: entities.length > 0 ? commonValue(entities.map((e) => e.locked)) : undefined,
        softEdges: edges.length > 0 ? commonValue(edges.map((e) => e.soft)) : undefined,
        smoothEdges: edges.length > 0 ? commonValue(edges.map((e) => e.smooth)) : undefined,
        name: entities.length === 1 ? entities[0].name : undefined,
      }
      return summary
    },

    isTagVisible(tagId) {
      return isTagVisibleIn(get().doc, tagId)
    },

    /* ================================================================ */
    /* Historie / Transaktionen                                         */
    /* ================================================================ */

    beginOperation(name) {
      history.begin(name, snapshot())
      set({ history: history.state() })
    },

    commitOperation() {
      if (!history.isRecording) return
      const closing = history.depthCount === 1
      const marks = history.marks
      if (closing && marks.document) {
        const doc = { ...get().doc, meta: { ...get().doc.meta, modifiedAt: new Date().toISOString() } }
        set({ doc })
      }
      const record = history.commit(snapshot())
      set({ history: history.state() })
      if (!record) return
      applyRevisions(record.marks)
      set({ dirty: true })
      emitMarks(record.marks)
    },

    abortOperation() {
      const aborted = history.abort()
      set({ history: history.state() })
      if (!aborted) return
      installDocument(aborted.snapshot.doc, aborted.snapshot.context, aborted.snapshot.selection)
      applyRevisions(aborted.marks)
      emitMarks(aborted.marks)
    },

    operation(name, fn) {
      get().beginOperation(name)
      try {
        const result = fn()
        get().commitOperation()
        return result
      } catch (err) {
        get().abortOperation()
        throw err
      }
    },

    undo() {
      if (history.isRecording) get().abortOperation()
      const record = history.undo()
      if (!record) return
      installDocument(record.before.doc, record.before.context, record.before.selection)
      applyRevisions(record.marks)
      set({ history: history.state(), dirty: true })
      emitMarks(record.marks)
      bus.emit('context:changed', {
        definitionId: get().context.definitionId,
        depth: get().context.instancePath.length,
      })
    },

    redo() {
      if (history.isRecording) get().abortOperation()
      const record = history.redo()
      if (!record) return
      installDocument(record.after.doc, record.after.context, record.after.selection)
      applyRevisions(record.marks)
      set({ history: history.state(), dirty: true })
      emitMarks(record.marks)
      bus.emit('context:changed', {
        definitionId: get().context.definitionId,
        depth: get().context.instancePath.length,
      })
    },

    canUndo() {
      return history.canUndo()
    },

    canRedo() {
      return history.canRedo()
    },

    clearHistory() {
      history.clear()
      set({ history: history.state() })
    },

    /* ================================================================ */
    /* Geometrie (delegiert an @/core, immer im aktiven Kontext)         */
    /* ================================================================ */

    addEdge(a, b, opts) {
      return get().operation('Kante zeichnen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const la = toLocalPoint(a)
          const lb = toLocalPoint(b)
          const addOpts = {
            guide: opts?.guide,
            tagId: doc.activeTagId,
            materialId: doc.activeMaterialId,
          }
          const change =
            kernelCall(
              () => core.addEdge(def.geometry, la, lb, addOpts),
              () => G.buildEdge(def.geometry, la, lb, addOpts),
              'Kante zeichnen',
            ) ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    addPolyline(points, closed, opts) {
      return get().operation('Linienzug zeichnen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def || points.length < 2) return emptyChange()
          const local = points.map(toLocalPoint)
          const addOpts = { guide: opts?.guide, tagId: doc.activeTagId, materialId: doc.activeMaterialId }
          const change =
            kernelCall(
              () => core.addPolyline(def.geometry, local, closed, addOpts),
              () => {
                const merged = emptyChange()
                const count = closed ? local.length : local.length - 1
                for (let i = 0; i < count; i++) {
                  const part = G.buildEdge(def.geometry, local[i], local[(i + 1) % local.length], addOpts)
                  merged.addedVertices.push(...part.addedVertices)
                  merged.addedEdges.push(...part.addedEdges)
                }
                return merged
              },
              'Linienzug zeichnen',
            ) ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    addFace(points, holes) {
      return get().operation('Flaeche erzeugen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def || points.length < 3) return emptyChange()
          const outer = points.map(toLocalPoint)
          const localHoles = holes?.map((hole) => hole.map(toLocalPoint))
          const addOpts = { tagId: doc.activeTagId, materialId: doc.activeMaterialId }
          const change =
            kernelCall(
              () => core.addFacePolygon(def.geometry, outer, localHoles, addOpts),
              () => G.buildFaceFromPoints(def.geometry, outer, addOpts),
              'Flaeche erzeugen',
            ) ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    deletePrimitives(ids) {
      return get().operation('Loeschen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()

          const change =
            kernelCall(
              () =>
                core.deletePrimitives(def.geometry, {
                  edgeIds: ids.edgeIds,
                  faceIds: ids.faceIds,
                  vertexIds: ids.vertexIds,
                }),
              () =>
                G.removePrimitives(
                  def.geometry,
                  { edgeIds: ids.edgeIds ?? [], faceIds: ids.faceIds ?? [], vertexIds: ids.vertexIds ?? [] },
                  { pruneOrphanVertices: true },
                ),
              'Loeschen',
            ) ?? emptyChange()

          for (const entityId of ids.entityIds ?? []) removeEntityFrom(doc, entityId)
          if ((ids.entityIds ?? []).length > 0) markScene()
          if (hasChange(change)) markGeometry(def.id)

          const pruned = pruneSelection(doc, get().selection, def.id)
          set({ selection: pruned })
          history.marks.selection = true
          return change
        }),
      )
    },

    moveVertices(vertexIds, delta) {
      return get().operation('Punkte verschieben', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def || vertexIds.length === 0) return emptyChange()
          const localDelta = toLocalDir(delta)
          const change =
            kernelCall(
              () => core.moveVertices(def.geometry, vertexIds, localDelta),
              () => {
                const result = emptyChange()
                for (const id of vertexIds) {
                  const vertex = def.geometry.vertices[id]
                  if (!vertex) continue
                  vertex.p = V.add(vertex.p, localDelta)
                  for (const eid of vertex.edges) result.modifiedEdges.push(eid)
                }
                for (const fid of Object.keys(def.geometry.faces)) {
                  G.recomputeFacePlaneMut(def.geometry, def.geometry.faces[fid])
                  result.modifiedFaces.push(fid)
                }
                invalidateCaches(def.geometry, result.modifiedFaces)
                return result
              },
              'Punkte verschieben',
            ) ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    transformPrimitives(sel, matrix, copy) {
      return get().operation(copy ? 'Kopieren' : 'Transformieren', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const local = toLocalMatrix(matrix)

          let change: GeometryChange = emptyChange()
          if (sel.edgeIds?.length || sel.faceIds?.length || sel.vertexIds?.length) {
            change =
              kernelCall(
                () =>
                  core.transformPrimitives(
                    def.geometry,
                    { edgeIds: sel.edgeIds, faceIds: sel.faceIds, vertexIds: sel.vertexIds },
                    local,
                    copy,
                  ),
                copy
                  ? null
                  : () => {
                      const sets = G.expandPrimitives(def.geometry, sel, { includeImpliedFaces: false })
                      const result = emptyChange()
                      for (const vid of sets.vertexIds) {
                        const vertex = def.geometry.vertices[vid]
                        if (vertex) vertex.p = M.transformPoint(local, vertex.p)
                      }
                      for (const fid of sets.faceIds) {
                        G.recomputeFacePlaneMut(def.geometry, def.geometry.faces[fid])
                        result.modifiedFaces.push(fid)
                      }
                      result.modifiedEdges.push(...sets.edgeIds)
                      invalidateCaches(def.geometry, result.modifiedFaces)
                      return result
                    },
                copy ? 'Kopieren' : 'Transformieren',
              ) ?? emptyChange()
            if (hasChange(change)) markGeometry(def.id)
          }

          if (sel.entityIds && sel.entityIds.length > 0) {
            transformEntitiesIn(doc, sel.entityIds, local, copy)
          }
          return change
        }),
      )
    },

    pushPull(faceId, distance, opts) {
      return get().operation('Druecken/Ziehen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const change =
            kernelCall(
              () =>
                core.pushPull(def.geometry, faceId, distance, {
                  direction: opts?.direction ? toLocalDir(opts.direction) : undefined,
                  createNewStartingFace: opts?.createNewStartingFace,
                }),
              null,
              'Druecken/Ziehen',
            ) ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    followMe(profileFaceId, pathEdgeIds) {
      return get().operation('Folge mir', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const change =
            kernelCall(() => core.followMe(def.geometry, profileFaceId, pathEdgeIds), null, 'Folge mir') ??
            emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    offsetFace(faceId, distance) {
      return get().operation('Versatz', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const change =
            kernelCall(() => core.offsetFace(def.geometry, faceId, distance), null, 'Versatz') ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    offsetEdges(edgeIds, distance) {
      return get().operation('Versatz', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const change =
            kernelCall(() => core.offsetEdges(def.geometry, edgeIds, distance), null, 'Versatz') ?? emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    intersectFaces(scope) {
      return get().operation('Flaechen schneiden', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return emptyChange()
          const all = Object.keys(def.geometry.faces)
          const source = scope === 'selection' ? get().selection.faceIds : all
          const target = scope === 'selection' ? all : undefined
          if (source.length === 0) return emptyChange()
          const change =
            kernelCall(() => core.intersectFaces(def.geometry, source, target), null, 'Flaechen schneiden') ??
            emptyChange()
          if (hasChange(change)) markGeometry(def.id)
          return change
        }),
      )
    },

    reverseFaces(faceIds) {
      get().operation('Flaechen umkehren', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def || faceIds.length === 0) return
          const done = kernelCall(
            () => {
              core.reverseFaces(def.geometry, faceIds)
              return true
            },
            () => {
              for (const id of faceIds) {
                const face = def.geometry.faces[id]
                if (!face) continue
                face.outer = { edges: face.outer.edges.slice().reverse(), vertices: face.outer.vertices.slice().reverse() }
                face.inner = face.inner.map((loop) => ({
                  edges: loop.edges.slice().reverse(),
                  vertices: loop.vertices.slice().reverse(),
                }))
                face.normal = V.negate(face.normal)
                face.plane = { n: face.normal, d: -face.plane.d }
                const front = face.frontMaterialId
                face.frontMaterialId = face.backMaterialId
                face.backMaterialId = front
              }
              invalidateCaches(def.geometry, faceIds)
              return true
            },
            'Flaechen umkehren',
          )
          if (done) markGeometry(def.id)
        }),
      )
    },

    orientFaces(faceId) {
      get().operation('Flaechen ausrichten', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return
          const done = kernelCall(
            () => {
              core.orientFacesConsistently(def.geometry, faceId)
              return true
            },
            null,
            'Flaechen ausrichten',
          )
          if (done) markGeometry(def.id)
        }),
      )
    },

    softenEdges(edgeIds, angle, opts) {
      get().operation('Kanten weichzeichnen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def || edgeIds.length === 0) return
          const done = kernelCall(
            () => {
              core.softenEdges(def.geometry, edgeIds, degToRad(angle), {
                softenCoplanar: opts.softenCoplanar,
                soften: true,
                smooth: true,
              })
              return true
            },
            null,
            'Kanten weichzeichnen',
          )
          if (done) markGeometry(def.id)
        }),
      )
    },

    setEdgeFlags(edgeIds, flags) {
      get().operation('Kanteneigenschaften', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def || edgeIds.length === 0) return
          let changed = false
          for (const id of edgeIds) {
            const edge = def.geometry.edges[id]
            if (!edge) continue
            if (flags.soft !== undefined) edge.soft = flags.soft
            if (flags.smooth !== undefined) edge.smooth = flags.smooth
            if (flags.hidden !== undefined) edge.hidden = flags.hidden
            changed = true
          }
          if (changed) {
            invalidateCaches(def.geometry, [])
            markGeometry(def.id)
          }
        }),
      )
    },

    booleanOp(op, targetId, toolId) {
      get().operation('Volumenoperation', () =>
        editDoc((doc) => {
          const target = doc.entities[targetId]
          const tool = doc.entities[toolId]
          if (!target || target.type !== 'instance' || !tool || tool.type !== 'instance') return
          const targetDef = touchDefinition(doc, target.definitionId, history.touch)
          const toolDef = doc.definitions[tool.definitionId]
          if (!targetDef || !toolDef) return

          // Werkzeuggeometrie in den Raum des Ziels bringen
          const toTarget = M.multiply(M.invert(target.transform), tool.transform)
          const toolGeom = G.transformedGeometry(toolDef.geometry, toTarget)

          const primary = op === 'trim' || op === 'split' ? 'subtract' : op
          const result = kernelCall(
            () => core.booleanSolid(targetDef.geometry, toolGeom, primary),
            null,
            'Volumenoperation',
          )
          if (!result) return

          targetDef.geometry = result
          invalidateCaches(targetDef.geometry)
          markGeometry(targetDef.id)

          if (op === 'split') {
            const overlap = kernelCall(
              () => core.booleanSolid(toolGeom, targetDef.geometry, 'intersect'),
              null,
              'Volumenoperation',
            )
            if (overlap) {
              const def: Definition = {
                id: newId('d'),
                name: uniqueDefinitionName(doc, 'Schnittvolumen'),
                kind: 'group',
                geometry: overlap,
                children: [],
                instanceCount: 1,
              }
              touchMap(doc, 'definitions', history.touch)
              doc.definitions[def.id] = def
              addEntityTo(doc, get().context.definitionId, {
                id: newId('i'),
                type: 'instance',
                name: def.name,
                tagId: null,
                hidden: false,
                locked: false,
                definitionId: def.id,
                transform: M.clone(target.transform),
                isGroup: true,
                materialId: null,
              })
              markScene()
            }
          }
          if (op !== 'trim' && op !== 'split') {
            removeEntityFrom(doc, toolId)
            markScene()
          }
        }),
      )
    },

    /* ================================================================ */
    /* Entities, Gruppen und Komponenten                                */
    /* ================================================================ */

    makeGroup(name) {
      const state = get()
      if (selectionIsEmpty(state.selection)) {
        state.toast('Nichts ausgewaehlt', 'warn')
        return null
      }
      const id = state.operation('Gruppe erstellen', () =>
        wrapSelection({ name: name ?? 'Gruppe', kind: 'group' }),
      )
      if (id) get().setSelection({ ...emptySelection(), entityIds: [id] })
      return id
    },

    makeComponent(opts) {
      const state = get()
      if (selectionIsEmpty(state.selection)) {
        state.toast('Nichts ausgewaehlt', 'warn')
        return null
      }
      const id = state.operation('Komponente erstellen', () =>
        wrapSelection({
          name: opts.name || 'Komponente',
          kind: 'component',
          description: opts.description,
          behavior: opts.behavior,
        }),
      )
      if (id) get().setSelection({ ...emptySelection(), entityIds: [id] })
      return id
    },

    explode(entityIds) {
      const state = get()
      if (entityIds.length === 0) return
      const selection = state.operation('Aufloesen', () =>
        editDoc((doc) => {
          const parentId = get().context.definitionId
          const parent = touchDefinition(doc, parentId, history.touch)
          if (!parent) return null
          const result = emptySelection()

          for (const entityId of entityIds) {
            const instance = doc.entities[entityId]
            if (!instance || instance.type !== 'instance') continue
            if (!parent.children.includes(entityId)) continue
            const def = doc.definitions[instance.definitionId]
            if (!def) continue

            /* 1. Geometrie transformiert in den Elternkontext mischen */
            const change = kernelCall(
              () => core.mergeGeometry(parent.geometry, def.geometry, instance.transform),
              () => G.mergeGeometryInto(parent.geometry, def.geometry, instance.transform),
              'Aufloesen',
            )
            if (change) {
              result.edgeIds.push(...change.addedEdges)
              result.faceIds.push(...change.addedFaces)
              result.vertexIds.push(...change.addedVertices)
              markGeometry(parentId)
            }

            /* 2. Verschachtelte Entities eine Ebene nach oben holen */
            touchMap(doc, 'entities', history.touch)
            for (const childId of def.children) {
              const child = doc.entities[childId]
              if (!child) continue
              const copy = cloneEntity(child)
              copy.id = newId(entityPrefix(child.type))
              transformEntityMut(copy, instance.transform)
              doc.entities[copy.id] = copy
              parent.children.push(copy.id)
              result.entityIds.push(copy.id)
            }

            /* 3. Instanz entfernen, Gruppendefinition aufraeumen */
            parent.children = parent.children.filter((id) => id !== entityId)
            delete doc.entities[entityId]
            if (def.kind !== 'component' && instanceCount(doc, def.id) === 0) {
              purgeDefinition(doc, def.id)
            } else {
              const touched = touchDefinition(doc, def.id, history.touch)
              if (touched) touched.instanceCount = instanceCount(doc, def.id)
            }
            markScene()
          }
          return result
        }),
      )
      if (selection) get().setSelection(selection)
    },

    placeInstance(definitionId, transform, opts) {
      return get().operation('Instanz platzieren', () =>
        editDoc((doc) => {
          const contextId = get().context.definitionId
          const def = doc.definitions[definitionId]
          if (!def) return ''
          if (definitionContains(doc, definitionId, contextId)) {
            get().toast('Eine Komponente kann sich nicht selbst enthalten', 'error')
            return ''
          }
          const instance: InstanceEntity = {
            id: newId('i'),
            type: 'instance',
            name: opts?.name ?? def.name,
            tagId: null,
            hidden: false,
            locked: false,
            definitionId,
            transform: M.clone(transform),
            isGroup: def.kind === 'group',
            materialId: null,
          }
          // Regel 4: `transform` ist eine Weltmatrix. Derselbe Weg wie bei
          // `addEntity` - nicht `toLocalMatrix`: das konjugiert eine OPERATION,
          // hier geht es um die PLATZIERUNG eines Objekts.
          toLocalEntityMut(instance)
          addEntityTo(doc, contextId, instance)
          markScene()
          return instance.id
        }),
      )
    },

    makeUnique(entityIds) {
      get().operation('Eindeutig machen', () =>
        editDoc((doc) => {
          for (const entityId of entityIds) {
            const instance = doc.entities[entityId]
            if (!instance || instance.type !== 'instance') continue
            const def = doc.definitions[instance.definitionId]
            if (!def) continue
            if (instanceCount(doc, def.id) <= 1) continue

            const copy = cloneDefinitionDeep(doc, def.id, def.name)
            if (!copy) continue
            const touched = touchEntity(doc, entityId, history.touch)
            if (touched && touched.type === 'instance') touched.definitionId = copy.id
            copy.instanceCount = 1
            const original = touchDefinition(doc, def.id, history.touch)
            if (original) original.instanceCount = instanceCount(doc, def.id)
            markScene()
            markGeometry(copy.id)
          }
        }),
      )
    },

    addEntity(entity) {
      return get().operation('Objekt hinzufuegen', () =>
        editDoc((doc) => {
          const copy = cloneEntity(entity)
          if (!copy.id) copy.id = newId(entityPrefix(copy.type))
          // Regel 4: Werkzeuge liefern Weltkoordinaten. Ohne diese Umrechnung
          // landen Bemassungen, Texte, Schnittebenen und Hilfsobjekte, die in
          // einer Gruppe erzeugt werden, um die Gruppentransformation versetzt.
          toLocalEntityMut(copy)
          addEntityTo(doc, get().context.definitionId, copy)
          markScene()
          return copy.id
        }),
      )
    },

    /**
     * Fuer ATTRIBUTE gedacht: Name, Farbe, Schriftgroesse, Pfeilart, aktiv,
     * Sichtbarkeit. Punktfelder werden bewusst NICHT umgerechnet - ein Patch
     * ist teilweise, und ob ein uebergebenes `start` als Welt- oder als
     * Kontextpunkt gemeint war, laesst sich nicht erraten. Mal so, mal anders
     * zu raten waere schlimmer als eine klare Regel:
     * **Positionsaenderungen laufen ueber `transformEntities`.**
     */
    updateEntity(id, patch) {
      get().operation('Objekt aendern', () =>
        editDoc((doc) => {
          const entity = touchEntity(doc, id, history.touch)
          if (!entity) return
          Object.assign(entity, patch, { id: entity.id, type: entity.type })
          markScene()
        }),
      )
    },

    removeEntities(ids) {
      if (ids.length === 0) return
      get().operation('Objekte loeschen', () =>
        editDoc((doc) => {
          for (const id of ids) removeEntityFrom(doc, id)
          markScene()
          set({ selection: pruneSelection(doc, get().selection, get().context.definitionId) })
          history.marks.selection = true
        }),
      )
    },

    transformEntities(ids, matrix, copy) {
      if (ids.length === 0) return []
      return get().operation(copy ? 'Objekte kopieren' : 'Objekte verschieben', () =>
        editDoc((doc) => transformEntitiesIn(doc, ids, toLocalMatrix(matrix), copy)),
      )
    },

    setEntityName(id, name) {
      get().operation('Objekt umbenennen', () =>
        editDoc((doc) => {
          const entity = touchEntity(doc, id, history.touch)
          if (!entity) return
          entity.name = name
          if (entity.type === 'instance') {
            const def = doc.definitions[entity.definitionId]
            if (def && def.kind === 'group') {
              const touched = touchDefinition(doc, def.id, history.touch)
              if (touched) touched.name = name
            }
          }
          markScene()
        }),
      )
    },

    setEntityTag(ids, tagId) {
      get().operation('Tag zuweisen', () =>
        editDoc((doc) => {
          for (const id of ids) {
            const entity = touchEntity(doc, id, history.touch)
            if (entity) entity.tagId = tagId
          }
          markScene()
          markStyle()
        }),
      )
    },

    setEntityHidden(ids, hidden) {
      get().operation(hidden ? 'Verbergen' : 'Einblenden', () =>
        editDoc((doc) => {
          for (const id of ids) {
            const entity = touchEntity(doc, id, history.touch)
            if (entity) entity.hidden = hidden
          }
          markScene()
        }),
      )
    },

    setEntityLocked(ids, locked) {
      get().operation(locked ? 'Sperren' : 'Entsperren', () =>
        editDoc((doc) => {
          for (const id of ids) {
            const entity = touchEntity(doc, id, history.touch)
            if (entity) entity.locked = locked
          }
          markScene()
        }),
      )
    },

    unhideAll() {
      get().operation('Alles einblenden', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return
          for (const childId of def.children) {
            const entity = doc.entities[childId]
            if (entity?.hidden) {
              const touched = touchEntity(doc, childId, history.touch)
              if (touched) touched.hidden = false
            }
          }
          for (const eid of Object.keys(def.geometry.edges)) def.geometry.edges[eid].hidden = false
          for (const fid of Object.keys(def.geometry.faces)) def.geometry.faces[fid].hidden = false
          invalidateCaches(def.geometry, [])
          markGeometry(def.id)
          markScene()
        }),
      )
    },

    upsertDefinition(def) {
      get().operation('Definition speichern', () =>
        editDoc((doc) => {
          touchMap(doc, 'definitions', history.touch)
          const stored = {
            ...def,
            geometry: G.cloneGeometry(def.geometry),
            children: def.children.slice(),
          }
          doc.definitions[def.id] = stored
          history.touch.definitions.add(def.id)
          // Eine komplett ersetzte Geometrie kann dieselben Flaechen-Ids
          // tragen wie die alte - der Flaechen-Cache muss darum weg.
          invalidateCaches(stored.geometry)
          markGeometry(def.id)
          markScene()
        }),
      )
    },

    removeDefinition(id) {
      get().operation('Definition loeschen', () =>
        editDoc((doc) => {
          if (id === doc.rootId) return
          for (const instance of Object.keys(doc.entities)) {
            const entity = doc.entities[instance]
            if (entity.type === 'instance' && entity.definitionId === id) removeEntityFrom(doc, instance)
          }
          purgeDefinition(doc, id)
          markScene()
          markGeometry(id)
        }),
      )
    },

    purgeUnused() {
      return get().operation('Unbenutztes entfernen', () =>
        editDoc((doc) => {
          const removed = { definitions: 0, materials: 0, tags: 0, textures: 0 }

          /* Definitionen */
          const reachable = reachableDefinitionIds(doc)
          for (const id of Object.keys(doc.definitions)) {
            const def = doc.definitions[id]
            if (reachable.has(id) || def.isLibrary) continue
            purgeDefinition(doc, id)
            removed.definitions += 1
          }

          /* Materialien */
          const usedMaterials = new Set<Id>()
          for (const defId of Object.keys(doc.definitions)) {
            const geom = doc.definitions[defId].geometry
            for (const fid of Object.keys(geom.faces)) {
              const face = geom.faces[fid]
              if (face.frontMaterialId) usedMaterials.add(face.frontMaterialId)
              if (face.backMaterialId) usedMaterials.add(face.backMaterialId)
            }
            for (const eid of Object.keys(geom.edges)) {
              const material = geom.edges[eid].materialId
              if (material) usedMaterials.add(material)
            }
          }
          for (const id of Object.keys(doc.entities)) {
            const entity = doc.entities[id]
            if (entity.type === 'instance' && entity.materialId) usedMaterials.add(entity.materialId)
          }
          if (doc.activeMaterialId) usedMaterials.add(doc.activeMaterialId)
          for (const id of Object.keys(doc.materials)) {
            if (usedMaterials.has(id)) continue
            touchMap(doc, 'materials', history.touch)
            delete doc.materials[id]
            removed.materials += 1
          }

          /* Texturen */
          const usedTextures = new Set<Id>()
          for (const id of Object.keys(doc.materials)) {
            const texture = doc.materials[id].textureId
            if (texture) usedTextures.add(texture)
          }
          for (const id of Object.keys(doc.entities)) {
            const entity = doc.entities[id]
            if (entity.type === 'image') usedTextures.add(entity.textureId)
          }
          for (const id of Object.keys(doc.textures)) {
            if (usedTextures.has(id)) continue
            touchMap(doc, 'textures', history.touch)
            delete doc.textures[id]
            removed.textures += 1
          }

          /* Tags */
          const usedTags = new Set<Id>([defaultTagId(doc), doc.activeTagId])
          for (const defId of Object.keys(doc.definitions)) {
            const geom = doc.definitions[defId].geometry
            for (const fid of Object.keys(geom.faces)) {
              const tag = geom.faces[fid].tagId
              if (tag) usedTags.add(tag)
            }
            for (const eid of Object.keys(geom.edges)) {
              const tag = geom.edges[eid].tagId
              if (tag) usedTags.add(tag)
            }
          }
          for (const id of Object.keys(doc.entities)) {
            const tag = doc.entities[id].tagId
            if (tag) usedTags.add(tag)
          }
          for (const id of Object.keys(doc.tags)) {
            if (usedTags.has(id)) continue
            touchMap(doc, 'tags', history.touch)
            delete doc.tags[id]
            removed.tags += 1
          }

          if (removed.definitions > 0) markScene()
          if (removed.materials > 0 || removed.textures > 0) markMaterial()
          if (removed.tags > 0) markStyle()
          return removed
        }),
      )
    },

    /* ================================================================ */
    /* Kontextnavigation                                                */
    /* ================================================================ */

    enterContext(instanceId) {
      const s = get()
      const entity = s.doc.entities[instanceId]
      if (!entity || entity.type !== 'instance') return
      const owner = s.doc.definitions[s.context.definitionId]
      if (!owner || !owner.children.includes(instanceId)) return
      const def = s.doc.definitions[entity.definitionId]
      if (!def) return
      if (entity.locked) {
        s.toast('Objekt ist gesperrt', 'warn')
        return
      }

      const instancePath = [...s.context.instancePath, instanceId]
      const context: EditContext = {
        definitionId: def.id,
        instancePath,
        definitionPath: [...s.context.definitionPath, def.id],
        worldTransform: M.multiply(s.context.worldTransform, entity.transform),
      }
      set({ context, selection: emptySelection(), selectionRevision: s.selectionRevision + 1, hover: null })
      bus.emit('context:changed', { definitionId: def.id, depth: instancePath.length })
      bus.emit('selection:changed')
      bus.emit('render:request')
    },

    exitContext() {
      const s = get()
      if (s.context.instancePath.length === 0) return false
      const instancePath = s.context.instancePath.slice(0, -1)
      const context: EditContext = {
        definitionId:
          instancePath.length === 0
            ? s.doc.rootId
            : (s.doc.entities[instancePath[instancePath.length - 1]] as InstanceEntity).definitionId,
        instancePath,
        definitionPath: definitionPathOf(s.doc, instancePath),
        worldTransform: worldTransformOf(s.doc, instancePath),
      }
      set({ context, selection: emptySelection(), selectionRevision: s.selectionRevision + 1, hover: null })
      bus.emit('context:changed', { definitionId: context.definitionId, depth: instancePath.length })
      bus.emit('selection:changed')
      bus.emit('render:request')
      return true
    },

    exitAllContexts() {
      const s = get()
      if (s.context.instancePath.length === 0) return
      set({
        context: rootContext(s.doc),
        selection: emptySelection(),
        selectionRevision: s.selectionRevision + 1,
        hover: null,
      })
      bus.emit('context:changed', { definitionId: s.doc.rootId, depth: 0 })
      bus.emit('selection:changed')
      bus.emit('render:request')
    },

    /* ================================================================ */
    /* Auswahl                                                          */
    /* ================================================================ */

    setSelection(sel) {
      applySelection(normalizeSelection(sel))
    },

    clearSelection() {
      if (selectionIsEmpty(get().selection)) return
      applySelection(emptySelection())
    },

    selectAll() {
      const s = get()
      const def = s.doc.definitions[s.context.definitionId]
      if (!def) return
      const geom = def.geometry
      const sel: Selection = {
        edgeIds: Object.keys(geom.edges).filter(
          (id) => !geom.edges[id].hidden && s.isTagVisible(geom.edges[id].tagId),
        ),
        faceIds: Object.keys(geom.faces).filter(
          (id) => !geom.faces[id].hidden && s.isTagVisible(geom.faces[id].tagId),
        ),
        vertexIds: [],
        entityIds: def.children.filter((id) => {
          const entity = s.doc.entities[id]
          return entity !== undefined && !entity.hidden && !entity.locked && s.isTagVisible(entity.tagId)
        }),
      }
      applySelection(sel)
    },

    invertSelection() {
      const s = get()
      const def = s.doc.definitions[s.context.definitionId]
      if (!def) return
      const geom = def.geometry
      const current = s.selection
      const edgeSet = new Set(current.edgeIds)
      const faceSet = new Set(current.faceIds)
      const entitySet = new Set(current.entityIds)
      applySelection({
        edgeIds: Object.keys(geom.edges).filter((id) => !edgeSet.has(id) && !geom.edges[id].hidden),
        faceIds: Object.keys(geom.faces).filter((id) => !faceSet.has(id) && !geom.faces[id].hidden),
        vertexIds: [],
        entityIds: def.children.filter((id) => {
          const entity = s.doc.entities[id]
          return entity !== undefined && !entitySet.has(id) && !entity.hidden && !entity.locked
        }),
      })
    },

    addToSelection(sel) {
      const current = get().selection
      applySelection(
        normalizeSelection({
          edgeIds: [...current.edgeIds, ...(sel.edgeIds ?? [])],
          faceIds: [...current.faceIds, ...(sel.faceIds ?? [])],
          vertexIds: [...current.vertexIds, ...(sel.vertexIds ?? [])],
          entityIds: [...current.entityIds, ...(sel.entityIds ?? [])],
        }),
      )
    },

    removeFromSelection(sel) {
      const current = get().selection
      const drop = (list: Id[], remove?: Id[]) => {
        if (!remove || remove.length === 0) return list
        const set = new Set(remove)
        return list.filter((id) => !set.has(id))
      }
      applySelection({
        edgeIds: drop(current.edgeIds, sel.edgeIds),
        faceIds: drop(current.faceIds, sel.faceIds),
        vertexIds: drop(current.vertexIds, sel.vertexIds),
        entityIds: drop(current.entityIds, sel.entityIds),
      })
    },

    toggleSelection(sel) {
      const current = get().selection
      const toggle = (list: Id[], other?: Id[]): Id[] => {
        if (!other || other.length === 0) return list
        const result = new Set(list)
        for (const id of other) {
          if (result.has(id)) result.delete(id)
          else result.add(id)
        }
        return Array.from(result)
      }
      applySelection({
        edgeIds: toggle(current.edgeIds, sel.edgeIds),
        faceIds: toggle(current.faceIds, sel.faceIds),
        vertexIds: toggle(current.vertexIds, sel.vertexIds),
        entityIds: toggle(current.entityIds, sel.entityIds),
      })
    },

    growSelection(mode) {
      const s = get()
      const geom = s.getActiveGeometry()
      const sel = s.selection

      switch (mode) {
        /* Doppelklick auf eine Flaeche: Flaeche + ihre Randkanten */
        case 'boundingEdges': {
          const edgeIds = new Set(sel.edgeIds)
          for (const id of G.boundingEdges(geom, sel.faceIds)) edgeIds.add(id)
          // umgekehrt: bei ausgewaehlten Kanten die angrenzenden Flaechen mitnehmen
          const faceIds = new Set(sel.faceIds)
          if (sel.faceIds.length === 0) {
            for (const eid of sel.edgeIds) {
              for (const fid of geom.edges[eid]?.faces ?? []) {
                faceIds.add(fid)
                for (const id of G.boundingEdges(geom, [fid])) edgeIds.add(id)
              }
            }
          }
          applySelection({ ...sel, edgeIds: Array.from(edgeIds), faceIds: Array.from(faceIds) })
          break
        }

        /* Dreifachklick: alles Zusammenhaengende */
        case 'connected': {
          const found =
            kernelCall(
              () => core.findConnected(geom, { edgeIds: sel.edgeIds, faceIds: sel.faceIds }),
              () => G.findConnected(geom, sel),
              'Zusammenhaengendes auswaehlen',
            ) ?? G.findConnected(geom, sel)
          applySelection({
            edgeIds: found.edgeIds,
            faceIds: found.faceIds,
            vertexIds: [],
            entityIds: sel.entityIds,
          })
          break
        }

        case 'coplanar': {
          const faceIds = new Set(sel.faceIds)
          for (const id of sel.faceIds) {
            const coplanar =
              kernelCall(
                () => core.findCoplanar(geom, id),
                () => G.findCoplanar(geom, id),
                'Koplanares auswaehlen',
              ) ?? []
            for (const fid of coplanar) faceIds.add(fid)
          }
          applySelection({ ...sel, faceIds: Array.from(faceIds) })
          break
        }

        case 'sameMaterial': {
          const reference =
            sel.faceIds.map((id) => geom.faces[id]?.frontMaterialId).find((m) => m !== undefined) ??
            sel.edgeIds.map((id) => geom.edges[id]?.materialId).find((m) => m !== undefined) ??
            null
          applySelection({
            edgeIds: Object.keys(geom.edges).filter((id) => geom.edges[id].materialId === reference),
            faceIds: Object.keys(geom.faces).filter((id) => geom.faces[id].frontMaterialId === reference),
            vertexIds: [],
            entityIds: (s.doc.definitions[s.context.definitionId]?.children ?? []).filter((id) => {
              const entity = s.doc.entities[id]
              return entity?.type === 'instance' && entity.materialId === reference
            }),
          })
          break
        }

        case 'sameTag': {
          const reference =
            sel.faceIds.map((id) => geom.faces[id]?.tagId).find((t) => t !== undefined) ??
            sel.edgeIds.map((id) => geom.edges[id]?.tagId).find((t) => t !== undefined) ??
            sel.entityIds.map((id) => s.doc.entities[id]?.tagId).find((t) => t !== undefined) ??
            null
          applySelection({
            edgeIds: Object.keys(geom.edges).filter((id) => geom.edges[id].tagId === reference),
            faceIds: Object.keys(geom.faces).filter((id) => geom.faces[id].tagId === reference),
            vertexIds: [],
            entityIds: (s.doc.definitions[s.context.definitionId]?.children ?? []).filter(
              (id) => s.doc.entities[id]?.tagId === reference,
            ),
          })
          break
        }
      }
    },

    isSelected(kind, id) {
      const sel = get().selection
      switch (kind) {
        case 'edge':
          return sel.edgeIds.includes(id)
        case 'face':
          return sel.faceIds.includes(id)
        case 'vertex':
          return sel.vertexIds.includes(id)
        case 'entity':
          return sel.entityIds.includes(id)
        default:
          return false
      }
    },

    setHover(hover) {
      const current = get().hover
      if (current === hover) return
      if (current && hover && current.kind === hover.kind && current.id === hover.id) return
      set({ hover })
      bus.emit('render:request')
    },

    /* ================================================================ */
    /* Materialien                                                      */
    /* ================================================================ */

    addMaterial(material) {
      return get().operation('Material hinzufuegen', () =>
        editDoc((doc) => {
          const id = material.id ?? newId('m')
          touchMap(doc, 'materials', history.touch)
          doc.materials[id] = normalizeMaterial({ ...material, id })
          markMaterial()
          return id
        }),
      )
    },

    updateMaterial(id, patch) {
      get().operation('Material aendern', () =>
        editDoc((doc) => {
          const material = touchMaterial(doc, id, history.touch)
          if (!material) return
          Object.assign(material, normalizeMaterial({ ...material, ...patch, id }))
          markMaterial()
        }),
      )
    },

    removeMaterial(id) {
      get().operation('Material entfernen', () =>
        editDoc((doc) => {
          if (!doc.materials[id]) return
          clearMaterialReferences(doc, id)
          touchMap(doc, 'materials', history.touch)
          delete doc.materials[id]
          if (doc.activeMaterialId === id) doc.activeMaterialId = null
          markMaterial()
          markGeometry()
        }),
      )
    },

    addTexture(texture) {
      return get().operation('Textur hinzufuegen', () =>
        editDoc((doc) => {
          const id = texture.id ?? newId('x')
          touchMap(doc, 'textures', history.touch)
          doc.textures[id] = {
            id,
            name: texture.name,
            dataUrl: texture.dataUrl,
            width: texture.width,
            height: texture.height,
          }
          markMaterial()
          return id
        }),
      )
    },

    /** Aktives Material = Werkzeugzustand, nicht undo-bar (siehe `setActiveTag`). */
    setActiveMaterial(id) {
      if (id !== null && !get().doc.materials[id]) return
      editDoc((doc) => {
        doc.activeMaterialId = id
      })
      bus.emit('material:changed', id ? { materialId: id } : {})
      bus.emit('render:request')
    },

    applyMaterial(target, materialId, side = 'front') {
      get().operation('Material zuweisen', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          if (!def) return
          let touchedGeometry = false

          for (const id of target.faceIds ?? []) {
            const face = def.geometry.faces[id]
            if (!face) continue
            if (side === 'front' || side === 'both') face.frontMaterialId = materialId
            if (side === 'back' || side === 'both') face.backMaterialId = materialId
            touchedGeometry = true
          }
          for (const id of target.edgeIds ?? []) {
            const edge = def.geometry.edges[id]
            if (!edge) continue
            edge.materialId = materialId
            touchedGeometry = true
          }
          for (const id of target.entityIds ?? []) {
            const entity = touchEntity(doc, id, history.touch)
            if (entity && entity.type === 'instance') {
              entity.materialId = materialId
              markScene()
            }
          }
          if (touchedGeometry) {
            invalidateCaches(def.geometry, target.faceIds ?? [])
            markGeometry(def.id)
          }
          markMaterial()
        }),
      )
    },

    sampleMaterial(kind, id, side = 'front') {
      const s = get()
      const geom = s.getActiveGeometry()
      switch (kind) {
        case 'face': {
          const face = geom.faces[id]
          if (!face) return null
          return side === 'back' ? face.backMaterialId : face.frontMaterialId
        }
        case 'edge':
          return geom.edges[id]?.materialId ?? null
        case 'entity': {
          const entity = s.doc.entities[id]
          return entity && entity.type === 'instance' ? entity.materialId : null
        }
        default:
          return null
      }
    },

    setFaceUv(faceId, side, uv) {
      get().operation('Textur positionieren', () =>
        editDoc((doc) => {
          const def = touchActive(doc)
          const face = def?.geometry.faces[faceId]
          if (!def || !face) return
          if (side === 'front') face.uvFront = uv
          else face.uvBack = uv
          invalidateCaches(def.geometry, [faceId])
          markGeometry(def.id)
          markMaterial()
        }),
      )
    },

    /* ================================================================ */
    /* Tags                                                             */
    /* ================================================================ */

    addTag(name) {
      return get().operation('Tag hinzufuegen', () =>
        editDoc((doc) => {
          const id = newId('t')
          touchMap(doc, 'tags', history.touch)
          doc.tags[id] = {
            id,
            name: uniqueTagName(doc, name || 'Tag'),
            visible: true,
            color: '#8a8f98',
            dashes: 'solid',
            folderId: null,
            locked: false,
          }
          markStyle()
          return id
        }),
      )
    },

    updateTag(id, patch) {
      get().operation('Tag aendern', () =>
        editDoc((doc) => {
          const tag = touchTag(doc, id, history.touch)
          if (!tag) return
          const { id: _ignored, ...rest } = patch
          Object.assign(tag, rest)
          markStyle()
        }),
      )
    },

    removeTag(id, reassignTo) {
      const state = get()
      const doc = state.doc
      if (!doc.tags[id]) return
      if (id === defaultTagId(doc)) {
        state.toast(`"${DEFAULT_TAG_NAME}" kann nicht geloescht werden`, 'warn')
        return
      }
      state.operation('Tag loeschen', () =>
        editDoc((next) => {
          const fallback = reassignTo && next.tags[reassignTo] ? reassignTo : defaultTagId(next)
          reassignTag(next, id, fallback)
          touchMap(next, 'tags', history.touch)
          delete next.tags[id]
          if (next.activeTagId === id) next.activeTagId = fallback
          for (const scene of next.scenes) {
            if (scene.tagVisibility[id] !== undefined) {
              const scenes = touchScenes(next, history.touch)
              for (const s2 of scenes) delete s2.tagVisibility[id]
              break
            }
          }
          markStyle()
          markScene()
          markGeometry()
        }),
      )
    },

    /**
     * Aktives Tag = Werkzeugzustand, kein Modellinhalt: bewusst OHNE Operation,
     * damit Strg+Z die letzte Geometrieaenderung zuruecknimmt und nicht die
     * Tag-Auswahl umspringt. Wird trotzdem mitserialisiert (Nutzer findet seine
     * Auswahl beim Oeffnen wieder), deshalb `dirty`. Gleiche Regel wie bei
     * `setActiveMaterial`. (Festgelegt vom Lead.)
     */
    setActiveTag(id) {
      if (!get().doc.tags[id]) return
      editDoc((doc) => {
        doc.activeTagId = id
      })
      bus.emit('style:changed')
      bus.emit('render:request')
    },

    addTagFolder(name) {
      return get().operation('Tag-Ordner hinzufuegen', () =>
        editDoc((doc) => {
          const id = newId('t')
          touchMap(doc, 'tagFolders', history.touch)
          doc.tagFolders[id] = { id, name: name || 'Ordner', visible: true }
          markStyle()
          return id
        }),
      )
    },

    updateTagFolder(id, patch) {
      get().operation('Tag-Ordner aendern', () =>
        editDoc((doc) => {
          const folder = touchTagFolder(doc, id, history.touch)
          if (!folder) return
          const { id: _ignored, ...rest } = patch
          Object.assign(folder, rest)
          markStyle()
        }),
      )
    },

    removeTagFolder(id) {
      get().operation('Tag-Ordner loeschen', () =>
        editDoc((doc) => {
          if (!doc.tagFolders[id]) return
          for (const tagId of Object.keys(doc.tags)) {
            if (doc.tags[tagId].folderId === id) {
              const tag = touchTag(doc, tagId, history.touch)
              if (tag) tag.folderId = null
            }
          }
          touchMap(doc, 'tagFolders', history.touch)
          delete doc.tagFolders[id]
          markStyle()
        }),
      )
    },

    /* ================================================================ */
    /* Stile, Sonne, Nebel                                              */
    /* ================================================================ */

    updateStyle(patch) {
      get().operation('Stil aendern', () =>
        editDoc((doc) => {
          const style = touchStyle(doc, doc.activeStyleId, history.touch)
          if (!style) return
          const { id: _ignored, ...rest } = patch
          Object.assign(style, rest)
          markStyle()
        }),
      )
    },

    addStyle(style) {
      return get().operation('Stil hinzufuegen', () =>
        editDoc((doc) => {
          const id = style.id || newId('c')
          touchMap(doc, 'styles', history.touch)
          doc.styles[id] = { ...style, id }
          markStyle()
          return id
        }),
      )
    },

    setActiveStyle(id) {
      get().operation('Stil waehlen', () =>
        editDoc((doc) => {
          if (!doc.styles[id]) return
          doc.activeStyleId = id
          markStyle()
        }),
      )
    },

    updateSun(patch) {
      get().operation('Sonne aendern', () =>
        editDoc((doc) => {
          doc.sun = { ...doc.sun, ...patch }
          markStyle()
        }),
      )
    },

    updateFog(patch) {
      get().operation('Nebel aendern', () =>
        editDoc((doc) => {
          doc.fog = { ...doc.fog, ...patch }
          markStyle()
        }),
      )
    },

    /* ================================================================ */
    /* Szenen                                                           */
    /* ================================================================ */

    addScene(name) {
      return get().operation('Szene hinzufuegen', () =>
        editDoc((doc) => {
          const hidden = Object.keys(doc.entities).filter((id) => doc.entities[id].hidden)
          const scenes = touchScenes(doc, history.touch)
          const scene = createSceneFromDocument(doc, lastCamera, name || `Szene ${scenes.length + 1}`, hidden)
          scenes.push(scene)
          markScene()
          return scene.id
        }),
      )
    },

    updateScene(id, patch) {
      get().operation('Szene aendern', () =>
        editDoc((doc) => {
          const scenes = touchScenes(doc, history.touch)
          const index = scenes.findIndex((s) => s.id === id)
          if (index < 0) return
          const { id: _ignored, ...rest } = patch
          scenes[index] = { ...scenes[index], ...rest, id }
          markScene()
        }),
      )
    },

    removeScene(id) {
      get().operation('Szene loeschen', () =>
        editDoc((doc) => {
          if (!doc.scenes.some((s) => s.id === id)) return
          touchScenes(doc, history.touch)
          doc.scenes = doc.scenes.filter((s) => s.id !== id)
          markScene()
        }),
      )
    },

    reorderScene(id, index) {
      get().operation('Szenen ordnen', () =>
        editDoc((doc) => {
          const current = doc.scenes.findIndex((s) => s.id === id)
          if (current < 0) return
          const scenes = touchScenes(doc, history.touch)
          const [scene] = scenes.splice(current, 1)
          scenes.splice(Math.max(0, Math.min(scenes.length, index)), 0, scene)
          markScene()
        }),
      )
    },

    activateScene(id) {
      const state = get()
      const scene = state.doc.scenes.find((s) => s.id === id)
      if (!scene) return

      state.operation(`Szene "${scene.name}"`, () =>
        editDoc((doc) => {
          if (scene.saves.tagVisibility) {
            for (const tagId of Object.keys(scene.tagVisibility)) {
              const tag = doc.tags[tagId]
              if (!tag || tag.visible === scene.tagVisibility[tagId]) continue
              const touched = touchTag(doc, tagId, history.touch)
              if (touched) touched.visible = scene.tagVisibility[tagId]
            }
            markStyle()
          }
          if (scene.saves.style && doc.styles[scene.styleId]) {
            doc.activeStyleId = scene.styleId
            markStyle()
          }
          if (scene.saves.shadows) {
            doc.sun = { ...scene.sun }
            doc.fog = { ...scene.fog }
            markStyle()
          }
          if (scene.saves.hiddenGeometry) {
            const hidden = new Set(scene.hiddenEntityIds)
            for (const entityId of Object.keys(doc.entities)) {
              const shouldHide = hidden.has(entityId)
              if (doc.entities[entityId].hidden === shouldHide) continue
              const touched = touchEntity(doc, entityId, history.touch)
              if (touched) touched.hidden = shouldHide
            }
            markScene()
          }
          if (scene.saves.sectionPlanes) {
            for (const entityId of Object.keys(doc.entities)) {
              const entity = doc.entities[entityId]
              if (entity.type !== 'sectionPlane') continue
              const active = entityId === scene.activeSectionPlaneId
              if (entity.active === active) continue
              const touched = touchEntity(doc, entityId, history.touch)
              if (touched && touched.type === 'sectionPlane') touched.active = active
            }
            markScene()
          }
        }),
      )

      if (scene.saves.camera) {
        lastCamera = scene.camera
        bus.emit('scene:activate', scene)
      }
    },

    updateSceneFromView(id) {
      get().operation('Szene aktualisieren', () =>
        editDoc((doc) => {
          const scenes = touchScenes(doc, history.touch)
          const index = scenes.findIndex((s) => s.id === id)
          if (index < 0) return
          const hidden = Object.keys(doc.entities).filter((entityId) => doc.entities[entityId].hidden)
          const refreshed = createSceneFromDocument(doc, lastCamera, scenes[index].name, hidden)
          scenes[index] = {
            ...refreshed,
            id: scenes[index].id,
            description: scenes[index].description,
            saves: { ...scenes[index].saves },
            transitionTime: scenes[index].transitionTime,
            delayTime: scenes[index].delayTime,
            included: scenes[index].included,
          }
          markScene()
        }),
      )
    },

    /* ================================================================ */
    /* Werkzeuge & Oberflaeche                                          */
    /* ================================================================ */

    setActiveTool(tool) {
      const s = get()
      if (s.activeTool === tool) return
      set({ activeTool: tool, previousTool: s.activeTool })
      bus.emit('tool:changed', { id: tool })
    },

    restorePreviousTool() {
      const s = get()
      const previous: ToolId = s.previousTool
      if (previous === s.activeTool) return
      set({ activeTool: previous, previousTool: s.activeTool })
      bus.emit('tool:changed', { id: previous })
    },

    setStatus(hint, modifiers = '') {
      const ui = get().ui
      if (ui.statusHint === hint && ui.statusModifiers === modifiers) return
      set({ ui: { ...ui, statusHint: hint, statusModifiers: modifiers } })
    },

    setVcb(patch) {
      set({ ui: { ...get().ui, ...patch } })
    },

    togglePanel(panel) {
      const ui = get().ui
      const open = ui.openPanels.includes(panel)
      const openPanels = open ? ui.openPanels.filter((p) => p !== panel) : [...ui.openPanels, panel]
      const activePanel = open
        ? ui.activePanel === panel
          ? (openPanels[openPanels.length - 1] ?? null)
          : ui.activePanel
        : panel
      set({ ui: { ...ui, openPanels, activePanel, trayVisible: openPanels.length > 0 ? true : ui.trayVisible } })
    },

    setActivePanel(panel) {
      const ui = get().ui
      const openPanels = panel && !ui.openPanels.includes(panel) ? [...ui.openPanels, panel] : ui.openPanels
      set({ ui: { ...ui, activePanel: panel, openPanels } })
    },

    setTrayVisible(visible) {
      set({ ui: { ...get().ui, trayVisible: visible } })
    },

    setTheme(theme) {
      set({ ui: { ...get().ui, theme } })
    },

    openDialog(dialog) {
      set({ ui: { ...get().ui, dialog } })
    },

    closeDialog() {
      if (!get().ui.dialog) return
      set({ ui: { ...get().ui, dialog: null } })
    },

    toast(text, kind = 'info') {
      const id = newId('n')
      const ui = get().ui
      set({ ui: { ...ui, toasts: [...ui.toasts, { id, text, kind }] } })
      const timer = setTimeout(() => get().dismissToast(id), 4000)
      // Node soll wegen eines Toasts nicht am Leben bleiben (Tests, SSR)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    },

    dismissToast(id) {
      const ui = get().ui
      if (!ui.toasts.some((t) => t.id === id)) return
      set({ ui: { ...ui, toasts: ui.toasts.filter((t) => t.id !== id) } })
    },

    setBusy(label) {
      if (get().ui.busy === label) return
      set({ ui: { ...get().ui, busy: label } })
    },

    setStats(stats) {
      const ui = get().ui
      set({ ui: { ...ui, stats: { ...ui.stats, ...stats } } })
    },

    setDirty(dirty) {
      if (get().dirty === dirty) return
      set({ dirty })
    },
  }
})

function entityTypeLabel(type: Entity['type'], count: number): string {
  switch (type) {
    case 'instance':
      return pluralKind(count, 'Objekt', 'Objekte')
    case 'dimension':
      return pluralKind(count, 'Bemassung', 'Bemassungen')
    case 'text':
      return pluralKind(count, 'Text', 'Texte')
    case 'sectionPlane':
      return pluralKind(count, 'Schnittebene', 'Schnittebenen')
    case 'guidePoint':
      return pluralKind(count, 'Hilfspunkt', 'Hilfspunkte')
    case 'guideLine':
      return pluralKind(count, 'Hilfslinie', 'Hilfslinien')
    case 'image':
      return pluralKind(count, 'Bild', 'Bilder')
    default:
      return 'Objekte'
  }
}

/* ------------------------------------------------------------------ */
/* Handle fuer alles ausserhalb von React                              */
/* ------------------------------------------------------------------ */

export const store: StoreHandle = {
  getState: useStore.getState,
  setState: useStore.setState,
  subscribe: useStore.subscribe,
}

/** Nur fuer Tests: setzt Store und Historie auf einen frischen Stand. */
export function resetStoreForTests(template: 'metric' | 'imperial' | 'empty' = 'metric'): void {
  reportedGaps.clear()
  lastCamera = createDefaultCamera()
  useStore.setState({
    geometryRevision: 0,
    sceneRevision: 0,
    materialRevision: 0,
    styleRevision: 0,
    selectionRevision: 0,
    hover: null,
    activeTool: 'select',
    previousTool: 'select',
    ui: initialUi(),
  })
  useStore.getState().newDocument(template)
}
