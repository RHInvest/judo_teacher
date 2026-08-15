/**
 * Testbausteine der Modellschicht.
 *
 * Der Geometriekern (`@/core`) entsteht parallel und wirft noch
 * "nicht implementiert". Testgeometrie wird deshalb hier direkt als
 * `Geometry`-Objekt aufgebaut - topologisch vollstaendig, damit Abfragen wie
 * `isSolid`, `solidVolume` und `findConnected` echte Ergebnisse liefern.
 *
 * OWNERSHIP: Model.
 */

import type { Face, Geometry, Id, Vec3Like } from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { newId } from '@/shared/ids'
import { V } from '@/core/math'
import { useStore } from '../store'

/** Newell-Normale einer Punktschleife. */
function newellNormal(points: readonly Vec3Like[]): Vec3Like {
  let x = 0
  let y = 0
  let z = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    x += (a.y - b.y) * (a.z + b.z)
    y += (a.z - b.z) * (a.x + b.x)
    z += (a.x - b.x) * (a.y + b.y)
  }
  return { x: x / 2, y: y / 2, z: z / 2 }
}

export interface BuiltGeometry {
  geometry: Geometry
  vertexIds: Id[]
  faceIds: Id[]
  edgeIds: Id[]
}

/**
 * Baut eine Geometrie aus Punkten und Flaechenschleifen (Indizes in `points`).
 * Kanten entstehen automatisch und werden zwischen benachbarten Flaechen
 * geteilt - genau so, wie es der Kernel spaeter tut.
 */
export function buildGeometry(points: readonly Vec3Like[], loops: readonly (readonly number[])[]): BuiltGeometry {
  const geometry = emptyGeometry()
  const vertexIds = points.map((p) => {
    const id = newId('v')
    geometry.vertices[id] = { id, p: { ...p }, edges: [] }
    return id
  })

  const edgeByPair = new Map<string, Id>()
  const edgeIds: Id[] = []
  const pairKey = (a: Id, b: Id): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

  const edgeBetween = (a: Id, b: Id): Id => {
    const key = pairKey(a, b)
    const existing = edgeByPair.get(key)
    if (existing) return existing
    const id = newId('e')
    geometry.edges[id] = {
      id,
      a,
      b,
      faces: [],
      soft: false,
      smooth: false,
      hidden: false,
      tagId: null,
      materialId: null,
    }
    geometry.vertices[a].edges.push(id)
    geometry.vertices[b].edges.push(id)
    edgeByPair.set(key, id)
    edgeIds.push(id)
    return id
  }

  const faceIds: Id[] = []
  for (const loop of loops) {
    const loopVertices = loop.map((i) => vertexIds[i])
    const loopEdges: Id[] = []
    for (let i = 0; i < loopVertices.length; i++) {
      loopEdges.push(edgeBetween(loopVertices[i], loopVertices[(i + 1) % loopVertices.length]))
    }
    const loopPoints = loop.map((i) => points[i])
    const normal = V.normalizeOr(newellNormal(loopPoints), V.AXIS_Z)
    const id = newId('f')
    const face: Face = {
      id,
      outer: { edges: loopEdges, vertices: loopVertices },
      inner: [],
      normal,
      plane: { n: normal, d: V.dot(normal, loopPoints[0]) },
      frontMaterialId: null,
      backMaterialId: null,
      hidden: false,
      tagId: null,
    }
    geometry.faces[id] = face
    for (const eid of loopEdges) geometry.edges[eid].faces.push(id)
    faceIds.push(id)
  }

  return { geometry, vertexIds, faceIds, edgeIds }
}

/** Achsparalleler Quader von `origin` mit den Kantenlaengen `size`. */
export function buildBox(
  origin: Vec3Like = { x: 0, y: 0, z: 0 },
  size: Vec3Like = { x: 1, y: 1, z: 1 },
): BuiltGeometry {
  const { x, y, z } = origin
  const points: Vec3Like[] = [
    { x, y, z },
    { x: x + size.x, y, z },
    { x: x + size.x, y: y + size.y, z },
    { x, y: y + size.y, z },
    { x, y, z: z + size.z },
    { x: x + size.x, y, z: z + size.z },
    { x: x + size.x, y: y + size.y, z: z + size.z },
    { x, y: y + size.y, z: z + size.z },
  ]
  // Schleifen gegen den Uhrzeigersinn von aussen betrachtet
  const loops = [
    [0, 3, 2, 1], // unten  (-Z)
    [4, 5, 6, 7], // oben   (+Z)
    [0, 1, 5, 4], // vorne  (-Y)
    [1, 2, 6, 5], // rechts (+X)
    [2, 3, 7, 6], // hinten (+Y)
    [3, 0, 4, 7], // links  (-X)
  ]
  return buildGeometry(points, loops)
}

/** Einzelnes Rechteck in der XY-Ebene, Normale +Z. */
export function buildQuad(origin: Vec3Like = { x: 0, y: 0, z: 0 }, w = 1, d = 1): BuiltGeometry {
  const { x, y, z } = origin
  return buildGeometry(
    [
      { x, y, z },
      { x: x + w, y, z },
      { x: x + w, y: y + d, z },
      { x, y: y + d, z },
    ],
    [[0, 1, 2, 3]],
  )
}

/** Legt die gebaute Geometrie in die Geometrie der aktiven Definition. */
export function installGeometry(built: BuiltGeometry): BuiltGeometry {
  const s = useStore.getState()
  const def = s.getDefinition(s.context.definitionId)
  if (!def) throw new Error('Aktive Definition fehlt')
  s.upsertDefinition({ ...def, geometry: built.geometry })
  s.clearHistory()
  return built
}
