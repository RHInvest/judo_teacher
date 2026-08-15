/**
 * Gemeinsames Geruest aller Importer.
 *
 * `ImportScene` sammelt Definitionen, Instanzen, Materialien, Texturen und
 * Warnungen ein und liefert am Ende ein fertiges `ImportResult`. Damit sehen
 * alle Importer gleich aus und die Hierarchie entsteht immer auf dieselbe
 * Weise: Definitionen halten Geometrie, Instanzen (`InstanceEntity`) stellen
 * die Verschachtelung her.
 */

import type {
  Definition,
  Entity,
  Geometry,
  Id,
  InstanceEntity,
  Mat4Like,
  Material,
  Texture,
} from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { newId } from '@/shared/ids'
import { M } from '@/core/math'
import type { ImportResult } from '../api-types'
import { GeomBuilder } from '../common/geom'

export class ImportScene {
  readonly definitions: Definition[] = []
  readonly entities: Entity[] = []
  readonly materials: Material[] = []
  readonly textures: Texture[] = []
  readonly warnings: string[] = []
  readonly root: Definition

  constructor(name: string) {
    this.root = this.addDefinition(name, 'group')
  }

  addDefinition(name: string, kind: 'group' | 'component' = 'component', geometry?: Geometry): Definition {
    const definition: Definition = {
      id: newId('d'),
      name: name || 'Import',
      kind,
      geometry: geometry ?? emptyGeometry(),
      children: [],
    }
    this.definitions.push(definition)
    return definition
  }

  /** Haengt `child` als Instanz unter `parent`. */
  addInstance(
    parent: Definition,
    child: Definition,
    transform: Mat4Like = M.identity(),
    name?: string,
    isGroup = true,
  ): InstanceEntity {
    const entity: InstanceEntity = {
      id: newId('i'),
      type: 'instance',
      name: name ?? child.name,
      tagId: null,
      hidden: false,
      locked: false,
      definitionId: child.id,
      transform: [...transform],
      isGroup,
      materialId: null,
    }
    this.entities.push(entity)
    parent.children.push(entity.id)
    return entity
  }

  addMaterial(material: Material): Material {
    this.materials.push(material)
    return material
  }

  addTexture(texture: Texture): Texture {
    this.textures.push(texture)
    return texture
  }

  warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message)
  }

  /** Definitionen ohne jede Geometrie und ohne Kinder entfernen. */
  prune(): void {
    const dead = new Set<Id>()
    for (const definition of this.definitions) {
      if (definition === this.root) continue
      const geom = definition.geometry
      const empty =
        Object.keys(geom.vertices).length === 0 &&
        Object.keys(geom.edges).length === 0 &&
        Object.keys(geom.faces).length === 0 &&
        definition.children.length === 0
      if (empty) dead.add(definition.id)
    }
    if (dead.size === 0) return
    const deadEntities = new Set<Id>()
    for (const entity of this.entities) {
      if (entity.type === 'instance' && dead.has(entity.definitionId)) deadEntities.add(entity.id)
    }
    for (const definition of this.definitions) {
      definition.children = definition.children.filter((id) => !deadEntities.has(id))
    }
    this.entities.splice(
      0,
      this.entities.length,
      ...this.entities.filter((e) => !deadEntities.has(e.id)),
    )
    this.definitions.splice(
      0,
      this.definitions.length,
      ...this.definitions.filter((d) => !dead.has(d.id)),
    )
  }

  toResult(): ImportResult {
    this.prune()
    return {
      definitions: this.definitions,
      rootDefinitionId: this.root.id,
      materials: this.materials,
      textures: this.textures.map((t) => ({
        id: t.id,
        name: t.name,
        dataUrl: t.dataUrl,
        width: t.width,
        height: t.height,
      })),
      warnings: this.warnings,
      entities: this.entities,
    }
  }
}

/* ------------------------------------------------------------------ */
/* Materialien                                                         */
/* ------------------------------------------------------------------ */

let materialCounter = 0

export function makeMaterial(name: string, color = '#cccccc', category = 'Import'): Material {
  materialCounter++
  return {
    id: newId('m'),
    name: name || `Material ${materialCounter}`,
    color,
    opacity: 1,
    textureId: null,
    textureWidth: 1,
    textureHeight: 1,
    roughness: 0.7,
    metalness: 0,
    category,
    colorize: false,
  }
}

/* ------------------------------------------------------------------ */
/* Geometrie                                                           */
/* ------------------------------------------------------------------ */

/** Builder fuer eine noch leere Definition. */
export function builderFor(definition: Definition): GeomBuilder {
  return new GeomBuilder(definition.geometry)
}

/**
 * Fasst koplanare Nachbardreiecke ueber den Geometriekern zusammen. Der Kern
 * wird bewusst dynamisch importiert und der Aufruf gekapselt: schlaegt er
 * fehl, bleibt die (korrekte, nur feiner unterteilte) Dreiecksgeometrie
 * stehen und es gibt eine Warnung statt eines Abbruchs.
 */
export async function mergeCoplanarSafely(geometry: Geometry, scene: ImportScene): Promise<void> {
  try {
    const core = await import('@/core')
    const merge = (core as { mergeCoplanarFaces?: (g: Geometry) => unknown }).mergeCoplanarFaces
    if (typeof merge !== 'function') throw new Error('mergeCoplanarFaces fehlt')
    merge(geometry)
  } catch {
    const { mergeCoplanarLocal, simplifyFaceLoops, removeOrphanVertices } = await import('../common/geom')
    mergeCoplanarLocal(geometry)
    simplifyFaceLoops(geometry)
    removeOrphanVertices(geometry)
    scene.warn(
      'Koplanare Flächen wurden mit dem einfachen IO-Verfahren zusammengefasst (Geometriekern nicht verfügbar).',
    )
  }
}
