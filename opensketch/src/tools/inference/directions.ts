/**
 * Richtungsinferenzen: Achsen, parallel, senkrecht, Verlaengerung, tangential
 * und "von Punkt".
 *
 * Der Test laeuft im BILDSCHIRMRAUM: eine Richtung faengt, wenn der Cursor
 * nahe genug an der projizierten Geraden liegt. Das ist der einzige Weg, der
 * sich unabhaengig von Zoom und Blickwinkel gleich anfuehlt.
 *
 * OWNERSHIP: Tools.
 */

import type { Id, InferenceType, Vec2Like, Vec3Like } from '@/shared/types'

export interface DirectionCandidate {
  type: InferenceType
  /** Weltpunkt auf der Geraden, der dem Mausstrahl am naechsten liegt */
  point: Vec3Like
  /** normierte Richtung der Geraden */
  direction: Vec3Like
  /** Ursprung der Geraden (Startpunkt der gepunkteten Hilfslinie) */
  origin: Vec3Like
  label?: string
  color?: string
  screenDist: number
  priority: number
  refEdgeId?: Id | null
  refPoint?: Vec3Like | null
}

/** Fangbreite einer Richtung in Bildschirmpixeln. */
export const DIRECTION_TOL_PX = 7
/** Mindestabstand vom Ursprung, damit eine Richtung ueberhaupt Sinn ergibt. */
export const DIRECTION_MIN_PX = 8

const PRIORITY: Partial<Record<InferenceType, number>> = {
  onAxisX: 0,
  onAxisY: 0,
  onAxisZ: 0,
  fromPoint: 1,
  tangent: 2,
  extension: 2,
  perpendicular: 3,
  parallel: 3,
}

export function directionPriority(type: InferenceType): number {
  const p = PRIORITY[type]
  return p === undefined ? 9 : p
}

/**
 * Abstand des Cursors zur projizierten Geraden.
 * `origin` und `along` sind Bildschirmpunkte: der Geradenursprung und ein
 * zweiter Punkt auf der Geraden.
 * Liefert null, wenn die Gerade zur Kamera zeigt (Projektion entartet).
 */
export function screenLineDistance(
  origin: Vec2Like,
  along: Vec2Like,
  mouse: Vec2Like,
  opts?: { bothSides?: boolean; minLength?: number },
): { dist: number; t: number } | null {
  const dx = along.x - origin.x
  const dy = along.y - origin.y
  const len = Math.hypot(dx, dy)
  if (!Number.isFinite(len) || len < (opts?.minLength ?? 4)) return null
  const ux = dx / len
  const uy = dy / len
  const mx = mouse.x - origin.x
  const my = mouse.y - origin.y
  const t = mx * ux + my * uy
  if (!(opts?.bothSides ?? true) && t < 0) return null
  const px = ux * t
  const py = uy * t
  return { dist: Math.hypot(mx - px, my - py), t }
}

/**
 * Waehlt die beste Richtung: erst Prioritaet (Achsen zuerst), dann
 * Bildschirmabstand.
 */
export function pickBestDirection(
  candidates: readonly DirectionCandidate[],
  tolerance = DIRECTION_TOL_PX,
): DirectionCandidate | null {
  let best: DirectionCandidate | null = null
  for (const cand of candidates) {
    if (!(cand.screenDist <= tolerance)) continue
    if (
      best === null ||
      cand.priority < best.priority ||
      (cand.priority === best.priority && cand.screenDist < best.screenDist)
    ) {
      best = cand
    }
  }
  return best
}

/** Achsentyp aus dem Achsindex (0 = rot, 1 = gruen, 2 = blau). */
export function axisInferenceType(index: 0 | 1 | 2): InferenceType {
  return index === 0 ? 'onAxisX' : index === 1 ? 'onAxisY' : 'onAxisZ'
}
