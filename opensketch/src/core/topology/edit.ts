/**
 * Deleting, cleaning, transforming and merging geometry.
 */

import type { Face, Geometry, Id, Loop, Mat4Like, Vec3Like } from '@/shared/types'
import { newId } from '@/shared/ids'
import { ANGULAR_TOL, M, MIN_LENGTH, P, PLANAR_TOL, POINT_TOL, V } from '@/core/math'
import type { ChangeAcc } from './change'
import {
  createEdge,
  createFace,
  faceLoops,
  findEdgeBetween,
  flipFace,
  getOrCreateVertex,
  invalidateVertexIndex,
  isFinitePoint,
  loopEdgeDirection,
  loopPoints,
  refreshFacePlane,
  removeEdge,
  removeFace,
  removeVertex,
  setVertexPosition,
  vertexPoint,
} from './mutate'
import { buildFacesInPlane, captureRegion, type DeletedRegion } from './faceloops'
import { findCoplanarFaces } from './connect'

/**
 * Eine Matrix mit NaN verwandelt jeden transformierten Punkt in NaN - und ein
 * NaN-Vertex ist irreparabel (siehe `isFinitePoint` in `mutate.ts`). Eine zu
 * kurze Matrix liefert `undefined` in der Rechnung, also ebenfalls NaN.
 */
function isFiniteMatrix(m: Mat4Like | undefined): boolean {
  if (!m || m.length < 16) return false
  for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return false
  return true
}

/* ------------------------------------------------------------------ */
/* Deleting                                                            */
/* ------------------------------------------------------------------ */

export function deletePrimitivesMut(
  geom: Geometry,
  ids: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[] },
  acc: ChangeAcc,
): void {
  for (const fId of ids.faceIds ?? []) removeFace(geom, fId, acc)
  for (const eId of ids.edgeIds ?? []) removeEdge(geom, eId, acc)
  for (const vId of ids.vertexIds ?? []) {
    const v = geom.vertices[vId]
    if (!v) continue
    for (const eId of [...v.edges]) removeEdge(geom, eId, acc)
    removeVertex(geom, vId, acc)
  }
}

/* ------------------------------------------------------------------ */
/* Cleanup and validation repair                                       */
/* ------------------------------------------------------------------ */

function loopIsValid(geom: Geometry, loop: Loop): boolean {
  const n = loop.edges.length
  if (n < 3 || loop.vertices.length !== n) return false
  for (let i = 0; i < n; i++) {
    const e = geom.edges[loop.edges[i]]
    if (!e) return false
    const from = loop.vertices[i]
    const to = loop.vertices[(i + 1) % n]
    if (!((e.a === from && e.b === to) || (e.b === from && e.a === to))) return false
  }
  return true
}

export function cleanupMut(geom: Geometry, acc: ChangeAcc): void {
  // 1. faces with broken loops
  for (const fId of Object.keys(geom.faces)) {
    const f = geom.faces[fId]
    if (!f) continue
    if (!loopIsValid(geom, f.outer) || f.inner.some((l) => !loopIsValid(geom, l))) {
      removeFace(geom, fId, acc)
    }
  }
  // 2. edges with missing endpoints or zero length
  for (const eId of Object.keys(geom.edges)) {
    const e = geom.edges[eId]
    if (!e) continue
    const va = geom.vertices[e.a]
    const vb = geom.vertices[e.b]
    if (!va || !vb || e.a === e.b || V.distance(va.p, vb.p) < MIN_LENGTH) {
      removeEdge(geom, eId, acc, false)
    }
  }
  // 3. dangling face references on edges
  for (const eId in geom.edges) {
    const e = geom.edges[eId]
    e.faces = e.faces.filter((fId) => {
      const f = geom.faces[fId]
      if (!f) return false
      return faceLoops(f).some((l) => l.edges.includes(eId))
    })
  }
  // 4. vertex back references
  for (const vId in geom.vertices) {
    const v = geom.vertices[vId]
    v.edges = v.edges.filter((eId) => {
      const e = geom.edges[eId]
      return !!e && (e.a === vId || e.b === vId)
    })
  }
  for (const eId in geom.edges) {
    const e = geom.edges[eId]
    for (const vId of [e.a, e.b]) {
      const v = geom.vertices[vId]
      if (v && !v.edges.includes(eId)) v.edges.push(eId)
    }
  }
  // 5. orphan vertices
  for (const vId of Object.keys(geom.vertices)) {
    const v = geom.vertices[vId]
    if (v && v.edges.length === 0) removeVertex(geom, vId, acc)
  }
  // 6. face planes
  for (const fId in geom.faces) refreshFacePlane(geom, fId)
}

/* ------------------------------------------------------------------ */
/* Coplanar merging                                                    */
/* ------------------------------------------------------------------ */

export function mergeCoplanarFacesMut(geom: Geometry, faceIds: Id[] | undefined, acc: ChangeAcc): void {
  const seeds = faceIds ?? Object.keys(geom.faces)
  const done = new Set<Id>()
  for (const seed of seeds) {
    if (done.has(seed) || !geom.faces[seed]) continue
    const group = findCoplanarFaces(geom, seed)
    for (const id of group) done.add(id)
    if (group.length < 2) continue
    const inGroup = new Set(group)
    const plane = geom.faces[seed].plane

    const interior: Id[] = []
    const counts = new Map<Id, number>()
    for (const fId of group) {
      const f = geom.faces[fId]
      if (!f) continue
      for (const loop of faceLoops(f)) {
        for (const eId of loop.edges) counts.set(eId, (counts.get(eId) ?? 0) + 1)
      }
    }
    for (const [eId, count] of counts) {
      const e = geom.edges[eId]
      if (!e) continue
      if (count === 2 && e.faces.every((f) => inGroup.has(f)) && e.faces.length === 2) {
        interior.push(eId)
      }
    }
    if (interior.length === 0) continue

    const regions: DeletedRegion[] = []
    for (const fId of group) {
      const f = geom.faces[fId]
      if (!f) continue
      regions.push(captureRegion(geom, f))
      removeFace(geom, fId, acc)
    }
    for (const eId of interior) removeEdge(geom, eId, acc)
    buildFacesInPlane(geom, plane, { newEdges: new Set(), regions }, acc)
  }
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

function facesTouchingVertices(geom: Geometry, vertexIds: ReadonlySet<Id>): Set<Id> {
  const out = new Set<Id>()
  for (const vId of vertexIds) {
    const v = geom.vertices[vId]
    if (!v) continue
    for (const eId of v.edges) {
      const e = geom.edges[eId]
      if (!e) continue
      for (const fId of e.faces) out.add(fId)
    }
  }
  return out
}

export function moveVerticesMut(
  geom: Geometry,
  vertexIds: readonly Id[],
  delta: Vec3Like,
  acc: ChangeAcc,
): void {
  if (!isFinitePoint(delta)) return
  const set = new Set(vertexIds.filter((id) => !!geom.vertices[id]))
  if (set.size === 0) return
  for (const vId of set) setVertexPosition(geom, vId, V.add(vertexPoint(geom, vId), delta))
  for (const fId of facesTouchingVertices(geom, set)) {
    refreshFacePlane(geom, fId)
    acc.modifiedFaces.add(fId)
  }
  for (const vId of set) {
    const v = geom.vertices[vId]
    if (v) for (const eId of v.edges) acc.modifiedEdges.add(eId)
  }
}

/** Expands a mixed selection to the vertices it covers. */
export function expandToVertices(
  geom: Geometry,
  ids: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[] },
): Set<Id> {
  const out = new Set<Id>()
  for (const vId of ids.vertexIds ?? []) if (geom.vertices[vId]) out.add(vId)
  for (const eId of ids.edgeIds ?? []) {
    const e = geom.edges[eId]
    if (!e) continue
    out.add(e.a)
    out.add(e.b)
  }
  for (const fId of ids.faceIds ?? []) {
    const f = geom.faces[fId]
    if (!f) continue
    for (const loop of faceLoops(f)) for (const v of loop.vertices) out.add(v)
  }
  return out
}

export function transformPrimitivesMut(
  geom: Geometry,
  ids: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[] },
  matrix: Mat4Like,
  copy: boolean,
  acc: ChangeAcc,
): void {
  if (!isFiniteMatrix(matrix)) return
  const vertexSet = expandToVertices(geom, ids)
  if (vertexSet.size === 0) return

  if (!copy) {
    for (const vId of vertexSet) {
      setVertexPosition(geom, vId, M.transformPoint(matrix, vertexPoint(geom, vId)))
    }
    const mirrored = M.isMirrored(matrix)
    for (const fId of facesTouchingVertices(geom, vertexSet)) {
      const f = geom.faces[fId]
      if (!f) continue
      f.normal = V.normalize(M.transformNormal(matrix, f.normal))
      refreshFacePlane(geom, fId)
      if (mirrored) flipFace(geom, fId)
      acc.modifiedFaces.add(fId)
    }
    return
  }

  // duplicate the induced sub geometry
  const edgeSet = new Set<Id>()
  for (const eId of ids.edgeIds ?? []) if (geom.edges[eId]) edgeSet.add(eId)
  for (const fId of ids.faceIds ?? []) {
    const f = geom.faces[fId]
    if (!f) continue
    for (const loop of faceLoops(f)) for (const eId of loop.edges) edgeSet.add(eId)
  }
  if (edgeSet.size === 0) {
    for (const eId in geom.edges) {
      const e = geom.edges[eId]
      if (vertexSet.has(e.a) && vertexSet.has(e.b)) edgeSet.add(eId)
    }
  }

  const vMap = new Map<Id, Id>()
  for (const vId of vertexSet) {
    const p = M.transformPoint(matrix, vertexPoint(geom, vId))
    vMap.set(vId, getOrCreateVertex(geom, p, acc))
  }
  const eMap = new Map<Id, Id>()
  for (const eId of edgeSet) {
    const e = geom.edges[eId]
    const a = vMap.get(e.a)
    const b = vMap.get(e.b)
    if (a === undefined || b === undefined || a === b) continue
    const existing = findEdgeBetween(geom, a, b)
    eMap.set(
      eId,
      existing ??
        createEdge(
          geom,
          a,
          b,
          { soft: e.soft, smooth: e.smooth, hidden: e.hidden, guide: e.guide, tagId: e.tagId, materialId: e.materialId },
          acc,
        ),
    )
  }
  const mirrored = M.isMirrored(matrix)
  for (const fId of ids.faceIds ?? []) {
    const f = geom.faces[fId]
    if (!f) continue
    const mapLoop = (loop: Loop): Loop | null => {
      const edges: Id[] = []
      const vertices: Id[] = []
      for (let i = 0; i < loop.edges.length; i++) {
        const e = eMap.get(loop.edges[i])
        const v = vMap.get(loop.vertices[i])
        if (e === undefined || v === undefined) return null
        edges.push(e)
        vertices.push(v)
      }
      return { edges, vertices }
    }
    const outer = mapLoop(f.outer)
    if (!outer) continue
    const inner: Loop[] = []
    for (const l of f.inner) {
      const m = mapLoop(l)
      if (m) inner.push(m)
    }
    const normal = V.normalize(M.transformNormal(matrix, f.normal))
    const newId2 = createFace(geom, outer, inner, mirrored ? V.negate(normal) : normal, {
      frontMaterialId: f.frontMaterialId,
      backMaterialId: f.backMaterialId,
      tagId: f.tagId,
      hidden: f.hidden,
    }, acc)
    if (mirrored) flipFace(geom, newId2)
  }
}

export function cloneGeometryDeep(geom: Geometry): Geometry {
  const out: Geometry = { vertices: {}, edges: {}, faces: {} }
  for (const id in geom.vertices) {
    const v = geom.vertices[id]
    out.vertices[id] = { id: v.id, p: { x: v.p.x, y: v.p.y, z: v.p.z }, edges: [...v.edges] }
  }
  for (const id in geom.edges) {
    const e = geom.edges[id]
    const copy = { ...e, faces: [...e.faces] }
    out.edges[id] = copy
  }
  for (const id in geom.faces) {
    const f = geom.faces[id]
    out.faces[id] = {
      ...f,
      outer: { edges: [...f.outer.edges], vertices: [...f.outer.vertices] },
      inner: f.inner.map((l) => ({ edges: [...l.edges], vertices: [...l.vertices] })),
      normal: { ...f.normal },
      plane: { n: { ...f.plane.n }, d: f.plane.d },
    }
  }
  return out
}

export function transformGeometryCopy(geom: Geometry, matrix: Mat4Like): Geometry {
  const out = cloneGeometryDeep(geom)
  // eine unbrauchbare Matrix liefert die unveraenderte Kopie, keine NaN-Kopie
  if (!isFiniteMatrix(matrix)) return out
  for (const id in out.vertices) {
    out.vertices[id].p = M.transformPoint(matrix, out.vertices[id].p)
  }
  const mirrored = M.isMirrored(matrix)
  for (const id in out.faces) {
    const f = out.faces[id]
    f.normal = V.normalize(M.transformNormal(matrix, f.normal))
    refreshFacePlane(out, id)
    if (mirrored) flipFace(out, id)
  }
  invalidateVertexIndex(out)
  return out
}

/* ------------------------------------------------------------------ */
/* Merging a second geometry                                           */
/* ------------------------------------------------------------------ */

export function mergeGeometryMut(
  target: Geometry,
  source: Geometry,
  transform: Mat4Like | undefined,
  acc: ChangeAcc,
): void {
  if (transform && !isFiniteMatrix(transform)) return
  const mirrored = transform ? M.isMirrored(transform) : false
  const vMap = new Map<Id, Id>()
  for (const id in source.vertices) {
    const p = transform ? M.transformPoint(transform, source.vertices[id].p) : source.vertices[id].p
    // eine beschaedigte Quelle darf das Ziel nicht anstecken
    if (!isFinitePoint(p)) continue
    vMap.set(id, getOrCreateVertex(target, p, acc))
  }
  const eMap = new Map<Id, Id>()
  for (const id in source.edges) {
    const e = source.edges[id]
    const a = vMap.get(e.a)
    const b = vMap.get(e.b)
    if (a === undefined || b === undefined || a === b) continue
    const existing = findEdgeBetween(target, a, b)
    eMap.set(
      id,
      existing ??
        createEdge(
          target,
          a,
          b,
          { soft: e.soft, smooth: e.smooth, hidden: e.hidden, guide: e.guide, tagId: e.tagId, materialId: e.materialId },
          acc,
        ),
    )
  }
  for (const id in source.faces) {
    const f = source.faces[id]
    const mapLoop = (loop: Loop): Loop | null => {
      const edges: Id[] = []
      const vertices: Id[] = []
      for (let i = 0; i < loop.edges.length; i++) {
        const e = eMap.get(loop.edges[i])
        const v = vMap.get(loop.vertices[i])
        if (e === undefined || v === undefined) return null
        edges.push(e)
        vertices.push(v)
      }
      return { edges, vertices }
    }
    const outer = mapLoop(f.outer)
    if (!outer) continue
    const inner: Loop[] = []
    for (const l of f.inner) {
      const m = mapLoop(l)
      if (m) inner.push(m)
    }
    let normal = transform ? V.normalize(M.transformNormal(transform, f.normal)) : f.normal
    if (mirrored) normal = V.negate(normal)
    const created = createFace(target, outer, inner, normal, {
      frontMaterialId: f.frontMaterialId,
      backMaterialId: f.backMaterialId,
      tagId: f.tagId,
      hidden: f.hidden,
    }, acc)
    if (mirrored) flipFace(target, created)
  }
}

/* ------------------------------------------------------------------ */
/* Orientation and softening                                           */
/* ------------------------------------------------------------------ */

export function reverseFacesMut(geom: Geometry, faceIds: readonly Id[]): void {
  for (const id of faceIds) flipFace(geom, id)
}

export function orientFacesConsistentlyMut(geom: Geometry, seedFaceId: Id): void {
  if (!geom.faces[seedFaceId]) return
  const visited = new Set<Id>([seedFaceId])
  const stack: Id[] = [seedFaceId]
  while (stack.length > 0) {
    const curId = stack.pop() as Id
    const cur = geom.faces[curId]
    if (!cur) continue
    for (const loop of faceLoops(cur)) {
      for (const eId of loop.edges) {
        const e = geom.edges[eId]
        if (!e) continue
        const dirCur = loopEdgeDirection(loop, eId, e)
        if (dirCur === 0) continue
        for (const otherId of e.faces) {
          if (otherId === curId || visited.has(otherId)) continue
          const other = geom.faces[otherId]
          if (!other) continue
          let dirOther: 1 | -1 | 0 = 0
          for (const ol of faceLoops(other)) {
            const d = loopEdgeDirection(ol, eId, e)
            if (d !== 0) {
              dirOther = d
              break
            }
          }
          if (dirOther === 0) continue
          if (dirOther === dirCur) flipFace(geom, otherId)
          visited.add(otherId)
          stack.push(otherId)
        }
      }
    }
  }
}

export function softenEdgesMut(
  geom: Geometry,
  edgeIds: readonly Id[],
  angleRad: number,
  opts?: { softenCoplanar?: boolean; soften?: boolean; smooth?: boolean },
): void {
  const soften = opts?.soften ?? true
  const smooth = opts?.smooth ?? true
  const softenCoplanar = opts?.softenCoplanar ?? true
  for (const id of edgeIds) {
    const e = geom.edges[id]
    if (!e) continue
    if (e.faces.length !== 2) continue
    const f0 = geom.faces[e.faces[0]]
    const f1 = geom.faces[e.faces[1]]
    if (!f0 || !f1) continue
    const angle = V.angleBetween(f0.normal, f1.normal)
    const coplanar = angle <= ANGULAR_TOL
    if (coplanar && !softenCoplanar) continue
    const on = angle <= angleRad
    if (soften) e.soft = on
    if (smooth) e.smooth = on
  }
}
