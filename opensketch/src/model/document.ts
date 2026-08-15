/**
 * Dokumenterzeugung und Navigation im Dokumentbaum.
 *
 * Alles hier ist REIN: keine Funktion veraendert ein uebergebenes Dokument.
 * Mutationen passieren ausschliesslich im Store (`./store.ts`).
 *
 * OWNERSHIP: Model.
 */

import type {
  BBox3Like,
  CameraState,
  Definition,
  DocumentMeta,
  Entity,
  FogSettings,
  Geometry,
  Id,
  InstanceEntity,
  Mat4Like,
  Scene,
  SketchDocument,
  StyleSettings,
  SunSettings,
  Tag,
  UnitSettings,
  Vec3Like,
} from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { bumpIdCounter, newId } from '@/shared/ids'
import { DEFAULT_UNITS, IMPERIAL_UNITS } from '@/shared/units'
import { B, M, V } from '@/core/math'
import { createDefaultMaterials } from './materials'
import { cloneGeometry, geometryBounds } from './geometry-utils'

export type DocumentTemplate = 'metric' | 'imperial' | 'empty'

/** Schemaversion des nativen Formats - wird von `serialize.ts` mitgeschrieben. */
export const DOCUMENT_VERSION = 1

/** Name des Standard-Tags. Dieses Tag ist nicht loeschbar. */
export const DEFAULT_TAG_NAME = 'Ohne Tag'

/* ------------------------------------------------------------------ */
/* Bausteine                                                           */
/* ------------------------------------------------------------------ */

export function createDefaultStyle(): StyleSettings {
  return {
    id: newId('c'),
    name: 'Standard (Architektur)',
    faceStyle: 'shadedWithTextures',
    xrayOpacity: 0.35,
    displayEdges: true,
    displayProfiles: true,
    profileWidth: 2,
    displayDepthCue: false,
    depthCueWidth: 4,
    displayExtensions: false,
    extensionLength: 6,
    displayEndpoints: false,
    endpointSize: 6,
    jitterEdges: false,
    edgeColor: '#1c1c1c',
    edgeColorMode: 'all',
    frontColor: '#f4f2ed',
    backColor: '#8fa6ba',
    backgroundColor: '#e9edf1',
    skyColor: '#7fa9d6',
    groundColor: '#8f8579',
    displaySky: true,
    displayGround: true,
    groundTransparency: 0.35,
    showAxes: true,
    showGrid: false,
    gridSpacing: 1,
    showHiddenGeometry: false,
    showSectionPlanes: true,
    showSectionCuts: true,
    sectionCutFill: '#c9c9c9',
    sectionLineWidth: 3,
  }
}

/**
 * Sonnenstand Mitteleuropa: Berlin, 21. Juni, 12:00 Ortszeit.
 * `enabled` ist aus - Schatten kosten Leistung und werden bewusst zugeschaltet.
 */
export function createDefaultSun(): SunSettings {
  return {
    enabled: false,
    date: '2024-06-21',
    time: 12 * 60,
    latitude: 52.52,
    longitude: 13.405,
    timezone: 1,
    light: 0.8,
    dark: 0.45,
    onFaces: true,
    onGround: true,
    fromEdges: false,
    northAngle: 0,
    locationName: 'Berlin, Deutschland',
  }
}

export function createDefaultFog(): FogSettings {
  return { enabled: false, near: 5, far: 120, color: '#e9edf1', useBackgroundColor: true }
}

export function createDefaultTag(): Tag {
  return {
    id: newId('t'),
    name: DEFAULT_TAG_NAME,
    visible: true,
    color: '#8a8f98',
    dashes: 'solid',
    folderId: null,
    locked: false,
  }
}

/** Standardkamera: isometrischer Blick auf den Ursprung (Z ist oben). */
export function createDefaultCamera(): CameraState {
  return {
    eye: { x: 12, y: -16, z: 9 },
    target: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 0, z: 1 },
    fov: 35,
    projection: 'perspective',
    orthoHeight: 12,
    twoPointPerspective: false,
  }
}

function createMeta(name: string): DocumentMeta {
  const now = new Date().toISOString()
  return {
    name,
    author: '',
    description: '',
    createdAt: now,
    modifiedAt: now,
    version: DOCUMENT_VERSION,
  }
}

/* ------------------------------------------------------------------ */
/* Dokument                                                            */
/* ------------------------------------------------------------------ */

/**
 * Erzeugt ein leeres Standarddokument.
 *
 *  - `metric`   metrische Einheiten (mm) + komplette Materialbibliothek
 *  - `imperial` Fuss/Zoll (architektonisch) + komplette Materialbibliothek
 *  - `empty`    metrisch, aber ohne Materialbibliothek (Basis fuer Importe)
 */
export function createEmptyDocument(template: DocumentTemplate = 'metric'): SketchDocument {
  const root: Definition = {
    id: newId('d'),
    name: 'Modell',
    kind: 'model',
    description: 'Wurzel des Modells',
    geometry: emptyGeometry(),
    children: [],
    instanceCount: 1,
  }

  const tag = createDefaultTag()
  const style = createDefaultStyle()

  const units: UnitSettings =
    template === 'imperial' ? { ...IMPERIAL_UNITS } : { ...DEFAULT_UNITS }

  const materials = template === 'empty' ? [] : createDefaultMaterials()

  return {
    meta: createMeta('Unbenannt'),
    rootId: root.id,
    definitions: { [root.id]: root },
    entities: {},
    materials: Object.fromEntries(materials.map((m) => [m.id, m])),
    textures: {},
    tags: { [tag.id]: tag },
    tagFolders: {},
    styles: { [style.id]: style },
    scenes: [],
    units,
    sun: createDefaultSun(),
    fog: createDefaultFog(),
    activeStyleId: style.id,
    activeTagId: tag.id,
    activeMaterialId: null,
  }
}

/** Tiefe, serialisierbare Kopie. */
export function cloneDocument(doc: SketchDocument): SketchDocument {
  const definitions: Record<Id, Definition> = {}
  for (const id of Object.keys(doc.definitions)) {
    const def = doc.definitions[id]
    definitions[id] = { ...def, geometry: cloneGeometry(def.geometry), children: def.children.slice() }
  }
  const entities: Record<Id, Entity> = {}
  for (const id of Object.keys(doc.entities)) entities[id] = cloneEntity(doc.entities[id])

  return {
    meta: { ...doc.meta },
    rootId: doc.rootId,
    definitions,
    entities,
    materials: mapValues(doc.materials, (m) => ({ ...m })),
    textures: mapValues(doc.textures, (t) => ({ ...t })),
    tags: mapValues(doc.tags, (t) => ({ ...t })),
    tagFolders: mapValues(doc.tagFolders, (f) => ({ ...f })),
    styles: mapValues(doc.styles, (s) => ({ ...s })),
    scenes: doc.scenes.map(cloneScene),
    units: { ...doc.units },
    sun: { ...doc.sun },
    fog: { ...doc.fog },
    activeStyleId: doc.activeStyleId,
    activeTagId: doc.activeTagId,
    activeMaterialId: doc.activeMaterialId,
  }
}

export function cloneEntity(entity: Entity): Entity {
  switch (entity.type) {
    case 'instance':
      return { ...entity, transform: M.clone(entity.transform) }
    case 'image':
      return { ...entity, transform: M.clone(entity.transform) }
    case 'dimension':
      return {
        ...entity,
        start: { ...entity.start },
        end: { ...entity.end },
        offset: { ...entity.offset },
        center: entity.center ? { ...entity.center } : undefined,
      }
    case 'text':
      return { ...entity, anchor: { ...entity.anchor }, position: { ...entity.position } }
    case 'sectionPlane':
      return { ...entity, plane: { n: { ...entity.plane.n }, d: entity.plane.d } }
    case 'guidePoint':
      return { ...entity, position: { ...entity.position }, from: entity.from ? { ...entity.from } : undefined }
    case 'guideLine':
      return { ...entity, origin: { ...entity.origin }, direction: { ...entity.direction } }
    default:
      return { ...entity }
  }
}

export function cloneScene(scene: Scene): Scene {
  return {
    ...scene,
    camera: cloneCamera(scene.camera),
    saves: { ...scene.saves },
    tagVisibility: { ...scene.tagVisibility },
    sun: { ...scene.sun },
    fog: { ...scene.fog },
    hiddenEntityIds: scene.hiddenEntityIds.slice(),
  }
}

export function cloneCamera(camera: CameraState): CameraState {
  return { ...camera, eye: { ...camera.eye }, target: { ...camera.target }, up: { ...camera.up } }
}

function mapValues<T>(record: Record<Id, T>, fn: (value: T) => T): Record<Id, T> {
  const out: Record<Id, T> = {}
  for (const id of Object.keys(record)) out[id] = fn(record[id])
  return out
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

/**
 * Id des Standard-Tags ("Ohne Tag"). Es ist immer das erste angelegte Tag;
 * fallweise wird ueber den Namen gesucht, damit auch importierte Dokumente
 * funktionieren.
 */
export function defaultTagId(doc: SketchDocument): Id {
  const ids = Object.keys(doc.tags)
  for (const id of ids) if (doc.tags[id].name === DEFAULT_TAG_NAME) return id
  return ids[0] ?? doc.activeTagId
}

export function isDefaultTag(doc: SketchDocument, tagId: Id): boolean {
  return tagId === defaultTagId(doc)
}

/** true, wenn das Tag und alle uebergeordneten Ordner sichtbar sind. */
export function isTagVisible(doc: SketchDocument, tagId: Id | null): boolean {
  if (tagId === null) return true
  const tag = doc.tags[tagId]
  if (!tag) return true
  if (!tag.visible) return false
  if (tag.folderId) {
    const folder = doc.tagFolders[tag.folderId]
    if (folder && !folder.visible) return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Navigation im Dokumentbaum                                          */
/* ------------------------------------------------------------------ */

/** Weltmatrix eines Instanzpfads (Modellwurzel -> ... -> Instanz). */
export function worldTransformOf(doc: SketchDocument, instancePath: readonly Id[]): Mat4Like {
  let m: Mat4Like = M.identity()
  for (const id of instancePath) {
    const entity = doc.entities[id]
    if (!entity || entity.type !== 'instance') continue
    m = M.multiply(m, entity.transform)
  }
  return m
}

/** Definitionspfad passend zu einem Instanzpfad. */
export function definitionPathOf(doc: SketchDocument, instancePath: readonly Id[]): Id[] {
  const path: Id[] = [doc.rootId]
  for (const id of instancePath) {
    const entity = doc.entities[id]
    if (!entity || entity.type !== 'instance') continue
    path.push(entity.definitionId)
  }
  return path
}

/** Definition, in deren `children` die Entity haengt. */
export function ownerDefinitionOf(doc: SketchDocument, entityId: Id): Definition | undefined {
  for (const id of Object.keys(doc.definitions)) {
    const def = doc.definitions[id]
    if (def.children.includes(entityId)) return def
  }
  return undefined
}

/** Alle Instanzen einer Definition im gesamten Dokument. */
export function instancesOf(doc: SketchDocument, definitionId: Id): InstanceEntity[] {
  const out: InstanceEntity[] = []
  for (const id of Object.keys(doc.entities)) {
    const entity = doc.entities[id]
    if (entity.type === 'instance' && entity.definitionId === definitionId) out.push(entity)
  }
  return out
}

export function instanceCount(doc: SketchDocument, definitionId: Id): number {
  return instancesOf(doc, definitionId).length
}

export interface DefinitionUsage {
  /** Ids aller Instanzen dieser Definition */
  instanceIds: Id[]
  /** Definitionen, die mindestens eine dieser Instanzen enthalten */
  parentDefinitionIds: Id[]
  /** true, wenn die Definition (transitiv) von der Modellwurzel erreichbar ist */
  reachable: boolean
}

export function definitionUsage(doc: SketchDocument, definitionId: Id): DefinitionUsage {
  const instanceIds = instancesOf(doc, definitionId).map((i) => i.id)
  const parents = new Set<Id>()
  for (const entityId of instanceIds) {
    const owner = ownerDefinitionOf(doc, entityId)
    if (owner) parents.add(owner.id)
  }
  return {
    instanceIds,
    parentDefinitionIds: Array.from(parents),
    reachable: reachableDefinitionIds(doc).has(definitionId),
  }
}

/** Alle von der Modellwurzel aus erreichbaren Definitionen. */
export function reachableDefinitionIds(doc: SketchDocument): Set<Id> {
  const seen = new Set<Id>()
  const queue: Id[] = [doc.rootId]
  while (queue.length > 0) {
    const id = queue.pop() as Id
    if (seen.has(id)) continue
    seen.add(id)
    const def = doc.definitions[id]
    if (!def) continue
    for (const childId of def.children) {
      const child = doc.entities[childId]
      if (child && child.type === 'instance' && !seen.has(child.definitionId)) queue.push(child.definitionId)
    }
  }
  return seen
}

/** true, wenn `candidate` (transitiv) `definitionId` enthaelt - schuetzt vor Zyklen. */
export function definitionContains(doc: SketchDocument, candidate: Id, definitionId: Id): boolean {
  if (candidate === definitionId) return true
  const seen = new Set<Id>()
  const queue: Id[] = [candidate]
  while (queue.length > 0) {
    const id = queue.pop() as Id
    if (seen.has(id)) continue
    seen.add(id)
    const def = doc.definitions[id]
    if (!def) continue
    for (const childId of def.children) {
      const child = doc.entities[childId]
      if (!child || child.type !== 'instance') continue
      if (child.definitionId === definitionId) return true
      queue.push(child.definitionId)
    }
  }
  return false
}

/** Freier Definitionsname ("Komponente", "Komponente#1", ...). */
export function uniqueDefinitionName(doc: SketchDocument, base: string): string {
  const taken = new Set<string>()
  for (const id of Object.keys(doc.definitions)) taken.add(doc.definitions[id].name)
  if (!taken.has(base)) return base
  for (let i = 1; i < 100000; i++) {
    const candidate = `${base}#${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}#${newId('n')}`
}

/** Freier Tagname. */
export function uniqueTagName(doc: SketchDocument, base: string): string {
  const taken = new Set<string>()
  for (const id of Object.keys(doc.tags)) taken.add(doc.tags[id].name)
  if (!taken.has(base)) return base
  for (let i = 1; i < 100000; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base} ${newId('n')}`
}

/* ------------------------------------------------------------------ */
/* Bounding-Boxen (memoisiert)                                         */
/* ------------------------------------------------------------------ */

/**
 * Memoisierung pro Dokumentobjekt.
 *
 * Der Store ersetzt bei JEDER Mutation das oberste `doc`-Objekt (Structural
 * Sharing), daher ist der Cache automatisch ungueltig, sobald sich etwas
 * aendert - ohne dass irgendwo invalidiert werden muss.
 */
const boundsCache = new WeakMap<SketchDocument, Map<Id, BBox3Like>>()

function cacheFor(doc: SketchDocument): Map<Id, BBox3Like> {
  let map = boundsCache.get(doc)
  if (!map) {
    map = new Map()
    boundsCache.set(doc, map)
  }
  return map
}

/** Bounding-Box einer Definition inklusive aller Kinder, im Definitionsraum. */
export function definitionBounds(doc: SketchDocument, definitionId: Id): BBox3Like {
  return definitionBoundsInternal(doc, definitionId, new Set())
}

function definitionBoundsInternal(doc: SketchDocument, definitionId: Id, visiting: Set<Id>): BBox3Like {
  const cache = cacheFor(doc)
  const cached = cache.get(definitionId)
  if (cached) return cached

  const def = doc.definitions[definitionId]
  if (!def || visiting.has(definitionId)) return B.empty()

  visiting.add(definitionId)
  let box = geometryBounds(def.geometry)
  for (const childId of def.children) {
    const child = doc.entities[childId]
    if (!child) continue
    const childBox = entityBounds(doc, child, visiting)
    if (!B.isEmpty(childBox)) box = B.union(box, childBox)
  }
  visiting.delete(definitionId)

  cache.set(definitionId, box)
  return box
}

/** Bounding-Box einer Entity im Raum der besitzenden Definition. */
export function entityBounds(doc: SketchDocument, entity: Entity, visiting = new Set<Id>()): BBox3Like {
  switch (entity.type) {
    case 'instance': {
      const inner = definitionBoundsInternal(doc, entity.definitionId, visiting)
      return B.isEmpty(inner) ? inner : B.transform(inner, entity.transform)
    }
    case 'guidePoint':
      return B.fromPoints([entity.position])
    case 'guideLine': {
      const points: Vec3Like[] = [entity.origin]
      if (entity.length !== null) points.push(V.addScaled(entity.origin, entity.direction, entity.length))
      return B.fromPoints(points)
    }
    case 'dimension':
      return B.fromPoints([entity.start, entity.end])
    case 'text':
      return B.fromPoints([entity.anchor, entity.position])
    case 'image': {
      const corners: Vec3Like[] = [
        { x: 0, y: 0, z: 0 },
        { x: entity.width, y: 0, z: 0 },
        { x: entity.width, y: entity.height, z: 0 },
        { x: 0, y: entity.height, z: 0 },
      ]
      return B.fromPoints(corners.map((c) => M.transformPoint(entity.transform, c)))
    }
    case 'sectionPlane':
    default:
      return B.empty()
  }
}

/** Bounding-Box des gesamten Modells (Wurzeldefinition). */
export function modelBounds(doc: SketchDocument): BBox3Like {
  return definitionBounds(doc, doc.rootId)
}

/* ------------------------------------------------------------------ */
/* Zaehler / Statistik                                                 */
/* ------------------------------------------------------------------ */

export interface DocumentStats {
  vertices: number
  edges: number
  faces: number
  instances: number
  definitions: number
  components: number
  groups: number
}

export function documentStats(doc: SketchDocument): DocumentStats {
  const stats: DocumentStats = {
    vertices: 0,
    edges: 0,
    faces: 0,
    instances: 0,
    definitions: 0,
    components: 0,
    groups: 0,
  }
  for (const id of Object.keys(doc.definitions)) {
    const def = doc.definitions[id]
    stats.definitions += 1
    if (def.kind === 'component') stats.components += 1
    if (def.kind === 'group') stats.groups += 1
    stats.vertices += Object.keys(def.geometry.vertices).length
    stats.edges += Object.keys(def.geometry.edges).length
    stats.faces += Object.keys(def.geometry.faces).length
  }
  for (const id of Object.keys(doc.entities)) {
    if (doc.entities[id].type === 'instance') stats.instances += 1
  }
  return stats
}

/** Geometrie einer Definition, `undefined` wenn es sie nicht gibt. */
export function geometryOf(doc: SketchDocument, definitionId: Id): Geometry | undefined {
  return doc.definitions[definitionId]?.geometry
}

/**
 * Hebt den globalen Id-Zaehler ueber alle im Dokument vorkommenden Ids, damit
 * neu erzeugte Ids nach dem Laden garantiert kollisionsfrei sind.
 */
export function syncIdCounter(doc: SketchDocument): void {
  let max = 0
  const consider = (id: string): void => {
    // Format: <prefix><session:3><counter in base36>
    if (id.length <= 4) return
    const value = Number.parseInt(id.slice(4), 36)
    if (Number.isFinite(value) && value > max) max = value
  }
  for (const id of Object.keys(doc.definitions)) {
    consider(id)
    const def = doc.definitions[id]
    for (const vid of Object.keys(def.geometry.vertices)) consider(vid)
    for (const eid of Object.keys(def.geometry.edges)) consider(eid)
    for (const fid of Object.keys(def.geometry.faces)) consider(fid)
  }
  for (const id of Object.keys(doc.entities)) consider(id)
  for (const id of Object.keys(doc.materials)) consider(id)
  for (const id of Object.keys(doc.textures)) consider(id)
  for (const id of Object.keys(doc.tags)) consider(id)
  for (const id of Object.keys(doc.tagFolders)) consider(id)
  for (const id of Object.keys(doc.styles)) consider(id)
  for (const scene of doc.scenes) consider(scene.id)
  bumpIdCounter(max + 1)
}

/* ------------------------------------------------------------------ */
/* Szenen                                                              */
/* ------------------------------------------------------------------ */

/** Erzeugt eine Szene aus dem aktuellen Dokumentzustand. */
export function createSceneFromDocument(
  doc: SketchDocument,
  camera: CameraState,
  name: string,
  hiddenEntityIds: Id[] = [],
): Scene {
  const tagVisibility: Record<Id, boolean> = {}
  for (const id of Object.keys(doc.tags)) tagVisibility[id] = doc.tags[id].visible

  return {
    id: newId('s'),
    name,
    description: '',
    camera: cloneCamera(camera),
    saves: {
      camera: true,
      tagVisibility: true,
      style: true,
      shadows: true,
      hiddenGeometry: true,
      sectionPlanes: true,
    },
    tagVisibility,
    styleId: doc.activeStyleId,
    sun: { ...doc.sun },
    fog: { ...doc.fog },
    hiddenEntityIds: hiddenEntityIds.slice(),
    activeSectionPlaneId: activeSectionPlaneOf(doc),
    transitionTime: 1,
    delayTime: 0,
    included: true,
  }
}

export function activeSectionPlaneOf(doc: SketchDocument): Id | null {
  for (const id of Object.keys(doc.entities)) {
    const entity = doc.entities[id]
    if (entity.type === 'sectionPlane' && entity.active) return id
  }
  return null
}
