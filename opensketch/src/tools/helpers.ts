/**
 * Gemeinsame Hilfsfunktionen aller Werkzeuge.
 *
 * WICHTIG: Kernel, Store und Renderer werden parallel entwickelt und werfen
 * anfangs `not implemented`. Deshalb geht JEDER Zugriff nach aussen durch
 * `safe()` / `runOperation()` - ein fehlendes Modul darf die App nie
 * abstuerzen lassen.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState, StoreHandle, ViewportApi } from '@/shared/store-api'
import type {
  Cursor,
  Geometry,
  Id,
  InferenceResult,
  Mat4Like,
  OverlayStyle,
  PickHit,
  PlaneLike,
  Selection,
  UnitSettings,
  Vec3Like,
} from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { DEFAULT_UNITS, parseLength } from '@/shared/units'
import { M, P, R, V } from '@/core/math'
import { COLORS } from './colors'

/* ------------------------------------------------------------------ */
/* Defensive Aufrufe                                                   */
/* ------------------------------------------------------------------ */

export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function safeOrNull<T>(fn: () => T): T | null {
  try {
    const value = fn()
    return value === undefined ? null : value
  } catch {
    return null
  }
}

export function stateOf(store: StoreHandle): AppState | null {
  return safeOrNull(() => store.getState())
}

export function unitsOf(store: StoreHandle): UnitSettings {
  const state = stateOf(store)
  const units = state?.doc?.units
  return units ?? DEFAULT_UNITS
}

/**
 * Fuehrt eine Modelloperation aus. Fehler werden protokolliert und die
 * Operation abgebrochen - das Werkzeug bleibt benutzbar.
 */
export function runOperation<T>(store: StoreHandle, name: string, fn: () => T): T | null {
  const state = stateOf(store)
  if (!state) {
    console.warn(`[tools] Operation "${name}" nicht moeglich: Store nicht verfuegbar`)
    return null
  }
  try {
    return state.operation(name, fn)
  } catch (err) {
    console.warn(`[tools] Operation "${name}" fehlgeschlagen`, err)
    try {
      store.getState().abortOperation()
    } catch {
      /* Operation war nie offen - egal */
    }
    return null
  }
}

export function toast(
  store: StoreHandle,
  text: string,
  kind: 'info' | 'warn' | 'error' | 'success' = 'info',
): void {
  const state = stateOf(store)
  try {
    state?.toast(text, kind)
  } catch {
    console.info(`[tools] ${text}`)
  }
}

/**
 * Laenge mit Vorzeichen.
 *
 * `parseLength` liest je nach Eingabeform nicht jedes Minus mit; Werkzeuge wie
 * Druecken/Ziehen und Versatz brauchen aber ein verlaessliches Vorzeichen
 * ("2 m in die Gegenrichtung"). Deshalb wird das Minus hier abgetrennt und
 * hinterher wieder angesetzt.
 */
export function parseSignedLength(text: string, units: UnitSettings): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const negative = trimmed.startsWith('-')
  const body = negative ? trimmed.slice(1).trim() : trimmed
  const value = parseLength(body, units)
  if (value === null || !Number.isFinite(value)) return null
  return negative ? -Math.abs(value) : value
}

/* ------------------------------------------------------------------ */
/* Geometriezugriff                                                    */
/* ------------------------------------------------------------------ */

export function activeGeometry(store: StoreHandle): Geometry | null {
  const state = stateOf(store)
  if (!state) return null
  return safeOrNull(() => state.getActiveGeometry())
}

export function contextTransform(store: StoreHandle): Mat4Like {
  const state = stateOf(store)
  const xf = state?.context?.worldTransform
  return xf && xf.length === 16 ? xf : M.identity()
}

/** Weltpunkte einer Kante innerhalb einer beliebigen Definition. */
export function edgeWorldPoints(
  state: AppState,
  edgeId: Id,
  definitionId: Id | null,
  worldTransform: Mat4Like,
): [Vec3Like, Vec3Like] | null {
  const edge = safeOrNull(() => state.getEdge(edgeId, definitionId ?? undefined))
  if (!edge) return null
  const va = safeOrNull(() => state.getVertex(edge.a, definitionId ?? undefined))
  const vb = safeOrNull(() => state.getVertex(edge.b, definitionId ?? undefined))
  if (!va || !vb) return null
  return [M.transformPoint(worldTransform, va.p), M.transformPoint(worldTransform, vb.p)]
}

/** Weltpunkte der Aussenschleife einer Flaeche. */
export function faceWorldPoints(
  state: AppState,
  faceId: Id,
  definitionId: Id | null,
  worldTransform: Mat4Like,
): Vec3Like[] {
  const face = safeOrNull(() => state.getFace(faceId, definitionId ?? undefined))
  if (!face) return []
  const out: Vec3Like[] = []
  for (const vid of face.outer.vertices) {
    const v = safeOrNull(() => state.getVertex(vid, definitionId ?? undefined))
    if (v) out.push(M.transformPoint(worldTransform, v.p))
  }
  return out
}

export function faceWorldPlane(
  state: AppState,
  faceId: Id,
  definitionId: Id | null,
  worldTransform: Mat4Like,
): PlaneLike | null {
  const points = faceWorldPoints(state, faceId, definitionId, worldTransform)
  if (points.length >= 3) {
    const plane = P.fromPolygon(points)
    if (plane) return plane
  }
  const face = safeOrNull(() => state.getFace(faceId, definitionId ?? undefined))
  if (!face) return null
  const n = M.transformNormal(worldTransform, face.normal)
  const origin = M.transformPoint(worldTransform, V.mul(face.plane.n, face.plane.d))
  return P.fromNormalAndPoint(n, origin)
}

/* ------------------------------------------------------------------ */
/* Auswahl                                                             */
/* ------------------------------------------------------------------ */

export function selectionFromHit(hit: PickHit | null): Selection {
  const sel = emptySelection()
  if (!hit || hit.kind === 'none' || hit.kind === 'ground') return sel
  if (hit.inContext && hit.id) {
    if (hit.kind === 'edge') sel.edgeIds.push(hit.id)
    else if (hit.kind === 'face') sel.faceIds.push(hit.id)
    else if (hit.kind === 'vertex') sel.vertexIds.push(hit.id)
    else if (hit.kind === 'entity' || hit.kind === 'instance' || hit.kind === 'guide') sel.entityIds.push(hit.id)
    return sel
  }
  if (hit.topInstanceId) sel.entityIds.push(hit.topInstanceId)
  else if (hit.id && (hit.kind === 'entity' || hit.kind === 'instance' || hit.kind === 'guide')) sel.entityIds.push(hit.id)
  return sel
}

export function selectionIsEmptySafe(sel: Selection | null | undefined): boolean {
  if (!sel) return true
  return (
    sel.edgeIds.length === 0 &&
    sel.faceIds.length === 0 &&
    sel.vertexIds.length === 0 &&
    sel.entityIds.length === 0
  )
}

export function cloneSelection(sel: Selection): Selection {
  return {
    edgeIds: [...sel.edgeIds],
    faceIds: [...sel.faceIds],
    vertexIds: [...sel.vertexIds],
    entityIds: [...sel.entityIds],
  }
}

/* ------------------------------------------------------------------ */
/* Bildschirm- und Ebenenmathematik                                    */
/* ------------------------------------------------------------------ */

/** Bildschirmabstand eines Weltpunkts zum Cursor; Infinity wenn nicht sichtbar. */
export function screenDistance(vp: ViewportApi, p: Vec3Like, x: number, y: number): number {
  const s = safeOrNull(() => vp.worldToScreen(p))
  if (!s || s.visible === false || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return Infinity
  return Math.hypot(s.x - x, s.y - y)
}

export function pixelsPerUnitAt(vp: ViewportApi, p: Vec3Like): number {
  const ppu = safe(() => vp.pixelsPerUnit(p), 0)
  return Number.isFinite(ppu) && ppu > 1e-9 ? ppu : 100
}

/** Blickrichtung der Kamera (normiert). */
export function viewDirection(vp: ViewportApi): Vec3Like {
  const cam = safeOrNull(() => vp.getCamera())
  if (!cam) return { x: 0, y: 1, z: -0.5 }
  const d = V.sub(cam.target, cam.eye)
  return V.isZero(d) ? { x: 0, y: 1, z: -0.5 } : V.normalize(d)
}

export const GROUND_PLANE: PlaneLike = { n: { x: 0, y: 0, z: 1 }, d: 0 }

/**
 * SketchUp-Logik fuer die Zeichenebene ohne Flaeche unter dem Cursor:
 *  - ohne Referenzpunkt: Bodenebene
 *  - mit Referenzpunkt: die Ebene durch den Punkt, deren Normale der
 *    Blickrichtung am naechsten liegt (enthaelt also die beiden Achsen, die
 *    dem Blickwinkel am naechsten sind).
 */
export function defaultWorkPlane(vp: ViewportApi, from: Vec3Like | null): PlaneLike {
  if (!from) return GROUND_PLANE
  const dir = viewDirection(vp)
  const axis = V.dominantAxis(dir)
  const n = axis === 0 ? V.AXIS_X : axis === 1 ? V.AXIS_Y : V.AXIS_Z
  return P.fromNormalAndPoint(n, from)
}

/** Strahl/Ebenen-Schnitt mit Fallback auf einen Punkt vor der Kamera. */
export function rayPlanePoint(
  vp: ViewportApi,
  x: number,
  y: number,
  plane: PlaneLike,
  fallback?: Vec3Like | null,
): Vec3Like {
  const ray = safeOrNull(() => vp.screenToRay(x, y))
  if (!ray) return fallback ? V.clone(fallback) : V.v3()
  const hit = P.intersectRayPoint(plane, ray.origin, ray.dir)
  if (hit && V.isFinite3(hit)) {
    const t = V.dot(V.sub(hit, ray.origin), ray.dir)
    if (t > 0) return hit
  }
  const ground = safeOrNull(() => vp.groundHit(x, y))
  if (ground) return ground
  return fallback ? V.clone(fallback) : V.addScaled(ray.origin, ray.dir, 10)
}

/** Punkt auf der Geraden (origin, dir), der dem Mausstrahl am naechsten liegt. */
export function closestPointOnLineToPointer(
  vp: ViewportApi,
  origin: Vec3Like,
  dir: Vec3Like,
  x: number,
  y: number,
  fallback: Vec3Like,
): Vec3Like {
  const ray = safeOrNull(() => vp.screenToRay(x, y))
  const d = V.normalizeOr(dir, V.AXIS_X)
  if (!ray) return V.addScaled(origin, d, V.dot(V.sub(fallback, origin), d))
  const res = R.closestPointsBetweenLines(origin, d, ray.origin, ray.dir)
  if (!res || !V.isFinite3(res.point1)) {
    return V.addScaled(origin, d, V.dot(V.sub(fallback, origin), d))
  }
  return res.point1
}

/** Projiziert einen Punkt auf die Gerade durch `origin` mit Richtung `dir`. */
export function projectOnLine(origin: Vec3Like, dir: Vec3Like, p: Vec3Like): Vec3Like {
  const d = V.normalizeOr(dir, V.AXIS_X)
  return V.addScaled(origin, d, V.dot(V.sub(p, origin), d))
}

/* ------------------------------------------------------------------ */
/* Overlay-Stile                                                       */
/* ------------------------------------------------------------------ */

/** Stil des Gummibands passend zur aktuellen Inferenz. */
export function rubberStyle(inf: InferenceResult | null): OverlayStyle {
  if (!inf || inf.type === 'none') {
    return { color: COLORS.preview, width: 2, onTop: true }
  }
  const directional =
    inf.type === 'onAxisX' ||
    inf.type === 'onAxisY' ||
    inf.type === 'onAxisZ' ||
    inf.type === 'parallel' ||
    inf.type === 'perpendicular' ||
    inf.type === 'extension' ||
    inf.type === 'tangent' ||
    inf.type === 'fromPoint'
  if (!directional) return { color: COLORS.preview, width: 2, onTop: true }
  return { color: inf.color, width: inf.locked ? 4 : 2.5, onTop: true }
}

export const PREVIEW_STYLE: OverlayStyle = { color: COLORS.preview, width: 2, onTop: true }
export const GHOST_STYLE: OverlayStyle = { color: COLORS.previewFill, opacity: 0.35, onTop: false }
export const GUIDE_STYLE: OverlayStyle = { color: COLORS.guide, width: 1, dashed: true, onTop: true }

/* ------------------------------------------------------------------ */
/* Diverses                                                            */
/* ------------------------------------------------------------------ */

export function clampInt(value: number, lo: number, hi: number): number {
  const v = Math.round(value)
  return v < lo ? lo : v > hi ? hi : v
}

export function setCursorSafe(vp: ViewportApi, cursor: Cursor): void {
  try {
    vp.setCursor(cursor)
  } catch {
    /* Renderer noch nicht bereit */
  }
}

/** Entfernt aufeinanderfolgende Duplikate aus einem Punktzug. */
export function dedupePoints(points: readonly Vec3Like[], tol = 1e-6): Vec3Like[] {
  const out: Vec3Like[] = []
  for (const p of points) {
    if (out.length === 0 || V.distance(out[out.length - 1], p) > tol) out.push(V.clone(p))
  }
  return out
}
