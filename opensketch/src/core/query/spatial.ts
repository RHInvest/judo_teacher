/**
 * Lazy spatial acceleration for picking.
 *
 * A flat median split BVH over the face bounding boxes plus one over the edge
 * bounding boxes. The structures are cached per `Geometry` object and rebuilt
 * whenever the primitive counts change or `invalidateSpatialIndex` is called.
 */

import type { BBox3Like, Geometry, Id } from '@/shared/types'
import { B, R, type Ray } from '@/core/math'

interface BvhNode {
  box: BBox3Like
  left: number
  right: number
  start: number
  count: number
}

export interface Bvh {
  nodes: BvhNode[]
  items: Id[]
  boxes: BBox3Like[]
}

interface SpatialCache {
  signature: string
  faces: Bvh
  edges: Bvh
}

const cache = new WeakMap<Geometry, SpatialCache>()

export function invalidateSpatialIndex(geom?: Geometry): void {
  if (geom) cache.delete(geom)
}

/**
 * CACHE-SIGNATUR - NICHT POSITIONSABHAENGIG. Hier stehen nur die ANZAHLEN von
 * Vertices, Kanten und Flaechen. Wer Vertices verschiebt, ohne die Anzahl zu
 * aendern (`moveVertices`, `transformPrimitives` ohne `copy`, `pushPull` in
 * einer bestehenden Topologie), bekommt sonst veraltete Huellboxen und damit
 * Treffer an der alten Stelle.
 *
 * Das ist Absicht, keine Nachlaessigkeit: die Positionen bei jeder Abfrage zu
 * hashen wuerde den Zweck des Index aufheben. Stattdessen ruft `core/index.ts`
 * nach JEDER Operation `commit()` auf, und das verwirft den Index ueber
 * `invalidateSpatialIndex(geom)`. Wer die Geometrie an der Fassade vorbei
 * mutiert, muss `core.invalidateCaches(geom)` selbst aufrufen.
 *
 * Unterschied zum Flaechen-Cache in `triangulate.ts`: der ist ueber die
 * Vertexpositionen signiert und faellt von selbst um.
 */
function signatureOf(geom: Geometry): string {
  return `${Object.keys(geom.vertices).length}/${Object.keys(geom.edges).length}/${Object.keys(geom.faces).length}`
}

const LEAF_SIZE = 6

function buildBvh(items: Id[], boxes: BBox3Like[]): Bvh {
  const order = items.map((_, i) => i)
  const nodes: BvhNode[] = []

  const boxOf = (from: number, to: number): BBox3Like => {
    let box = B.empty()
    for (let i = from; i < to; i++) box = B.union(box, boxes[order[i]])
    return box
  }

  const build = (from: number, to: number): number => {
    const box = boxOf(from, to)
    const index = nodes.length
    nodes.push({ box, left: -1, right: -1, start: from, count: to - from })
    if (to - from <= LEAF_SIZE) return index
    const size = B.size(box)
    const axis: 'x' | 'y' | 'z' = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z'
    const slice = order.slice(from, to)
    slice.sort((a, b) => {
      const ca = (boxes[a].min[axis] + boxes[a].max[axis]) * 0.5
      const cb = (boxes[b].min[axis] + boxes[b].max[axis]) * 0.5
      return ca - cb
    })
    for (let i = 0; i < slice.length; i++) order[from + i] = slice[i]
    const mid = (from + to) >> 1
    if (mid === from || mid === to) return index
    const node = nodes[index]
    node.count = 0
    node.left = build(from, mid)
    node.right = build(mid, to)
    return index
  }

  if (items.length > 0) build(0, items.length)
  return { nodes, items: order.map((i) => items[i]), boxes }
}

function edgeBoxes(geom: Geometry): { items: Id[]; boxes: BBox3Like[] } {
  const items: Id[] = []
  const boxes: BBox3Like[] = []
  for (const id in geom.edges) {
    const e = geom.edges[id]
    const a = geom.vertices[e.a]
    const b = geom.vertices[e.b]
    if (!a || !b) continue
    items.push(id)
    boxes.push(B.fromPoints([a.p, b.p]))
  }
  return { items, boxes }
}

function faceBoxes(geom: Geometry): { items: Id[]; boxes: BBox3Like[] } {
  const items: Id[] = []
  const boxes: BBox3Like[] = []
  for (const id in geom.faces) {
    const f = geom.faces[id]
    const box = B.empty()
    for (const loop of [f.outer, ...f.inner]) {
      for (const vId of loop.vertices) {
        const v = geom.vertices[vId]
        if (v) B.expandByPointMut(box, v.p)
      }
    }
    if (B.isEmpty(box)) continue
    items.push(id)
    boxes.push(box)
  }
  return { items, boxes }
}

export function spatialIndex(geom: Geometry): SpatialCache {
  const sig = signatureOf(geom)
  const hit = cache.get(geom)
  if (hit && hit.signature === sig) return hit
  const f = faceBoxes(geom)
  const e = edgeBoxes(geom)
  const built: SpatialCache = {
    signature: sig,
    faces: buildBvh(f.items, f.boxes),
    edges: buildBvh(e.items, e.boxes),
  }
  cache.set(geom, built)
  return built
}

/** Ids whose bounding box (grown by `pad`) is hit by the ray. */
export function queryRay(bvh: Bvh, ray: Ray, pad = 0): Id[] {
  if (bvh.nodes.length === 0) return []
  const out: Id[] = []
  const stack: number[] = [0]
  while (stack.length > 0) {
    const nodeIndex = stack.pop() as number
    const node = bvh.nodes[nodeIndex]
    const box = pad > 0 ? B.expandByScalar(node.box, pad) : node.box
    if (!R.intersectBox(ray, box)) continue
    if (node.left < 0) {
      for (let i = node.start; i < node.start + node.count; i++) out.push(bvh.items[i])
      continue
    }
    stack.push(node.left, node.right)
  }
  return out
}

/** Ids whose bounding box overlaps `box`. */
export function queryBox(bvh: Bvh, box: BBox3Like, pad = 0): Id[] {
  if (bvh.nodes.length === 0) return []
  const out: Id[] = []
  const stack: number[] = [0]
  while (stack.length > 0) {
    const nodeIndex = stack.pop() as number
    const node = bvh.nodes[nodeIndex]
    if (!B.intersects(node.box, box, pad)) continue
    if (node.left < 0) {
      for (let i = node.start; i < node.start + node.count; i++) out.push(bvh.items[i])
      continue
    }
    stack.push(node.left, node.right)
  }
  return out
}
