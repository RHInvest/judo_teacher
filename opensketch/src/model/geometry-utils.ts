/**
 * Geometrie-Hilfsfunktionen der Modellschicht.
 *
 * Diese Datei enthaelt AUSSCHLIESSLICH Operationen, die das Modell selbst
 * braucht und die keine echte Kernel-Logik duplizieren:
 *
 *  - tiefes Klonen einer `Geometry` (Copy-on-Write fuer das Undo-System)
 *  - Extrahieren / Entfernen von Primitiven (Gruppieren, Loeschen)
 *  - ein einfacher `mergeGeometry`-Ersatz (Fallback, solange `@/core` fehlt)
 *  - reine Abfragen (Flaeche, Laenge, Volumen, zusammenhaengend, koplanar)
 *
 * Die reinen Abfragen sind bewusst lokal implementiert: das Entity-Info-Panel
 * und die Auswahl-Erweiterung muessen auch dann funktionieren, wenn der Kernel
 * gerade parallel entwickelt wird. Sobald `@/core` steht, bleiben sie als
 * schneller, allokationsarmer Pfad bestehen - sie sind semantisch identisch.
 *
 * OWNERSHIP: Model.
 */

import type {
  BBox3Like,
  Edge,
  Face,
  Geometry,
  Id,
  Loop,
  Mat4Like,
  UvMapping,
  Vec3Like,
  Vertex,
} from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import type { GeometryChange } from '@/shared/store-api'
import { emptyChange } from '@/shared/store-api'
import { B, M, V, MIN_LENGTH, PLANAR_TOL, POINT_TOL } from '@/core/math'
import { invalidateFaceCache, invalidateSpatialIndex } from '@/core'
import { newId } from '@/shared/ids'

/* ------------------------------------------------------------------ */
/* Cache-Invalidierung                                                 */
/* ------------------------------------------------------------------ */

/**
 * Der Kern haelt zwei Caches: eine Triangulierung pro Flaechen-Id und einen
 * BVH pro `Geometry`-Objekt. Nach eigenen Kernel-Operationen verwirft er sie
 * selbst - die Funktionen HIER mutieren aber am Kernel vorbei. Jede mutierende
 * Funktion dieser Datei meldet deshalb, was sie angefasst hat. Ohne das zeigt
 * der Renderer alte Dreiecke und das Picking trifft ins Leere.
 */
export function invalidateGeometryCaches(geom: Geometry, faceIds?: Iterable<Id>): void {
  if (faceIds === undefined) invalidateFaceCache()
  else for (const id of faceIds) invalidateFaceCache(id)
  invalidateSpatialIndex(geom)
}

/* ------------------------------------------------------------------ */
/* Klonen                                                              */
/* ------------------------------------------------------------------ */

export function cloneVertex(v: Vertex): Vertex {
  return { id: v.id, p: { x: v.p.x, y: v.p.y, z: v.p.z }, edges: v.edges.slice() }
}

export function cloneEdge(e: Edge): Edge {
  return { ...e, faces: e.faces.slice() }
}

export function cloneLoop(l: Loop): Loop {
  return { edges: l.edges.slice(), vertices: l.vertices.slice() }
}

function cloneUv(uv: UvMapping): UvMapping {
  return {
    ...uv,
    m: uv.m.slice(),
    origin: { ...uv.origin },
    xAxis: { ...uv.xAxis },
    yAxis: { ...uv.yAxis },
  }
}

export function cloneFace(f: Face): Face {
  return {
    ...f,
    outer: cloneLoop(f.outer),
    inner: f.inner.map(cloneLoop),
    normal: { ...f.normal },
    plane: { n: { ...f.plane.n }, d: f.plane.d },
    uvFront: f.uvFront ? cloneUv(f.uvFront) : undefined,
    uvBack: f.uvBack ? cloneUv(f.uvBack) : undefined,
  }
}

/**
 * Tiefe Kopie einer Geometrie.
 *
 * Wichtig fuer das Undo-System: der Kernel mutiert Vertices, Kanten und
 * Flaechen IN PLACE (`edge.faces.push(...)`, `vertex.p = ...`). Ein flacher
 * Klon der Maps wuerde den Snapshot mitveraendern, deshalb werden auch die
 * Primitive selbst kopiert.
 */
export function cloneGeometry(g: Geometry): Geometry {
  const out = emptyGeometry()
  for (const id of Object.keys(g.vertices)) out.vertices[id] = cloneVertex(g.vertices[id])
  for (const id of Object.keys(g.edges)) out.edges[id] = cloneEdge(g.edges[id])
  for (const id of Object.keys(g.faces)) out.faces[id] = cloneFace(g.faces[id])
  return out
}

export function isGeometryEmpty(g: Geometry): boolean {
  /*
   * Die Schleifen brechen absichtlich beim ersten Schluessel ab - das ist der
   * allokationsfreie Weg, "ist dieses Objekt leer?" zu beantworten.
   * Object.keys() wuerde bei jeder Abfrage ein Array fuer moeglicherweise
   * hunderttausend Primitive bauen, nur um dessen Laenge zu lesen.
   */
  /* eslint-disable no-unreachable-loop */
  for (const _ in g.vertices) return false
  for (const _ in g.edges) return false
  for (const _ in g.faces) return false
  /* eslint-enable no-unreachable-loop */
  return true
}

export function countPrimitives(g: Geometry): { vertices: number; edges: number; faces: number } {
  return {
    vertices: Object.keys(g.vertices).length,
    edges: Object.keys(g.edges).length,
    faces: Object.keys(g.faces).length,
  }
}

/* ------------------------------------------------------------------ */
/* Auswahl-Mengen                                                      */
/* ------------------------------------------------------------------ */

export interface PrimitiveIds {
  vertexIds: Id[]
  edgeIds: Id[]
  faceIds: Id[]
}

export interface PrimitiveSets {
  vertexIds: Set<Id>
  edgeIds: Set<Id>
  faceIds: Set<Id>
}

export function loopEdgeIds(face: Face): Id[] {
  const out = face.outer.edges.slice()
  for (const hole of face.inner) out.push(...hole.edges)
  return out
}

export function loopVertexIds(face: Face): Id[] {
  const out = face.outer.vertices.slice()
  for (const hole of face.inner) out.push(...hole.vertices)
  return out
}

/**
 * Erweitert eine Primitiv-Auswahl auf ihre Bestandteile:
 * Flaechen ziehen ihre Randkanten mit, Kanten ihre Endpunkte.
 * Zusaetzlich werden Flaechen aufgenommen, deren saemtliche Kanten enthalten
 * sind (`includeImpliedFaces`) - so wandert beim Gruppieren einer Kantenkontur
 * auch die zugehoerige Flaeche mit.
 */
export function expandPrimitives(
  geom: Geometry,
  sel: Partial<PrimitiveIds>,
  opts?: { includeImpliedFaces?: boolean },
): PrimitiveSets {
  const faceIds = new Set<Id>()
  const edgeIds = new Set<Id>()
  const vertexIds = new Set<Id>()

  for (const id of sel.faceIds ?? []) if (geom.faces[id]) faceIds.add(id)
  for (const id of sel.edgeIds ?? []) if (geom.edges[id]) edgeIds.add(id)
  for (const id of sel.vertexIds ?? []) if (geom.vertices[id]) vertexIds.add(id)

  for (const fid of faceIds) {
    const face = geom.faces[fid]
    for (const eid of loopEdgeIds(face)) if (geom.edges[eid]) edgeIds.add(eid)
    for (const vid of loopVertexIds(face)) if (geom.vertices[vid]) vertexIds.add(vid)
  }

  if (opts?.includeImpliedFaces !== false) {
    for (const fid of Object.keys(geom.faces)) {
      if (faceIds.has(fid)) continue
      const face = geom.faces[fid]
      const edges = loopEdgeIds(face)
      if (edges.length > 0 && edges.every((eid) => edgeIds.has(eid))) faceIds.add(fid)
    }
  }

  for (const eid of edgeIds) {
    const edge = geom.edges[eid]
    if (!edge) continue
    if (geom.vertices[edge.a]) vertexIds.add(edge.a)
    if (geom.vertices[edge.b]) vertexIds.add(edge.b)
  }

  return { vertexIds, edgeIds, faceIds }
}

export function toIdArrays(sets: PrimitiveSets): PrimitiveIds {
  return {
    vertexIds: Array.from(sets.vertexIds),
    edgeIds: Array.from(sets.edgeIds),
    faceIds: Array.from(sets.faceIds),
  }
}

/* ------------------------------------------------------------------ */
/* Extrahieren / Entfernen                                             */
/* ------------------------------------------------------------------ */

/**
 * Kopiert die genannten Primitive in eine neue Geometrie. Ids bleiben erhalten,
 * Querverweise auf nicht kopierte Primitive werden entfernt.
 */
export function extractGeometry(geom: Geometry, sets: PrimitiveSets): Geometry {
  const out = emptyGeometry()

  for (const vid of sets.vertexIds) {
    const v = geom.vertices[vid]
    if (!v) continue
    out.vertices[vid] = {
      id: v.id,
      p: { x: v.p.x, y: v.p.y, z: v.p.z },
      edges: v.edges.filter((eid) => sets.edgeIds.has(eid)),
    }
  }
  for (const eid of sets.edgeIds) {
    const e = geom.edges[eid]
    if (!e) continue
    if (!out.vertices[e.a] || !out.vertices[e.b]) continue
    out.edges[eid] = { ...e, faces: e.faces.filter((fid) => sets.faceIds.has(fid)) }
  }
  for (const fid of sets.faceIds) {
    const f = geom.faces[fid]
    if (!f) continue
    const edges = loopEdgeIds(f)
    const verts = loopVertexIds(f)
    if (!edges.every((id) => out.edges[id]) || !verts.every((id) => out.vertices[id])) continue
    out.faces[fid] = cloneFace(f)
  }

  // Verweise auf Flaechen saeubern, die es nicht in die Kopie geschafft haben
  for (const eid of Object.keys(out.edges)) {
    out.edges[eid].faces = out.edges[eid].faces.filter((fid) => out.faces[fid] !== undefined)
  }
  for (const vid of Object.keys(out.vertices)) {
    out.vertices[vid].edges = out.vertices[vid].edges.filter((eid) => out.edges[eid] !== undefined)
  }
  return out
}

/**
 * Entfernt Primitive aus einer Geometrie (mutierend).
 *
 * Kaskade: geloeschte Vertices reissen ihre Kanten mit, geloeschte Kanten ihre
 * Flaechen. `pruneOrphanVertices` entfernt danach Vertices ohne Kanten.
 */
export function removePrimitives(
  geom: Geometry,
  ids: Partial<PrimitiveIds>,
  opts?: { pruneOrphanVertices?: boolean },
): GeometryChange {
  const change = emptyChange()

  const faceIds = new Set<Id>((ids.faceIds ?? []).filter((id) => geom.faces[id]))
  const edgeIds = new Set<Id>((ids.edgeIds ?? []).filter((id) => geom.edges[id]))
  const vertexIds = new Set<Id>((ids.vertexIds ?? []).filter((id) => geom.vertices[id]))

  for (const vid of vertexIds) {
    for (const eid of geom.vertices[vid].edges) if (geom.edges[eid]) edgeIds.add(eid)
  }
  for (const eid of edgeIds) {
    for (const fid of geom.edges[eid].faces) if (geom.faces[fid]) faceIds.add(fid)
  }

  for (const fid of faceIds) {
    const face = geom.faces[fid]
    if (!face) continue
    for (const eid of loopEdgeIds(face)) {
      const edge = geom.edges[eid]
      if (edge) edge.faces = edge.faces.filter((id) => id !== fid)
    }
    delete geom.faces[fid]
    change.removedFaces.push(fid)
  }
  for (const eid of edgeIds) {
    const edge = geom.edges[eid]
    if (!edge) continue
    for (const vid of [edge.a, edge.b]) {
      const vertex = geom.vertices[vid]
      if (vertex) vertex.edges = vertex.edges.filter((id) => id !== eid)
    }
    delete geom.edges[eid]
    change.removedEdges.push(eid)
  }
  for (const vid of vertexIds) {
    if (!geom.vertices[vid]) continue
    delete geom.vertices[vid]
    change.removedVertices.push(vid)
  }

  if (opts?.pruneOrphanVertices !== false) {
    for (const vid of Object.keys(geom.vertices)) {
      const vertex = geom.vertices[vid]
      vertex.edges = vertex.edges.filter((eid) => geom.edges[eid] !== undefined)
      if (vertex.edges.length === 0) {
        delete geom.vertices[vid]
        change.removedVertices.push(vid)
      }
    }
  }
  invalidateGeometryCaches(geom, change.removedFaces)
  return change
}

/* ------------------------------------------------------------------ */
/* Transformieren                                                      */
/* ------------------------------------------------------------------ */

/** Transformiert alle Punkte einer Geometrie in place und richtet die Ebenen neu aus. */
export function transformGeometryMut(geom: Geometry, matrix: Mat4Like): void {
  for (const vid of Object.keys(geom.vertices)) {
    const v = geom.vertices[vid]
    v.p = M.transformPoint(matrix, v.p)
  }
  const faceIds = Object.keys(geom.faces)
  for (const fid of faceIds) recomputeFacePlaneMut(geom, geom.faces[fid])
  invalidateGeometryCaches(geom, faceIds)
}

/** Neue, transformierte Kopie. */
export function transformedGeometry(geom: Geometry, matrix: Mat4Like): Geometry {
  const copy = cloneGeometry(geom)
  transformGeometryMut(copy, matrix)
  return copy
}

/** Berechnet Normale und Ebene einer Flaeche aus ihrer Aussenschleife neu (Newell). */
export function recomputeFacePlaneMut(geom: Geometry, face: Face): void {
  const points = loopPoints(geom, face.outer)
  if (points.length < 3) return
  const n = newellNormal(points)
  if (V.isZero(n)) return
  const normal = V.normalize(n)
  face.normal = normal
  face.plane = { n: normal, d: V.dot(normal, points[0]) }
  invalidateFaceCache(face.id)
}

export function loopPoints(geom: Geometry, loop: Loop): Vec3Like[] {
  const out: Vec3Like[] = []
  for (const vid of loop.vertices) {
    const v = geom.vertices[vid]
    if (v) out.push(v.p)
  }
  return out
}

function newellNormal(points: readonly Vec3Like[]): Vec3Like {
  let x = 0
  let y = 0
  let z = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    x += (a.y - b.y) * (a.z + b.z)
    y += (a.z - b.z) * (a.x + b.x)
    z += (a.x - b.x) * (a.y + b.y)
  }
  return { x: x / 2, y: y / 2, z: z / 2 }
}

/* ------------------------------------------------------------------ */
/* Zusammenfuehren (Fallback fuer core.mergeGeometry)                  */
/* ------------------------------------------------------------------ */

/**
 * Einfacher `mergeGeometry`-Ersatz: uebertraegt `source` (optional
 * transformiert) nach `target`, verschweisst Vertices im Radius POINT_TOL und
 * dedupliziert Kanten. Es werden KEINE Schnittpunkte gesucht und keine neuen
 * Flaechen gebildet - genau das macht spaeter der Kernel besser.
 */
export function mergeGeometryInto(target: Geometry, source: Geometry, transform?: Mat4Like): GeometryChange {
  const change = emptyChange()

  const vertexKey = new Map<string, Id>()
  for (const vid of Object.keys(target.vertices)) vertexKey.set(V.key(target.vertices[vid].p), vid)

  const edgeKey = new Map<string, Id>()
  for (const eid of Object.keys(target.edges)) {
    const e = target.edges[eid]
    edgeKey.set(pairKey(e.a, e.b), eid)
  }

  const vertexMap = new Map<Id, Id>()
  for (const vid of Object.keys(source.vertices)) {
    const src = source.vertices[vid]
    const p = transform ? M.transformPoint(transform, src.p) : { ...src.p }
    const key = V.key(p)
    const existing = vertexKey.get(key)
    if (existing) {
      vertexMap.set(vid, existing)
      continue
    }
    const id = target.vertices[vid] ? newId('v') : vid
    target.vertices[id] = { id, p, edges: [] }
    vertexKey.set(key, id)
    vertexMap.set(vid, id)
    change.addedVertices.push(id)
  }

  const edgeMap = new Map<Id, Id>()
  for (const eid of Object.keys(source.edges)) {
    const src = source.edges[eid]
    const a = vertexMap.get(src.a)
    const b = vertexMap.get(src.b)
    if (!a || !b || a === b) continue
    const key = pairKey(a, b)
    const existing = edgeKey.get(key)
    if (existing) {
      edgeMap.set(eid, existing)
      continue
    }
    const id = target.edges[eid] ? newId('e') : eid
    target.edges[id] = { ...src, id, a, b, faces: [] }
    target.vertices[a].edges.push(id)
    target.vertices[b].edges.push(id)
    edgeKey.set(key, id)
    edgeMap.set(eid, id)
    change.addedEdges.push(id)
  }

  for (const fid of Object.keys(source.faces)) {
    const src = source.faces[fid]
    const outer = remapLoop(src.outer, vertexMap, edgeMap)
    if (!outer) continue
    const inner: Loop[] = []
    let holesOk = true
    for (const hole of src.inner) {
      const mapped = remapLoop(hole, vertexMap, edgeMap)
      if (!mapped) {
        holesOk = false
        break
      }
      inner.push(mapped)
    }
    if (!holesOk) continue
    const id = target.faces[fid] ? newId('f') : fid
    const face: Face = { ...cloneFace(src), id, outer, inner }
    target.faces[id] = face
    for (const eid of loopEdgeIds(face)) {
      const edge = target.edges[eid]
      if (edge && !edge.faces.includes(id)) edge.faces.push(id)
    }
    recomputeFacePlaneMut(target, face)
    change.addedFaces.push(id)
  }

  invalidateGeometryCaches(target, change.addedFaces)
  return change
}

function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function remapLoop(loop: Loop, vertexMap: Map<Id, Id>, edgeMap: Map<Id, Id>): Loop | null {
  const vertices: Id[] = []
  const edges: Id[] = []
  for (const vid of loop.vertices) {
    const mapped = vertexMap.get(vid)
    if (!mapped) return null
    vertices.push(mapped)
  }
  for (const eid of loop.edges) {
    const mapped = edgeMap.get(eid)
    if (!mapped) return null
    edges.push(mapped)
  }
  return { vertices, edges }
}

/* ------------------------------------------------------------------ */
/* Abfragen                                                            */
/* ------------------------------------------------------------------ */

export function geometryBounds(geom: Geometry): BBox3Like {
  const box = B.empty()
  for (const vid of Object.keys(geom.vertices)) B.expandByPointMut(box, geom.vertices[vid].p)
  return box
}

export function edgeLength(geom: Geometry, edgeId: Id): number {
  const e = geom.edges[edgeId]
  if (!e) return 0
  const a = geom.vertices[e.a]
  const b = geom.vertices[e.b]
  if (!a || !b) return 0
  return V.distance(a.p, b.p)
}

export function totalEdgeLength(geom: Geometry, edgeIds: readonly Id[]): number {
  let sum = 0
  for (const id of edgeIds) sum += edgeLength(geom, id)
  return sum
}

function loopArea(geom: Geometry, loop: Loop): number {
  const points = loopPoints(geom, loop)
  if (points.length < 3) return 0
  return V.length(newellNormal(points))
}

export function faceArea(geom: Geometry, faceId: Id): number {
  const face = geom.faces[faceId]
  if (!face) return 0
  let area = loopArea(geom, face.outer)
  for (const hole of face.inner) area -= loopArea(geom, hole)
  return Math.max(0, area)
}

export function totalArea(geom: Geometry, faceIds?: readonly Id[]): number {
  const ids = faceIds ?? Object.keys(geom.faces)
  let sum = 0
  for (const id of ids) sum += faceArea(geom, id)
  return sum
}

/** true, wenn jede Kante genau zwei Flaechen traegt (geschlossenes Volumen). */
export function isSolid(geom: Geometry): boolean {
  const edgeIds = Object.keys(geom.edges)
  if (edgeIds.length === 0) return false
  if (Object.keys(geom.faces).length < 4) return false
  for (const eid of edgeIds) {
    const edge = geom.edges[eid]
    if (edge.guide) continue
    if (edge.faces.length !== 2) return false
  }
  return true
}

/** Volumen eines geschlossenen Koerpers (Divergenzsatz ueber Faecher-Triangulierung). */
export function solidVolume(geom: Geometry): number {
  if (!isSolid(geom)) return 0
  let volume = 0
  for (const fid of Object.keys(geom.faces)) {
    const face = geom.faces[fid]
    volume += loopSignedVolume(geom, face.outer)
    for (const hole of face.inner) volume += loopSignedVolume(geom, hole)
  }
  return Math.abs(volume)
}

function loopSignedVolume(geom: Geometry, loop: Loop): number {
  const p = loopPoints(geom, loop)
  let sum = 0
  for (let i = 1; i + 1 < p.length; i++) sum += V.dot(p[0], V.cross(p[i], p[i + 1]))
  return sum / 6
}

/** Alle ueber Kanten verbundenen Primitive ab einem Startelement. */
export function findConnected(geom: Geometry, seed: Partial<PrimitiveIds>): PrimitiveIds {
  const vertices = new Set<Id>()
  const edges = new Set<Id>()
  const faces = new Set<Id>()
  const vertexQueue: Id[] = []

  const addVertex = (id: Id): void => {
    if (vertices.has(id) || !geom.vertices[id]) return
    vertices.add(id)
    vertexQueue.push(id)
  }
  const addEdge = (id: Id): void => {
    const edge = geom.edges[id]
    if (!edge || edges.has(id)) return
    edges.add(id)
    addVertex(edge.a)
    addVertex(edge.b)
    for (const fid of edge.faces) addFace(fid)
  }
  const addFace = (id: Id): void => {
    const face = geom.faces[id]
    if (!face || faces.has(id)) return
    faces.add(id)
    for (const eid of loopEdgeIds(face)) addEdge(eid)
  }

  for (const id of seed.vertexIds ?? []) addVertex(id)
  for (const id of seed.edgeIds ?? []) addEdge(id)
  for (const id of seed.faceIds ?? []) addFace(id)

  while (vertexQueue.length > 0) {
    const vid = vertexQueue.pop() as Id
    for (const eid of geom.vertices[vid].edges) addEdge(eid)
  }

  return {
    vertexIds: Array.from(vertices),
    edgeIds: Array.from(edges),
    faceIds: Array.from(faces),
  }
}

/** Alle koplanaren, ueber Kanten zusammenhaengenden Flaechen ab einer Startflaeche. */
export function findCoplanar(geom: Geometry, faceId: Id): Id[] {
  const seed = geom.faces[faceId]
  if (!seed) return []
  const result = new Set<Id>([faceId])
  const queue: Id[] = [faceId]
  while (queue.length > 0) {
    const current = geom.faces[queue.pop() as Id]
    for (const eid of loopEdgeIds(current)) {
      const edge = geom.edges[eid]
      if (!edge) continue
      for (const fid of edge.faces) {
        if (result.has(fid)) continue
        const other = geom.faces[fid]
        if (!other) continue
        if (!samePlane(seed, other)) continue
        result.add(fid)
        queue.push(fid)
      }
    }
  }
  return Array.from(result)
}

function samePlane(a: Face, b: Face): boolean {
  const dot = V.dot(a.plane.n, b.plane.n)
  if (Math.abs(Math.abs(dot) - 1) > 1e-4) return false
  const d = dot >= 0 ? b.plane.d : -b.plane.d
  return Math.abs(a.plane.d - d) <= PLANAR_TOL * 100
}

/** Begrenzungskanten einer Flaechenmenge (aeussere Kontur + Loecher). */
export function boundingEdges(geom: Geometry, faceIds: readonly Id[]): Id[] {
  const out = new Set<Id>()
  for (const fid of faceIds) {
    const face = geom.faces[fid]
    if (!face) continue
    for (const eid of loopEdgeIds(face)) if (geom.edges[eid]) out.add(eid)
  }
  return Array.from(out)
}

/** Kanten, die exakt zwischen zwei Punkten liegen - Hilfsmittel fuer Tests/IO. */
export function findEdgeBetween(geom: Geometry, a: Vec3Like, b: Vec3Like): Id | null {
  for (const eid of Object.keys(geom.edges)) {
    const edge = geom.edges[eid]
    const pa = geom.vertices[edge.a]?.p
    const pb = geom.vertices[edge.b]?.p
    if (!pa || !pb) continue
    if ((V.equals(pa, a, POINT_TOL) && V.equals(pb, b, POINT_TOL)) || (V.equals(pa, b, POINT_TOL) && V.equals(pb, a, POINT_TOL))) {
      return eid
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Bauen (nur fuer Tests / Fallbacks)                                  */
/* ------------------------------------------------------------------ */

/**
 * Baut eine einfache, geschlossene Flaeche aus einer Punktschleife.
 * Bewusst simpel: kein Verschmelzen, kein Schneiden - der Kernel macht das
 * spaeter richtig. Wird als Fallback fuer `addFacePolygon` benutzt.
 */
export function buildFaceFromPoints(
  geom: Geometry,
  points: readonly Vec3Like[],
  opts?: { tagId?: Id | null; materialId?: Id | null },
): GeometryChange {
  const change = emptyChange()
  if (points.length < 3) return change

  const vertexIds: Id[] = []
  for (const p of points) {
    const id = newId('v')
    geom.vertices[id] = { id, p: { ...p }, edges: [] }
    vertexIds.push(id)
    change.addedVertices.push(id)
  }
  const edgeIds: Id[] = []
  for (let i = 0; i < vertexIds.length; i++) {
    const a = vertexIds[i]
    const b = vertexIds[(i + 1) % vertexIds.length]
    const id = newId('e')
    geom.edges[id] = {
      id,
      a,
      b,
      faces: [],
      soft: false,
      smooth: false,
      hidden: false,
      tagId: opts?.tagId ?? null,
      materialId: null,
    }
    geom.vertices[a].edges.push(id)
    geom.vertices[b].edges.push(id)
    edgeIds.push(id)
    change.addedEdges.push(id)
  }

  const fid = newId('f')
  const normal = V.normalizeOr(newellNormal(points), V.AXIS_Z)
  const face: Face = {
    id: fid,
    outer: { edges: edgeIds, vertices: vertexIds },
    inner: [],
    normal,
    plane: { n: normal, d: V.dot(normal, points[0]) },
    frontMaterialId: opts?.materialId ?? null,
    backMaterialId: null,
    hidden: false,
    tagId: opts?.tagId ?? null,
  }
  geom.faces[fid] = face
  for (const eid of edgeIds) geom.edges[eid].faces.push(fid)
  change.addedFaces.push(fid)
  invalidateGeometryCaches(geom, [fid])
  return change
}

/** Fuegt eine einzelne Kante ohne Verschmelzen ein (Fallback fuer `addEdge`). */
export function buildEdge(
  geom: Geometry,
  a: Vec3Like,
  b: Vec3Like,
  opts?: { guide?: boolean; tagId?: Id | null; materialId?: Id | null },
): GeometryChange {
  const change = emptyChange()
  if (V.distance(a, b) < MIN_LENGTH) return change

  const va = findOrCreateVertex(geom, a, change)
  const vb = findOrCreateVertex(geom, b, change)
  if (va === vb) return change

  const existing = geom.vertices[va].edges.find((eid) => {
    const e = geom.edges[eid]
    return e && ((e.a === va && e.b === vb) || (e.a === vb && e.b === va))
  })
  if (existing) return change

  const id = newId('e')
  geom.edges[id] = {
    id,
    a: va,
    b: vb,
    faces: [],
    soft: false,
    smooth: false,
    hidden: false,
    guide: opts?.guide,
    tagId: opts?.tagId ?? null,
    materialId: opts?.materialId ?? null,
  }
  geom.vertices[va].edges.push(id)
  geom.vertices[vb].edges.push(id)
  change.addedEdges.push(id)
  invalidateGeometryCaches(geom, [])
  return change
}

function findOrCreateVertex(geom: Geometry, p: Vec3Like, change: GeometryChange): Id {
  for (const vid of Object.keys(geom.vertices)) {
    if (V.equalsSq(geom.vertices[vid].p, p)) return vid
  }
  const id = newId('v')
  geom.vertices[id] = { id, p: { ...p }, edges: [] }
  change.addedVertices.push(id)
  return id
}
