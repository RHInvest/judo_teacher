/**
 * Modellachsen.
 *
 * Das Dokument-Schema kennt (noch) keine Achsen, das Achsenwerkzeug muss sie
 * aber setzen koennen und die Inferenzmaschine muss sie benutzen. Deshalb
 * liegen sie hier als Sitzungszustand der Werkzeugschicht.
 *
 * OWNERSHIP: Tools.
 */

import type { Vec3Like } from '@/shared/types'
import { V } from '@/core/math'

export interface ModelAxes {
  origin: Vec3Like
  x: Vec3Like
  y: Vec3Like
  z: Vec3Like
  /** false = Weltachsen (Standard) */
  custom: boolean
}

const WORLD_AXES: ModelAxes = {
  origin: { x: 0, y: 0, z: 0 },
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
  custom: false,
}

let current: ModelAxes = { ...WORLD_AXES }

export function getModelAxes(): ModelAxes {
  return current
}

/** Setzt die Achsen aus Ursprung + roter + gruener Richtung (orthonormalisiert). */
export function setModelAxes(origin: Vec3Like, xDir: Vec3Like, yDir: Vec3Like): ModelAxes {
  const x = V.normalizeOr(xDir, V.AXIS_X)
  let z = V.cross(x, yDir)
  if (V.isZero(z)) z = V.anyPerpendicular(x)
  z = V.normalize(z)
  const y = V.normalize(V.cross(z, x))
  current = { origin: V.clone(origin), x, y, z, custom: true }
  return current
}

export function resetModelAxes(): ModelAxes {
  current = { ...WORLD_AXES }
  return current
}

/** Die drei Achsrichtungen in fester Reihenfolge (rot, gruen, blau). */
export function axisDirections(): [Vec3Like, Vec3Like, Vec3Like] {
  const a = current
  return [a.x, a.y, a.z]
}
