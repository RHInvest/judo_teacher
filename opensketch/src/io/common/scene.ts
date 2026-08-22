/**
 * Dokument -> Exportdaten.
 *
 * Zwei Sichten auf dasselbe Dokument:
 *  - `flattenDocument`  : alle Flaechen/Kanten in Weltkoordinaten (STL, SVG, OBJ)
 *  - `buildSceneTree`   : Knotenhierarchie mit Transformationen (glTF, DAE)
 */

import type {
  Definition,
  Face,
  Geometry,
  Id,
  InstanceEntity,
  Mat4Like,
  Material,
  SketchDocument,
  Vec3Like,
} from '@/shared/types'
import { M, P, V } from '@/core/math'
import { faceHoleRings, faceRing } from './geom'
import { triangulatePolygon3 } from './triangulate'

/* ------------------------------------------------------------------ */
/* Optionen                                                            */
/* ------------------------------------------------------------------ */

export interface TraverseOptions {
  /** versteckte Instanzen und Flaechen ueberspringen (Standard: true) */
  skipHidden?: boolean
  /** Skalierung aller Koordinaten (1 = Meter) */
  unitScale?: number
  /**
   * Nur diese Instanzen der Wurzel exportieren. Ist die Liste gesetzt, wird
   * die Rohgeometrie der Wurzel uebersprungen und nur in die genannten
   * Instanzen abgestiegen. Leere oder fehlende Liste = alles.
   */
  onlyEntityIds?: Id[]
  /**
   * Wird fuer jede Instanz gerufen, die die Traversierung auslaesst (Ring
   * oder Rekursionsgrenze). `flattenDocument` zaehlt das zusaetzlich in
   * `FlatDocument.skipped`; `buildSceneTree` hat kein Ergebnisobjekt dafuer,
   * deshalb der Rueckkanal - ohne ihn verschwaenden Instanzen lautlos.
   */
  onSkip?: () => void
  /**
   * Wird fuer jede Flaeche gerufen, die `buildDefinitionMesh` nicht in
   * Dreiecke zerlegen konnte (entartete Schleife, nicht ebener Ring, NaN).
   * Ohne den Rueckkanal exportiert ein Modell mit 200 Flaechen 197, und
   * niemand erfaehrt es.
   */
  onDegenerateFace?: () => void
}

/** true, wenn `onlyEntityIds` benutzbar ist. */
function selectionOf(opts: TraverseOptions): Set<Id> | null {
  const ids = opts.onlyEntityIds
  return ids && ids.length > 0 ? new Set(ids) : null
}

const MAX_DEPTH = 32

/* ------------------------------------------------------------------ */
/* Flaechenpolygone                                                    */
/* ------------------------------------------------------------------ */

export interface FacePolygon {
  outer: Vec3Like[]
  holes: Vec3Like[][]
  normal: Vec3Like
  frontMaterialId: Id | null
  backMaterialId: Id | null
  faceId: Id
  definitionId: Id
  /** Name der Instanz, in der die Flaeche steckt */
  groupName: string
}

export interface FlatEdge {
  a: Vec3Like
  b: Vec3Like
  materialId: Id | null
  groupName: string
  soft: boolean
  hidden: boolean
  /**
   * true, wenn die Kante mindestens eine Flaeche begrenzt. Formate ohne
   * Linien (STL, DAE, glTF) verlieren genau die Kanten, bei denen das
   * false ist - sie sind sonst nirgends in der Datei zu sehen.
   */
  hasFaces: boolean
}

export interface FlatDocument {
  faces: FacePolygon[]
  edges: FlatEdge[]
  /** Anzahl uebersprungener Instanzen (Rekursionsgrenze) */
  skipped: number
  /** Flaechen, deren Ring unbrauchbar war (zu kurz oder nicht endlich) */
  degenerateFaces: number
  /** Kanten mit nicht endlichem Endpunkt */
  degenerateEdges: number
}

/**
 * NaN oder Infinity in einem einzigen Vertex reicht, um eine Exportdatei
 * unbrauchbar zu machen: `num()` schreibt dafuer eine 0 - also einen erfundenen
 * Wert an einer plausiblen Stelle -, und der STL-Binaerschreiber legt das NaN
 * roh in die Datei. Beides sieht nach Erfolg aus. Deshalb fliegt nicht endliche
 * Geometrie hier heraus und wird gezaehlt, statt weiter unten durch jede
 * Toleranzpruefung zu rutschen.
 */
function ringIsFinite(ring: readonly Vec3Like[]): boolean {
  for (const p of ring) if (!V.isFinite3(p)) return false
  return true
}

/** Alle Flaechen und Kanten des Dokuments in Weltkoordinaten. */
export function flattenDocument(doc: SketchDocument, opts: TraverseOptions = {}): FlatDocument {
  const scale = opts.unitScale ?? 1
  const skipHidden = opts.skipHidden ?? true
  const selection = selectionOf(opts)
  const out: FlatDocument = { faces: [], edges: [], skipped: 0, degenerateFaces: 0, degenerateEdges: 0 }

  const walk = (definitionId: Id, transform: Mat4Like, name: string, depth: number, path: Id[]): void => {
    if (depth > MAX_DEPTH) {
      out.skipped++
      opts.onSkip?.()
      return
    }
    const def = doc.definitions[definitionId]
    if (!def) return

    // Bei einer Auswahl bleibt die Rohgeometrie der Wurzel aussen vor.
    const skipGeometry = selection !== null && depth === 0
    const geom = def.geometry
    if (!skipGeometry) {
      for (const face of Object.values(geom.faces)) {
        if (skipHidden && face.hidden) continue
        const outer = faceRing(geom, face.id).map((p) => transformScaled(p, transform, scale))
        if (outer.length < 3 || !ringIsFinite(outer)) {
          out.degenerateFaces++
          continue
        }
        const holes = faceHoleRings(geom, face.id)
          .map((ring) => ring.map((p) => transformScaled(p, transform, scale)))
          // Ein unbrauchbares Loch macht die Flaeche nicht unbrauchbar - es
          // faellt einzeln heraus, die Flaeche bleibt (dann ohne Loch).
          .filter((ring) => {
            if (ringIsFinite(ring)) return true
            out.degenerateFaces++
            return false
          })
        const normal = P.polygonNormal(outer) ?? M.transformNormal(transform, face.normal)
        if (!V.isFinite3(normal)) {
          out.degenerateFaces++
          continue
        }
        out.faces.push({
          outer,
          holes,
          normal,
          frontMaterialId: face.frontMaterialId,
          backMaterialId: face.backMaterialId,
          faceId: face.id,
          definitionId,
          groupName: name,
        })
      }
      for (const edge of Object.values(geom.edges)) {
        if (skipHidden && (edge.hidden || edge.guide)) continue
        const a = geom.vertices[edge.a]
        const b = geom.vertices[edge.b]
        if (!a || !b) continue
        const pa = transformScaled(a.p, transform, scale)
        const pb = transformScaled(b.p, transform, scale)
        if (!V.isFinite3(pa) || !V.isFinite3(pb)) {
          out.degenerateEdges++
          continue
        }
        out.edges.push({
          a: pa,
          b: pb,
          materialId: edge.materialId,
          groupName: name,
          soft: edge.soft,
          hidden: edge.hidden,
          hasFaces: edge.faces.length > 0,
        })
      }
    }

    for (const childId of def.children) {
      const entity = doc.entities[childId]
      if (!entity || entity.type !== 'instance') continue
      if (skipHidden && entity.hidden) continue
      if (selection !== null && depth === 0 && !selection.has(entity.id)) continue
      if (path.includes(entity.definitionId)) {
        out.skipped++
        opts.onSkip?.()
        continue
      }
      const child = doc.definitions[entity.definitionId]
      const childName = entity.name || child?.name || 'Gruppe'
      walk(
        entity.definitionId,
        M.multiply(transform, entity.transform),
        childName,
        depth + 1,
        [...path, entity.definitionId],
      )
    }
  }

  walk(doc.rootId, M.identity(), doc.meta.name || 'Modell', 0, [doc.rootId])
  return out
}

function transformScaled(p: Vec3Like, m: Mat4Like, scale: number): Vec3Like {
  const t = V.applyMat4(p, m)
  return scale === 1 ? t : { x: t.x * scale, y: t.y * scale, z: t.z * scale }
}

/* ------------------------------------------------------------------ */
/* Knotenbaum                                                          */
/* ------------------------------------------------------------------ */

export interface SceneNode {
  name: string
  definitionId: Id
  /** lokale Transformation relativ zum Elternknoten */
  transform: Mat4Like
  children: SceneNode[]
  /** Materialueberschreibung der Instanz */
  materialId: Id | null
}

export function buildSceneTree(doc: SketchDocument, opts: TraverseOptions = {}): SceneNode {
  const skipHidden = opts.skipHidden ?? true
  const selection = selectionOf(opts)

  const walk = (definitionId: Id, transform: Mat4Like, name: string, materialId: Id | null, depth: number, path: Id[]): SceneNode => {
    const node: SceneNode = { name, definitionId, transform, children: [], materialId }
    const def = doc.definitions[definitionId]
    if (!def) return node
    if (depth > MAX_DEPTH) {
      opts.onSkip?.()
      return node
    }
    for (const childId of def.children) {
      const entity = doc.entities[childId]
      if (!entity || entity.type !== 'instance') continue
      if (skipHidden && entity.hidden) continue
      if (selection !== null && depth === 0 && !selection.has(entity.id)) continue
      if (path.includes(entity.definitionId)) {
        opts.onSkip?.()
        continue
      }
      const child = doc.definitions[entity.definitionId]
      node.children.push(
        walk(
          entity.definitionId,
          entity.transform,
          entity.name || child?.name || 'Gruppe',
          entity.materialId ?? materialId,
          depth + 1,
          [...path, entity.definitionId],
        ),
      )
    }
    return node
  }

  return walk(doc.rootId, M.identity(), doc.meta.name || 'Modell', null, 0, [doc.rootId])
}

/** Alle Definitionen, die im Baum tatsaechlich vorkommen. */
export function usedDefinitions(root: SceneNode): Id[] {
  const seen = new Set<Id>()
  const walk = (node: SceneNode): void => {
    seen.add(node.definitionId)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return [...seen]
}

/* ------------------------------------------------------------------ */
/* Dreiecksnetze                                                       */
/* ------------------------------------------------------------------ */

export interface MeshPrimitive {
  materialId: Id | null
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

/**
 * Baut die Rohgeometrie einer Definition (ohne Kinder) als Dreiecksnetze,
 * gruppiert nach Material. Positionen liegen im Definitionsraum.
 */
export function buildDefinitionMesh(
  doc: SketchDocument,
  definitionId: Id,
  opts: TraverseOptions = {},
): MeshPrimitive[] {
  const def = doc.definitions[definitionId]
  if (!def) return []
  const scale = opts.unitScale ?? 1
  const skipHidden = opts.skipHidden ?? true
  const byMaterial = new Map<string, MeshPrimitive>()

  for (const face of Object.values(def.geometry.faces)) {
    if (skipHidden && face.hidden) continue
    const key = face.frontMaterialId ?? ''
    let prim = byMaterial.get(key)
    if (!prim) {
      prim = { materialId: face.frontMaterialId, positions: [], normals: [], uvs: [], indices: [] }
      byMaterial.set(key, prim)
    }
    appendFace(prim, def.geometry, face, doc.materials[face.frontMaterialId ?? ''], scale, opts.onDegenerateFace)
  }
  return [...byMaterial.values()].filter((p) => p.indices.length > 0)
}

function appendFace(
  prim: MeshPrimitive,
  geom: Geometry,
  face: Face,
  material: Material | undefined,
  scale: number,
  onDegenerate?: () => void,
): void {
  const outer = faceRing(geom, face.id)
  if (outer.length < 3 || !ringIsFinite(outer)) {
    onDegenerate?.()
    return
  }
  const holes = faceHoleRings(geom, face.id).filter(ringIsFinite)
  const normal = P.polygonNormal(outer) ?? face.normal
  if (!V.isFinite3(normal)) {
    onDegenerate?.()
    return
  }
  const tris = triangulatePolygon3({ outer, holes, normal })
  if (tris.length === 0) {
    onDegenerate?.()
    return
  }

  const all = [...outer, ...holes.flat()]
  const base = prim.positions.length / 3
  const frame = P.frame(P.fromNormalAndPoint(normal, outer[0]), outer[0])
  const tw = material && material.textureWidth > 0 ? material.textureWidth : 1
  const th = material && material.textureHeight > 0 ? material.textureHeight : 1

  for (const p of all) {
    prim.positions.push(p.x * scale, p.y * scale, p.z * scale)
    prim.normals.push(normal.x, normal.y, normal.z)
    const uv = frame.to2d(p)
    prim.uvs.push(uv.x / tw, uv.y / th)
  }
  for (const idx of tris) prim.indices.push(base + idx)
}

/** Dreiecke einer Flaeche in Weltkoordinaten (STL, SVG-Tiefensortierung). */
export function triangulateFlatFace(poly: FacePolygon): { a: Vec3Like; b: Vec3Like; c: Vec3Like }[] {
  const all = [...poly.outer, ...poly.holes.flat()]
  const tris = triangulatePolygon3({ outer: poly.outer, holes: poly.holes, normal: poly.normal })
  const out: { a: Vec3Like; b: Vec3Like; c: Vec3Like }[] = []
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = all[tris[i]]
    const b = all[tris[i + 1]]
    const c = all[tris[i + 2]]
    if (a && b && c) out.push({ a, b, c })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Materialien                                                         */
/* ------------------------------------------------------------------ */

export const DEFAULT_MATERIAL_NAME = 'Standard'
export const DEFAULT_MATERIAL_COLOR = '#d9d3c8'

export function materialOf(doc: SketchDocument, id: Id | null): Material | null {
  if (!id) return null
  return doc.materials[id] ?? null
}

/** Alle im Dokument tatsaechlich benutzten Materialien. */
export function usedMaterials(doc: SketchDocument, flat: FlatDocument): Material[] {
  const ids = new Set<Id>()
  for (const face of flat.faces) {
    if (face.frontMaterialId) ids.add(face.frontMaterialId)
    if (face.backMaterialId) ids.add(face.backMaterialId)
  }
  for (const edge of flat.edges) if (edge.materialId) ids.add(edge.materialId)
  const out: Material[] = []
  for (const id of ids) {
    const material = doc.materials[id]
    if (material) out.push(material)
  }
  return out
}

/** Definitionen sortiert, Wurzel zuerst - wird von glTF/DAE gebraucht. */
export function definitionList(doc: SketchDocument, root: SceneNode): Definition[] {
  return usedDefinitions(root)
    .map((id) => doc.definitions[id])
    .filter((d): d is Definition => !!d)
}

export function instanceEntities(doc: SketchDocument, definitionId: Id): InstanceEntity[] {
  const def = doc.definitions[definitionId]
  if (!def) return []
  const out: InstanceEntity[] = []
  for (const id of def.children) {
    const entity = doc.entities[id]
    if (entity && entity.type === 'instance') out.push(entity)
  }
  return out
}
