/**
 * Ray picking against a geometry context.
 *
 * Vertices win over edges, edges win over faces whenever the hits are within
 * `tolerance` of each other. Faces use Moeller-Trumbore over the cached
 * triangulation, edges a capsule test, vertices a sphere test.
 */

import type { Geometry, Id, Vec3Like } from '@/shared/types'
import { POINT_TOL, R, V, type Ray } from '@/core/math'
import { faceTriangles } from './triangulate'
import { queryRay, spatialIndex } from './spatial'

export interface RaycastHit {
  kind: 'face' | 'edge' | 'vertex'
  id: Id
  point: Vec3Like
  distance: number
  normal: Vec3Like | null
}

export interface RaycastOptions {
  tolerance?: number
  kinds?: ('face' | 'edge' | 'vertex')[]
  ignore?: Id[]
  backfaces?: boolean
}

const RANK: Record<RaycastHit['kind'], number> = { vertex: 0, edge: 1, face: 2 }

export function raycast(geom: Geometry, ray: Ray, opts?: RaycastOptions): RaycastHit[] {
  const tolerance = opts?.tolerance ?? 0
  const kinds = new Set(opts?.kinds ?? ['face', 'edge', 'vertex'])
  const ignore = new Set(opts?.ignore ?? [])
  const backfaces = opts?.backfaces ?? true
  const hits: RaycastHit[] = []
  const index = spatialIndex(geom)

  if (kinds.has('edge') || kinds.has('vertex')) {
    const pad = Math.max(tolerance, POINT_TOL)
    const candidates = queryRay(index.edges, ray, pad)
    const seenVertex = new Set<Id>()
    for (const eId of candidates) {
      const e = geom.edges[eId]
      if (!e) continue
      const a = geom.vertices[e.a]
      const b = geom.vertices[e.b]
      if (!a || !b) continue
      if (kinds.has('vertex')) {
        for (const v of [a, b]) {
          if (seenVertex.has(v.id) || ignore.has(v.id)) continue
          seenVertex.add(v.id)
          const along = V.dot(V.sub(v.p, ray.origin), ray.dir)
          if (along < 0) continue
          const closest = V.addScaled(ray.origin, ray.dir, along)
          if (V.distance(closest, v.p) > pad) continue
          hits.push({ kind: 'vertex', id: v.id, point: { ...v.p }, distance: along, normal: null })
        }
      }
      if (!kinds.has('edge') || ignore.has(eId)) continue
      const seg = R.rayToSegment(ray, a.p, b.p)
      if (seg.distance > pad) continue
      if (seg.rayT < 0) continue
      hits.push({
        kind: 'edge',
        id: eId,
        point: seg.pointOnSegment,
        distance: seg.rayT,
        normal: null,
      })
    }
  }

  if (kinds.has('face')) {
    for (const fId of queryRay(index.faces, ray)) {
      if (ignore.has(fId)) continue
      const face = geom.faces[fId]
      if (!face) continue
      if (!backfaces && V.dot(face.normal, ray.dir) > 0) continue
      let best: { t: number; point: Vec3Like } | null = null
      for (const [a, b, c] of faceTriangles(geom, fId)) {
        const hit = R.intersectTriangle(ray, a, b, c, false)
        if (!hit) continue
        if (!best || hit.t < best.t) best = { t: hit.t, point: hit.point }
      }
      if (!best) continue
      hits.push({
        kind: 'face',
        id: fId,
        point: best.point,
        distance: best.t,
        normal: { ...face.normal },
      })
    }
  }

  const tie = Math.max(tolerance, POINT_TOL)
  hits.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) <= tie) return RANK[a.kind] - RANK[b.kind]
    return a.distance - b.distance
  })
  return hits
}
