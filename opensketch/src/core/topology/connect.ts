/**
 * Pure graph queries on a geometry context: connectivity, coplanar groups,
 * boundary extraction and path ordering.
 */

import type { Geometry, Id } from '@/shared/types'
import { P, PLANAR_TOL, V } from '@/core/math'
import { faceLoops } from './mutate'

/** Everything reachable from the seed through shared vertices. */
export function findConnected(
  geom: Geometry,
  seed: { edgeIds?: Id[]; faceIds?: Id[]; vertexIds?: Id[] },
): { edgeIds: Id[]; faceIds: Id[]; vertexIds: Id[] } {
  const vertexQueue: Id[] = []
  const vertices = new Set<Id>()
  const edges = new Set<Id>()
  const faces = new Set<Id>()

  const pushVertex = (id: Id): void => {
    if (!geom.vertices[id] || vertices.has(id)) return
    vertices.add(id)
    vertexQueue.push(id)
  }

  for (const id of seed.vertexIds ?? []) pushVertex(id)
  for (const id of seed.edgeIds ?? []) {
    const e = geom.edges[id]
    if (!e) continue
    pushVertex(e.a)
    pushVertex(e.b)
  }
  for (const id of seed.faceIds ?? []) {
    const f = geom.faces[id]
    if (!f) continue
    for (const loop of faceLoops(f)) for (const v of loop.vertices) pushVertex(v)
  }

  while (vertexQueue.length > 0) {
    const vId = vertexQueue.pop() as Id
    const v = geom.vertices[vId]
    if (!v) continue
    for (const eId of v.edges) {
      const e = geom.edges[eId]
      if (!e) continue
      edges.add(eId)
      pushVertex(e.a)
      pushVertex(e.b)
      for (const fId of e.faces) if (geom.faces[fId]) faces.add(fId)
    }
  }
  return { edgeIds: [...edges], faceIds: [...faces], vertexIds: [...vertices] }
}

/** All coplanar faces reachable from `faceId` across shared edges. */
export function findCoplanarFaces(geom: Geometry, faceId: Id, tol = PLANAR_TOL): Id[] {
  const start = geom.faces[faceId]
  if (!start) return []
  const out = new Set<Id>([faceId])
  const stack: Id[] = [faceId]
  while (stack.length > 0) {
    const cur = geom.faces[stack.pop() as Id]
    if (!cur) continue
    for (const loop of faceLoops(cur)) {
      for (const eId of loop.edges) {
        const e = geom.edges[eId]
        if (!e) continue
        for (const otherId of e.faces) {
          if (out.has(otherId)) continue
          const other = geom.faces[otherId]
          if (!other) continue
          if (!P.isCoplanar(start.plane, other.plane, tol)) continue
          out.add(otherId)
          stack.push(otherId)
        }
      }
    }
  }
  return [...out]
}

/** Edges of a face set that are not shared by two faces of the same set. */
export function boundingEdges(geom: Geometry, faceIds: readonly Id[]): Id[] {
  const inSet = new Set(faceIds)
  const counts = new Map<Id, number>()
  for (const fId of faceIds) {
    const f = geom.faces[fId]
    if (!f) continue
    for (const loop of faceLoops(f)) {
      for (const eId of loop.edges) counts.set(eId, (counts.get(eId) ?? 0) + 1)
    }
  }
  const out: Id[] = []
  for (const [eId, count] of counts) {
    const e = geom.edges[eId]
    if (!e) continue
    const outside = e.faces.some((f) => !inSet.has(f))
    if (count < 2 || outside) out.push(eId)
  }
  return out
}

/**
 * Orders loose edges into one continuous path. Returns null when the edges do
 * not form a simple open or closed chain.
 */
export function orderEdgePath(geom: Geometry, edgeIds: readonly Id[]): Id[] | null {
  const ids = edgeIds.filter((id) => !!geom.edges[id])
  if (ids.length === 0) return null
  if (ids.length === 1) return [ids[0]]
  const set = new Set(ids)
  const degree = new Map<Id, Id[]>()
  for (const id of ids) {
    const e = geom.edges[id]
    for (const v of [e.a, e.b]) {
      let list = degree.get(v)
      if (!list) degree.set(v, (list = []))
      list.push(id)
    }
  }
  for (const list of degree.values()) if (list.length > 2) return null

  const ends: Id[] = []
  for (const [v, list] of degree) if (list.length === 1) ends.push(v)
  if (ends.length !== 0 && ends.length !== 2) return null

  const startVertex = ends.length === 2 ? ends[0] : (geom.edges[ids[0]].a as Id)
  const path: Id[] = []
  const used = new Set<Id>()
  let current = startVertex
  while (path.length < ids.length) {
    const candidates = (degree.get(current) ?? []).filter((id) => !used.has(id) && set.has(id))
    if (candidates.length === 0) break
    const next = candidates[0]
    used.add(next)
    path.push(next)
    const e = geom.edges[next]
    current = e.a === current ? e.b : e.a
  }
  if (path.length !== ids.length) return null
  return path
}

/** Vertex sequence of an ordered edge path. */
export function pathVertices(geom: Geometry, path: readonly Id[]): Id[] {
  if (path.length === 0) return []
  const first = geom.edges[path[0]]
  if (!first) return []
  let start = first.a
  if (path.length > 1) {
    const second = geom.edges[path[1]]
    if (second && (second.a === first.a || second.b === first.a)) start = first.b
  }
  const out: Id[] = [start]
  let current = start
  for (const eId of path) {
    const e = geom.edges[eId]
    if (!e) break
    current = e.a === current ? e.b : e.a
    out.push(current)
  }
  return out
}

/** Signed angle helper used by softening and consistency checks. */
export function dihedralAngle(geom: Geometry, edgeId: Id): number | null {
  const e = geom.edges[edgeId]
  if (!e || e.faces.length !== 2) return null
  const f0 = geom.faces[e.faces[0]]
  const f1 = geom.faces[e.faces[1]]
  if (!f0 || !f1) return null
  return V.angleBetween(f0.normal, f1.normal)
}
