/**
 * Testhilfen des Render-Moduls.
 *
 * Baut vollstaendige, aber winzige Dokumente und Schnappschuesse, damit die
 * Untersysteme ohne Store und ohne WebGL-Kontext geprueft werden koennen.
 */

import * as core from '@/core'
import { M } from '@/core/math'
import type {
  Definition,
  Entity,
  Geometry,
  Id,
  InstanceEntity,
  Mat4Like,
  SketchDocument,
  UnitSettings,
  Vec3Like,
} from '@/shared/types'
import { emptyGeometry, emptySelection } from '@/shared/types'
import { DEFAULT_FOG, DEFAULT_STYLE, DEFAULT_SUN } from '../defaults'
import type { RenderSnapshot } from '../snapshot'

export const TEST_UNITS: UnitSettings = {
  format: 'decimal',
  lengthUnit: 'm',
  angleUnit: 'deg',
  areaUnit: 'm2',
  volumeUnit: 'm3',
  precision: 2,
  fractionDenominator: 16,
  displayUnitSuffix: true,
  lengthSnap: 0,
  angleSnap: 15,
  enableLengthSnap: false,
  enableAngleSnap: false,
}

export function emptyDocument(): SketchDocument {
  const root: Definition = {
    id: 'root',
    name: 'Modell',
    kind: 'model',
    geometry: emptyGeometry(),
    children: [],
  }
  return {
    meta: {
      name: 'Test',
      author: '',
      description: '',
      createdAt: '2024-01-01T00:00:00.000Z',
      modifiedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
    },
    rootId: 'root',
    definitions: { root },
    entities: {},
    materials: {},
    textures: {},
    tags: {},
    tagFolders: {},
    styles: { [DEFAULT_STYLE.id]: { ...DEFAULT_STYLE } },
    scenes: [],
    units: TEST_UNITS,
    sun: { ...DEFAULT_SUN },
    fog: { ...DEFAULT_FOG },
    activeStyleId: DEFAULT_STYLE.id,
    activeTagId: 'tag-default',
    activeMaterialId: null,
  }
}

/** Quadrat in der XY-Ebene, ueber den Kernel gebaut (inkl. Flaechenbildung). */
export function squareGeometry(size = 2, z = 0): Geometry {
  const geom = emptyGeometry()
  const h = size / 2
  core.addFacePolygon(geom, [
    { x: -h, y: -h, z },
    { x: h, y: -h, z },
    { x: h, y: h, z },
    { x: -h, y: h, z },
  ])
  return geom
}

export function documentWithSquare(size = 2): SketchDocument {
  const doc = emptyDocument()
  doc.definitions.root.geometry = squareGeometry(size)
  return doc
}

/** Fuegt eine Definition mit eigener Geometrie samt Instanz im Wurzelkontext ein. */
export function addInstance(
  doc: SketchDocument,
  definitionId: Id,
  geometry: Geometry,
  transform: Mat4Like = M.identity(),
  entityId: Id = `inst-${definitionId}`,
): InstanceEntity {
  doc.definitions[definitionId] = {
    id: definitionId,
    name: definitionId,
    kind: 'group',
    geometry,
    children: [],
  }
  const entity: InstanceEntity = {
    id: entityId,
    type: 'instance',
    name: definitionId,
    tagId: null,
    hidden: false,
    locked: false,
    definitionId,
    transform,
    isGroup: true,
    materialId: null,
  }
  doc.entities[entityId] = entity
  doc.definitions[doc.rootId].children.push(entityId)
  return entity
}

export function addEntity(doc: SketchDocument, entity: Entity): Entity {
  doc.entities[entity.id] = entity
  doc.definitions[doc.rootId].children.push(entity.id)
  return entity
}

export function snapshotOf(doc: SketchDocument | null, patch: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const base: RenderSnapshot = {
    doc,
    style: { ...DEFAULT_STYLE },
    sun: { ...DEFAULT_SUN },
    fog: { ...DEFAULT_FOG },
    context: doc
      ? {
          definitionId: doc.rootId,
          instancePath: [],
          definitionPath: [doc.rootId],
          worldTransform: M.identity(),
        }
      : null,
    selection: emptySelection(),
    hover: null,
    revisions: { geometry: 1, scene: 1, material: 1, style: 1, selection: 1 },
    isTagVisible: () => true,
  }
  return { ...base, ...patch }
}

/** Erster Schluessel eines Datensatzes - fuer Tests mit genau einem Element. */
export function firstId(record: Record<Id, unknown>): Id {
  return Object.keys(record)[0]
}

export function vec(x: number, y: number, z: number): Vec3Like {
  return { x, y, z }
}
