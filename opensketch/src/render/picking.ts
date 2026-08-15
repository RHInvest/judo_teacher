/**
 * Picking.
 *
 * Gearbeitet wird gegen die flache Instanzliste aus `sceneSync` - jede Instanz
 * bringt ihre fertige Welttransformation und die Welt-Huelle ihrer eigenen
 * Geometrie mit. Ablauf pro Instanz:
 *
 *  1. Huellentest im Weltraum (billig, sortiert die meisten Instanzen aus)
 *  2. Strahl in den DEFINITIONSRAUM transformieren (die Geometrie wird NIE
 *     transformiert - nur der Strahl)
 *  3. Treffertest gegen die bereits gecachten Puffer der Definition
 *     (Dreiecke, Kantensegmente, Vertexpositionen)
 *
 * Der Kernel-Raycast (`core.raycast`) wird - wenn verfuegbar - als schnellere
 * Variante mit raeumlichem Index vorgezogen und faellt sonst auf die eigenen
 * Puffer zurueck. Beides steckt hinter `raycastDefinition`, damit sich die
 * Quelle spaeter wechseln laesst, ohne das Picking umzubauen.
 *
 * Priorisierung wie in SketchUp: Vertex vor Kante vor Flaeche, sofern der
 * Treffer innerhalb der Pixeltoleranz liegt und nicht deutlich hinter der
 * naechsten Flaeche verschwindet.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as core from '@/core'
import { B, M, R, V, V2 } from '@/core/math'
import type { Ray } from '@/core/math'
import type {
  Geometry,
  Id,
  PickHit,
  PickKind,
  PickOptions,
  Selection,
  SketchDocument,
  Vec2Like,
  Vec3Like,
} from '@/shared/types'
import { emptySelection } from '@/shared/types'
import type { CameraController } from './camera'
import type { DefinitionBuild, InstanceRecord, SceneSync } from './sceneSync'
import type { RenderSnapshot } from './snapshot'
import { warnOnce } from './util'

export const DEFAULT_PICK_TOLERANCE = 8

/** Ein Treffer im Definitionsraum. */
interface LocalHit {
  kind: 'face' | 'edge' | 'vertex'
  id: Id
  /** Strahlparameter im Definitionsraum */
  distance: number
  point: Vec3Like
  normal: Vec3Like | null
  /** Abstand zum Strahl (nur fuer Kanten/Vertices interessant) */
  offset: number
}

export function emptyHit(point: Vec3Like = { x: 0, y: 0, z: 0 }): PickHit {
  return {
    kind: 'none',
    point,
    distance: Infinity,
    normal: null,
    id: null,
    definitionId: null,
    instancePath: [],
    worldTransform: M.identity(),
    inContext: false,
    topInstanceId: null,
  }
}

/* ------------------------------------------------------------------ */
/* Kernel-Raycast (optional)                                           */
/* ------------------------------------------------------------------ */

let kernelRaycastUsable = true

/**
 * Schaltet den Kernel-Raycast ab bzw. wieder an. Wird von den Tests benutzt,
 * um beide Pfade (Kernel und eigene Puffer) getrennt zu pruefen.
 */
export function setKernelRaycastEnabled(enabled: boolean): void {
  kernelRaycastUsable = enabled
}

export function isKernelRaycastEnabled(): boolean {
  return kernelRaycastUsable
}

/**
 * Versucht den Kernel-Raycast. Liefert null, wenn er (noch) nicht verfuegbar
 * ist - dann uebernimmt der Puffer-Raycast.
 */
function kernelRaycast(
  geom: Geometry,
  ray: Ray,
  tolerance: number,
  kinds: ('face' | 'edge' | 'vertex')[],
  ignore: Id[] | undefined,
  backfaces: boolean,
): LocalHit[] | null {
  if (!kernelRaycastUsable) return null
  try {
    const hits = core.raycast(geom, ray, { tolerance, kinds, ignore, backfaces })
    if (!Array.isArray(hits)) return null
    const out: LocalHit[] = []
    for (const hit of hits) {
      if (!hit || !hit.point) continue
      out.push({
        kind: hit.kind,
        id: hit.id,
        distance: hit.distance,
        point: hit.point,
        normal: hit.normal ?? null,
        offset: hit.kind === 'face' ? 0 : 0,
      })
    }
    return out
  } catch (err) {
    kernelRaycastUsable = false
    warnOnce('core.raycast', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Puffer-Raycast                                                      */
/* ------------------------------------------------------------------ */

/** Dreiecke, Kanten und Vertices einer Definition aus dem Render-Cache. */
function bufferRaycast(
  build: DefinitionBuild,
  ray: Ray,
  tolerance: number,
  kinds: ('face' | 'edge' | 'vertex')[],
  ignore: Id[] | undefined,
  backfaces: boolean,
): LocalHit[] {
  const out: LocalHit[] = []
  const skip = ignore && ignore.length > 0 ? new Set(ignore) : null

  if (kinds.includes('face')) {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 0 }
    const c = { x: 0, y: 0, z: 0 }
    for (const group of build.faceGroups) {
      const positions = group.positions
      const indices = group.indices
      const triangles = Math.floor(indices.length / 3)
      for (let t = 0; t < triangles; t++) {
        const faceId = group.faceIds[t]
        if (skip && faceId && skip.has(faceId)) continue
        readPoint(positions, indices[t * 3], a)
        readPoint(positions, indices[t * 3 + 1], b)
        readPoint(positions, indices[t * 3 + 2], c)
        const hit = R.intersectTriangle(ray, a, b, c, !backfaces)
        if (!hit) continue
        const normal = V.normalizeOr(V.cross(V.sub(b, a), V.sub(c, a)), { x: 0, y: 0, z: 1 })
        out.push({
          kind: 'face',
          id: faceId ?? '',
          distance: hit.t,
          point: hit.point,
          normal,
          offset: 0,
        })
      }
    }
  }

  if (kinds.includes('edge')) {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 0 }
    for (const cls of ['normal', 'profile', 'hidden', 'guide'] as const) {
      const bucket = build.edges.buckets[cls]
      for (let i = 0; i < bucket.segments; i++) {
        const edgeId = bucket.edgeIds[i]
        if (skip && skip.has(edgeId)) continue
        readPoint(bucket.positions, i * 2, a)
        readPoint(bucket.positions, i * 2 + 1, b)
        const closest = R.rayToSegment(ray, a, b)
        if (closest.distance > tolerance) continue
        out.push({
          kind: 'edge',
          id: edgeId,
          distance: closest.rayT,
          point: closest.pointOnSegment,
          normal: null,
          offset: closest.distance,
        })
      }
    }
  }

  if (kinds.includes('vertex')) {
    const p = { x: 0, y: 0, z: 0 }
    const count = build.vertexIds.length
    for (let i = 0; i < count; i++) {
      const vertexId = build.vertexIds[i]
      if (skip && skip.has(vertexId)) continue
      readPoint(build.vertexPositions, i, p)
      const along = V.dot(V.sub(p, ray.origin), ray.dir)
      if (along < 0) continue
      const onRay = V.addScaled(ray.origin, ray.dir, along)
      const offset = V.distance(onRay, p)
      if (offset > tolerance) continue
      out.push({
        kind: 'vertex',
        id: vertexId,
        distance: along,
        point: { x: p.x, y: p.y, z: p.z },
        normal: null,
        offset,
      })
    }
  }

  return out
}

function readPoint(buffer: Float32Array, index: number, out: Vec3Like): void {
  const o = index * 3
  out.x = buffer[o]
  out.y = buffer[o + 1]
  out.z = buffer[o + 2]
}

/* ------------------------------------------------------------------ */
/* Bildschirmbereiche fuer Rahmen- und Lassoauswahl                    */
/* ------------------------------------------------------------------ */

interface ScreenRegion {
  minX: number
  minY: number
  maxX: number
  maxY: number
  containsPoint(x: number, y: number): boolean
  intersectsSegment(ax: number, ay: number, bx: number, by: number): boolean
}

function rectRegion(x0: number, y0: number, x1: number, y1: number): ScreenRegion {
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  return {
    minX,
    minY,
    maxX,
    maxY,
    containsPoint: (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY,
    intersectsSegment: (ax, ay, bx, by) => segmentIntersectsRect(ax, ay, bx, by, minX, minY, maxX, maxY),
  }
}

function lassoRegion(points: Vec2Like[]): ScreenRegion | null {
  const polygon = points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (polygon.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    containsPoint: (x, y) => V2.pointInPolygon({ x, y }, polygon),
    intersectsSegment: (ax, ay, bx, by) => {
      if (V2.pointInPolygon({ x: ax, y: ay }, polygon)) return true
      if (V2.pointInPolygon({ x: bx, y: by }, polygon)) return true
      for (let i = 0; i < polygon.length; i++) {
        const c = polygon[i]
        const d = polygon[(i + 1) % polygon.length]
        if (segmentsCross(ax, ay, bx, by, c.x, c.y, d.x, d.y)) return true
      }
      return false
    },
  }
}

function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  if ((ax >= minX && ax <= maxX && ay >= minY && ay <= maxY) || (bx >= minX && bx <= maxX && by >= minY && by <= maxY)) {
    return true
  }
  if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX) return false
  if (Math.max(ay, by) < minY || Math.min(ay, by) > maxY) return false
  return (
    segmentsCross(ax, ay, bx, by, minX, minY, maxX, minY) ||
    segmentsCross(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
    segmentsCross(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
    segmentsCross(ax, ay, bx, by, minX, maxY, minX, minY)
  )
}

function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross2(cx, cy, dx, dy, ax, ay)
  const d2 = cross2(cx, cy, dx, dy, bx, by)
  const d3 = cross2(ax, ay, bx, by, cx, cy)
  const d4 = cross2(ax, ay, bx, by, dx, dy)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function cross2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

export class Picker {
  constructor(
    private readonly sync: SceneSync,
    private readonly camera: CameraController,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Einzeltreffer                                                    */
  /* ---------------------------------------------------------------- */

  pick(snapshot: RenderSnapshot, x: number, y: number, options?: PickOptions): PickHit {
    const screenRay = this.camera.screenToRay(x, y)
    const worldRay: Ray = { origin: screenRay.origin, dir: screenRay.dir }
    const doc = snapshot.doc
    const tolerancePx = positiveOr(options?.tolerance, DEFAULT_PICK_TOLERANCE)
    const kinds = options?.kinds ?? null
    const wantsGeometry = (kind: PickKind): boolean => !kinds || kinds.includes(kind)
    const geometryKinds: ('face' | 'edge' | 'vertex')[] = []
    if (wantsGeometry('face')) geometryKinds.push('face')
    if (wantsGeometry('edge')) geometryKinds.push('edge')
    if (wantsGeometry('vertex')) geometryKinds.push('vertex')

    let best: PickHit | null = null
    let bestScore = Infinity

    if (doc && geometryKinds.length > 0) {
      for (const record of this.sync.records) {
        const build = this.sync.getBuild(record.definitionId)
        if (!build) continue
        if (B.isEmpty(record.bounds)) continue

        const worldTolerance = this.worldTolerance(tolerancePx, B.center(record.bounds))
        if (!R.intersectBox(worldRay, B.expandByScalar(record.bounds, worldTolerance * 2))) continue

        const scale = record.scale > 1e-9 ? record.scale : 1
        const localRay = transformRay(worldRay, record)
        const localTolerance = worldTolerance / scale

        const geom = doc.definitions[record.definitionId]?.geometry
        const kernelHits = geom
          ? kernelRaycast(geom, localRay, localTolerance, geometryKinds, options?.ignore, options?.includeHidden === true)
          : null
        // Der Kernel prueft Flaechen EXAKT gegen die Triangulierung (siehe
        // core/query/raycast.ts) - die Toleranz gilt dort nur fuer Kanten und
        // Vertices. Genau am Flaechenrand kann er deshalb leer ausgehen, wo der
        // Puffer-Raycast noch trifft. Bei leerem Ergebnis wird deshalb der
        // Puffer nachgeschlagen, damit beide Pfade dasselbe liefern.
        const hits =
          kernelHits && kernelHits.length > 0
            ? kernelHits
            : bufferRaycast(build, localRay, localTolerance, geometryKinds, options?.ignore, options?.includeHidden === true)

        const local = pickBest(hits, localTolerance)
        if (!local) continue

        const worldDistance = local.distance * scale
        const score = worldDistance - priorityBonus(local.kind, worldTolerance)
        if (score >= bestScore) continue

        bestScore = score
        best = this.toPickHit(local, record, worldDistance, options)
      }
    }

    if (best) return best

    const entityHit = this.pickEntities(snapshot, worldRay, tolerancePx, options)
    if (entityHit) return entityHit

    if (!kinds || kinds.includes('ground')) {
      const ground = intersectGround(worldRay)
      if (ground) {
        const hit = emptyHit(ground)
        hit.kind = 'ground'
        hit.normal = { x: 0, y: 0, z: 1 }
        hit.distance = V.distance(worldRay.origin, ground)
        hit.instancePath = snapshot.context?.instancePath ?? []
        hit.definitionId = snapshot.context?.definitionId ?? null
        hit.inContext = true
        return hit
      }
    }

    return emptyHit(worldRay.origin)
  }

  /** Baut den vollstaendigen `PickHit` im Weltraum. */
  private toPickHit(
    local: LocalHit,
    record: InstanceRecord,
    worldDistance: number,
    options?: PickOptions,
  ): PickHit {
    const point = M.transformPoint(record.worldTransform, local.point)
    const normal = local.normal ? V.normalizeOr(M.transformNormal(record.worldTransform, local.normal), local.normal) : null
    const deep = options?.deep === true
    const raw: PickKind = local.kind
    // Ausserhalb des aktiven Kontexts liefert SketchUp die Gruppe/Komponente,
    // nicht das einzelne Primitiv - es sei denn, der Aufrufer will explizit tief
    // hineinpicken.
    const kind: PickKind = record.inContext || deep ? raw : 'instance'
    return {
      kind,
      point,
      distance: worldDistance,
      normal,
      id: kind === 'instance' ? record.topInstanceId : local.id,
      definitionId: record.definitionId,
      instancePath: record.instancePath,
      worldTransform: record.worldTransform,
      inContext: record.inContext,
      topInstanceId: record.topInstanceId,
    }
  }

  /** Hilfslinien, Hilfspunkte und Schnittebenen des aktiven Kontexts. */
  private pickEntities(
    snapshot: RenderSnapshot,
    ray: Ray,
    tolerancePx: number,
    options?: PickOptions,
  ): PickHit | null {
    const doc = snapshot.doc
    if (!doc) return null
    const kinds = options?.kinds ?? null
    if (kinds && !kinds.includes('guide') && !kinds.includes('entity')) return null

    const contextRecord = this.contextRecord(snapshot)
    if (!contextRecord) return null
    const def = doc.definitions[contextRecord.definitionId]
    if (!def) return null

    const skip = options?.ignore && options.ignore.length > 0 ? new Set(options.ignore) : null
    let best: PickHit | null = null

    for (const childId of def.children ?? []) {
      if (skip && skip.has(childId)) continue
      const entity = doc.entities?.[childId]
      if (!entity || entity.hidden) continue

      let point: Vec3Like | null = null
      let kind: PickKind = 'entity'

      if (entity.type === 'guidePoint') {
        point = M.transformPoint(contextRecord.worldTransform, entity.position)
        kind = 'guide'
      } else if (entity.type === 'guideLine') {
        const origin = M.transformPoint(contextRecord.worldTransform, entity.origin)
        const direction = V.normalizeOr(
          M.transformDirection(contextRecord.worldTransform, entity.direction),
          { x: 1, y: 0, z: 0 },
        )
        const span = Number.isFinite(entity.length) && entity.length ? entity.length : 1e4
        const closest = R.rayToSegment(ray, V.addScaled(origin, direction, -span), V.addScaled(origin, direction, span))
        const tolerance = this.worldTolerance(tolerancePx, closest.pointOnSegment)
        if (closest.distance <= tolerance) {
          point = closest.pointOnSegment
          kind = 'guide'
        }
      } else if (entity.type === 'sectionPlane') {
        point = null
      }

      if (!point) continue
      if (kind === 'guide' && entity.type === 'guidePoint') {
        const tolerance = this.worldTolerance(tolerancePx, point)
        const along = V.dot(V.sub(point, ray.origin), ray.dir)
        if (along < 0) continue
        if (V.distance(V.addScaled(ray.origin, ray.dir, along), point) > tolerance) continue
      }

      const distance = V.distance(ray.origin, point)
      if (best && best.distance <= distance) continue
      const hit = emptyHit(point)
      hit.kind = kind
      hit.distance = distance
      hit.id = entity.id
      hit.definitionId = contextRecord.definitionId
      hit.instancePath = contextRecord.instancePath
      hit.worldTransform = contextRecord.worldTransform
      hit.inContext = true
      hit.topInstanceId = contextRecord.topInstanceId
      best = hit
    }

    return best
  }

  groundHit(x: number, y: number): Vec3Like | null {
    const ray = this.camera.screenToRay(x, y)
    return intersectGround({ origin: ray.origin, dir: ray.dir })
  }

  /* ---------------------------------------------------------------- */
  /* Rahmen- und Lassoauswahl                                         */
  /* ---------------------------------------------------------------- */

  pickRect(snapshot: RenderSnapshot, x0: number, y0: number, x1: number, y1: number, crossing: boolean): Selection {
    return this.pickRegion(snapshot, rectRegion(x0, y0, x1, y1), crossing)
  }

  pickLasso(snapshot: RenderSnapshot, points: Vec2Like[], crossing: boolean): Selection {
    const region = lassoRegion(points)
    if (!region) return emptySelection()
    return this.pickRegion(snapshot, region, crossing)
  }

  private pickRegion(snapshot: RenderSnapshot, region: ScreenRegion, crossing: boolean): Selection {
    const selection = emptySelection()
    const doc = snapshot.doc
    if (!doc) return selection

    const record = this.contextRecord(snapshot)
    if (!record) return selection
    const build = this.sync.getBuild(record.definitionId)
    const def = doc.definitions[record.definitionId]
    if (!build || !def) return selection

    const geom: Geometry = def.geometry ?? { vertices: {}, edges: {}, faces: {} }

    /* --- Vertices auf den Bildschirm projizieren --- */
    const screenByVertex = new Map<Id, { x: number; y: number; ok: boolean }>()
    for (let i = 0; i < build.vertexIds.length; i++) {
      const id = build.vertexIds[i]
      const local: Vec3Like = {
        x: build.vertexPositions[i * 3],
        y: build.vertexPositions[i * 3 + 1],
        z: build.vertexPositions[i * 3 + 2],
      }
      const world = M.transformPoint(record.worldTransform, local)
      const screen = this.camera.worldToScreen(world)
      const ok = Number.isFinite(screen.x) && Number.isFinite(screen.y) && screen.depth >= -1 && screen.depth <= 1
      screenByVertex.set(id, { x: screen.x, y: screen.y, ok })
      if (ok && region.containsPoint(screen.x, screen.y)) selection.vertexIds.push(id)
    }

    const inside = (id: Id): boolean => {
      const s = screenByVertex.get(id)
      return !!s && s.ok && region.containsPoint(s.x, s.y)
    }

    /* --- Kanten --- */
    for (const edgeId of Object.keys(geom.edges)) {
      const edge = geom.edges[edgeId]
      if (!edge) continue
      if (!snapshot.isTagVisible(edge.tagId)) continue
      if ((edge.hidden || edge.soft) && !snapshot.style.showHiddenGeometry) continue
      const a = screenByVertex.get(edge.a)
      const b = screenByVertex.get(edge.b)
      if (!a || !b || !a.ok || !b.ok) continue
      const bothInside = region.containsPoint(a.x, a.y) && region.containsPoint(b.x, b.y)
      if (bothInside || (crossing && region.intersectsSegment(a.x, a.y, b.x, b.y))) {
        selection.edgeIds.push(edgeId)
      }
    }

    /* --- Flaechen --- */
    for (const faceId of Object.keys(geom.faces)) {
      const face = geom.faces[faceId]
      if (!face || !face.outer) continue
      if (face.hidden && !snapshot.style.showHiddenGeometry) continue
      if (!snapshot.isTagVisible(face.tagId)) continue
      const loop = face.outer.vertices ?? []
      if (loop.length < 3) continue

      let allInside = true
      let anyInside = false
      for (const vertexId of loop) {
        if (inside(vertexId)) anyInside = true
        else allInside = false
      }
      if (allInside) {
        selection.faceIds.push(faceId)
        continue
      }
      if (!crossing) continue
      if (anyInside) {
        selection.faceIds.push(faceId)
        continue
      }
      let crosses = false
      for (let i = 0; i < loop.length && !crosses; i++) {
        const a = screenByVertex.get(loop[i])
        const b = screenByVertex.get(loop[(i + 1) % loop.length])
        if (!a || !b || !a.ok || !b.ok) continue
        crosses = region.intersectsSegment(a.x, a.y, b.x, b.y)
      }
      if (crosses) selection.faceIds.push(faceId)
    }

    /* --- Kindentitaeten --- */
    const contextPath = record.instancePath
    for (const other of this.sync.records) {
      if (other === record) continue
      if (other.instancePath.length !== contextPath.length + 1) continue
      if (!startsWith(other.instancePath, contextPath)) continue
      const entityId = other.entityId
      if (!entityId) continue
      if (this.boxInRegion(other, region, crossing)) selection.entityIds.push(entityId)
    }

    const contextDefinition = doc.definitions[record.definitionId]
    for (const childId of contextDefinition?.children ?? []) {
      const entity = doc.entities?.[childId]
      if (!entity || entity.type === 'instance' || entity.hidden) continue
      const point = entityAnchor(entity)
      if (!point) continue
      const world = M.transformPoint(record.worldTransform, point)
      const screen = this.camera.worldToScreen(world)
      if (screen.depth < -1 || screen.depth > 1) continue
      if (region.containsPoint(screen.x, screen.y)) selection.entityIds.push(entity.id)
    }

    return selection
  }

  /** Huelle einer Instanz gegen den Bildschirmbereich pruefen. */
  private boxInRegion(record: InstanceRecord, region: ScreenRegion, crossing: boolean): boolean {
    const build = this.sync.getBuild(record.definitionId)
    const bounds = build && !B.isEmpty(build.localBounds) ? record.bounds : record.bounds
    if (B.isEmpty(bounds)) return false
    const corners = B.corners(bounds)

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let allInside = true
    for (const corner of corners) {
      const screen = this.camera.worldToScreen(corner)
      if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false
      minX = Math.min(minX, screen.x)
      minY = Math.min(minY, screen.y)
      maxX = Math.max(maxX, screen.x)
      maxY = Math.max(maxY, screen.y)
      if (!region.containsPoint(screen.x, screen.y)) allInside = false
    }
    if (allInside) return true
    if (!crossing) return false
    if (maxX < region.minX || minX > region.maxX || maxY < region.minY || minY > region.maxY) return false
    return true
  }

  /* ---------------------------------------------------------------- */

  /** Datensatz des aktiven Kontexts (Modellwurzel, wenn kein Kontext offen ist). */
  contextRecord(snapshot: RenderSnapshot): InstanceRecord | null {
    const path = snapshot.context?.instancePath ?? []
    for (const record of this.sync.records) {
      if (record.instancePath.length !== path.length) continue
      if (startsWith(record.instancePath, path)) return record
    }
    return this.sync.records.length > 0 ? this.sync.records[0] : null
  }

  /** Pixeltoleranz in Modelleinheiten am Punkt `p`. */
  private worldTolerance(pixels: number, p: Vec3Like): number {
    const ppu = this.camera.pixelsPerUnit(p)
    if (!Number.isFinite(ppu) || ppu <= 1e-9) return pixels * 0.01
    return pixels / ppu
  }
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

/** Strahl in den Definitionsraum einer Instanz bringen. */
function transformRay(ray: Ray, record: InstanceRecord): Ray {
  const inverse = record.inverseMatrix
  const origin = applyMatrix(inverse, ray.origin)
  const target = applyMatrix(inverse, V.add(ray.origin, ray.dir))
  return { origin, dir: V.normalizeOr(V.sub(target, origin), ray.dir) }
}

function applyMatrix(m: { elements: number[] | Float32Array | ArrayLike<number> }, p: Vec3Like): Vec3Like {
  const e = m.elements
  const w = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15] || 1
  return {
    x: (e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12]) / w,
    y: (e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13]) / w,
    z: (e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14]) / w,
  }
}

/**
 * Bester Treffer einer Instanz. Vertex schlaegt Kante schlaegt Flaeche, solange
 * der Treffer nicht deutlich hinter der naechsten Flaeche liegt.
 */
export function pickBest(hits: LocalHit[], tolerance: number): LocalHit | null {
  let face: LocalHit | null = null
  let edge: LocalHit | null = null
  let vertex: LocalHit | null = null

  for (const hit of hits) {
    if (!hit || !Number.isFinite(hit.distance) || hit.distance < 0) continue
    if (hit.kind === 'face') {
      if (!face || hit.distance < face.distance) face = hit
    } else if (hit.kind === 'edge') {
      if (!edge || betterNear(hit, edge)) edge = hit
    } else if (!vertex || betterNear(hit, vertex)) {
      vertex = hit
    }
  }

  const limit = face ? face.distance + tolerance * 3 : Infinity
  if (vertex && vertex.distance <= limit) return vertex
  if (edge && edge.distance <= limit) return edge
  return face
}

/** Naeher am Strahl gewinnt; bei aehnlichem Abstand der naehere Treffer. */
function betterNear(candidate: LocalHit, current: LocalHit): boolean {
  if (candidate.offset < current.offset * 0.75) return true
  if (current.offset < candidate.offset * 0.75) return false
  return candidate.distance < current.distance
}

/** Bonus, damit Vertices und Kanten innerhalb der Toleranz gewinnen. */
function priorityBonus(kind: LocalHit['kind'], tolerance: number): number {
  if (kind === 'vertex') return tolerance * 4
  if (kind === 'edge') return tolerance * 2
  return 0
}

export function intersectGround(ray: Ray): Vec3Like | null {
  if (Math.abs(ray.dir.z) < 1e-9) return null
  const t = -ray.origin.z / ray.dir.z
  if (t < 0 || !Number.isFinite(t)) return null
  return V.addScaled(ray.origin, ray.dir, t)
}

function startsWith(path: readonly Id[], prefix: readonly Id[]): boolean {
  if (prefix.length > path.length) return false
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false
  return true
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Ankerpunkt einer Nicht-Instanz-Entitaet fuer die Rahmenauswahl. */
function entityAnchor(entity: SketchDocument['entities'][string]): Vec3Like | null {
  switch (entity.type) {
    case 'guidePoint':
      return entity.position
    case 'guideLine':
      return entity.origin
    case 'text':
      return entity.position
    case 'dimension':
      return V.midpoint(entity.start, entity.end)
    case 'sectionPlane':
      return V.mul(entity.plane.n, entity.plane.d)
    case 'image':
      return M.getTranslation(entity.transform)
    default:
      return null
  }
}
