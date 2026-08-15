/**
 * Natives Dateiformat `.osk` (JSON).
 *
 * Aufbau:
 * ```json
 * { "format": "opensketch", "version": 1, "app": "OpenSketch Studio",
 *   "savedAt": "2024-01-01T00:00:00.000Z", "document": { ... } }
 * ```
 *
 * Beim Schreiben werden alle Zahlen auf 9 Nachkommastellen gerundet: Dateien
 * bleiben klein und - viel wichtiger - diffbar, weil Fliesskomma-Rauschen
 * (0.30000000000000004) verschwindet.
 *
 * Beim Lesen ist ALLES optional: `deserializeDocument` fuellt jedes fehlende
 * Feld mit einem sinnvollen Standard. Ein kaputtes oder fremdes JSON fuehrt zu
 * einer klaren Fehlermeldung, niemals zu einem halb gefuellten Dokument.
 *
 * OWNERSHIP: Model.
 */

import type {
  CameraState,
  Definition,
  DefinitionKind,
  DocumentMeta,
  Edge,
  Entity,
  Face,
  FogSettings,
  Geometry,
  Id,
  Loop,
  Mat4Like,
  Material,
  PlaneLike,
  Scene,
  SketchDocument,
  StyleSettings,
  SunSettings,
  Tag,
  TagFolder,
  Texture,
  UnitSettings,
  UvMapping,
  Vec3Like,
  Vertex,
} from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { DEFAULT_UNITS } from '@/shared/units'
import { newId } from '@/shared/ids'
import { M, V } from '@/core/math'
import {
  DOCUMENT_VERSION,
  createDefaultCamera,
  createDefaultFog,
  createDefaultStyle,
  createDefaultSun,
  createDefaultTag,
  syncIdCounter,
} from './document'
import { normalizeMaterial } from './materials'

export const OSK_FORMAT = 'opensketch'
export const OSK_VERSION = DOCUMENT_VERSION
export const OSK_EXTENSION = '.osk'

export interface OskFile {
  format: string
  version: number
  app: string
  savedAt: string
  document: SketchDocument
}

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

const ROUND_DECIMALS = 9
const ROUND_FACTOR = Math.pow(10, ROUND_DECIMALS)

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * ROUND_FACTOR) / ROUND_FACTOR
  // -0 vermeiden, damit Diffs stabil bleiben
  return rounded === 0 ? 0 : rounded
}

/** Serialisiert ein Dokument als `.osk`-JSON. */
export function serializeDocument(doc: SketchDocument, opts?: { pretty?: boolean }): string {
  const payload: OskFile = {
    format: OSK_FORMAT,
    version: OSK_VERSION,
    app: 'OpenSketch Studio',
    savedAt: new Date().toISOString(),
    document: doc,
  }
  const replacer = (_key: string, value: unknown): unknown =>
    typeof value === 'number' ? roundNumber(value) : value
  return JSON.stringify(payload, replacer, opts?.pretty ? 2 : undefined)
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

/** Liest ein `.osk`-JSON. Wirft bei unlesbarem Inhalt. */
export function deserializeDocument(json: string): SketchDocument {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new Error(`Datei ist kein gueltiges JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  return documentFromRaw(raw)
}

/** Wie `deserializeDocument`, aber ab einem bereits geparsten Objekt. */
export function documentFromRaw(raw: unknown): SketchDocument {
  if (!isRecord(raw)) throw new Error('Datei enthaelt kein Dokument')

  const container = isRecord(raw.document) ? raw.document : raw
  const version = num(raw.version, num(container.version, OSK_VERSION))
  if (raw.format !== undefined && raw.format !== OSK_FORMAT) {
    throw new Error(`Unbekanntes Dateiformat "${String(raw.format)}"`)
  }
  if (version > OSK_VERSION) {
    throw new Error(
      `Die Datei wurde mit einer neueren Version gespeichert (Version ${version}, unterstuetzt ${OSK_VERSION}).`,
    )
  }

  const migrated = migrateDocument(container, version)
  const doc = normalizeDocument(migrated)
  syncIdCounter(doc)
  return doc
}

/* ------------------------------------------------------------------ */
/* Migrationen                                                         */
/* ------------------------------------------------------------------ */

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>

/**
 * Migrationshaken. Der Index ist die Version, VON der migriert wird:
 * `MIGRATIONS[1]` hebt ein Dokument der Version 1 auf Version 2.
 * Solange es nur Version 1 gibt, ist die Tabelle leer.
 */
const MIGRATIONS: Record<number, Migration> = {}

export function migrateDocument(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = raw
  for (let v = fromVersion; v < OSK_VERSION; v++) {
    const migration = MIGRATIONS[v]
    if (migration) current = migration(current)
  }
  return current
}

/* ------------------------------------------------------------------ */
/* Normalisierung (robust gegen fehlende Felder)                       */
/* ------------------------------------------------------------------ */

export function normalizeDocument(raw: Record<string, unknown>): SketchDocument {
  const definitions = normalizeDefinitions(raw.definitions)
  const entities = normalizeEntities(raw.entities)

  let rootId = str(raw.rootId, '')
  if (!rootId || !definitions[rootId]) {
    rootId = Object.keys(definitions).find((id) => definitions[id].kind === 'model') ?? ''
  }
  if (!rootId) {
    const root: Definition = {
      id: newId('d'),
      name: 'Modell',
      kind: 'model',
      geometry: emptyGeometry(),
      children: [],
      instanceCount: 1,
    }
    definitions[root.id] = root
    rootId = root.id
  }

  // Kindverweise auf verschwundene Entities entfernen
  for (const id of Object.keys(definitions)) {
    definitions[id].children = definitions[id].children.filter((child) => entities[child] !== undefined)
  }

  const tags = normalizeTags(raw.tags)
  if (Object.keys(tags).length === 0) {
    const tag = createDefaultTag()
    tags[tag.id] = tag
  }
  const styles = normalizeStyles(raw.styles)
  if (Object.keys(styles).length === 0) {
    const style = createDefaultStyle()
    styles[style.id] = style
  }
  const materials = normalizeMaterials(raw.materials)

  const activeTagId = str(raw.activeTagId, '')
  const activeStyleId = str(raw.activeStyleId, '')
  const activeMaterialId = raw.activeMaterialId === null ? null : str(raw.activeMaterialId, '')

  return {
    meta: normalizeMeta(raw.meta),
    rootId,
    definitions,
    entities,
    materials,
    textures: normalizeTextures(raw.textures),
    tags,
    tagFolders: normalizeTagFolders(raw.tagFolders),
    styles,
    scenes: normalizeScenes(raw.scenes),
    units: normalizeUnits(raw.units),
    sun: normalizeSun(raw.sun),
    fog: normalizeFog(raw.fog),
    activeStyleId: styles[activeStyleId] ? activeStyleId : Object.keys(styles)[0],
    activeTagId: tags[activeTagId] ? activeTagId : Object.keys(tags)[0],
    activeMaterialId: activeMaterialId && materials[activeMaterialId] ? activeMaterialId : null,
  }
}

function normalizeMeta(raw: unknown): DocumentMeta {
  const r = isRecord(raw) ? raw : {}
  const now = new Date().toISOString()
  return {
    name: str(r.name, 'Unbenannt'),
    author: str(r.author, ''),
    description: str(r.description, ''),
    createdAt: str(r.createdAt, now),
    modifiedAt: str(r.modifiedAt, now),
    version: num(r.version, DOCUMENT_VERSION),
  }
}

function normalizeDefinitions(raw: unknown): Record<Id, Definition> {
  const out: Record<Id, Definition> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const r = raw[id]
    if (!isRecord(r)) continue
    const kind = str(r.kind, 'group')
    out[id] = {
      id,
      name: str(r.name, 'Definition'),
      kind: (['model', 'group', 'component'].includes(kind) ? kind : 'group') as DefinitionKind,
      description: r.description === undefined ? undefined : str(r.description, ''),
      geometry: normalizeGeometry(r.geometry),
      children: strArray(r.children),
      behavior: isRecord(r.behavior)
        ? {
            glueTo: (['none', 'any', 'horizontal', 'vertical', 'sloped'].includes(str(r.behavior.glueTo, 'none'))
              ? str(r.behavior.glueTo, 'none')
              : 'none') as 'none' | 'any' | 'horizontal' | 'vertical' | 'sloped',
            cutsOpening: bool(r.behavior.cutsOpening, false),
            alwaysFaceCamera: bool(r.behavior.alwaysFaceCamera, false),
            shadowsFaceSun: bool(r.behavior.shadowsFaceSun, false),
            scaleRestriction: r.behavior.scaleRestriction === undefined
              ? undefined
              : (str(r.behavior.scaleRestriction, 'none') as 'none' | 'uniform' | 'noScale'),
          }
        : undefined,
      instanceCount: r.instanceCount === undefined ? undefined : num(r.instanceCount, 0),
      isLibrary: r.isLibrary === undefined ? undefined : bool(r.isLibrary, false),
      thumbnail: r.thumbnail === undefined ? undefined : str(r.thumbnail, ''),
    }
  }
  return out
}

export function normalizeGeometry(raw: unknown): Geometry {
  const geom = emptyGeometry()
  if (!isRecord(raw)) return geom

  if (isRecord(raw.vertices)) {
    for (const id of Object.keys(raw.vertices)) {
      const r = raw.vertices[id]
      if (!isRecord(r)) continue
      const vertex: Vertex = { id, p: vec3(r.p), edges: strArray(r.edges) }
      geom.vertices[id] = vertex
    }
  }
  if (isRecord(raw.edges)) {
    for (const id of Object.keys(raw.edges)) {
      const r = raw.edges[id]
      if (!isRecord(r)) continue
      const edge: Edge = {
        id,
        a: str(r.a, ''),
        b: str(r.b, ''),
        faces: strArray(r.faces),
        soft: bool(r.soft, false),
        smooth: bool(r.smooth, false),
        hidden: bool(r.hidden, false),
        guide: r.guide === undefined ? undefined : bool(r.guide, false),
        tagId: nullableStr(r.tagId),
        materialId: nullableStr(r.materialId),
      }
      if (!geom.vertices[edge.a] || !geom.vertices[edge.b]) continue
      geom.edges[id] = edge
    }
  }
  if (isRecord(raw.faces)) {
    for (const id of Object.keys(raw.faces)) {
      const r = raw.faces[id]
      if (!isRecord(r)) continue
      const outer = normalizeLoop(r.outer)
      if (outer.vertices.length < 3) continue
      const face: Face = {
        id,
        outer,
        inner: Array.isArray(r.inner) ? r.inner.map(normalizeLoop).filter((l) => l.vertices.length >= 3) : [],
        normal: vec3(r.normal, { x: 0, y: 0, z: 1 }),
        plane: normalizePlane(r.plane, vec3(r.normal, { x: 0, y: 0, z: 1 })),
        frontMaterialId: nullableStr(r.frontMaterialId),
        backMaterialId: nullableStr(r.backMaterialId),
        hidden: bool(r.hidden, false),
        tagId: nullableStr(r.tagId),
        uvFront: normalizeUv(r.uvFront),
        uvBack: normalizeUv(r.uvBack),
      }
      geom.faces[id] = face
    }
  }

  repairGeometryReferences(geom)
  return geom
}

/** Entfernt tote Querverweise und stellt die Rueckverweise wieder her. */
export function repairGeometryReferences(geom: Geometry): void {
  for (const vid of Object.keys(geom.vertices)) geom.vertices[vid].edges = []
  for (const eid of Object.keys(geom.edges)) geom.edges[eid].faces = []

  for (const eid of Object.keys(geom.edges)) {
    const edge = geom.edges[eid]
    geom.vertices[edge.a]?.edges.push(eid)
    geom.vertices[edge.b]?.edges.push(eid)
  }
  for (const fid of Object.keys(geom.faces)) {
    const face = geom.faces[fid]
    const loops: Loop[] = [face.outer, ...face.inner]
    let valid = true
    for (const loop of loops) {
      for (const vid of loop.vertices) if (!geom.vertices[vid]) valid = false
      for (const eid of loop.edges) if (!geom.edges[eid]) valid = false
    }
    if (!valid) {
      delete geom.faces[fid]
      continue
    }
    for (const loop of loops) {
      for (const eid of loop.edges) {
        const edge = geom.edges[eid]
        if (edge && !edge.faces.includes(fid)) edge.faces.push(fid)
      }
    }
  }
}

function normalizeLoop(raw: unknown): Loop {
  if (!isRecord(raw)) return { edges: [], vertices: [] }
  return { edges: strArray(raw.edges), vertices: strArray(raw.vertices) }
}

function normalizePlane(raw: unknown, fallbackNormal: Vec3Like): PlaneLike {
  if (!isRecord(raw)) return { n: fallbackNormal, d: 0 }
  return { n: vec3(raw.n, fallbackNormal), d: num(raw.d, 0) }
}

function normalizeUv(raw: unknown): UvMapping | undefined {
  if (!isRecord(raw)) return undefined
  return {
    m: numArray(raw.m, 9),
    origin: vec3(raw.origin),
    xAxis: vec3(raw.xAxis, { x: 1, y: 0, z: 0 }),
    yAxis: vec3(raw.yAxis, { x: 0, y: 1, z: 0 }),
    scaleU: num(raw.scaleU, 1),
    scaleV: num(raw.scaleV, 1),
    rotation: num(raw.rotation, 0),
    offsetU: num(raw.offsetU, 0),
    offsetV: num(raw.offsetV, 0),
    flipU: raw.flipU === undefined ? undefined : bool(raw.flipU, false),
    flipV: raw.flipV === undefined ? undefined : bool(raw.flipV, false),
  }
}

function normalizeEntities(raw: unknown): Record<Id, Entity> {
  const out: Record<Id, Entity> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const entity = normalizeEntity(id, raw[id])
    if (entity) out[id] = entity
  }
  return out
}

function normalizeEntity(id: Id, raw: unknown): Entity | null {
  if (!isRecord(raw)) return null
  const base = {
    id,
    name: str(raw.name, ''),
    tagId: nullableStr(raw.tagId),
    hidden: bool(raw.hidden, false),
    locked: bool(raw.locked, false),
  }
  switch (str(raw.type, '')) {
    case 'instance':
      return {
        ...base,
        type: 'instance',
        definitionId: str(raw.definitionId, ''),
        transform: mat4(raw.transform),
        isGroup: bool(raw.isGroup, false),
        materialId: nullableStr(raw.materialId),
      }
    case 'dimension':
      return {
        ...base,
        type: 'dimension',
        kind: (['linear', 'diameter', 'radius', 'angular'].includes(str(raw.kind, 'linear'))
          ? str(raw.kind, 'linear')
          : 'linear') as 'linear' | 'diameter' | 'radius' | 'angular',
        start: vec3(raw.start),
        end: vec3(raw.end),
        offset: vec3(raw.offset),
        center: raw.center === undefined ? undefined : vec3(raw.center),
        text: raw.text === null || raw.text === undefined ? null : str(raw.text, ''),
        fontSize: num(raw.fontSize, 12),
        color: str(raw.color, '#000000'),
        screenSpace: bool(raw.screenSpace, true),
        arrowStyle: (['slash', 'dot', 'closedArrow', 'openArrow', 'none'].includes(str(raw.arrowStyle, 'slash'))
          ? str(raw.arrowStyle, 'slash')
          : 'slash') as 'slash' | 'dot' | 'closedArrow' | 'openArrow' | 'none',
      }
    case 'text':
      return {
        ...base,
        type: 'text',
        anchor: vec3(raw.anchor),
        position: vec3(raw.position),
        text: str(raw.text, ''),
        fontSize: num(raw.fontSize, 12),
        color: str(raw.color, '#000000'),
        screenSpace: bool(raw.screenSpace, true),
        leader: (['none', 'viewBased', 'pushPin'].includes(str(raw.leader, 'viewBased'))
          ? str(raw.leader, 'viewBased')
          : 'viewBased') as 'none' | 'viewBased' | 'pushPin',
      }
    case 'sectionPlane':
      return {
        ...base,
        type: 'sectionPlane',
        plane: normalizePlane(raw.plane, { x: 0, y: 0, z: 1 }),
        active: bool(raw.active, false),
        symbolSize: num(raw.symbolSize, 1),
        color: str(raw.color, '#d97706'),
      }
    case 'guidePoint':
      return {
        ...base,
        type: 'guidePoint',
        position: vec3(raw.position),
        from: raw.from === undefined ? undefined : vec3(raw.from),
      }
    case 'guideLine':
      return {
        ...base,
        type: 'guideLine',
        origin: vec3(raw.origin),
        direction: vec3(raw.direction, { x: 1, y: 0, z: 0 }),
        length: raw.length === null || raw.length === undefined ? null : num(raw.length, 0),
      }
    case 'image':
      return {
        ...base,
        type: 'image',
        textureId: str(raw.textureId, ''),
        transform: mat4(raw.transform),
        width: num(raw.width, 1),
        height: num(raw.height, 1),
        usage: str(raw.usage, 'model') === 'watermark' ? 'watermark' : 'model',
      }
    default:
      return null
  }
}

function normalizeMaterials(raw: unknown): Record<Id, Material> {
  const out: Record<Id, Material> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const r = raw[id]
    if (!isRecord(r)) continue
    out[id] = normalizeMaterial({
      id,
      name: str(r.name, 'Material'),
      color: str(r.color, '#c8c8c8'),
      opacity: num(r.opacity, 1),
      textureId: nullableStr(r.textureId),
      textureWidth: num(r.textureWidth, 1),
      textureHeight: num(r.textureHeight, 1),
      roughness: num(r.roughness, 0.7),
      metalness: num(r.metalness, 0),
      category: str(r.category, 'Eigene'),
      colorize: bool(r.colorize, false),
    })
  }
  return out
}

function normalizeTextures(raw: unknown): Record<Id, Texture> {
  const out: Record<Id, Texture> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const r = raw[id]
    if (!isRecord(r)) continue
    out[id] = {
      id,
      name: str(r.name, 'Textur'),
      dataUrl: str(r.dataUrl, ''),
      width: num(r.width, 1),
      height: num(r.height, 1),
    }
  }
  return out
}

function normalizeTags(raw: unknown): Record<Id, Tag> {
  const out: Record<Id, Tag> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const r = raw[id]
    if (!isRecord(r)) continue
    const dashes = str(r.dashes, 'solid')
    out[id] = {
      id,
      name: str(r.name, 'Tag'),
      visible: bool(r.visible, true),
      color: str(r.color, '#8a8f98'),
      dashes: (['solid', 'dash', 'dot', 'dashdot'].includes(dashes) ? dashes : 'solid') as Tag['dashes'],
      folderId: nullableStr(r.folderId),
      locked: bool(r.locked, false),
    }
  }
  return out
}

function normalizeTagFolders(raw: unknown): Record<Id, TagFolder> {
  const out: Record<Id, TagFolder> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const r = raw[id]
    if (!isRecord(r)) continue
    out[id] = { id, name: str(r.name, 'Ordner'), visible: bool(r.visible, true) }
  }
  return out
}

function normalizeStyles(raw: unknown): Record<Id, StyleSettings> {
  const out: Record<Id, StyleSettings> = {}
  if (!isRecord(raw)) return out
  for (const id of Object.keys(raw)) {
    const r = raw[id]
    if (!isRecord(r)) continue
    const base = createDefaultStyle()
    out[id] = {
      ...base,
      id,
      name: str(r.name, base.name),
      faceStyle: (
        ['shadedWithTextures', 'shaded', 'hiddenLine', 'wireframe', 'monochrome', 'xray'].includes(
          str(r.faceStyle, ''),
        )
          ? str(r.faceStyle, '')
          : base.faceStyle
      ) as StyleSettings['faceStyle'],
      xrayOpacity: num(r.xrayOpacity, base.xrayOpacity),
      displayEdges: bool(r.displayEdges, base.displayEdges),
      displayProfiles: bool(r.displayProfiles, base.displayProfiles),
      profileWidth: num(r.profileWidth, base.profileWidth),
      displayDepthCue: bool(r.displayDepthCue, base.displayDepthCue),
      depthCueWidth: num(r.depthCueWidth, base.depthCueWidth),
      displayExtensions: bool(r.displayExtensions, base.displayExtensions),
      extensionLength: num(r.extensionLength, base.extensionLength),
      displayEndpoints: bool(r.displayEndpoints, base.displayEndpoints),
      endpointSize: num(r.endpointSize, base.endpointSize),
      jitterEdges: bool(r.jitterEdges, base.jitterEdges),
      edgeColor: str(r.edgeColor, base.edgeColor),
      edgeColorMode: (['all', 'byMaterial', 'byTag'].includes(str(r.edgeColorMode, ''))
        ? str(r.edgeColorMode, '')
        : base.edgeColorMode) as StyleSettings['edgeColorMode'],
      frontColor: str(r.frontColor, base.frontColor),
      backColor: str(r.backColor, base.backColor),
      backgroundColor: str(r.backgroundColor, base.backgroundColor),
      skyColor: str(r.skyColor, base.skyColor),
      groundColor: str(r.groundColor, base.groundColor),
      displaySky: bool(r.displaySky, base.displaySky),
      displayGround: bool(r.displayGround, base.displayGround),
      groundTransparency: num(r.groundTransparency, base.groundTransparency),
      showAxes: bool(r.showAxes, base.showAxes),
      showGrid: bool(r.showGrid, base.showGrid),
      gridSpacing: num(r.gridSpacing, base.gridSpacing),
      showHiddenGeometry: bool(r.showHiddenGeometry, base.showHiddenGeometry),
      showSectionPlanes: bool(r.showSectionPlanes, base.showSectionPlanes),
      showSectionCuts: bool(r.showSectionCuts, base.showSectionCuts),
      sectionCutFill: str(r.sectionCutFill, base.sectionCutFill),
      sectionLineWidth: num(r.sectionLineWidth, base.sectionLineWidth),
    }
  }
  return out
}

function normalizeScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw)) return []
  const out: Scene[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const saves = isRecord(item.saves) ? item.saves : {}
    out.push({
      id: str(item.id, newId('s')),
      name: str(item.name, 'Szene'),
      description: str(item.description, ''),
      camera: normalizeCamera(item.camera),
      saves: {
        camera: bool(saves.camera, true),
        tagVisibility: bool(saves.tagVisibility, true),
        style: bool(saves.style, true),
        shadows: bool(saves.shadows, true),
        hiddenGeometry: bool(saves.hiddenGeometry, true),
        sectionPlanes: bool(saves.sectionPlanes, true),
      },
      tagVisibility: boolRecord(item.tagVisibility),
      styleId: str(item.styleId, ''),
      sun: normalizeSun(item.sun),
      fog: normalizeFog(item.fog),
      hiddenEntityIds: strArray(item.hiddenEntityIds),
      activeSectionPlaneId: nullableStr(item.activeSectionPlaneId),
      transitionTime: num(item.transitionTime, 1),
      delayTime: num(item.delayTime, 0),
      included: bool(item.included, true),
    })
  }
  return out
}

export function normalizeCamera(raw: unknown): CameraState {
  const base = createDefaultCamera()
  if (!isRecord(raw)) return base
  return {
    eye: vec3(raw.eye, base.eye),
    target: vec3(raw.target, base.target),
    up: vec3(raw.up, base.up),
    fov: num(raw.fov, base.fov),
    projection: str(raw.projection, base.projection) === 'parallel' ? 'parallel' : 'perspective',
    orthoHeight: num(raw.orthoHeight, base.orthoHeight),
    twoPointPerspective: raw.twoPointPerspective === undefined ? undefined : bool(raw.twoPointPerspective, false),
  }
}

function normalizeUnits(raw: unknown): UnitSettings {
  const base = { ...DEFAULT_UNITS }
  if (!isRecord(raw)) return base
  const denominator = num(raw.fractionDenominator, base.fractionDenominator)
  return {
    format: (['decimal', 'architectural', 'engineering', 'fractional'].includes(str(raw.format, ''))
      ? str(raw.format, '')
      : base.format) as UnitSettings['format'],
    lengthUnit: (['m', 'cm', 'mm', 'in', 'ft', 'ftin', 'yd'].includes(str(raw.lengthUnit, ''))
      ? str(raw.lengthUnit, '')
      : base.lengthUnit) as UnitSettings['lengthUnit'],
    angleUnit: str(raw.angleUnit, base.angleUnit) === 'rad' ? 'rad' : 'deg',
    areaUnit: (['m2', 'cm2', 'mm2', 'ft2', 'in2'].includes(str(raw.areaUnit, ''))
      ? str(raw.areaUnit, '')
      : base.areaUnit) as UnitSettings['areaUnit'],
    volumeUnit: (['m3', 'cm3', 'l', 'ft3'].includes(str(raw.volumeUnit, ''))
      ? str(raw.volumeUnit, '')
      : base.volumeUnit) as UnitSettings['volumeUnit'],
    precision: Math.max(0, Math.min(8, Math.round(num(raw.precision, base.precision)))),
    fractionDenominator: ([2, 4, 8, 16, 32, 64].includes(denominator)
      ? denominator
      : base.fractionDenominator) as UnitSettings['fractionDenominator'],
    displayUnitSuffix: bool(raw.displayUnitSuffix, base.displayUnitSuffix),
    lengthSnap: num(raw.lengthSnap, base.lengthSnap),
    angleSnap: num(raw.angleSnap, base.angleSnap),
    enableLengthSnap: bool(raw.enableLengthSnap, base.enableLengthSnap),
    enableAngleSnap: bool(raw.enableAngleSnap, base.enableAngleSnap),
  }
}

function normalizeSun(raw: unknown): SunSettings {
  const base = createDefaultSun()
  if (!isRecord(raw)) return base
  return {
    enabled: bool(raw.enabled, base.enabled),
    date: str(raw.date, base.date),
    time: num(raw.time, base.time),
    latitude: num(raw.latitude, base.latitude),
    longitude: num(raw.longitude, base.longitude),
    timezone: num(raw.timezone, base.timezone),
    light: num(raw.light, base.light),
    dark: num(raw.dark, base.dark),
    onFaces: bool(raw.onFaces, base.onFaces),
    onGround: bool(raw.onGround, base.onGround),
    fromEdges: bool(raw.fromEdges, base.fromEdges),
    northAngle: num(raw.northAngle, base.northAngle),
    locationName: str(raw.locationName, base.locationName),
  }
}

function normalizeFog(raw: unknown): FogSettings {
  const base = createDefaultFog()
  if (!isRecord(raw)) return base
  return {
    enabled: bool(raw.enabled, base.enabled),
    near: num(raw.near, base.near),
    far: num(raw.far, base.far),
    color: str(raw.color, base.color),
    useBackgroundColor: bool(raw.useBackgroundColor, base.useBackgroundColor),
  }
}

/* ------------------------------------------------------------------ */
/* Primitive Leser                                                     */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function numArray(value: unknown, length: number): number[] {
  const out = new Array<number>(length).fill(0)
  if (!Array.isArray(value)) return out
  for (let i = 0; i < length; i++) out[i] = num(value[i], 0)
  return out
}

function boolRecord(value: unknown): Record<Id, boolean> {
  const out: Record<Id, boolean> = {}
  if (!isRecord(value)) return out
  for (const id of Object.keys(value)) out[id] = bool(value[id], true)
  return out
}

function vec3(value: unknown, fallback: Vec3Like = V.ORIGIN): Vec3Like {
  if (Array.isArray(value) && value.length >= 3) {
    return { x: num(value[0], 0), y: num(value[1], 0), z: num(value[2], 0) }
  }
  if (!isRecord(value)) return { ...fallback }
  return { x: num(value.x, fallback.x), y: num(value.y, fallback.y), z: num(value.z, fallback.z) }
}

function mat4(value: unknown): Mat4Like {
  if (!Array.isArray(value) || value.length < 16) return M.identity()
  return M.fromArray(value.map((v) => num(v, 0)))
}
