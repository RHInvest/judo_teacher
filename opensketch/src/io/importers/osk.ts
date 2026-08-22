/**
 * Import des nativen `.osk`-Formats - als EINFUEGEN in ein bestehendes
 * Dokument.
 *
 * Das komplette Oeffnen einer Datei ist Sache des Stores (`@/model`); hier
 * geht es darum, ein fremdes Modell als Komponente einzufuegen. Damit dabei
 * keine Id kollidiert, werden ALLE Ids neu vergeben und alle Verweise
 * mitgezogen.
 */

import type {
  Definition,
  Entity,
  Geometry,
  Id,
  InstanceEntity,
  Material,
  SketchDocument,
  Texture,
} from '@/shared/types'
import type { ImportOptions, ImportResult } from '../api-types'
import { baseName, utf8Text } from '../common/util'
import { ImportScene } from './common'
import { documentFromRaw } from '@/model'
import { newId } from '@/shared/ids'
import { M } from '@/core/math'

/**
 * Liest eine `.osk`-Datei.
 *
 * Gelesen wird ueber `@/model`s `documentFromRaw`, nicht ueber ein eigenes
 * `JSON.parse`. Das ist wichtig: eine vom Programm gespeicherte Datei ist in
 * einen Formatkopf (`{ format, version, document }`) verpackt, ein roher
 * Parser sucht `definitions` vergeblich an der Wurzel. `documentFromRaw`
 * versteht beide Schreibweisen, prueft die Formatversion und normalisiert das
 * Dokument.
 */
export function readOskDocument(bytes: Uint8Array): SketchDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(utf8Text(bytes))
  } catch (err) {
    throw new Error(`OSK: Die Datei ist kein gültiges JSON (${err instanceof Error ? err.message : String(err)}).`)
  }
  try {
    return documentFromRaw(parsed)
  } catch (err) {
    throw new Error(`OSK: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function importOsk(bytes: Uint8Array, filename: string, opts: ImportOptions = {}): ImportResult {
  const source = readOskDocument(bytes)
  const scale = opts.unitScale ?? 1
  const scene = new ImportScene(opts.name ?? source.meta?.name ?? baseName(filename) ?? 'OSK-Import')

  /* ---- Id-Abbildung aufbauen ---- */
  const definitionMap = new Map<Id, Id>()
  const entityMap = new Map<Id, Id>()
  const materialMap = new Map<Id, Id>()
  const textureMap = new Map<Id, Id>()

  for (const id of Object.keys(source.definitions ?? {})) definitionMap.set(id, newId('d'))
  for (const id of Object.keys(source.entities ?? {})) entityMap.set(id, newId('i'))
  for (const id of Object.keys(source.materials ?? {})) materialMap.set(id, newId('m'))
  for (const id of Object.keys(source.textures ?? {})) textureMap.set(id, newId('x'))

  /* ---- Texturen und Materialien ---- */
  for (const texture of Object.values(source.textures ?? {}) as Texture[]) {
    const id = textureMap.get(texture.id)
    if (!id) continue
    scene.addTexture({ ...texture, id })
  }
  for (const material of Object.values(source.materials ?? {}) as Material[]) {
    const id = materialMap.get(material.id)
    if (!id) continue
    scene.addMaterial({
      ...material,
      id,
      textureId: material.textureId ? textureMap.get(material.textureId) ?? null : null,
    })
  }

  /* ---- Definitionen ---- */
  let skippedEntities = 0
  for (const definition of Object.values(source.definitions ?? {}) as Definition[]) {
    const id = definitionMap.get(definition.id)
    if (!id) continue
    const copy: Definition = {
      ...definition,
      id,
      // Die Wurzel des Fremddokuments wird zu einer normalen Gruppe.
      kind: definition.kind === 'model' ? 'group' : definition.kind,
      geometry: remapGeometry(definition.geometry, materialMap, scale),
      children: definition.children.map((child) => entityMap.get(child)).filter((c): c is Id => !!c),
      instanceCount: undefined,
    }
    scene.definitions.push(copy)
  }

  /* ---- Entities ---- */
  for (const entity of Object.values(source.entities ?? {}) as Entity[]) {
    const id = entityMap.get(entity.id)
    if (!id) continue
    if (entity.type === 'instance') {
      const definitionId = definitionMap.get(entity.definitionId)
      if (!definitionId) {
        skippedEntities++
        continue
      }
      const copy: InstanceEntity = {
        ...entity,
        id,
        definitionId,
        transform: scaleTranslation([...entity.transform], scale),
        materialId: entity.materialId ? materialMap.get(entity.materialId) ?? null : null,
      }
      scene.entities.push(copy)
    } else if (entity.type === 'image') {
      const textureId = textureMap.get(entity.textureId)
      if (!textureId) {
        skippedEntities++
        continue
      }
      scene.entities.push({
        ...entity,
        id,
        textureId,
        transform: scaleTranslation([...entity.transform], scale),
        width: entity.width * scale,
        height: entity.height * scale,
      })
    } else {
      // Bemassungen, Texte, Hilfslinien: Tags gehoeren dem Zieldokument
      scene.entities.push({ ...entity, id, tagId: null })
    }
  }
  if (skippedEntities > 0) scene.warn(`${skippedEntities} Objekt(e) mit fehlenden Verweisen wurden übersprungen.`)

  /* ---- Fremde Wurzel unter die Import-Wurzel haengen ---- */
  const rootId = definitionMap.get(source.rootId)
  const foreignRoot = rootId ? scene.definitions.find((d) => d.id === rootId) : undefined
  if (foreignRoot) {
    scene.addInstance(scene.root, foreignRoot, M.identity(), source.meta?.name || foreignRoot.name)
  } else {
    scene.warn('Die Wurzeldefinition der Datei wurde nicht gefunden - der Import bleibt leer.')
  }

  scene.warn('Tags, Szenen, Stile und Sonneneinstellungen der Datei wurden nicht übernommen.')
  return scene.toResult()
}

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */

function remapGeometry(geometry: Geometry, materialMap: Map<Id, Id>, scale: number): Geometry {
  const out: Geometry = { vertices: {}, edges: {}, faces: {} }
  const vertexMap = new Map<Id, Id>()
  const edgeMap = new Map<Id, Id>()
  const faceMap = new Map<Id, Id>()
  for (const id of Object.keys(geometry.vertices ?? {})) vertexMap.set(id, newId('v'))
  for (const id of Object.keys(geometry.edges ?? {})) edgeMap.set(id, newId('e'))
  for (const id of Object.keys(geometry.faces ?? {})) faceMap.set(id, newId('f'))
  const material = (id: Id | null): Id | null => (id ? materialMap.get(id) ?? null : null)

  for (const vertex of Object.values(geometry.vertices ?? {})) {
    const id = vertexMap.get(vertex.id)
    if (!id) continue
    out.vertices[id] = {
      id,
      p: { x: vertex.p.x * scale, y: vertex.p.y * scale, z: vertex.p.z * scale },
      edges: vertex.edges.map((e) => edgeMap.get(e)).filter((e): e is Id => !!e),
    }
  }
  for (const edge of Object.values(geometry.edges ?? {})) {
    const id = edgeMap.get(edge.id)
    const a = vertexMap.get(edge.a)
    const b = vertexMap.get(edge.b)
    if (!id || !a || !b) continue
    out.edges[id] = {
      ...edge,
      id,
      a,
      b,
      faces: edge.faces.map((f) => faceMap.get(f)).filter((f): f is Id => !!f),
      tagId: null,
      materialId: material(edge.materialId),
    }
  }
  for (const face of Object.values(geometry.faces ?? {})) {
    const id = faceMap.get(face.id)
    if (!id) continue
    const remapLoop = (loop: { edges: Id[]; vertices: Id[] }) => ({
      edges: loop.edges.map((e) => edgeMap.get(e)).filter((e): e is Id => !!e),
      vertices: loop.vertices.map((v) => vertexMap.get(v)).filter((v): v is Id => !!v),
    })
    out.faces[id] = {
      ...face,
      id,
      outer: remapLoop(face.outer),
      inner: face.inner.map(remapLoop),
      plane: { n: face.plane.n, d: face.plane.d * scale },
      frontMaterialId: material(face.frontMaterialId),
      backMaterialId: material(face.backMaterialId),
      tagId: null,
    }
  }
  return out
}

function scaleTranslation(matrix: number[], scale: number): number[] {
  if (scale === 1) return matrix
  const out = [...matrix]
  out[12] *= scale
  out[13] *= scale
  out[14] *= scale
  return out
}
