/**
 * Automatic face finding - the heart of the SketchUp style modeller.
 *
 * Given a plane, every non guide edge lying in that plane is collected,
 * projected to 2d through `P.frame(plane)` and traversed like a half edge
 * structure: leaving a dart `u -> v` the next dart is the one at `v` that comes
 * directly clockwise after the reverse dart. That enumerates every facet of the
 * planar subdivision. Facets with a positive signed area are real faces, the
 * facet with the negative area is the outer boundary of its component and is
 * either discarded or - when it sits inside another facet - turned into a hole.
 */

import type { Face, Geometry, Id, Loop, PlaneLike, Vec2Like, Vec3Like } from '@/shared/types'
import { MIN_AREA, P, PLANAR_TOL, POINT_TOL, V, V2 } from '@/core/math'
import type { ChangeAcc } from './change'
import {
  createFace,
  faceLoops,
  loopEdgeDirection,
  loopPoints,
} from './mutate'

/* ------------------------------------------------------------------ */
/* 2d helpers                                                          */
/* ------------------------------------------------------------------ */

/** A point that lies strictly inside the (assumed simple) polygon. */
export function interiorPoint2D(poly: readonly Vec2Like[]): Vec2Like | null {
  const n = poly.length
  if (n < 3) return null
  const pts = V2.signedArea(poly) < 0 ? [...poly].reverse() : [...poly]
  const centre = V2.centroid(pts)
  if (V2.pointInPolygon(centre, pts)) return centre
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length]
    const b = pts[i]
    const c = pts[(i + 1) % pts.length]
    if (V2.cross(V2.sub(b, a), V2.sub(c, b)) <= 0) continue
    const cand = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
    if (V2.pointInPolygon(cand, pts)) return cand
  }
  return pts[0] ?? null
}

/** true when p is inside `outer` and outside every hole, with a safety margin */
export function pointInRegion2D(
  p: Vec2Like,
  outer: readonly Vec2Like[],
  holes: readonly (readonly Vec2Like[])[],
  margin = 0,
): boolean {
  if (!V2.pointInPolygon(p, outer)) return false
  if (margin > 0 && distanceToRing(p, outer) <= margin) return false
  for (const h of holes) {
    if (V2.pointInPolygon(p, h)) return false
    if (margin > 0 && distanceToRing(p, h) <= margin) return false
  }
  return true
}

export function distanceToRing(p: Vec2Like, ring: readonly Vec2Like[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = V2.distanceToSegment(p, ring[i], ring[(i + 1) % ring.length])
    if (d < best) best = d
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Planar subdivision                                                  */
/* ------------------------------------------------------------------ */

interface Dart {
  edge: Id
  from: Id
  to: Id
  angle: number
}

export interface PlanarCycle {
  loop: Loop
  points2d: Vec2Like[]
  area: number
  component: number
  edgeKey: string
  edgeSet: Set<Id>
}

export interface PlanarSubdivision {
  frame: ReturnType<typeof P.frame>
  cycles: PlanarCycle[]
  /** number of connected components */
  componentCount: number
}

function edgeSetKey(ids: readonly Id[]): string {
  return [...ids].sort().join('|')
}

/**
 * Collects every non guide edge lying in `plane` and enumerates all facets of
 * the resulting planar subdivision.
 */
export function subdividePlane(geom: Geometry, plane: PlaneLike, tol = PLANAR_TOL): PlanarSubdivision {
  const frame = P.frame(plane)
  const edgeIds: Id[] = []
  const vertexIds = new Set<Id>()
  for (const id in geom.edges) {
    const e = geom.edges[id]
    if (e.guide) continue
    const va = geom.vertices[e.a]
    const vb = geom.vertices[e.b]
    if (!va || !vb) continue
    if (Math.abs(P.signedDistance(plane, va.p)) > tol) continue
    if (Math.abs(P.signedDistance(plane, vb.p)) > tol) continue
    edgeIds.push(id)
    vertexIds.add(e.a)
    vertexIds.add(e.b)
  }

  const pos2d = new Map<Id, Vec2Like>()
  for (const v of vertexIds) pos2d.set(v, frame.to2d(geom.vertices[v].p))

  // union find over vertices -> connected components
  const parent = new Map<Id, Id>()
  const find = (x: Id): Id => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as Id
    let cur = x
    while (parent.get(cur) !== root) {
      const nxt = parent.get(cur) as Id
      parent.set(cur, root)
      cur = nxt
    }
    return root
  }
  for (const v of vertexIds) parent.set(v, v)
  for (const id of edgeIds) {
    const e = geom.edges[id]
    const ra = find(e.a)
    const rb = find(e.b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const componentIndex = new Map<Id, number>()
  let componentCount = 0
  for (const v of vertexIds) {
    const r = find(v)
    if (!componentIndex.has(r)) componentIndex.set(r, componentCount++)
  }

  // darts: 2*i = a->b, 2*i+1 = b->a  (reverse = index ^ 1)
  const darts: Dart[] = []
  const outgoing = new Map<Id, number[]>()
  for (const id of edgeIds) {
    const e = geom.edges[id]
    const pa = pos2d.get(e.a) as Vec2Like
    const pb = pos2d.get(e.b) as Vec2Like
    const d = V2.sub(pb, pa)
    if (V2.lengthSq(d) < 1e-24) continue
    const ang = Math.atan2(d.y, d.x)
    const i0 = darts.length
    darts.push({ edge: id, from: e.a, to: e.b, angle: ang })
    darts.push({ edge: id, from: e.b, to: e.a, angle: ang > 0 ? ang - Math.PI : ang + Math.PI })
    let la = outgoing.get(e.a)
    if (!la) outgoing.set(e.a, (la = []))
    la.push(i0)
    let lb = outgoing.get(e.b)
    if (!lb) outgoing.set(e.b, (lb = []))
    lb.push(i0 + 1)
  }
  for (const list of outgoing.values()) {
    list.sort((x, y) => darts[x].angle - darts[y].angle || x - y)
  }
  const slot = new Map<number, number>()
  for (const list of outgoing.values()) {
    for (let i = 0; i < list.length; i++) slot.set(list[i], i)
  }

  const nextDart = (d: number): number => {
    const rev = d ^ 1
    const at = darts[rev].from
    const list = outgoing.get(at)
    if (!list || list.length === 0) return rev
    const pos = slot.get(rev) ?? 0
    return list[(pos - 1 + list.length) % list.length]
  }

  const visited = new Array<boolean>(darts.length).fill(false)
  const cycles: PlanarCycle[] = []
  for (let start = 0; start < darts.length; start++) {
    if (visited[start]) continue
    const chain: number[] = []
    let cur = start
    let guard = 0
    while (!visited[cur] && guard++ < darts.length + 4) {
      visited[cur] = true
      chain.push(cur)
      cur = nextDart(cur)
    }
    if (chain.length === 0) continue
    const loop: Loop = {
      edges: chain.map((d) => darts[d].edge),
      vertices: chain.map((d) => darts[d].from),
    }
    const points2d = chain.map((d) => pos2d.get(darts[d].from) as Vec2Like)
    const area = V2.signedArea(points2d)
    const comp = componentIndex.get(find(darts[chain[0]].from)) ?? 0
    cycles.push({
      loop,
      points2d,
      area,
      component: comp,
      edgeKey: edgeSetKey(loop.edges),
      edgeSet: new Set(loop.edges),
    })
  }

  return { frame, cycles, componentCount }
}

/* ------------------------------------------------------------------ */
/* Face construction                                                   */
/* ------------------------------------------------------------------ */

/** Snapshot of a face that was destroyed and whose area should be re-facetted. */
export interface DeletedRegion {
  plane: PlaneLike
  outer: Vec3Like[]
  holes: Vec3Like[][]
  frontMaterialId: Id | null
  backMaterialId: Id | null
  tagId: Id | null
  hidden: boolean
}

export function captureRegion(geom: Geometry, face: Face): DeletedRegion {
  return {
    plane: face.plane,
    outer: loopPoints(geom, face.outer),
    holes: face.inner.map((l) => loopPoints(geom, l)),
    frontMaterialId: face.frontMaterialId,
    backMaterialId: face.backMaterialId,
    tagId: face.tagId,
    hidden: face.hidden,
  }
}

export interface BuildFacesOptions {
  /** edges created during the current operation - cycles touching them are new faces */
  newEdges: ReadonlySet<Id>
  /** areas of faces destroyed during the current operation */
  regions?: readonly DeletedRegion[]
  tagId?: Id | null
  materialId?: Id | null
}

/**
 * Rebuilds all faces of the planar subdivision defined by `plane` that either
 * contain one of the new edges or fill the area of a destroyed face.
 */
export function buildFacesInPlane(
  geom: Geometry,
  plane: PlaneLike,
  opts: BuildFacesOptions,
  acc: ChangeAcc,
): Id[] {
  const sub = subdividePlane(geom, plane)
  if (sub.cycles.length === 0) return []
  const frame = sub.frame

  const existingKeys = new Set<string>()
  for (const id in geom.faces) {
    existingKeys.add(edgeSetKey(geom.faces[id].outer.edges))
  }

  const regions = (opts.regions ?? []).filter((r) => P.isCoplanar(r.plane, plane, PLANAR_TOL * 8))
  const regions2d = regions.map((r) => ({
    src: r,
    outer: r.outer.map(frame.to2d),
    holes: r.holes.map((h) => h.map(frame.to2d)),
  }))

  const positives = sub.cycles.filter((c) => c.area > MIN_AREA)
  const negatives = sub.cycles.filter((c) => c.area < -MIN_AREA)

  interface Pending {
    cycle: PlanarCycle
    holes: PlanarCycle[]
    region: DeletedRegion | null
  }

  const pending: Pending[] = []
  for (const cycle of positives) {
    if (existingKeys.has(cycle.edgeKey)) continue
    let touchesNew = false
    for (const eId of cycle.edgeSet) {
      if (opts.newEdges.has(eId)) {
        touchesNew = true
        break
      }
    }
    const rep = interiorPoint2D(cycle.points2d)
    let region: DeletedRegion | null = null
    if (rep) {
      for (const r of regions2d) {
        if (pointInRegion2D(rep, r.outer, r.holes)) {
          region = r.src
          break
        }
      }
    }
    if (!touchesNew && !region) continue
    pending.push({ cycle, holes: [], region })
  }
  if (pending.length === 0) return []

  // hole assignment: a component whose outer boundary lies inside a new face
  // becomes a hole of the smallest such face
  const boundaryByComponent = new Map<number, PlanarCycle>()
  for (const c of negatives) {
    const cur = boundaryByComponent.get(c.component)
    if (!cur || c.area < cur.area) boundaryByComponent.set(c.component, c)
  }
  for (const [comp, boundary] of boundaryByComponent) {
    // a point ON the component boundary: components never share vertices, so a
    // boundary vertex is unambiguously inside or outside any other facet
    const rep = boundary.points2d[0]
    if (!rep) continue
    let best: Pending | null = null
    for (const cand of pending) {
      if (cand.cycle.component === comp) continue
      if (!V2.pointInPolygon(rep, cand.cycle.points2d)) continue
      if (!best || cand.cycle.area < best.cycle.area) best = cand
    }
    if (best) best.holes.push(boundary)
  }

  const created: Id[] = []
  for (const item of pending) {
    const props = item.region
      ? {
          frontMaterialId: item.region.frontMaterialId,
          backMaterialId: item.region.backMaterialId,
          tagId: item.region.tagId,
          hidden: item.region.hidden,
        }
      : {
          frontMaterialId: opts.materialId ?? null,
          backMaterialId: null,
          tagId: opts.tagId ?? null,
          hidden: false,
        }
    const faceId = createFace(
      geom,
      item.cycle.loop,
      item.holes.map((h) => h.loop),
      plane.n,
      props,
      acc,
    )
    if (item.region) {
      // a face that was destroyed and re-facetted keeps its original front
      // side - cutting a face must never turn it inside out
      if (V.dot(item.region.plane.n, plane.n) < 0) flipCreated(geom, faceId)
    } else {
      harmonizeOrientation(geom, faceId, acc)
    }
    created.push(faceId)
  }
  return created
}

/**
 * Flips a freshly created face when a pre-existing coplanar neighbour traverses
 * the shared edge in the same direction (which would mean both fronts point the
 * opposite way).
 */
function harmonizeOrientation(geom: Geometry, faceId: Id, acc: ChangeAcc): void {
  const face = geom.faces[faceId]
  if (!face) return
  for (const eId of face.outer.edges) {
    const edge = geom.edges[eId]
    if (!edge) continue
    for (const otherId of edge.faces) {
      if (otherId === faceId) continue
      if (acc.addedFaces.has(otherId)) continue
      const other = geom.faces[otherId]
      if (!other) continue
      if (Math.abs(V.dot(other.normal, face.normal)) < 0.999) continue
      const dirNew = loopEdgeDirection(face.outer, eId, edge)
      let dirOld: 1 | -1 | 0 = 0
      for (const loop of faceLoops(other)) {
        const d = loopEdgeDirection(loop, eId, edge)
        if (d !== 0) {
          dirOld = d
          break
        }
      }
      if (dirNew === 0 || dirOld === 0) continue
      const sameSide = V.dot(other.normal, face.normal) > 0
      if (sameSide && dirNew === dirOld) {
        flipCreated(geom, faceId)
        return
      }
      if (!sameSide && dirNew !== dirOld) {
        flipCreated(geom, faceId)
        return
      }
      return
    }
  }
}

function flipCreated(geom: Geometry, faceId: Id): void {
  const f = geom.faces[faceId]
  if (!f) return
  const reversed = (loop: Loop): Loop => ({
    edges: [...loop.edges].reverse(),
    vertices: loop.vertices.length ? [loop.vertices[0], ...loop.vertices.slice(1).reverse()] : [],
  })
  f.outer = reversed(f.outer)
  f.inner = f.inner.map(reversed)
  f.normal = V.negate(f.normal)
  f.plane = P.flip(f.plane)
}

/* ------------------------------------------------------------------ */
/* Face piercing                                                       */
/* ------------------------------------------------------------------ */

/**
 * true when the (already split) edge runs through the interior of the face and
 * therefore cuts it apart.
 */
export function edgePiercesFace(geom: Geometry, edgeId: Id, face: Face): boolean {
  const e = geom.edges[edgeId]
  if (!e) return false
  const va = geom.vertices[e.a]
  const vb = geom.vertices[e.b]
  if (!va || !vb) return false
  if (Math.abs(P.signedDistance(face.plane, va.p)) > PLANAR_TOL) return false
  if (Math.abs(P.signedDistance(face.plane, vb.p)) > PLANAR_TOL) return false
  if (face.outer.edges.includes(edgeId)) return false
  for (const l of face.inner) if (l.edges.includes(edgeId)) return false
  const frame = P.frame(face.plane)
  const outer = loopPoints(geom, face.outer).map(frame.to2d)
  const holes = face.inner.map((l) => loopPoints(geom, l).map(frame.to2d))
  const mid = frame.to2d(V.midpoint(va.p, vb.p))
  return pointInRegion2D(mid, outer, holes, POINT_TOL)
}
