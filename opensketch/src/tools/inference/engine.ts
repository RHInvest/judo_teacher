/**
 * DIE INFERENZMASCHINE.
 *
 * Sie macht das Zeichnen in 3D mit einer 2D-Maus ueberhaupt erst moeglich.
 * Ablauf pro Mausbewegung:
 *
 *   1. Rohtreffer ueber `viewport.pick(x, y)`
 *   2. Punktinferenzen ableiten (Endpunkt > Mittelpunkt > Zentrum >
 *      Schnittpunkt > Auf Kante > Auf Flaeche), Test im Bildschirmraum
 *   3. Richtungsinferenzen relativ zum Referenzpunkt `from`
 *      (Achsen, parallel, senkrecht, Verlaengerung, tangential, von Punkt)
 *   4. Ebeneninferenz (Flaeche unter dem Cursor, sonst Boden- bzw.
 *      Blickwinkelebene durch `from`)
 *   5. Sperren (Pfeiltasten, Shift)
 *   6. Von-Punkt-Inferenz nach ~0,7 s Verweilen
 *
 * Jeder Zugriff nach aussen ist defensiv: Renderer und Store werden parallel
 * entwickelt und werfen anfangs `not implemented`.
 *
 * OWNERSHIP: Tools.
 */

import type { InferenceApi, StoreHandle, ViewportApi } from '@/shared/store-api'
import type { AppState } from '@/shared/store-api'
import type {
  Id,
  InferenceLock,
  InferenceResult,
  InferenceType,
  KeyInfo,
  OverlayApi,
  PickHit,
  PlaneLike,
  Vec3Like,
} from '@/shared/types'
import { M, P, R, V, POINT_TOL } from '@/core/math'
import { AXIS_COLORS, COLORS } from '../colors'
import {
  closestPointOnLineToPointer,
  defaultWorkPlane,
  edgeWorldPoints,
  faceWorldPlane,
  pixelsPerUnitAt,
  rayPlanePoint,
  safeOrNull,
  screenDistance,
  stateOf,
} from '../helpers'
import { axisDirections } from '../modelAxes'
import { colorFor, labelFor, markerFor, LABEL_FACE_CENTER } from './labels'
import {
  isStrongPoint,
  pickBestPoint,
  pushCandidate,
  type PointCandidate,
} from './points'
import {
  axisInferenceType,
  DIRECTION_MIN_PX,
  DIRECTION_TOL_PX,
  pickBestDirection,
  screenLineDistance,
  type DirectionCandidate,
} from './directions'

export interface InferOptions {
  from?: Vec3Like | null
  plane?: PlaneLike | null
  references?: Vec3Like[]
  lastDirection?: Vec3Like | null
  disabled?: boolean
  ignore?: Id[]
}

interface RefEdge {
  id: Id | null
  a: Vec3Like
  b: Vec3Like
  smooth: boolean
}

/** Verweildauer, nach der ein Punkt zum Referenzpunkt wird. */
const DWELL_MS = 700
/** Maximale Zahl gemerkter Referenzpunkte. */
const MAX_REFERENCE_POINTS = 4
/** Maximale Zahl gemerkter Referenzkanten. */
const MAX_REFERENCE_EDGES = 4
/** Obergrenze fuer gescannte Flaechenpunkte (Performance). */
const MAX_FACE_POINTS = 64

function emptyResult(point: Vec3Like): InferenceResult {
  return {
    point: V.clone(point),
    type: 'none',
    label: '',
    color: COLORS.preview,
    marker: 'none',
    locked: false,
    direction: null,
    plane: null,
    refEdgeId: null,
    refFaceId: null,
    refPoint: null,
    onGeometry: false,
    hit: null,
  }
}

export class InferenceEngine implements InferenceApi {
  private lock: InferenceLock = { kind: 'none' }
  private shiftLock: InferenceLock | null = null
  private shiftHeld = false
  private lockOrigin: Vec3Like | null = null

  private references: Vec3Like[] = []
  private refEdges: RefEdge[] = []

  private lastResult: InferenceResult | null = null
  private lastFrom: Vec3Like | null = null

  private dwellPoint: Vec3Like | null = null
  private dwellSince = 0

  constructor(
    private readonly store: StoreHandle,
    private readonly viewport: ViewportApi,
  ) {}

  /* ================================================================ */
  /* Oeffentliche API                                                 */
  /* ================================================================ */

  infer(x: number, y: number, opts?: InferOptions): InferenceResult {
    try {
      const result = this.compute(x, y, opts ?? {})
      this.lastResult = result
      return result
    } catch (err) {
      console.warn('[inference] Berechnung fehlgeschlagen', err)
      const fallback = emptyResult(rayPlanePoint(this.viewport, x, y, defaultWorkPlane(this.viewport, opts?.from ?? null)))
      this.lastResult = fallback
      return fallback
    }
  }

  getLock(): InferenceLock {
    return this.shiftLock ?? this.lock
  }

  setLock(lock: InferenceLock): void {
    this.lock = lock
    if (lock.kind !== 'none') {
      this.lockOrigin = this.lastFrom ?? this.lastResult?.point ?? null
    }
  }

  clearLock(): void {
    this.lock = { kind: 'none' }
    this.shiftLock = null
    this.lockOrigin = null
  }

  handleKey(key: KeyInfo, down: boolean, from: Vec3Like | null): boolean {
    if (from) this.lastFrom = from
    if (down) {
      switch (key.key) {
        case 'ArrowRight':
          this.toggleAxisLock(0, from)
          return true
        case 'ArrowLeft':
          this.toggleAxisLock(1, from)
          return true
        case 'ArrowUp':
          this.toggleAxisLock(2, from)
          return true
        case 'ArrowDown':
          this.toggleRelativeLock(from)
          return true
        case 'Shift':
          if (!this.shiftHeld) {
            this.shiftHeld = true
            this.freezeCurrent(from)
          }
          return true
        default:
          return false
      }
    }
    if (key.key === 'Shift') {
      this.shiftHeld = false
      this.shiftLock = null
      return true
    }
    return false
  }

  addReferencePoint(p: Vec3Like): void {
    if (!V.isFinite3(p)) return
    for (const r of this.references) {
      if (V.distance(r, p) < POINT_TOL * 10) return
    }
    this.references.unshift(V.clone(p))
    if (this.references.length > MAX_REFERENCE_POINTS) this.references.length = MAX_REFERENCE_POINTS
  }

  clearReferencePoints(): void {
    this.references = []
    this.refEdges = []
    this.dwellPoint = null
  }

  draw(overlay: OverlayApi, result: InferenceResult | null): void {
    if (!result || result.type === 'none') return
    try {
      const color = result.color || COLORS.preview
      if (result.marker !== 'none') {
        overlay.point(result.point, result.marker, {
          color,
          size: result.locked ? 9 : 7,
          onTop: true,
          width: 2,
        })
      }
      const guideStyle = { color, width: result.locked ? 3 : 1, dashed: true, onTop: true }
      const anchor = result.refPoint ?? this.lastFrom ?? this.lockOrigin
      if (anchor && V.distance(anchor, result.point) > 1e-7) {
        if (result.direction) overlay.guide(anchor, result.point, guideStyle)
        else overlay.line(anchor, result.point, guideStyle)
      }
      if (result.label) {
        overlay.text(result.point, result.label, {
          color,
          offsetX: 14,
          offsetY: -16,
          size: 12,
          onTop: true,
          background: 'rgba(20,20,22,0.78)',
        })
      }
    } catch (err) {
      console.warn('[inference] Zeichnen fehlgeschlagen', err)
    }
  }

  /* ================================================================ */
  /* Sperren                                                          */
  /* ================================================================ */

  private toggleAxisLock(index: 0 | 1 | 2, from: Vec3Like | null): void {
    const axisKey = index === 0 ? 'x' : index === 1 ? 'y' : 'z'
    if (this.lock.kind === 'axis' && this.lock.axis === axisKey) {
      this.clearLock()
      return
    }
    const dirs = axisDirections()
    this.lockOrigin = from ?? this.lastFrom ?? this.lastResult?.point ?? { x: 0, y: 0, z: 0 }
    this.lock = { kind: 'axis', axis: axisKey, direction: V.clone(dirs[index]) }
    this.shiftLock = null
  }

  /** Pfeil nach unten: Parallel-/Senkrecht-Sperre zur aktuellen Inferenz. */
  private toggleRelativeLock(from: Vec3Like | null): void {
    if (this.lock.kind === 'direction') {
      this.clearLock()
      return
    }
    const dir = this.lastResult?.direction
    if (!dir || V.isZero(dir)) return
    this.lockOrigin = from ?? this.lastFrom ?? this.lastResult?.point ?? null
    this.lock = {
      kind: 'direction',
      direction: V.normalize(dir),
      label: this.lastResult?.label || 'Richtung gesperrt',
    }
    this.shiftLock = null
  }

  /** Shift: friert die aktuelle Inferenz ein, solange die Taste gehalten wird. */
  private freezeCurrent(from: Vec3Like | null): void {
    const last = this.lastResult
    if (!last || last.type === 'none') return
    this.lockOrigin = from ?? this.lastFrom ?? last.refPoint ?? last.point
    if (last.direction && !V.isZero(last.direction)) {
      this.shiftLock = { kind: 'direction', direction: V.normalize(last.direction), label: last.label }
      return
    }
    if (last.plane) {
      this.shiftLock = { kind: 'plane', plane: last.plane, label: last.label }
      return
    }
    this.shiftLock = { kind: 'point', point: V.clone(last.point), label: last.label }
  }

  private applyLock(
    lock: InferenceLock,
    x: number,
    y: number,
    raw: Vec3Like,
    from: Vec3Like | null,
    hit: PickHit | null,
    state: AppState | null,
  ): InferenceResult {
    const origin = from ?? this.lockOrigin ?? raw
    if (lock.kind === 'none') {
      return { ...emptyResult(raw), hit }
    }
    if (lock.kind === 'point') {
      return {
        ...emptyResult(lock.point),
        type: 'endpoint',
        label: lock.label || labelFor('endpoint'),
        color: COLORS.endpoint,
        marker: markerFor('endpoint'),
        locked: true,
        onGeometry: true,
        hit,
      }
    }
    if (lock.kind === 'plane') {
      const point = rayPlanePoint(this.viewport, x, y, lock.plane, raw)
      const snapped = this.snapOntoPlane(state, hit, x, y, lock.plane)
      return {
        ...emptyResult(snapped?.point ?? point),
        type: 'onPlane',
        label: lock.label || labelFor('onPlane'),
        color: COLORS.onPlane,
        marker: markerFor('onPlane'),
        locked: true,
        plane: lock.plane,
        refPoint: snapped?.source ?? null,
        onGeometry: snapped !== null,
        hit,
      }
    }

    const direction = V.normalizeOr(lock.direction, V.AXIS_X)
    let point = closestPointOnLineToPointer(this.viewport, origin, direction, x, y, raw)
    let refPoint: Vec3Like | null = null

    // Ein starker Punkt in der Naehe wird auf die gesperrte Gerade projiziert.
    const candidates: PointCandidate[] = []
    this.collectPointCandidates(state, hit, x, y, candidates)
    const best = pickBestPoint(candidates)
    if (best && isStrongPoint(best.type)) {
      const projected = V.addScaled(origin, direction, V.dot(V.sub(best.point, origin), direction))
      if (screenDistance(this.viewport, projected, x, y) <= 24) {
        point = projected
        refPoint = best.point
      }
    }

    const type: InferenceType =
      lock.kind === 'axis'
        ? lock.axis === 'x'
          ? 'onAxisX'
          : lock.axis === 'y'
            ? 'onAxisY'
            : 'onAxisZ'
        : 'parallel'
    const color = lock.kind === 'axis' ? AXIS_COLORS[lock.axis] : COLORS.intersection
    return {
      ...emptyResult(point),
      type,
      label: lock.kind === 'axis' ? labelFor(type) : lock.label || labelFor('parallel'),
      color,
      marker: refPoint ? 'x' : 'none',
      locked: true,
      direction,
      refPoint,
      onGeometry: refPoint !== null,
      hit,
    }
  }

  /** Sucht einen starken Punkt und projiziert ihn auf die Ebene. */
  private snapOntoPlane(
    state: AppState | null,
    hit: PickHit | null,
    x: number,
    y: number,
    plane: PlaneLike,
  ): { point: Vec3Like; source: Vec3Like } | null {
    const candidates: PointCandidate[] = []
    this.collectPointCandidates(state, hit, x, y, candidates)
    const best = pickBestPoint(candidates)
    if (!best || !isStrongPoint(best.type)) return null
    return { point: P.projectPoint(plane, best.point), source: best.point }
  }

  /* ================================================================ */
  /* Hauptberechnung                                                  */
  /* ================================================================ */

  private compute(x: number, y: number, opts: InferOptions): InferenceResult {
    const vp = this.viewport
    const from = opts.from ?? null
    this.lastFrom = from

    const state = stateOf(this.store)
    const hit = opts.disabled
      ? null
      : safeOrNull(() => vp.pick(x, y, { tolerance: 12, ignore: opts.ignore }))
    this.rememberEdges(state, hit)

    const workPlane = opts.plane ?? this.derivePlane(state, hit, from)
    const raw = this.rawPoint(x, y, hit, workPlane, opts)

    const activeLock = this.shiftLock ?? this.lock
    if (activeLock.kind !== 'none') {
      return this.applyLock(activeLock, x, y, raw, from, hit, state)
    }

    if (opts.disabled) {
      return { ...emptyResult(raw), plane: workPlane, hit }
    }

    /* ---- 1. Punktinferenzen ---- */
    const candidates: PointCandidate[] = []
    this.collectPointCandidates(state, hit, x, y, candidates)
    const bestPoint = pickBestPoint(candidates)

    if (bestPoint && isStrongPoint(bestPoint.type)) {
      this.trackDwell(bestPoint.type, bestPoint.point)
      return this.finishResult(this.resultFromPoint(bestPoint, hit), opts)
    }

    /* ---- 2. Richtungsinferenzen ---- */
    const directions = this.collectDirections(state, hit, from, raw, workPlane, opts, x, y)
    const bestDirection = pickBestDirection(directions, DIRECTION_TOL_PX)

    if (bestDirection) {
      // Schnittpunkt: die Richtungsgerade kreuzt die Kante unter dem Cursor
      const crossing = this.directionEdgeIntersection(state, hit, bestDirection, x, y)
      if (crossing) {
        return this.finishResult(
          {
            ...emptyResult(crossing.point),
            type: 'intersection',
            label: labelFor('intersection'),
            color: COLORS.intersection,
            marker: markerFor('intersection'),
            direction: bestDirection.direction,
            refEdgeId: crossing.edgeId,
            refPoint: bestDirection.origin,
            onGeometry: true,
            hit,
          },
          opts,
        )
      }
      return this.finishResult(this.resultFromDirection(bestDirection, hit), opts)
    }

    /* ---- 3. Schwache Punktinferenzen ---- */
    if (bestPoint) {
      this.trackDwell(bestPoint.type, bestPoint.point)
      return this.finishResult(this.resultFromPoint(bestPoint, hit), opts)
    }

    /* ---- 4. Ebene ---- */
    this.dwellPoint = null
    const onGround = !hit || hit.kind === 'none' || hit.kind === 'ground'
    return this.finishResult(
      {
        ...emptyResult(raw),
        type: onGround && !opts.plane && !from ? 'onPlane' : 'onPlane',
        label: labelFor('onPlane'),
        color: COLORS.onPlane,
        marker: 'none',
        plane: workPlane,
        onGeometry: false,
        hit,
      },
      opts,
    )
  }

  /** Letzter Schliff: Ebenenzwang und Endkontrolle. */
  private finishResult(result: InferenceResult, opts: InferOptions): InferenceResult {
    if (opts.plane) {
      result.point = P.projectPoint(opts.plane, result.point)
      result.plane = opts.plane
    }
    if (!V.isFinite3(result.point)) result.point = { x: 0, y: 0, z: 0 }
    return result
  }

  private resultFromPoint(cand: PointCandidate, hit: PickHit | null): InferenceResult {
    return {
      ...emptyResult(cand.point),
      type: cand.type,
      label: cand.label ?? labelFor(cand.type),
      color: colorFor(cand.type),
      marker: markerFor(cand.type),
      plane: cand.plane ?? null,
      refEdgeId: cand.refEdgeId ?? null,
      refFaceId: cand.refFaceId ?? null,
      refPoint: cand.refPoint ?? null,
      onGeometry: cand.onGeometry,
      hit,
    }
  }

  private resultFromDirection(cand: DirectionCandidate, hit: PickHit | null): InferenceResult {
    return {
      ...emptyResult(cand.point),
      type: cand.type,
      label: cand.label ?? labelFor(cand.type),
      color: cand.color ?? colorFor(cand.type),
      marker: markerFor(cand.type),
      direction: cand.direction,
      refEdgeId: cand.refEdgeId ?? null,
      refPoint: cand.refPoint ?? cand.origin,
      onGeometry: false,
      hit,
    }
  }

  /* ================================================================ */
  /* Punktkandidaten                                                  */
  /* ================================================================ */

  private collectPointCandidates(
    state: AppState | null,
    hit: PickHit | null,
    x: number,
    y: number,
    out: PointCandidate[],
  ): void {
    if (!hit || hit.kind === 'none') return
    const vp = this.viewport
    const xf = hit.worldTransform && hit.worldTransform.length === 16 ? hit.worldTransform : M.identity()
    const def = hit.definitionId

    if (hit.kind === 'ground') return

    if (hit.kind === 'guide' && V.isFinite3(hit.point)) {
      pushCandidate(out, hit.point, 'onGuide', screenDistance(vp, hit.point, x, y))
      return
    }

    if (hit.kind === 'vertex' && hit.id && state) {
      const vertex = safeOrNull(() => state.getVertex(hit.id as Id, def ?? undefined))
      const p = vertex ? M.transformPoint(xf, vertex.p) : hit.point
      pushCandidate(out, p, 'endpoint', screenDistance(vp, p, x, y))
      if (vertex) {
        for (const edgeId of vertex.edges.slice(0, 12)) {
          const pts = edgeWorldPoints(state, edgeId, def, xf)
          if (!pts) continue
          const other = V.distance(pts[0], p) < V.distance(pts[1], p) ? pts[1] : pts[0]
          const mid = V.midpoint(pts[0], pts[1])
          pushCandidate(out, other, 'endpoint', screenDistance(vp, other, x, y), { refEdgeId: edgeId })
          pushCandidate(out, mid, 'midpoint', screenDistance(vp, mid, x, y), { refEdgeId: edgeId })
        }
      }
      return
    }

    if (hit.kind === 'vertex') {
      pushCandidate(out, hit.point, 'endpoint', screenDistance(vp, hit.point, x, y))
      return
    }

    if (hit.kind === 'edge') {
      const pts = hit.id && state ? edgeWorldPoints(state, hit.id, def, xf) : null
      if (pts) {
        const [a, b] = pts
        const mid = V.midpoint(a, b)
        pushCandidate(out, a, 'endpoint', screenDistance(vp, a, x, y), { refEdgeId: hit.id })
        pushCandidate(out, b, 'endpoint', screenDistance(vp, b, x, y), { refEdgeId: hit.id })
        pushCandidate(out, mid, 'midpoint', screenDistance(vp, mid, x, y), { refEdgeId: hit.id })
        const onEdge = R.closestPointOnSegment(a, b, hit.point).point
        pushCandidate(out, onEdge, 'onEdge', screenDistance(vp, onEdge, x, y), { refEdgeId: hit.id })
      } else if (V.isFinite3(hit.point)) {
        pushCandidate(out, hit.point, 'onEdge', screenDistance(vp, hit.point, x, y), { refEdgeId: hit.id })
      }
      return
    }

    if (hit.kind === 'face') {
      if (hit.id && state) {
        const face = safeOrNull(() => state.getFace(hit.id as Id, def ?? undefined))
        const plane = faceWorldPlane(state, hit.id, def, xf)
        if (face) {
          const loops = [face.outer, ...face.inner]
          const world: Vec3Like[] = []
          let scanned = 0
          for (const loop of loops) {
            const ring: Vec3Like[] = []
            for (const vid of loop.vertices) {
              if (scanned++ > MAX_FACE_POINTS) break
              const v = safeOrNull(() => state.getVertex(vid, def ?? undefined))
              if (v) ring.push(M.transformPoint(xf, v.p))
            }
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i]
              const b = ring[(i + 1) % ring.length]
              pushCandidate(out, a, 'endpoint', screenDistance(vp, a, x, y), { refFaceId: hit.id })
              const mid = V.midpoint(a, b)
              pushCandidate(out, mid, 'midpoint', screenDistance(vp, mid, x, y), { refFaceId: hit.id })
            }
            if (loop === face.outer) world.push(...ring)
          }
          if (world.length >= 3) {
            const center = V.centroid(world)
            pushCandidate(out, center, 'center', screenDistance(vp, center, x, y), {
              refFaceId: hit.id,
              label: LABEL_FACE_CENTER,
              plane,
            })
          }
        }
        if (V.isFinite3(hit.point)) {
          pushCandidate(out, hit.point, 'onFace', 0, { refFaceId: hit.id, plane })
        }
        return
      }
      if (V.isFinite3(hit.point)) pushCandidate(out, hit.point, 'onFace', 0, { refFaceId: hit.id })
      return
    }

    if (hit.kind === 'instance' || hit.kind === 'entity') {
      this.collectInstanceCandidates(state, hit, xf, x, y, out)
      if (V.isFinite3(hit.point)) {
        pushCandidate(out, hit.point, 'onFace', 0, { onGeometry: true })
      }
    }
  }

  /** Eckpunkte und Kantenmitten der Begrenzungsbox einer Instanz. */
  private collectInstanceCandidates(
    state: AppState | null,
    hit: PickHit,
    xf: readonly number[],
    x: number,
    y: number,
    out: PointCandidate[],
  ): void {
    if (!state || !hit.id) return
    const entity = safeOrNull(() => state.getEntity(hit.id as Id))
    if (!entity || entity.type !== 'instance') return
    const bounds = safeOrNull(() => state.getDefinitionBounds(entity.definitionId))
    if (!bounds || !V.isFinite3(bounds.min) || !V.isFinite3(bounds.max)) return
    const world = M.multiply(xf as never, entity.transform)
    const corners = [
      { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      { x: bounds.max.x, y: bounds.min.y, z: bounds.min.z },
      { x: bounds.min.x, y: bounds.max.y, z: bounds.min.z },
      { x: bounds.max.x, y: bounds.max.y, z: bounds.min.z },
      { x: bounds.min.x, y: bounds.min.y, z: bounds.max.z },
      { x: bounds.max.x, y: bounds.min.y, z: bounds.max.z },
      { x: bounds.min.x, y: bounds.max.y, z: bounds.max.z },
      { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    ].map((c) => M.transformPoint(world, c))
    for (const c of corners) {
      pushCandidate(out, c, 'endpoint', screenDistance(this.viewport, c, x, y), { refFaceId: null })
    }
    const center = V.centroid(corners)
    pushCandidate(out, center, 'center', screenDistance(this.viewport, center, x, y))
  }

  /* ================================================================ */
  /* Richtungskandidaten                                              */
  /* ================================================================ */

  private collectDirections(
    state: AppState | null,
    hit: PickHit | null,
    from: Vec3Like | null,
    raw: Vec3Like,
    workPlane: PlaneLike,
    opts: InferOptions,
    x: number,
    y: number,
  ): DirectionCandidate[] {
    const out: DirectionCandidate[] = []
    const mouse = { x, y }
    const vp = this.viewport

    const add = (
      origin: Vec3Like,
      direction: Vec3Like,
      type: InferenceType,
      extra?: { color?: string; label?: string; refEdgeId?: Id | null; refPoint?: Vec3Like | null; priority?: number },
    ): DirectionCandidate | null => {
      const dir = V.normalizeOr(direction, V.AXIS_X)
      if (V.isZero(dir)) return null
      // Bei Ebenenzwang nur Richtungen zulassen, die in der Ebene liegen.
      if (opts.plane && Math.abs(V.dot(opts.plane.n, dir)) > 0.02) return null
      const s0 = safeOrNull(() => vp.worldToScreen(origin))
      if (!s0 || !Number.isFinite(s0.x)) return null
      const world = 120 / pixelsPerUnitAt(vp, origin)
      const s1 = safeOrNull(() => vp.worldToScreen(V.addScaled(origin, dir, world)))
      if (!s1 || !Number.isFinite(s1.x)) return null
      const measured = screenLineDistance(s0, s1, mouse)
      if (!measured) return null
      if (Math.abs(measured.t) < DIRECTION_MIN_PX) return null
      if (measured.dist > DIRECTION_TOL_PX) return null
      const point = closestPointOnLineToPointer(vp, origin, dir, x, y, raw)
      const cand: DirectionCandidate = {
        type,
        point,
        direction: dir,
        origin: V.clone(origin),
        label: extra?.label,
        color: extra?.color,
        screenDist: measured.dist,
        priority: extra?.priority ?? 9,
        refEdgeId: extra?.refEdgeId ?? null,
        refPoint: extra?.refPoint ?? null,
      }
      out.push(cand)
      return cand
    }

    /* Achsen durch den Referenzpunkt */
    if (from) {
      const axes = axisDirections()
      const colors = [AXIS_COLORS.x, AXIS_COLORS.y, AXIS_COLORS.z]
      for (let i = 0; i < 3; i++) {
        const type = axisInferenceType(i as 0 | 1 | 2)
        add(from, axes[i], type, { color: colors[i], priority: 0, refPoint: from })
      }

      /* parallel / senkrecht zur letzten Richtung und zu Referenzkanten */
      const dirs: { dir: Vec3Like; id: Id | null }[] = []
      if (opts.lastDirection && !V.isZero(opts.lastDirection)) {
        dirs.push({ dir: V.normalize(opts.lastDirection), id: null })
      }
      for (const edge of this.refEdges) {
        const d = V.sub(edge.b, edge.a)
        if (!V.isZero(d)) dirs.push({ dir: V.normalize(d), id: edge.id })
      }
      for (const entry of dirs.slice(0, 4)) {
        add(from, entry.dir, 'parallel', {
          color: COLORS.intersection,
          priority: 3,
          refEdgeId: entry.id,
          refPoint: from,
        })
        let perp = V.cross(workPlane.n, entry.dir)
        if (V.isZero(perp)) perp = V.anyPerpendicular(entry.dir)
        add(from, perp, 'perpendicular', {
          color: COLORS.intersection,
          priority: 3,
          refEdgeId: entry.id,
          refPoint: from,
        })
      }
    }

    /* Verlaengerung / Tangente bekannter Kanten - braucht keinen Referenzpunkt */
    for (const edge of this.refEdges) {
      const d = V.sub(edge.b, edge.a)
      if (V.isZero(d)) continue
      const length = V.length(d)
      const dir = V.mul(d, 1 / length)
      const type: InferenceType = edge.smooth ? 'tangent' : 'extension'
      const cand = add(edge.a, dir, type, {
        color: edge.smooth ? COLORS.tangent : COLORS.guide,
        priority: 2,
        refEdgeId: edge.id,
        refPoint: edge.b,
      })
      if (cand) {
        // Nur ausserhalb der Kante ist es wirklich eine Verlaengerung.
        const t = V.dot(V.sub(cand.point, edge.a), dir)
        if (t > -0.001 && t < length + 0.001) out.pop()
      }
    }

    /* Von-Punkt-Inferenzen: Achsen durch gemerkte Referenzpunkte */
    const referencePoints = [...this.references, ...(opts.references ?? [])]
    const axes = axisDirections()
    const colors = [AXIS_COLORS.x, AXIS_COLORS.y, AXIS_COLORS.z]
    for (const ref of referencePoints.slice(0, MAX_REFERENCE_POINTS)) {
      if (from && V.distance(ref, from) < POINT_TOL * 10) continue
      for (let i = 0; i < 3; i++) {
        add(ref, axes[i], 'fromPoint', {
          color: colors[i],
          label: labelFor('fromPoint'),
          priority: 1,
          refPoint: ref,
        })
      }
    }

    return out
  }

  /** Schnittpunkt einer Richtungsgeraden mit der Kante unter dem Cursor. */
  private directionEdgeIntersection(
    state: AppState | null,
    hit: PickHit | null,
    dir: DirectionCandidate,
    x: number,
    y: number,
  ): { point: Vec3Like; edgeId: Id | null } | null {
    if (!state || !hit || hit.kind !== 'edge' || !hit.id) return null
    const xf = hit.worldTransform && hit.worldTransform.length === 16 ? hit.worldTransform : M.identity()
    const pts = edgeWorldPoints(state, hit.id, hit.definitionId, xf)
    if (!pts) return null
    const [a, b] = pts
    const ab = V.sub(b, a)
    if (V.isZero(ab)) return null
    const res = R.closestPointsBetweenLines(dir.origin, dir.direction, a, ab)
    if (!res) return null
    if (res.t2 < -0.001 || res.t2 > 1.001) return null
    if (V.distance(res.point1, res.point2) > V.length(ab) * 0.02 + POINT_TOL) return null
    const point = res.point2
    if (screenDistance(this.viewport, point, x, y) > 12) return null
    return { point, edgeId: hit.id }
  }

  /* ================================================================ */
  /* Zustandspflege                                                   */
  /* ================================================================ */

  private rememberEdges(state: AppState | null, hit: PickHit | null): void {
    if (!state || !hit || !hit.id) return
    const xf = hit.worldTransform && hit.worldTransform.length === 16 ? hit.worldTransform : M.identity()
    if (hit.kind !== 'edge') return
    const pts = edgeWorldPoints(state, hit.id, hit.definitionId, xf)
    if (!pts) return
    const edge = safeOrNull(() => state.getEdge(hit.id as Id, hit.definitionId ?? undefined))
    const entry: RefEdge = {
      id: hit.id,
      a: pts[0],
      b: pts[1],
      smooth: Boolean(edge?.smooth || edge?.soft),
    }
    this.refEdges = [entry, ...this.refEdges.filter((e) => e.id !== entry.id)]
    if (this.refEdges.length > MAX_REFERENCE_EDGES) this.refEdges.length = MAX_REFERENCE_EDGES
  }

  /** Verweilt der Cursor lange genug auf einem starken Punkt, wird er gemerkt. */
  private trackDwell(type: InferenceType, point: Vec3Like): void {
    if (type !== 'endpoint' && type !== 'midpoint' && type !== 'center') {
      this.dwellPoint = null
      return
    }
    const now = Date.now()
    if (this.dwellPoint && V.distance(this.dwellPoint, point) < POINT_TOL * 10) {
      if (now - this.dwellSince >= DWELL_MS) {
        this.addReferencePoint(point)
        this.dwellSince = now
      }
      return
    }
    this.dwellPoint = V.clone(point)
    this.dwellSince = now
  }

  private derivePlane(state: AppState | null, hit: PickHit | null, from: Vec3Like | null): PlaneLike {
    if (hit && hit.kind === 'face' && hit.id && state) {
      const xf = hit.worldTransform && hit.worldTransform.length === 16 ? hit.worldTransform : M.identity()
      const plane = faceWorldPlane(state, hit.id, hit.definitionId, xf)
      if (plane) return plane
    }
    if (hit && hit.normal && V.isFinite3(hit.normal) && !V.isZero(hit.normal) && V.isFinite3(hit.point)) {
      if (hit.kind === 'face' || hit.kind === 'instance') return P.fromNormalAndPoint(hit.normal, hit.point)
    }
    return defaultWorkPlane(this.viewport, from)
  }

  private rawPoint(x: number, y: number, hit: PickHit | null, plane: PlaneLike, opts: InferOptions): Vec3Like {
    if (opts.plane) return rayPlanePoint(this.viewport, x, y, opts.plane, hit?.point)
    if (hit && hit.kind !== 'none' && V.isFinite3(hit.point)) return V.clone(hit.point)
    return rayPlanePoint(this.viewport, x, y, plane, null)
  }
}
