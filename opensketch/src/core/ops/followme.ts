/**
 * Follow-me and revolve: sweeping a profile face along a path.
 *
 * The profile is transported from node to node. At every interior node of the
 * path the section plane is the angle bisector of the incoming and the outgoing
 * segment, and the previous section is projected onto it along the incoming
 * direction - that is the classic miter join and it keeps the wall thickness
 * constant around corners.
 *
 * Closed paths wrap around and produce a closed body without caps; open paths
 * get a cap at both ends.
 */

import type { Geometry, Id, Loop, Vec3Like } from '@/shared/types'
import { MIN_LENGTH, P, POINT_TOL, V } from '@/core/math'
import {
  createFace,
  faceLoops,
  getOrCreateEdge,
  getOrCreateVertex,
  loopPoints,
  orderEdgePath,
  pathVertices,
  removeFace,
  vertexPoint,
  type ChangeAcc,
} from '@/core/topology'
import { orientComponentOutward } from './orient'

interface SweepProps {
  tagId: Id | null
  frontMaterialId: Id | null
  backMaterialId: Id | null
}

/** Builds a face from a closed ring of vertices, reusing existing edges. */
function ringFace(
  geom: Geometry,
  vertexIds: readonly Id[],
  holes: readonly (readonly Id[])[],
  props: SweepProps,
  acc: ChangeAcc,
): Id | null {
  const build = (ids: readonly Id[]): Loop | null => {
    const clean: Id[] = []
    for (const id of ids) {
      if (clean.length === 0 || clean[clean.length - 1] !== id) clean.push(id)
    }
    while (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop()
    if (clean.length < 3) return null
    const edges: Id[] = []
    for (let i = 0; i < clean.length; i++) {
      const res = getOrCreateEdge(geom, clean[i], clean[(i + 1) % clean.length], { tagId: props.tagId }, acc)
      edges.push(res.id)
    }
    return { edges, vertices: clean }
  }

  const outer = build(vertexIds)
  if (!outer) return null
  const pts = outer.vertices.map((v) => vertexPoint(geom, v))
  const normal = P.polygonNormal(pts)
  if (!normal) return null

  const inner: Loop[] = []
  for (const h of holes) {
    const loop = build(h)
    if (!loop) continue
    const hp = loop.vertices.map((v) => vertexPoint(geom, v))
    const hn = P.polygonNormal(hp)
    if (hn && V.dot(hn, normal) > 0) {
      loop.edges.reverse()
      loop.vertices = [loop.vertices[0], ...loop.vertices.slice(1).reverse()]
    }
    inner.push(loop)
  }

  return createFace(geom, outer, inner, normal, {
    frontMaterialId: props.frontMaterialId,
    backMaterialId: props.backMaterialId,
    tagId: props.tagId,
  }, acc)
}

/** Connects two rings of equal length with quads (triangles where a side collapses). */
function stitchRings(
  geom: Geometry,
  a: readonly Id[],
  b: readonly Id[],
  props: SweepProps,
  acc: ChangeAcc,
): Id[] {
  const out: Id[] = []
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const id = ringFace(geom, [a[i], a[j], b[j], b[i]], [], props, acc)
    if (id !== null) out.push(id)
  }
  return out
}

/** Projects `points` along `dir` onto the plane through `origin` with normal `n`. */
function projectSection(
  points: readonly Vec3Like[],
  dir: Vec3Like,
  origin: Vec3Like,
  n: Vec3Like,
): Vec3Like[] {
  const plane = P.fromNormalAndPoint(n, origin)
  return points.map((q) => {
    const hit = P.intersectRayPoint(plane, q, dir)
    return hit ?? P.projectPoint(plane, q)
  })
}

/**
 * The miter sections of a profile transported along `nodes`.
 * `nodes` must not contain the repeated closing point of a closed path.
 */
export function sweepSections(
  profile: readonly Vec3Like[],
  nodes: readonly Vec3Like[],
  closed: boolean,
): Vec3Like[][] {
  const count = nodes.length
  if (count < 2) return []
  const segCount = closed ? count : count - 1
  const dirs: Vec3Like[] = []
  for (let i = 0; i < segCount; i++) {
    const d = V.sub(nodes[(i + 1) % count], nodes[i])
    if (V.length(d) < MIN_LENGTH) return []
    dirs.push(V.normalize(d))
  }

  const bisector = (incoming: Vec3Like, outgoing: Vec3Like): Vec3Like => {
    const sum = V.add(incoming, outgoing)
    // a 180 degree reversal has no usable bisector - keep the incoming plane
    return V.length(sum) < 1e-6 ? incoming : V.normalize(sum)
  }

  const sections: Vec3Like[][] = []
  if (closed) {
    // the first section already has to be mitered against the closing segment
    sections.push(
      projectSection(profile, dirs[0], nodes[0], bisector(dirs[segCount - 1], dirs[0])),
    )
    for (let j = 1; j < count; j++) {
      sections.push(
        projectSection(sections[j - 1], dirs[j - 1], nodes[j], bisector(dirs[j - 1], dirs[j])),
      )
    }
  } else {
    sections.push(profile.map((q) => ({ ...q })))
    for (let j = 1; j < count; j++) {
      const incoming = dirs[j - 1]
      const outgoing = j < segCount ? dirs[j] : incoming
      sections.push(projectSection(sections[j - 1], incoming, nodes[j], bisector(incoming, outgoing)))
    }
  }
  return sections
}

/** Drops consecutive sections that ended up on top of each other. */
function dedupeSections(sections: Vec3Like[][]): Vec3Like[][] {
  const out: Vec3Like[][] = []
  for (const sec of sections) {
    const last = out[out.length - 1]
    if (last && last.every((q, i) => V.distance(q, sec[i]) <= POINT_TOL)) continue
    out.push(sec)
  }
  return out
}

function profileRing(geom: Geometry, faceId: Id): Vec3Like[] | null {
  const face = geom.faces[faceId]
  if (!face) return null
  const pts = loopPoints(geom, face.outer)
  return pts.length >= 3 ? pts : null
}

/**
 * Sweeps the outer loop of `profileFaceId` along the path. Inner loops of the
 * profile are not swept; a profile with holes keeps only its outer boundary.
 */
export function followMeMut(
  geom: Geometry,
  profileFaceId: Id,
  pathEdgeIds: readonly Id[],
  acc: ChangeAcc,
): void {
  const profileFace = geom.faces[profileFaceId]
  if (!profileFace) return
  const profile = profileRing(geom, profileFaceId)
  if (!profile) return

  const path = orderEdgePath(geom, pathEdgeIds)
  if (!path || path.length === 0) return
  const chain = pathVertices(geom, path)
  if (chain.length < 2) return
  const closed = chain.length > 2 && chain[0] === chain[chain.length - 1]
  const nodeIds = closed ? chain.slice(0, -1) : chain
  const nodes = nodeIds.map((id) => vertexPoint(geom, id))
  if (nodes.length < 2) return

  const sections = dedupeSections(sweepSections(profile, nodes, closed))
  if (sections.length < 2) return

  const props: SweepProps = {
    tagId: profileFace.tagId,
    frontMaterialId: profileFace.frontMaterialId,
    backMaterialId: profileFace.backMaterialId,
  }

  // the profile face itself is consumed by the sweep
  removeFace(geom, profileFaceId, acc)

  const rings = sections.map((sec) => sec.map((q) => getOrCreateVertex(geom, q, acc)))
  const created: Id[] = []
  const steps = closed ? rings.length : rings.length - 1
  for (let j = 0; j < steps; j++) {
    created.push(...stitchRings(geom, rings[j], rings[(j + 1) % rings.length], props, acc))
  }
  if (!closed) {
    const start = ringFace(geom, rings[0], [], props, acc)
    if (start !== null) created.push(start)
    const end = ringFace(geom, rings[rings.length - 1], [], props, acc)
    if (end !== null) created.push(end)
  }
  if (created.length > 0) orientComponentOutward(geom, created[0])
}

/**
 * Revolve: the profile is rotated around the axis in `segments` steps. A full
 * turn closes the body, a partial turn gets a cap at both ends.
 */
export function revolveMut(
  geom: Geometry,
  profileFaceId: Id,
  axisOrigin: Vec3Like,
  axisDirection: Vec3Like,
  angle: number,
  segments: number,
  acc: ChangeAcc,
): void {
  const profileFace = geom.faces[profileFaceId]
  if (!profileFace) return
  const profile = profileRing(geom, profileFaceId)
  if (!profile) return
  const axis = V.normalize(axisDirection)
  if (V.lengthSq(axis) < 0.5) return
  const steps = Math.max(3, Math.floor(segments))
  if (Math.abs(angle) < 1e-9) return

  const full = Math.abs(Math.abs(angle) - Math.PI * 2) < 1e-6
  const ringCount = full ? steps : steps + 1
  const sections: Vec3Like[][] = []
  for (let i = 0; i < ringCount; i++) {
    const a = (angle * i) / steps
    sections.push(profile.map((q) => V.rotateAboutLine(q, axisOrigin, axis, a)))
  }

  const props: SweepProps = {
    tagId: profileFace.tagId,
    frontMaterialId: profileFace.frontMaterialId,
    backMaterialId: profileFace.backMaterialId,
  }
  removeFace(geom, profileFaceId, acc)

  const rings = sections.map((sec) => sec.map((q) => getOrCreateVertex(geom, q, acc)))
  const created: Id[] = []
  const stitches = full ? rings.length : rings.length - 1
  for (let j = 0; j < stitches; j++) {
    created.push(...stitchRings(geom, rings[j], rings[(j + 1) % rings.length], props, acc))
  }
  if (!full) {
    const start = ringFace(geom, rings[0], [], props, acc)
    if (start !== null) created.push(start)
    const end = ringFace(geom, rings[rings.length - 1], [], props, acc)
    if (end !== null) created.push(end)
  }
  if (created.length > 0) orientComponentOutward(geom, created[0])
}

/** Boundary loops of a face as point rings - used by the offset operations. */
export function faceRings(geom: Geometry, faceId: Id): Vec3Like[][] {
  const f = geom.faces[faceId]
  if (!f) return []
  return faceLoops(f).map((l) => loopPoints(geom, l))
}
