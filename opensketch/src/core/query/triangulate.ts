/**
 * Polygon triangulation (ear clipping with hole bridging) plus the cached face
 * tessellation used by the renderer.
 */

import type { Geometry, Id, Vec2Like, Vec3Like } from '@/shared/types'
import { P, V, V2 } from '@/core/math'

/* ------------------------------------------------------------------ */
/* 2d ear clipping                                                     */
/* ------------------------------------------------------------------ */

const AREA_EPS = 1e-14

function triArea(a: Vec2Like, b: Vec2Like, c: Vec2Like): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function pointInTriangle(p: Vec2Like, a: Vec2Like, b: Vec2Like, c: Vec2Like): boolean {
  const d1 = triArea(a, b, p)
  const d2 = triArea(b, c, p)
  const d3 = triArea(c, a, p)
  return d1 >= 0 && d2 >= 0 && d3 >= 0
}

/** true when the two segments cross somewhere that is not one of the given ends */
function crossesRing(
  pts: readonly Vec2Like[],
  ring: readonly number[],
  o: number,
  h: number,
): boolean {
  const A = pts[o]
  const B = pts[h]
  for (let i = 0; i < ring.length; i++) {
    const ia = ring[i]
    const ib = ring[(i + 1) % ring.length]
    if (ia === o || ib === o || ia === h || ib === h) continue
    const hit = V2.intersectSegments(A, B, pts[ia], pts[ib], 1e-14)
    if (hit) return true
  }
  return false
}

/**
 * Cuts every hole into the outer ring with a bridge. Robust brute force: the
 * shortest bridge that neither crosses a ring nor leaves the polygon wins.
 */
function eliminateHoles(pts: Vec2Like[], outer: number[], holes: number[][]): number[] {
  let ring = [...outer]
  const remaining = holes.map((h) => [...h])
  // process holes left to right, that keeps the bridges short
  remaining.sort((a, b) => {
    const ax = Math.min(...a.map((i) => pts[i].x))
    const bx = Math.min(...b.map((i) => pts[i].x))
    return ax - bx
  })

  for (let hi = 0; hi < remaining.length; hi++) {
    const hole = remaining[hi]
    if (hole.length < 3) continue
    const others = remaining.slice(hi + 1)
    const candidates: { o: number; h: number; d: number }[] = []
    for (let i = 0; i < ring.length; i++) {
      for (let j = 0; j < hole.length; j++) {
        candidates.push({ o: i, h: j, d: V2.distance(pts[ring[i]], pts[hole[j]]) })
      }
    }
    candidates.sort((a, b) => a.d - b.d)
    let chosen: { o: number; h: number } | null = null
    for (const cand of candidates) {
      const oIdx = ring[cand.o]
      const hIdx = hole[cand.h]
      if (crossesRing(pts, ring, oIdx, hIdx)) continue
      let blocked = false
      for (const other of [hole, ...others]) {
        if (crossesRing(pts, other, oIdx, hIdx)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      const mid = V2.lerp(pts[oIdx], pts[hIdx], 0.5)
      if (!V2.pointInPolygon(mid, ring.map((i) => pts[i]))) continue
      let insideHole = false
      for (const other of [hole, ...others]) {
        if (V2.pointInPolygon(mid, other.map((i) => pts[i]))) {
          insideHole = true
          break
        }
      }
      if (insideHole) continue
      chosen = { o: cand.o, h: cand.h }
      break
    }
    if (!chosen) continue
    const rotated: number[] = []
    for (let k = 0; k < hole.length; k++) rotated.push(hole[(chosen.h + k) % hole.length])
    rotated.push(hole[chosen.h])
    const merged = [
      ...ring.slice(0, chosen.o + 1),
      ...rotated,
      ring[chosen.o],
      ...ring.slice(chosen.o + 1),
    ]
    ring = merged
  }
  return ring
}

function earClip(pts: readonly Vec2Like[], input: readonly number[]): number[] {
  const out: number[] = []
  const idx = [...input]
  let guard = idx.length * idx.length + 64
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const ai = idx[(i - 1 + idx.length) % idx.length]
      const bi = idx[i]
      const ci = idx[(i + 1) % idx.length]
      const a = pts[ai]
      const b = pts[bi]
      const c = pts[ci]
      if (triArea(a, b, c) <= AREA_EPS) continue
      let blocked = false
      for (const j of idx) {
        if (j === ai || j === bi || j === ci) continue
        if (pointInTriangle(pts[j], a, b, c)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      out.push(ai, bi, ci)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (clipped) continue
    // no ear: drop a degenerate corner so that the loop terminates
    let removed = false
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i - 1 + idx.length) % idx.length]]
      const b = pts[idx[i]]
      const c = pts[idx[(i + 1) % idx.length]]
      if (Math.abs(triArea(a, b, c)) <= AREA_EPS || V2.distance(a, c) <= 1e-12) {
        idx.splice(i, 1)
        removed = true
        break
      }
    }
    if (removed) continue
    // last resort: clip the most convex corner even if it is not a proper ear
    let bestI = -1
    let bestArea = -Infinity
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i - 1 + idx.length) % idx.length]]
      const b = pts[idx[i]]
      const c = pts[idx[(i + 1) % idx.length]]
      const area = triArea(a, b, c)
      if (area > bestArea) {
        bestArea = area
        bestI = i
      }
    }
    if (bestI < 0) break
    out.push(
      idx[(bestI - 1 + idx.length) % idx.length],
      idx[bestI],
      idx[(bestI + 1) % idx.length],
    )
    idx.splice(bestI, 1)
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2])
  return out
}

/**
 * Trianguliert ein 2D-Polygon mit Loechern. Indizes beziehen sich auf
 * `outer.concat(...holes)`. Die Dreiecke haben denselben Umlaufsinn wie
 * `outer`.
 */
export function triangulatePolygon2D(
  outer: readonly { x: number; y: number }[],
  holes?: readonly (readonly { x: number; y: number }[])[],
): number[] {
  if (outer.length < 3) return []
  const pts: Vec2Like[] = outer.map((p) => ({ x: p.x, y: p.y }))
  let outerRing: number[] = outer.map((_, i) => i)
  const holeRings: number[][] = []
  let offset = outer.length
  for (const h of holes ?? []) {
    const ring: number[] = []
    for (const p of h) {
      pts.push({ x: p.x, y: p.y })
      ring.push(offset++)
    }
    if (ring.length >= 3) holeRings.push(ring)
  }

  const outerCcw = V2.signedArea(outerRing.map((i) => pts[i])) > 0
  if (!outerCcw) outerRing = [...outerRing].reverse()
  for (let i = 0; i < holeRings.length; i++) {
    const ccw = V2.signedArea(holeRings[i].map((j) => pts[j])) > 0
    // holes must run opposite to the outer ring
    if (ccw) holeRings[i] = [...holeRings[i]].reverse()
  }

  const ring = holeRings.length > 0 ? eliminateHoles(pts, outerRing, holeRings) : outerRing
  const tris = earClip(pts, ring)
  if (!outerCcw) {
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const t = tris[i]
      tris[i] = tris[i + 2]
      tris[i + 2] = t
    }
  }
  return tris
}

/* ------------------------------------------------------------------ */
/* Cached face tessellation                                            */
/* ------------------------------------------------------------------ */

export interface FaceMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

interface CacheEntry {
  sig: string
  mesh: FaceMesh
  /**
   * Vertex-Ids parallel zu den Punkten in `mesh.positions`. Damit kann
   * `faceTriangles` die exakten float64-Positionen aus der Geometrie holen,
   * statt die auf float32 gerundeten Werte des Render-Mesh zu benutzen.
   */
  vertexIds: (Id | null)[]
}

const faceCache = new Map<Id, CacheEntry>()

/** Drops one or all cached face tessellations. */
export function invalidateFaceCache(faceId?: Id): void {
  if (faceId === undefined) faceCache.clear()
  else faceCache.delete(faceId)
}

function faceSignature(geom: Geometry, faceId: Id): string {
  const f = geom.faces[faceId]
  if (!f) return 'x'
  let sum = 0
  const parts: string[] = []
  for (const loop of [f.outer, ...f.inner]) {
    parts.push(loop.edges.join(','))
    for (const vId of loop.vertices) {
      const v = geom.vertices[vId]
      if (!v) continue
      sum += v.p.x * 3.7 + v.p.y * 11.3 + v.p.z * 29.1
    }
  }
  return `${parts.join(';')}#${f.normal.x.toFixed(6)},${f.normal.y.toFixed(6)},${f.normal.z.toFixed(6)}#${sum.toFixed(9)}`
}

const EMPTY_MESH: FaceMesh = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
}

function emptyEntry(): CacheEntry {
  return { sig: 'x', mesh: EMPTY_MESH, vertexIds: [] }
}

/**
 * Cache-Eintrag einer Flaeche: Render-Mesh plus die Vertex-Id zu jedem
 * Mesh-Punkt.
 *
 * CACHE-SIGNATUR - POSITIONSABHAENGIG. `faceSignature` enthaelt neben den
 * Kanten-Ids der Schleifen auch eine gewichtete Summe der Vertexpositionen und
 * die Flaechennormale. Der Flaechen-Cache faellt deshalb von selbst um, sobald
 * eine Flaeche verschoben, gedreht oder umgedreht wird; ein vergessenes
 * `invalidateFaceCache` faellt hier nicht auf. Der raeumliche Index in
 * `spatial.ts` ist NICHT positionsabhaengig signiert - siehe die Notiz dort.
 */
function faceMeshEntry(geom: Geometry, faceId: Id): CacheEntry {
  const face = geom.faces[faceId]
  if (!face) return emptyEntry()
  const sig = faceSignature(geom, faceId)
  const cached = faceCache.get(faceId)
  if (cached && cached.sig === sig) return cached

  const entry = buildFaceMesh(geom, faceId)
  entry.sig = sig
  faceCache.set(faceId, entry)
  return entry
}

/** Positions in context space, normals pointing to the front side. */
export function triangulateFace(geom: Geometry, faceId: Id): FaceMesh {
  return faceMeshEntry(geom, faceId).mesh
}

function buildFaceMesh(geom: Geometry, faceId: Id): CacheEntry {
  const face = geom.faces[faceId]
  if (!face) return emptyEntry()
  const frame = P.frame(face.plane)
  const points3d: Vec3Like[] = []
  const vertexIds: (Id | null)[] = []
  const outer2d: Vec2Like[] = []
  for (const vId of face.outer.vertices) {
    const v = geom.vertices[vId]
    if (!v) continue
    points3d.push(v.p)
    vertexIds.push(vId)
    outer2d.push(frame.to2d(v.p))
  }
  if (outer2d.length < 3) return emptyEntry()
  const holes2d: Vec2Like[][] = []
  for (const loop of face.inner) {
    const ring: Vec2Like[] = []
    for (const vId of loop.vertices) {
      const v = geom.vertices[vId]
      if (!v) continue
      points3d.push(v.p)
      vertexIds.push(vId)
      ring.push(frame.to2d(v.p))
    }
    if (ring.length >= 3) holes2d.push(ring)
  }

  // triangulatePolygon2D keeps the winding of the outer ring, and the outer
  // loop is CCW around the face normal by definition - nothing to correct
  const tris = triangulatePolygon2D(outer2d, holes2d)

  const positions = new Float32Array(points3d.length * 3)
  const normals = new Float32Array(points3d.length * 3)
  for (let i = 0; i < points3d.length; i++) {
    positions[i * 3] = points3d[i].x
    positions[i * 3 + 1] = points3d[i].y
    positions[i * 3 + 2] = points3d[i].z
    normals[i * 3] = face.normal.x
    normals[i * 3 + 1] = face.normal.y
    normals[i * 3 + 2] = face.normal.z
  }
  const indices = new Uint32Array(tris.length)
  for (let i = 0; i < tris.length; i++) indices[i] = tris[i]
  return { sig: 'x', mesh: { positions, normals, indices }, vertexIds }
}

/**
 * Dreiecke einer Flaeche als 3D-Punkttripel - fuer Strahltest, Volumen und CSG.
 *
 * Die Punkte kommen aus den VERTEXPOSITIONEN der Geometrie (float64), nicht aus
 * `mesh.positions` (float32). Das ist kein Detail: bei einem Modell mit
 * x = 1234.5678 endet das float32-Mesh bei 1234.56774902, also 0.05 mm neben
 * der echten Kante - das Fuenffache von POINT_TOL. Wer auf dem gerundeten Mesh
 * pickt, schneidet oder Volumen rechnet, rechnet gegen eine verschobene
 * Flaeche. Das float32-Mesh bleibt dem Renderer vorbehalten, der es ohnehin so
 * an die GPU gibt.
 */
export function faceTriangles(geom: Geometry, faceId: Id): [Vec3Like, Vec3Like, Vec3Like][] {
  const entry = faceMeshEntry(geom, faceId)
  const { mesh, vertexIds } = entry
  const out: [Vec3Like, Vec3Like, Vec3Like][] = []
  const at = (i: number): Vec3Like => {
    const vId = vertexIds[i]
    const v = vId === null || vId === undefined ? undefined : geom.vertices[vId]
    if (v) return { x: v.p.x, y: v.p.y, z: v.p.z }
    return {
      x: mesh.positions[i * 3],
      y: mesh.positions[i * 3 + 1],
      z: mesh.positions[i * 3 + 2],
    }
  }
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    out.push([at(mesh.indices[i]), at(mesh.indices[i + 1]), at(mesh.indices[i + 2])])
  }
  return out
}
