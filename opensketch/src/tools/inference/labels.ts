/**
 * Deutsche Beschriftungen und Markerformen der Inferenzen.
 *
 * OWNERSHIP: Tools.
 */

import type { InferenceResult, InferenceType } from '@/shared/types'
import { AXIS_COLORS, COLORS } from '../colors'

export const INFERENCE_LABELS: Record<InferenceType, string> = {
  none: '',
  endpoint: 'Endpunkt',
  midpoint: 'Mittelpunkt',
  center: 'Mittelpunkt',
  intersection: 'Schnittpunkt',
  onEdge: 'Auf Kante',
  onFace: 'Auf Fläche',
  onPlane: 'Auf Ebene',
  onAxisX: 'Auf roter Achse',
  onAxisY: 'Auf grüner Achse',
  onAxisZ: 'Auf blauer Achse',
  parallel: 'Parallel zur Kante',
  perpendicular: 'Senkrecht zur Kante',
  tangent: 'Tangential',
  fromPoint: 'Von Punkt',
  onGuide: 'Auf Hilfslinie',
  halfCircle: 'Halbkreis',
  square: 'Quadrat',
  golden: 'Goldener Schnitt',
  equal: 'Gleiche Länge',
  extension: 'Verlängerung der Kante',
}

/** Sonderfall: Schwerpunkt einer Flaeche. */
export const LABEL_FACE_CENTER = 'Mittelpunkt der Fläche'
/** Sonderfall: Mittelpunkt eines Kreises oder Bogens. */
export const LABEL_ARC_CENTER = 'Mittelpunkt'

export const INFERENCE_COLORS: Record<InferenceType, string> = {
  none: COLORS.preview,
  endpoint: COLORS.endpoint,
  midpoint: COLORS.midpoint,
  center: COLORS.center,
  intersection: COLORS.intersection,
  onEdge: COLORS.onEdge,
  onFace: COLORS.onFace,
  onPlane: COLORS.onPlane,
  onAxisX: AXIS_COLORS.x,
  onAxisY: AXIS_COLORS.y,
  onAxisZ: AXIS_COLORS.z,
  parallel: COLORS.intersection,
  perpendicular: COLORS.intersection,
  tangent: COLORS.tangent,
  fromPoint: COLORS.guide,
  onGuide: COLORS.guide,
  halfCircle: COLORS.highlight,
  square: COLORS.highlight,
  golden: COLORS.highlight,
  equal: COLORS.highlight,
  extension: COLORS.guide,
}

export const INFERENCE_MARKERS: Record<InferenceType, InferenceResult['marker']> = {
  none: 'none',
  endpoint: 'square',
  midpoint: 'circle',
  center: 'circle',
  intersection: 'x',
  onEdge: 'square',
  onFace: 'diamond',
  onPlane: 'diamond',
  onAxisX: 'none',
  onAxisY: 'none',
  onAxisZ: 'none',
  parallel: 'cross',
  perpendicular: 'cross',
  tangent: 'circle',
  fromPoint: 'cross',
  onGuide: 'square',
  halfCircle: 'triangle',
  square: 'square',
  golden: 'triangle',
  equal: 'triangle',
  extension: 'cross',
}

export function labelFor(type: InferenceType): string {
  return INFERENCE_LABELS[type] ?? ''
}

export function colorFor(type: InferenceType): string {
  return INFERENCE_COLORS[type] ?? COLORS.preview
}

export function markerFor(type: InferenceType): InferenceResult['marker'] {
  return INFERENCE_MARKERS[type] ?? 'none'
}
