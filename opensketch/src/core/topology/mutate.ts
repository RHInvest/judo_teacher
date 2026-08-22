/**
 * Low level graph maintenance for one `Geometry` context.
 *
 * Every structural change in the kernel goes through the helpers in this file
 * so that the back references (vertex -> edges, edge -> faces) and the vertex
 * spatial index stay consistent. Nothing here does face finding; that lives in
 * `faceloops.ts`.
 */

import type { Edge, Face, Geometry, Id, Loop, PlaneLike, Vec3Like } from '@/shared/types'
import { newId } from '@/shared/ids'
import { MIN_LENGTH, P, POINT_TOL, V } from '@/core/math'
import type { ChangeAcc } from './change'

/* ------------------------------------------------------------------ */
/* Eingangspruefung                                                    */
/* ------------------------------------------------------------------ */

/**
 * NaN und Infinity duerfen NIE in die Geometrie gelangen.
 *
 * Ein einziger nicht endlicher Vertex vergiftet alles, was danach kommt: die
 * Huellbox wird NaN, damit die BVH-Vorauswahl, damit jeder Strahltest;
 * `solidVolume` liefert NaN; und `validate` meldet die Geometrie als
 * beschaedigt. Repariert wird das nicht mehr - der Nutzer sieht nur, dass
 * "nichts mehr geht". Deshalb wird an jeder Stelle, die Zahlen von aussen
 * annimmt, vorher geprueft, statt hinterher zu retten.
 */
export function isFinitePoint(p: Vec3Like | null | undefined): boolean {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
}

/** Endliche Zahl, sonst false. Fuer Distanzen, Winkel und Segmentzahlen. */
export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

/* ------------------------------------------------------------------ */
/* Vertex spatial index                                                */
/* ------------------------------------------------------------------ */

/** cell width, chosen so that two points within POINT_TOL land in adjacent cells */
const CELL = POINT_TOL * 2

interface VertexIndex {
  cells: Map<string, Id[]>
  count: number
}

const indexCache = new WeakMap<Geometry, VertexIndex>()

function cellKey(p: Vec3Like): string {
  return `${Math.round(p.x / CELL)},${Math.round(p.y / CELL)},${Math.round(p.z / CELL)}`
}

function countRecord(rec: Record<string, unknown>): number {
  return Object.keys(rec).length
}

function buildIndex(geom: Geometry): VertexIndex {
  const cells = new Map<string, Id[]>()
  let count = 0
  for (const id in geom.vertices) {
    const k = cellKey(geom.vertices[id].p)
    const list = cells.get(k)
    if (list) list.push(id)
    else cells.set(k, [id])
    count++
  }
  return { cells, count }
}

/** Drops the cached index; call after mutating vertex positions from outside. */
export function invalidateVertexIndex(geom: Geometry): void {
  indexCache.delete(geom)
}

function getIndex(geom: Geometry): VertexIndex {
  const cached = indexCache.get(geom)
  if (cached && cached.count === countRecord(geom.vertices)) return cached
  const built = buildIndex(geom)
  indexCache.set(geom, built)
  return built
}

function indexInsert(geom: Geometry, id: Id, p: Vec3Like): void {
  const idx = indexCache.get(geom)
  if (!idx) return
  const k = cellKey(p)
  const list = idx.cells.get(k)
  if (list) list.push(id)
  else idx.cells.set(k, [id])
  idx.count++
}

function indexRemove(geom: Geometry, id: Id, p: Vec3Like): void {
  const idx = indexCache.get(geom)
  if (!idx) return
  const k = cellKey(p)
  const list = idx.cells.get(k)
  if (list) {
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    if (list.length === 0) idx.cells.delete(k)
  }
  idx.count--
}

/* ------------------------------------------------------------------ */
/* Vertices                                                            */
/* ------------------------------------------------------------------ */

export function vertexPoint(geom: Geometry, id: Id): Vec3Like {
  const v = geom.vertices[id]
  return v ? v.p : { x: 0, y: 0, z: 0 }
}

/** Nearest existing vertex within `tol`, or null. */
export function findVertexAt(geom: Geometry, p: Vec3Like, tol = POINT_TOL): Id | null {
  const idx = getIndex(geom)
  const cx = Math.round(p.x / CELL)
  const cy = Math.round(p.y / CELL)
  const cz = Math.round(p.z / CELL)
  const reach = Math.max(1, Math.ceil(tol / CELL))
  let best: Id | null = null
  let bestDist = tol * tol
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const list = idx.cells.get(`${cx + dx},${cy + dy},${cz + dz}`)
        if (!list) continue
        for (const id of list) {
          const v = geom.vertices[id]
          if (!v) continue
          const d = V.distanceSq(v.p, p)
          if (d <= bestDist) {
            bestDist = d
            best = id
          }
        }
      }
    }
  }
  return best
}

export function createVertex(geom: Geometry, p: Vec3Like, acc?: ChangeAcc): Id {
  const id = newId('v')
  geom.vertices[id] = { id, p: { x: p.x, y: p.y, z: p.z }, edges: [] }
  indexInsert(geom, id, p)
  acc?.addedVertices.add(id)
  return id
}

/** Merging vertex creation: reuses an existing vertex within POINT_TOL. */
export function getOrCreateVertex(geom: Geometry, p: Vec3Like, acc?: ChangeAcc): Id {
  const found = findVertexAt(geom, p)
  if (found !== null) return found
  return createVertex(geom, p, acc)
}

export function setVertexPosition(geom: Geometry, id: Id, p: Vec3Like): void {
  const v = geom.vertices[id]
  if (!v) return
  indexRemove(geom, id, v.p)
  v.p = { x: p.x, y: p.y, z: p.z }
  indexInsert(geom, id, v.p)
}

/** Removes a vertex that no longer carries edges. */
export function removeVertex(geom: Geometry, id: Id, acc?: ChangeAcc): void {
  const v = geom.vertices[id]
  if (!v) return
  indexRemove(geom, id, v.p)
  delete geom.vertices[id]
  acc?.removedVertices.add(id)
}

function attachEdgeToVertex(geom: Geometry, vId: Id, eId: Id): void {
  const v = geom.vertices[vId]
  if (!v) return
  if (!v.edges.includes(eId)) v.edges.push(eId)
}

function detachEdgeFromVertex(geom: Geometry, vId: Id, eId: Id): void {
  const v = geom.vertices[vId]
  if (!v) return
  const i = v.edges.indexOf(eId)
  if (i >= 0) v.edges.splice(i, 1)
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

export interface EdgeProps {
  soft?: boolean
  smooth?: boolean
  hidden?: boolean
  guide?: boolean
  tagId?: Id | null
  materialId?: Id | null
}

export function findEdgeBetween(geom: Geometry, a: Id, b: Id): Id | null {
  const va = geom.vertices[a]
  if (!va) return null
  for (const eId of va.edges) {
    const e = geom.edges[eId]
    if (!e) continue
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return eId
  }
  return null
}

export function createEdge(geom: Geometry, a: Id, b: Id, props: EdgeProps, acc?: ChangeAcc): Id {
  const id = newId('e')
  const edge: Edge = {
    id,
    a,
    b,
    faces: [],
    soft: props.soft ?? false,
    smooth: props.smooth ?? false,
    hidden: props.hidden ?? false,
    tagId: props.tagId ?? null,
    materialId: props.materialId ?? null,
  }
  if (props.guide) edge.guide = true
  geom.edges[id] = edge
  attachEdgeToVertex(geom, a, id)
  attachEdgeToVertex(geom, b, id)
  acc?.addedEdges.add(id)
  return id
}

/** Reuses an existing edge between the two vertices instead of duplicating it. */
export function getOrCreateEdge(
  geom: Geometry,
  a: Id,
  b: Id,
  props: EdgeProps,
  acc?: ChangeAcc,
): { id: Id; created: boolean } {
  const existing = findEdgeBetween(geom, a, b)
  if (existing !== null) return { id: existing, created: false }
  return { id: createEdge(geom, a, b, props, acc), created: true }
}

export function edgeOther(edge: Edge, vId: Id): Id {
  return edge.a === vId ? edge.b : edge.a
}

export function edgeEndpoints(geom: Geometry, edgeId: Id): [Vec3Like, Vec3Like] {
  const e = geom.edges[edgeId]
  if (!e) return [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
  return [vertexPoint(geom, e.a), vertexPoint(geom, e.b)]
}

/** Removes an edge; every face using it is removed as well. */
export function removeEdge(geom: Geometry, id: Id, acc?: ChangeAcc, dropOrphans = true): void {
  const e = geom.edges[id]
  if (!e) return
  for (const fId of [...e.faces]) removeFace(geom, fId, acc)
  detachEdgeFromVertex(geom, e.a, id)
  detachEdgeFromVertex(geom, e.b, id)
  delete geom.edges[id]
  acc?.removedEdges.add(id)
  if (dropOrphans) {
    for (const vId of [e.a, e.b]) {
      const v = geom.vertices[vId]
      if (v && v.edges.length === 0) removeVertex(geom, vId, acc)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Loops and faces                                                     */
/* ------------------------------------------------------------------ */

export function faceLoops(face: Face): Loop[] {
  return [face.outer, ...face.inner]
}

export function loopPoints(geom: Geometry, loop: Loop): Vec3Like[] {
  return loop.vertices.map((v) => vertexPoint(geom, v))
}

export function cloneLoop(loop: Loop): Loop {
  return { edges: [...loop.edges], vertices: [...loop.vertices] }
}

/** Reverses the traversal direction of a loop. */
export function reverseLoop(loop: Loop): Loop {
  const vertices = loop.vertices.length > 0
    ? [loop.vertices[0], ...loop.vertices.slice(1).reverse()]
    : []
  return { edges: [...loop.edges].reverse(), vertices }
}

/** +1 when the loop traverses the edge from `edge.a` to `edge.b`, -1 otherwise, 0 if absent. */
export function loopEdgeDirection(loop: Loop, edgeId: Id, edge: Edge): 1 | -1 | 0 {
  const i = loop.edges.indexOf(edgeId)
  if (i < 0) return 0
  return loop.vertices[i] === edge.a ? 1 : -1
}

export interface FaceProps {
  frontMaterialId?: Id | null
  backMaterialId?: Id | null
  tagId?: Id | null
  hidden?: boolean
}

/**
 * Creates a face from ready made loops. `normal` fixes the front side; the
 * plane is fitted with Newell's method and aligned to that normal.
 */
export function createFace(
  geom: Geometry,
  outer: Loop,
  inner: Loop[],
  normal: Vec3Like,
  props: FaceProps,
  acc?: ChangeAcc,
): Id {
  const id = newId('f')
  const pts = loopPoints(geom, outer)
  let n = V.normalize(normal)
  if (V.lengthSq(n) < 0.5) {
    n = P.polygonNormal(pts) ?? { x: 0, y: 0, z: 1 }
  }
  const plane = P.fromNormalAndPoint(n, pts.length ? V.centroid(pts) : { x: 0, y: 0, z: 0 })
  const face: Face = {
    id,
    outer,
    inner,
    normal: n,
    plane,
    frontMaterialId: props.frontMaterialId ?? null,
    backMaterialId: props.backMaterialId ?? null,
    hidden: props.hidden ?? false,
    tagId: props.tagId ?? null,
  }
  geom.faces[id] = face
  for (const loop of faceLoops(face)) {
    for (const eId of loop.edges) {
      const e = geom.edges[eId]
      if (e && !e.faces.includes(id)) e.faces.push(id)
    }
  }
  acc?.addedFaces.add(id)
  return id
}

export function removeFace(geom: Geometry, id: Id, acc?: ChangeAcc): void {
  const f = geom.faces[id]
  if (!f) return
  for (const loop of faceLoops(f)) {
    for (const eId of loop.edges) {
      const e = geom.edges[eId]
      if (!e) continue
      const i = e.faces.indexOf(id)
      if (i >= 0) e.faces.splice(i, 1)
    }
  }
  delete geom.faces[id]
  acc?.removedFaces.add(id)
}

/** Recomputes normal and plane from the current vertex positions. */
export function refreshFacePlane(geom: Geometry, faceId: Id, keepOrientation = true): void {
  const f = geom.faces[faceId]
  if (!f) return
  const pts = loopPoints(geom, f.outer)
  const n = P.polygonNormal(pts)
  if (!n) return
  const aligned = keepOrientation && V.dot(n, f.normal) < 0 ? V.negate(n) : n
  f.normal = aligned
  f.plane = P.fromNormalAndPoint(aligned, V.centroid(pts))
}

export function flipFace(geom: Geometry, faceId: Id): void {
  const f = geom.faces[faceId]
  if (!f) return
  f.outer = reverseLoop(f.outer)
  f.inner = f.inner.map(reverseLoop)
  f.normal = V.negate(f.normal)
  f.plane = P.flip(f.plane)
  const front = f.frontMaterialId
  f.frontMaterialId = f.backMaterialId
  f.backMaterialId = front
}

/**
 * Splits `edgeId` at the existing vertex `vId` which must lie strictly between
 * its endpoints. The low half keeps the original id, the high half becomes a
 * new edge. All faces referencing the edge are patched.
 */
export function splitEdge(geom: Geometry, edgeId: Id, vId: Id, acc?: ChangeAcc): Id | null {
  const e = geom.edges[edgeId]
  if (!e) return null
  if (e.a === vId || e.b === vId) return null
  const oldA = e.a
  const oldB = e.b
  const newEdgeId = newId('e')
  const newEdge: Edge = {
    id: newEdgeId,
    a: vId,
    b: oldB,
    faces: [...e.faces],
    soft: e.soft,
    smooth: e.smooth,
    hidden: e.hidden,
    tagId: e.tagId,
    materialId: e.materialId,
  }
  if (e.guide) newEdge.guide = true
  geom.edges[newEdgeId] = newEdge
  acc?.addedEdges.add(newEdgeId)

  e.b = vId
  detachEdgeFromVertex(geom, oldB, edgeId)
  attachEdgeToVertex(geom, oldB, newEdgeId)
  attachEdgeToVertex(geom, vId, edgeId)
  attachEdgeToVertex(geom, vId, newEdgeId)
  acc?.modifiedEdges.add(edgeId)

  for (const fId of newEdge.faces) {
    const f = geom.faces[fId]
    if (!f) continue
    for (const loop of faceLoops(f)) {
      if (!loop.edges.includes(edgeId)) continue
      const edges: Id[] = []
      const vertices: Id[] = []
      for (let i = 0; i < loop.edges.length; i++) {
        const eid = loop.edges[i]
        const from = loop.vertices[i]
        vertices.push(from)
        if (eid !== edgeId) {
          edges.push(eid)
          continue
        }
        if (from === oldA) {
          edges.push(edgeId)
          vertices.push(vId)
          edges.push(newEdgeId)
        } else {
          edges.push(newEdgeId)
          vertices.push(vId)
          edges.push(edgeId)
        }
      }
      loop.edges = edges
      loop.vertices = vertices
    }
    acc?.modifiedFaces.add(fId)
  }
  return newEdgeId
}

/* ------------------------------------------------------------------ */
/* Plane helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Deterministic sign for a plane so that repeatedly derived planes end up with
 * the same normal direction (and therefore the same face orientation).
 */
export function canonicalPlane(plane: PlaneLike): PlaneLike {
  const n = plane.n
  const eps = 1e-9
  let flip: boolean
  if (Math.abs(n.z) > eps) flip = n.z < 0
  else if (Math.abs(n.y) > eps) flip = n.y < 0
  else flip = n.x < 0
  return flip ? P.flip(plane) : plane
}

export function planeKey(plane: PlaneLike): string {
  const c = canonicalPlane(plane)
  const q = 1e5
  return [
    Math.round(c.n.x * q),
    Math.round(c.n.y * q),
    Math.round(c.n.z * q),
    Math.round(c.d * q),
  ].join('/')
}

export function isDegenerateSegment(a: Vec3Like, b: Vec3Like): boolean {
  // NaN zuerst: jeder Vergleich mit NaN ist false, ein NaN-Segment gaelte sonst
  // als voellig in Ordnung und landete in der Geometrie.
  if (!isFinitePoint(a) || !isFinitePoint(b)) return true
  return V.distanceSq(a, b) < MIN_LENGTH * MIN_LENGTH
}
