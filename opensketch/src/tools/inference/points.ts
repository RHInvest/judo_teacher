/**
 * Punktinferenzen: Kandidaten, Prioritaeten, Auswahl.
 *
 * Diese Datei ist bewusst REIN (keine Viewport-/Store-Zugriffe), damit die
 * Priorisierung - das Herz des SketchUp-Gefuehls - direkt testbar ist.
 *
 * Prioritaet (hoch nach niedrig):
 *   endpoint > midpoint > center > intersection > onGuide > onEdge > onFace > onPlane
 *
 * OWNERSHIP: Tools.
 */

import type { Id, InferenceType, PlaneLike, Vec3Like } from '@/shared/types'

export interface PointCandidate {
  point: Vec3Like
  type: InferenceType
  /** abweichende Beschriftung (z.B. "Mittelpunkt der Fläche") */
  label?: string
  /** Abstand zum Cursor in Bildschirmpixeln */
  screenDist: number
  /** Fangradius in Bildschirmpixeln */
  radius: number
  refEdgeId?: Id | null
  refFaceId?: Id | null
  refPoint?: Vec3Like | null
  plane?: PlaneLike | null
  onGeometry: boolean
}

/** Fangradien in Bildschirmpixeln. */
export const SNAP_RADIUS: Record<string, number> = {
  endpoint: 10,
  midpoint: 8,
  center: 9,
  intersection: 8,
  onGuide: 8,
  onEdge: 7,
  onFace: Number.POSITIVE_INFINITY,
  onPlane: Number.POSITIVE_INFINITY,
}

const PRIORITY: Partial<Record<InferenceType, number>> = {
  endpoint: 0,
  midpoint: 1,
  center: 2,
  intersection: 3,
  onGuide: 4,
  onEdge: 5,
  onFace: 6,
  onPlane: 7,
  none: 99,
}

/** Kleinere Zahl = wichtiger. Unbekannte Typen landen hinten. */
export function pointPriority(type: InferenceType): number {
  const p = PRIORITY[type]
  return p === undefined ? 90 : p
}

/** True fuer die "starken" Punkte, die jede Richtungsinferenz schlagen. */
export function isStrongPoint(type: InferenceType): boolean {
  return pointPriority(type) <= pointPriority('intersection')
}

/**
 * True fuer Punkte, die auf ECHTER Geometrie mit einem eigenen Fangradius
 * liegen: die starken Punkte plus "Auf Hilfslinie" und "Auf Kante".
 *
 * Diese Punkte duerfen eine Richtungsinferenz schlagen, wenn sie naeher am
 * Cursor liegen - der Nutzer zeigt sichtbar auf vorhandene Geometrie, und die
 * darf nicht von einer unsichtbaren Achsengeraden ueberstimmt werden.
 * `onFace` und `onPlane` gehoeren NICHT dazu: die haben einen unendlichen
 * Fangradius und wuerden jede Richtungsinferenz auf einer Flaeche ausschalten.
 */
export function isGeometryPoint(type: InferenceType): boolean {
  return pointPriority(type) <= pointPriority('onEdge')
}

export function snapRadiusFor(type: InferenceType): number {
  const r = SNAP_RADIUS[type]
  return r === undefined ? 7 : r
}

/**
 * Waehlt den besten Kandidaten: erst nach Prioritaet, bei gleicher Prioritaet
 * nach Bildschirmabstand. Kandidaten ausserhalb ihres Fangradius fallen raus.
 */
export function pickBestPoint(candidates: readonly PointCandidate[]): PointCandidate | null {
  let best: PointCandidate | null = null
  let bestPriority = Number.POSITIVE_INFINITY
  for (const cand of candidates) {
    if (!(cand.screenDist <= cand.radius)) continue
    const priority = pointPriority(cand.type)
    if (best === null || priority < bestPriority || (priority === bestPriority && cand.screenDist < best.screenDist)) {
      best = cand
      bestPriority = priority
    }
  }
  return best
}

/** Fuegt einen Kandidaten hinzu, wenn er innerhalb seines Radius liegt. */
export function pushCandidate(
  out: PointCandidate[],
  point: Vec3Like,
  type: InferenceType,
  screenDist: number,
  extra?: Partial<PointCandidate>,
): void {
  if (!Number.isFinite(screenDist)) return
  const radius = extra?.radius ?? snapRadiusFor(type)
  if (screenDist > radius) return
  out.push({
    point,
    type,
    screenDist,
    radius,
    onGeometry: extra?.onGeometry ?? true,
    label: extra?.label,
    refEdgeId: extra?.refEdgeId ?? null,
    refFaceId: extra?.refFaceId ?? null,
    refPoint: extra?.refPoint ?? null,
    plane: extra?.plane ?? null,
  })
}
