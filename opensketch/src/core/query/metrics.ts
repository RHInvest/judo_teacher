/**
 * Measurements on a geometry context: areas, lengths, bounds, volume.
 */

import type { BBox3Like, Geometry, Id, PlaneLike, Vec3Like } from '@/shared/types'
import { B, P, V } from '@/core/math'
import { faceTriangles } from './triangulate'

export function faceVertices(geom: Geometry, faceId: Id): Vec3Like[] {
  const f = geom.faces[faceId]
  if (!f) return []
  return f.outer.vertices.map((v) => {
    const vert = geom.vertices[v]
    return vert ? { ...vert.p } : { x: 0, y: 0, z: 0 }
  })
}

export function faceHoleVertices(geom: Geometry, faceId: Id, holeIndex: number): Vec3Like[] {
  const f = geom.faces[faceId]
  if (!f) return []
  const loop = f.inner[holeIndex]
  if (!loop) return []
  return loop.vertices.map((v) => {
    const vert = geom.vertices[v]
    return vert ? { ...vert.p } : { x: 0, y: 0, z: 0 }
  })
}

/** Outer area minus the area of every hole. */
export function faceArea(geom: Geometry, faceId: Id): number {
  const f = geom.faces[faceId]
  if (!f) return 0
  let area = P.polygonArea(faceVertices(geom, faceId))
  for (let i = 0; i < f.inner.length; i++) {
    area -= P.polygonArea(faceHoleVertices(geom, faceId, i))
  }
  return Math.max(0, area)
}

export function facePlane(geom: Geometry, faceId: Id): PlaneLike {
  const f = geom.faces[faceId]
  if (!f) return { n: { x: 0, y: 0, z: 1 }, d: 0 }
  return { n: { ...f.plane.n }, d: f.plane.d }
}

export function edgeLength(geom: Geometry, edgeId: Id): number {
  const e = geom.edges[edgeId]
  if (!e) return 0
  const a = geom.vertices[e.a]
  const b = geom.vertices[e.b]
  if (!a || !b) return 0
  return V.distance(a.p, b.p)
}

export function edgePoints(geom: Geometry, edgeId: Id): [Vec3Like, Vec3Like] {
  const e = geom.edges[edgeId]
  const zero = { x: 0, y: 0, z: 0 }
  if (!e) return [zero, { ...zero }]
  const a = geom.vertices[e.a]
  const b = geom.vertices[e.b]
  return [a ? { ...a.p } : { ...zero }, b ? { ...b.p } : { ...zero }]
}

export function geometryBounds(geom: Geometry): BBox3Like {
  const box = B.empty()
  for (const id in geom.vertices) B.expandByPointMut(box, geom.vertices[id].p)
  return box
}

export function totalArea(geom: Geometry, faceIds?: readonly Id[]): number {
  const ids = faceIds ?? Object.keys(geom.faces)
  let sum = 0
  for (const id of ids) sum += faceArea(geom, id)
  return sum
}

/** true when every edge borders exactly two faces and at least one face exists. */
export function isSolid(geom: Geometry): boolean {
  let edgeCount = 0
  for (const id in geom.edges) {
    const e = geom.edges[id]
    if (e.guide) continue
    edgeCount++
    if (e.faces.length !== 2) return false
  }
  if (edgeCount === 0) return false
  let faceCount = 0
  for (const _id in geom.faces) faceCount++
  return faceCount > 0
}

/** Divergence theorem over the triangulation; 0 for open shells. */
export function solidVolume(geom: Geometry): number {
  if (!isSolid(geom)) return 0
  let sum = 0
  for (const id in geom.faces) {
    for (const [a, b, c] of faceTriangles(geom, id)) {
      sum += V.dot(a, V.cross(b, c))
    }
  }
  return Math.abs(sum) / 6
}

/** Surface area of every face, ignoring orientation. */
export function surfaceArea(geom: Geometry): number {
  return totalArea(geom)
}
