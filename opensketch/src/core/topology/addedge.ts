/**
 * Edge insertion with automatic merging, splitting and face finding.
 *
 * `addEdgeMut` is the single entry point every drawing operation funnels
 * through. It performs, in this order:
 *   1. vertex merging of both endpoints (POINT_TOL)
 *   2. intersection detection against every existing edge, including collinear
 *      overlaps, and splitting of both sides
 *   3. creation of the sub edges along the segment (existing edges are reused,
 *      so drawing the same line twice is idempotent)
 *   4. destruction of every face the new edges cut through
 *   5. planar face finding in all candidate planes
 */

import type { Geometry, Id, PlaneLike, Vec3Like } from '@/shared/types'
import { MIN_LENGTH, P, PLANAR_TOL, POINT_TOL, R, V } from '@/core/math'
import type { ChangeAcc } from './change'
import {
  canonicalPlane,
  createEdge,
  createFace,
  edgeEndpoints,
  findEdgeBetween,
  findVertexAt,
  getOrCreateEdge,
  getOrCreateVertex,
  isFinitePoint,
  planeKey,
  removeFace,
  splitEdge,
  vertexPoint,
} from './mutate'
import {
  buildFacesInPlane,
  captureRegion,
  edgePiercesFace,
  type DeletedRegion,
} from './faceloops'

export interface AddOptions {
  /** Konstruktionskante - erzeugt niemals Flaechen */
  guide?: boolean
  /** Tag der neuen Primitive */
  tagId?: Id | null
  /** Material der neuen Primitive */
  materialId?: Id | null
  /** false = kein automatisches Flaechenfinden (schnelles Bulk-Laden) */
  autoFace?: boolean
  /** false = keine Kantenschnitte suchen (schnelles Bulk-Laden) */
  splitIntersections?: boolean
  /** weiche/geglaettete Kante */
  soft?: boolean
  smooth?: boolean
}

function edgeProps(opts: AddOptions) {
  return {
    soft: opts.soft,
    smooth: opts.smooth,
    guide: opts.guide,
    tagId: opts.tagId ?? null,
    materialId: opts.materialId ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Splitting                                                           */
/* ------------------------------------------------------------------ */

function segmentBoundsOverlap(a0: Vec3Like, a1: Vec3Like, b0: Vec3Like, b1: Vec3Like, tol: number): boolean {
  return (
    Math.min(a0.x, a1.x) - tol <= Math.max(b0.x, b1.x) &&
    Math.max(a0.x, a1.x) + tol >= Math.min(b0.x, b1.x) &&
    Math.min(a0.y, a1.y) - tol <= Math.max(b0.y, b1.y) &&
    Math.max(a0.y, a1.y) + tol >= Math.min(b0.y, b1.y) &&
    Math.min(a0.z, a1.z) - tol <= Math.max(b0.z, b1.z) &&
    Math.max(a0.z, a1.z) + tol >= Math.min(b0.z, b1.z)
  )
}

/**
 * Splits every existing edge crossed by the segment A-B at the crossing points.
 * Returns nothing - the created vertices are picked up by the chain scan.
 */
function splitCrossedEdges(
  geom: Geometry,
  A: Vec3Like,
  B: Vec3Like,
  acc: ChangeAcc,
  newEdges: Set<Id>,
): void {
  const d = V.sub(B, A)
  const lenSq = V.lengthSq(d)
  if (lenSq < MIN_LENGTH * MIN_LENGTH) return
  const splits = new Map<Id, number[]>()
  const record = (id: Id, s: number): void => {
    let list = splits.get(id)
    if (!list) splits.set(id, (list = []))
    list.push(s)
  }

  for (const id in geom.edges) {
    const e = geom.edges[id]
    const va = geom.vertices[e.a]
    const vb = geom.vertices[e.b]
    if (!va || !vb) continue
    const P0 = va.p
    const P1 = vb.p
    if (!segmentBoundsOverlap(A, B, P0, P1, POINT_TOL)) continue

    const distA = R.closestPointOnLine(A, B, P0)
    const distB = R.closestPointOnLine(A, B, P1)
    const collinear =
      V.distance(distA.point, P0) <= POINT_TOL && V.distance(distB.point, P1) <= POINT_TOL
    if (collinear) {
      const eDir = V.sub(P1, P0)
      const eLenSq = V.lengthSq(eDir)
      if (eLenSq < MIN_LENGTH * MIN_LENGTH) continue
      const lo = Math.max(0, Math.min(distA.t, distB.t))
      const hi = Math.min(1, Math.max(distA.t, distB.t))
      const overlap = (hi - lo) * Math.sqrt(lenSq)
      if (overlap <= POINT_TOL) continue
      // where A and B fall on the existing edge
      record(id, V.dot(V.sub(A, P0), eDir) / eLenSq)
      record(id, V.dot(V.sub(B, P0), eDir) / eLenSq)
      continue
    }

    const hit = R.intersectSegments(A, B, P0, P1, POINT_TOL)
    if (hit) record(id, hit.tb)
  }

  for (const [id, params] of splits) {
    const [P0, P1] = edgeEndpoints(geom, id)
    const edgeLen = V.distance(P0, P1)
    if (edgeLen < MIN_LENGTH) continue
    const usable = params
      .filter((s) => s * edgeLen > POINT_TOL && (1 - s) * edgeLen > POINT_TOL)
      .sort((x, y) => y - x)
    let last = Infinity
    for (const s of usable) {
      if ((last - s) * edgeLen <= POINT_TOL) continue
      last = s
      const point = V.lerpV(P0, P1, s)
      const vId = getOrCreateVertex(geom, point, acc)
      const half = splitEdge(geom, id, vId, acc)
      if (half !== null && newEdges.has(id)) newEdges.add(half)
    }
  }
}

/** All vertices lying on the segment, ordered from A to B. */
function chainVertices(geom: Geometry, A: Vec3Like, B: Vec3Like): Id[] {
  const d = V.sub(B, A)
  const lenSq = V.lengthSq(d)
  if (lenSq < MIN_LENGTH * MIN_LENGTH) return []
  const found: { t: number; id: Id }[] = []
  const minX = Math.min(A.x, B.x) - POINT_TOL
  const maxX = Math.max(A.x, B.x) + POINT_TOL
  const minY = Math.min(A.y, B.y) - POINT_TOL
  const maxY = Math.max(A.y, B.y) + POINT_TOL
  const minZ = Math.min(A.z, B.z) - POINT_TOL
  const maxZ = Math.max(A.z, B.z) + POINT_TOL
  for (const id in geom.vertices) {
    const p = geom.vertices[id].p
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY || p.z < minZ || p.z > maxZ) continue
    const near = R.closestPointOnSegment(A, B, p)
    if (V.distance(near.point, p) > POINT_TOL) continue
    found.push({ t: near.t, id })
  }
  found.sort((x, y) => x.t - y.t)
  const out: Id[] = []
  const len = Math.sqrt(lenSq)
  let lastT = -Infinity
  for (const f of found) {
    if (out.length > 0 && (f.t - lastT) * len <= POINT_TOL) continue
    out.push(f.id)
    lastT = f.t
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Face finding driver                                                 */
/* ------------------------------------------------------------------ */

/** Every plane that could carry a new face through one of the new edges. */
export function candidatePlanes(geom: Geometry, newEdges: ReadonlySet<Id>): PlaneLike[] {
  const seen = new Set<string>()
  const out: PlaneLike[] = []
  for (const eId of newEdges) {
    const e = geom.edges[eId]
    if (!e) continue
    const A = vertexPoint(geom, e.a)
    const B = vertexPoint(geom, e.b)
    for (const vId of [e.a, e.b]) {
      const v = geom.vertices[vId]
      if (!v) continue
      for (const otherId of v.edges) {
        if (otherId === eId) continue
        const other = geom.edges[otherId]
        if (!other || other.guide) continue
        const C = vertexPoint(geom, other.a === vId ? other.b : other.a)
        const plane = P.fromPoints(A, B, C)
        if (!plane) continue
        const canon = canonicalPlane(plane)
        const key = planeKey(canon)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(canon)
      }
    }
  }
  return out
}

/**
 * Destroys every face the new edges cut through and rebuilds the affected
 * planar subdivisions.
 */
export function runFaceFinding(
  geom: Geometry,
  newEdges: Set<Id>,
  opts: AddOptions,
  acc: ChangeAcc,
): void {
  if (newEdges.size === 0) return
  const regions: DeletedRegion[] = []
  for (const fId of Object.keys(geom.faces)) {
    const face = geom.faces[fId]
    if (!face) continue
    let pierced = false
    for (const eId of newEdges) {
      if (edgePiercesFace(geom, eId, face)) {
        pierced = true
        break
      }
    }
    if (!pierced) continue
    regions.push(captureRegion(geom, face))
    removeFace(geom, fId, acc)
  }

  const planes = candidatePlanes(geom, newEdges)
  const seen = new Set(planes.map(planeKey))
  for (const r of regions) {
    const canon = canonicalPlane(r.plane)
    const key = planeKey(canon)
    if (seen.has(key)) continue
    seen.add(key)
    planes.push(canon)
  }
  for (const plane of planes) {
    buildFacesInPlane(
      geom,
      plane,
      { newEdges, regions, tagId: opts.tagId ?? null, materialId: opts.materialId ?? null },
      acc,
    )
  }
}

/* ------------------------------------------------------------------ */
/* Public mutators                                                     */
/* ------------------------------------------------------------------ */

/**
 * Adds one edge. When `collect` is given the face finding phase is skipped and
 * the caller runs it once for a whole batch.
 */
export function addEdgeMut(
  geom: Geometry,
  a: Vec3Like,
  b: Vec3Like,
  opts: AddOptions,
  acc: ChangeAcc,
  collect?: Set<Id>,
): Id[] {
  // NaN/Infinity abweisen, BEVOR ein Vertex entsteht - siehe isFinitePoint
  if (!isFinitePoint(a) || !isFinitePoint(b)) return []
  if (V.distance(a, b) <= POINT_TOL) return []
  const vaId = getOrCreateVertex(geom, a, acc)
  const vbId = getOrCreateVertex(geom, b, acc)
  if (vaId === vbId) return []
  const A = vertexPoint(geom, vaId)
  const B = vertexPoint(geom, vbId)

  const newEdges = collect ?? new Set<Id>()
  const created: Id[] = []

  if (opts.splitIntersections === false) {
    const res = getOrCreateEdge(geom, vaId, vbId, edgeProps(opts), acc)
    if (res.created) {
      created.push(res.id)
      newEdges.add(res.id)
    }
  } else {
    splitCrossedEdges(geom, A, B, acc, newEdges)
    const chain = chainVertices(geom, A, B)
    if (chain.length < 2) {
      const res = getOrCreateEdge(geom, vaId, vbId, edgeProps(opts), acc)
      if (res.created) {
        created.push(res.id)
        newEdges.add(res.id)
      }
    } else {
      for (let i = 0; i + 1 < chain.length; i++) {
        const res = getOrCreateEdge(geom, chain[i], chain[i + 1], edgeProps(opts), acc)
        if (res.created) {
          created.push(res.id)
          newEdges.add(res.id)
        }
      }
    }
  }

  if (!collect && !opts.guide && opts.autoFace !== false) {
    runFaceFinding(geom, newEdges, opts, acc)
  }
  return created
}

export function addPolylineMut(
  geom: Geometry,
  points: readonly Vec3Like[],
  closed: boolean,
  opts: AddOptions,
  acc: ChangeAcc,
): Id[] {
  if (points.length < 2) return []
  const collect = new Set<Id>()
  const created: Id[] = []
  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    created.push(...addEdgeMut(geom, a, b, opts, acc, collect))
  }
  if (!opts.guide && opts.autoFace !== false) {
    runFaceFinding(geom, collect, opts, acc)
  }
  return created
}

/**
 * Creates a face straight from a point loop. Used for bulk loading and for
 * generated geometry where the topology is already known.
 */
export function addFacePolygonMut(
  geom: Geometry,
  outer: readonly Vec3Like[],
  holes: readonly (readonly Vec3Like[])[] | undefined,
  opts: AddOptions,
  acc: ChangeAcc,
): Id | null {
  /**
   * Kollabiert die Punktfolge genau so, wie es `buildLoop` gleich tut - aber
   * OHNE etwas anzulegen. Ohne diesen Trockenlauf legt eine Schleife aus zwei
   * Punkten erst zwei Vertices an und wird dann verworfen; zurueck bleiben
   * verwaiste Vertices in einem Modell, in dem der Nutzer nichts gezeichnet
   * hat. Ein Schluessel ist die Id eines vorhandenen Vertex oder `n<i>` fuer
   * einen, der neu entstehen wuerde.
   */
  const wouldYieldLoop = (pts: readonly Vec3Like[]): boolean => {
    const keys: string[] = []
    const fresh: Vec3Like[] = []
    for (const p of pts) {
      if (!isFinitePoint(p)) return false
      const existing = findVertexAt(geom, p)
      let key: string
      if (existing !== null) {
        key = existing
      } else {
        let at = fresh.findIndex((q) => V.distance(q, p) <= POINT_TOL)
        if (at < 0) {
          at = fresh.length
          fresh.push(p)
        }
        key = `n${at}`
      }
      if (keys.length === 0 || keys[keys.length - 1] !== key) keys.push(key)
    }
    while (keys.length > 1 && keys[0] === keys[keys.length - 1]) keys.pop()
    return keys.length >= 3
  }

  const buildLoop = (pts: readonly Vec3Like[]): { edges: Id[]; vertices: Id[] } | null => {
    if (!wouldYieldLoop(pts)) return null
    const ids: Id[] = []
    for (const p of pts) {
      const id = getOrCreateVertex(geom, p, acc)
      if (ids.length === 0 || ids[ids.length - 1] !== id) ids.push(id)
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop()
    if (ids.length < 3) return null
    const edges: Id[] = []
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]
      const b = ids[(i + 1) % ids.length]
      const existing = findEdgeBetween(geom, a, b)
      edges.push(existing ?? createEdge(geom, a, b, edgeProps(opts), acc))
    }
    return { edges, vertices: ids }
  }

  const outerLoop = buildLoop(outer)
  if (!outerLoop) return null
  const outerPts = outerLoop.vertices.map((v) => vertexPoint(geom, v))
  const normal = P.polygonNormal(outerPts)
  if (!normal) return null

  const innerLoops: { edges: Id[]; vertices: Id[] }[] = []
  for (const h of holes ?? []) {
    const loop = buildLoop(h)
    if (!loop) continue
    const pts = loop.vertices.map((v) => vertexPoint(geom, v))
    const hn = P.polygonNormal(pts)
    // holes wind clockwise as seen from the front
    if (hn && V.dot(hn, normal) > 0) {
      loop.edges.reverse()
      loop.vertices = [loop.vertices[0], ...loop.vertices.slice(1).reverse()]
    }
    innerLoops.push(loop)
  }

  return createFace(
    geom,
    outerLoop,
    innerLoops,
    normal,
    {
      frontMaterialId: opts.materialId ?? null,
      backMaterialId: null,
      tagId: opts.tagId ?? null,
      hidden: false,
    },
    acc,
  )
}

/** Distance from a plane, used by callers that need a quick coplanarity test. */
export function isOnPlane(plane: PlaneLike, p: Vec3Like, tol = PLANAR_TOL): boolean {
  return Math.abs(P.signedDistance(plane, p)) <= tol
}
