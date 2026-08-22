/**
 * Direkter Geometrie-Aufbau fuer Importer und Bibliothek.
 *
 * Import und Bibliothek bauen `Geometry` selbst, statt ueber `@/core`
 * aufzubauen: beim Laden einer Datei sind Kantenschnitte und automatische
 * Flaechenfindung nicht noetig - die Topologie steht ja schon fest -, und der
 * Suchlauf waere bei zehntausenden Kanten der Flaschenhals. Die Struktur aus
 * `@/shared/types` wird dabei exakt eingehalten, `core.validate()` laeuft
 * ueber das Ergebnis sauber durch (siehe `__tests__/library.test.ts`).
 *
 * Die Datenstruktur aus `@/shared/types` wird dabei exakt eingehalten:
 *  - `Vertex.edges` enthaelt jede anliegende Kante genau einmal
 *  - `Edge.faces` enthaelt jede anliegende Flaeche genau einmal
 *  - `Loop.edges[i]` verbindet `Loop.vertices[i]` mit `Loop.vertices[i+1]`
 *  - `Face.normal` zeigt zur Vorderseite, die Aussenschleife laeuft von dort
 *    aus gesehen gegen den Uhrzeigersinn
 */

import type { Edge, Face, Geometry, Id, Loop, PlaneLike, Vec3Like, Vertex } from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { newId } from '@/shared/ids'
import { P, POINT_TOL, V } from '@/core/math'

export interface BuildOptions {
  materialId?: Id | null
  backMaterialId?: Id | null
  tagId?: Id | null
  soft?: boolean
  smooth?: boolean
  hidden?: boolean
}

/**
 * Stateful helper - erzeugt Vertices/Kanten/Flaechen mit automatischem
 * Verschmelzen identischer Punkte und Kanten.
 */
export class GeomBuilder {
  readonly geom: Geometry
  private readonly vertexKeys = new Map<string, Id>()
  private readonly edgeKeys = new Map<string, Id>()

  constructor(geom?: Geometry) {
    this.geom = geom ?? emptyGeometry()
    for (const v of Object.values(this.geom.vertices)) this.vertexKeys.set(V.key(v.p), v.id)
    for (const e of Object.values(this.geom.edges)) this.edgeKeys.set(edgeKey(e.a, e.b), e.id)
  }

  /** Punkt einfuegen oder den bereits vorhandenen innerhalb POINT_TOL wiederverwenden. */
  vertex(p: Vec3Like): Id {
    const key = V.key(p)
    const existing = this.vertexKeys.get(key)
    if (existing) return existing
    // Nachbarzellen pruefen, damit Punkte knapp neben der Rasterkante verschmelzen
    const near = this.findNearby(p)
    if (near) {
      this.vertexKeys.set(key, near)
      return near
    }
    const id = newId('v')
    const vertex: Vertex = { id, p: { x: p.x, y: p.y, z: p.z }, edges: [] }
    this.geom.vertices[id] = vertex
    this.vertexKeys.set(key, id)
    return id
  }

  private findNearby(p: Vec3Like): Id | null {
    const q = 1 / POINT_TOL
    const bx = Math.round(p.x * q)
    const by = Math.round(p.y * q)
    const bz = Math.round(p.z * q)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          const id = this.vertexKeys.get(`${bx + dx},${by + dy},${bz + dz}`)
          if (id && V.equals(this.geom.vertices[id].p, p, POINT_TOL)) return id
        }
      }
    }
    return null
  }

  /** Kante zwischen zwei bestehenden Vertices; vorhandene Kanten werden wiederverwendet. */
  edge(a: Id, b: Id, opts: BuildOptions = {}): Id | null {
    if (a === b) return null
    const key = edgeKey(a, b)
    const existing = this.edgeKeys.get(key)
    if (existing) return existing
    const id = newId('e')
    const edge: Edge = {
      id,
      a,
      b,
      faces: [],
      soft: opts.soft ?? false,
      smooth: opts.smooth ?? false,
      hidden: opts.hidden ?? false,
      tagId: opts.tagId ?? null,
      materialId: opts.materialId ?? null,
    }
    this.geom.edges[id] = edge
    this.edgeKeys.set(key, id)
    pushUnique(this.geom.vertices[a].edges, id)
    pushUnique(this.geom.vertices[b].edges, id)
    return id
  }

  /** Kante zwischen zwei Punkten. */
  edgePoints(a: Vec3Like, b: Vec3Like, opts: BuildOptions = {}): Id | null {
    return this.edge(this.vertex(a), this.vertex(b), opts)
  }

  /** Kantenzug; `closed` schliesst zurueck zum Anfang. */
  polyline(points: readonly Vec3Like[], closed: boolean, opts: BuildOptions = {}): Id[] {
    const ids: Id[] = []
    const count = closed ? points.length : points.length - 1
    for (let i = 0; i < count; i++) {
      const id = this.edgePoints(points[i], points[(i + 1) % points.length], opts)
      if (id) ids.push(id)
    }
    return ids
  }

  /**
   * Flaeche aus einer geschlossenen Punktschleife (plus Loechern).
   * Doppelte und kollineare Punkte werden entfernt; entartete Schleifen
   * liefern `null`.
   */
  face(
    outer: readonly Vec3Like[],
    holes: readonly (readonly Vec3Like[])[] = [],
    opts: BuildOptions = {},
  ): Id | null {
    const ring = dedupeRing(outer)
    if (ring.length < 3) return null
    const normal = P.polygonNormal(ring)
    if (!normal) return null
    const plane: PlaneLike = P.fromNormalAndPoint(normal, V.centroid(ring))

    const outerLoop = this.loop(ring, opts)
    if (!outerLoop) return null

    const innerLoops: Loop[] = []
    for (const hole of holes) {
      const holeRing = dedupeRing(hole)
      if (holeRing.length < 3) continue
      const holeNormal = P.polygonNormal(holeRing)
      // Loecher laufen von der Vorderseite gesehen im Uhrzeigersinn
      const ordered = holeNormal && V.dot(holeNormal, normal) > 0 ? [...holeRing].reverse() : holeRing
      const loop = this.loop(ordered, opts)
      if (loop) innerLoops.push(loop)
    }

    const id = newId('f')
    const face: Face = {
      id,
      outer: outerLoop,
      inner: innerLoops,
      normal,
      plane,
      frontMaterialId: opts.materialId ?? null,
      backMaterialId: opts.backMaterialId ?? null,
      hidden: opts.hidden ?? false,
      tagId: opts.tagId ?? null,
    }
    this.geom.faces[id] = face
    for (const edgeId of outerLoop.edges) pushUnique(this.geom.edges[edgeId].faces, id)
    for (const loop of innerLoops) for (const edgeId of loop.edges) pushUnique(this.geom.edges[edgeId].faces, id)
    return id
  }

  private loop(points: readonly Vec3Like[], opts: BuildOptions): Loop | null {
    const vertices = points.map((p) => this.vertex(p))
    // nach dem Verschmelzen koennen Punkte zusammenfallen
    const unique: Id[] = []
    for (const v of vertices) if (unique.length === 0 || unique[unique.length - 1] !== v) unique.push(v)
    while (unique.length > 1 && unique[0] === unique[unique.length - 1]) unique.pop()
    if (unique.length < 3) return null

    const edges: Id[] = []
    for (let i = 0; i < unique.length; i++) {
      const id = this.edge(unique[i], unique[(i + 1) % unique.length], opts)
      if (!id) return null
      edges.push(id)
    }
    return { edges, vertices: unique }
  }
}

function edgeKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function pushUnique(list: Id[], id: Id): void {
  if (!list.includes(id)) list.push(id)
}

/** Entfernt aufeinanderfolgende doppelte Punkte (inkl. Anfang == Ende). */
export function dedupeRing(points: readonly Vec3Like[]): Vec3Like[] {
  const out: Vec3Like[] = []
  for (const p of points) {
    if (out.length > 0 && V.equals(out[out.length - 1], p, POINT_TOL)) continue
    out.push({ x: p.x, y: p.y, z: p.z })
  }
  while (out.length > 1 && V.equals(out[0], out[out.length - 1], POINT_TOL)) out.pop()
  return out
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

/** Punkte der Aussenschleife einer Flaeche, in Umlaufrichtung. */
export function faceRing(geom: Geometry, faceId: Id): Vec3Like[] {
  const face = geom.faces[faceId]
  if (!face) return []
  return face.outer.vertices.map((id) => geom.vertices[id]?.p ?? { x: 0, y: 0, z: 0 })
}

export function faceHoleRings(geom: Geometry, faceId: Id): Vec3Like[][] {
  const face = geom.faces[faceId]
  if (!face) return []
  return face.inner.map((loop) => loop.vertices.map((id) => geom.vertices[id]?.p ?? { x: 0, y: 0, z: 0 }))
}

export function edgeEndpoints(geom: Geometry, edgeId: Id): [Vec3Like, Vec3Like] | null {
  const edge = geom.edges[edgeId]
  if (!edge) return null
  const a = geom.vertices[edge.a]
  const b = geom.vertices[edge.b]
  if (!a || !b) return null
  return [a.p, b.p]
}

/** Alle Punkte einer Geometrie (fuer Bounding-Boxen). */
export function geometryPoints(geom: Geometry): Vec3Like[] {
  return Object.values(geom.vertices).map((v) => v.p)
}

export function geometryBounds(geom: Geometry): { min: Vec3Like; max: Vec3Like } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const v of Object.values(geom.vertices)) {
    if (v.p.x < minX) minX = v.p.x
    if (v.p.y < minY) minY = v.p.y
    if (v.p.z < minZ) minZ = v.p.z
    if (v.p.x > maxX) maxX = v.p.x
    if (v.p.y > maxY) maxY = v.p.y
    if (v.p.z > maxZ) maxZ = v.p.z
  }
  if (minX > maxX) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } }
}

/* ------------------------------------------------------------------ */
/* Nachbearbeitung fuer Importe                                        */
/* ------------------------------------------------------------------ */

/**
 * Fasst koplanare Nachbarflaechen zusammen (STL-Import: Dreieckssuppe ->
 * brauchbare N-Gons). Nutzt `core.mergeCoplanarFaces`; nur wenn der Aufruf
 * fehlschlaegt, greift die einfachere IO-eigene Variante. Der Kern kann das
 * inzwischen - der Rueckfallweg bleibt trotzdem stehen, damit ein Import nicht
 * an einer Kernel-Ausnahme scheitert, sondern hoechstens feiner unterteilte
 * (aber korrekte) Geometrie liefert.
 */
export function mergeCoplanar(geom: Geometry, core?: { mergeCoplanarFaces(g: Geometry): unknown }): number {
  if (core) {
    try {
      core.mergeCoplanarFaces(geom)
      return 0
    } catch {
      /* Kern hat abgelehnt - eigene Variante benutzen */
    }
  }
  return mergeCoplanarLocal(geom)
}

/**
 * Entfernt Kanten zwischen koplanaren Nachbarflaechen und verschmilzt diese zu
 * einer groesseren Flaeche. Liefert die Anzahl der entfernten Kanten.
 */
export function mergeCoplanarLocal(geom: Geometry, planarTol = 1e-4): number {
  let removed = 0
  let changed = true
  let guard = 64
  while (changed && guard-- > 0) {
    changed = false
    for (const edge of Object.values(geom.edges)) {
      if (edge.faces.length !== 2) continue
      const [idA, idB] = edge.faces
      if (idA === idB) continue
      const fa = geom.faces[idA]
      const fb = geom.faces[idB]
      if (!fa || !fb) continue
      if (fa.inner.length > 0 || fb.inner.length > 0) continue
      if (V.dot(fa.normal, fb.normal) < 1 - 1e-6) continue
      if (Math.abs(fa.plane.d - fb.plane.d) > planarTol) continue
      // Nur verschmelzen, wenn genau eine gemeinsame Kante existiert
      const shared = fa.outer.edges.filter((e) => fb.outer.edges.includes(e))
      if (shared.length !== 1 || shared[0] !== edge.id) continue
      if (mergeFacePair(geom, fa, fb, edge.id)) {
        removed++
        changed = true
        break
      }
    }
  }
  return removed
}

function mergeFacePair(geom: Geometry, fa: Face, fb: Face, edgeId: Id): boolean {
  const ia = fa.outer.edges.indexOf(edgeId)
  const ib = fb.outer.edges.indexOf(edgeId)
  if (ia < 0 || ib < 0) return false

  const na = fa.outer.vertices.length
  const nb = fb.outer.vertices.length
  // Schleife A ab der Kante, danach Schleife B ab der Kante - die gemeinsame
  // Kante faellt in beiden Schleifen weg.
  const verts: Id[] = []
  const edges: Id[] = []
  for (let k = 1; k < na; k++) {
    verts.push(fa.outer.vertices[(ia + k) % na])
    edges.push(fa.outer.edges[(ia + k) % na])
  }
  for (let k = 1; k < nb; k++) {
    verts.push(fb.outer.vertices[(ib + k) % nb])
    edges.push(fb.outer.edges[(ib + k) % nb])
  }
  if (verts.length < 3 || verts.length !== edges.length) return false

  const points = verts.map((id) => geom.vertices[id]?.p).filter((p): p is Vec3Like => !!p)
  const normal = P.polygonNormal(points)
  if (!normal || V.dot(normal, fa.normal) < 0.99) return false

  // Flaeche B aufloesen, Flaeche A erweitern
  for (const e of fb.outer.edges) {
    const edge = geom.edges[e]
    if (!edge) continue
    edge.faces = edge.faces.filter((f) => f !== fb.id)
  }
  for (const e of fa.outer.edges) {
    const edge = geom.edges[e]
    if (!edge) continue
    edge.faces = edge.faces.filter((f) => f !== fa.id)
  }
  delete geom.faces[fb.id]

  fa.outer = { edges, vertices: verts }
  fa.normal = normal
  fa.plane = P.fromNormalAndPoint(normal, V.centroid(points))
  for (const e of edges) pushUnique(geom.edges[e].faces, fa.id)

  // gemeinsame Kante entfernen
  const dead = geom.edges[edgeId]
  if (dead) {
    delete geom.edges[edgeId]
    for (const vid of [dead.a, dead.b]) {
      const vertex = geom.vertices[vid]
      if (vertex) vertex.edges = vertex.edges.filter((e) => e !== edgeId)
    }
  }
  removeOrphanVertices(geom)
  return true
}

/** Entfernt Vertices ohne Kanten. */
export function removeOrphanVertices(geom: Geometry): number {
  let count = 0
  for (const v of Object.values(geom.vertices)) {
    if (v.edges.length === 0) {
      delete geom.vertices[v.id]
      count++
    }
  }
  return count
}

/**
 * Entfernt kollineare Zwischenpunkte einer Flaechenschleife, wenn der Punkt
 * nur zu genau diesen zwei Kanten gehoert. Haelt STL-Importe schlank.
 */
export function simplifyFaceLoops(geom: Geometry, angleTol = 1e-6): number {
  let removed = 0
  for (const face of Object.values(geom.faces)) {
    let guard = face.outer.vertices.length + 2
    let again = true
    while (again && guard-- > 0) {
      again = false
      const verts = face.outer.vertices
      const edges = face.outer.edges
      const n = verts.length
      if (n <= 3) break
      for (let i = 0; i < n; i++) {
        const vid = verts[i]
        const vertex = geom.vertices[vid]
        if (!vertex || vertex.edges.length !== 2) continue
        const prev = geom.vertices[verts[(i + n - 1) % n]]
        const next = geom.vertices[verts[(i + 1) % n]]
        if (!prev || !next) continue
        const d0 = V.normalize(V.sub(vertex.p, prev.p))
        const d1 = V.normalize(V.sub(next.p, vertex.p))
        if (V.lengthSq(V.cross(d0, d1)) > angleTol) continue
        const incoming = edges[(i + n - 1) % n]
        const outgoing = edges[i]
        const eIn = geom.edges[incoming]
        const eOut = geom.edges[outgoing]
        if (!eIn || !eOut) continue
        if (eIn.faces.length !== eOut.faces.length) continue
        // Kante verlaengern, Zwischenkante und Vertex entfernen
        if (eIn.a === vid) eIn.a = next.id
        else if (eIn.b === vid) eIn.b = next.id
        else continue
        pushUnique(next.edges, incoming)
        next.edges = next.edges.filter((e) => e !== outgoing)
        delete geom.edges[outgoing]
        delete geom.vertices[vid]
        verts.splice(i, 1)
        edges.splice(i, 1)
        removed++
        again = true
        break
      }
    }
  }
  return removed
}
