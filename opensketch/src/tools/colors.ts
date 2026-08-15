/**
 * Farbpalette der Werkzeugschicht.
 *
 * Die Achsenfarben sind verbindlich (rot/gruen/blau wie in SketchUp), alle
 * uebrigen Farben werden nur fuer Overlay-Feedback benutzt.
 *
 * OWNERSHIP: Tools.
 */

export const AXIS_COLORS = {
  x: '#d93b3b',
  y: '#2fa84f',
  z: '#2f6fd0',
} as const

export type AxisKey = keyof typeof AXIS_COLORS

/** Marker- und Hilfslinienfarben der Inferenzmaschine. */
export const COLORS = {
  endpoint: '#2fa84f',
  midpoint: '#66d9ef',
  center: '#66d9ef',
  intersection: '#e24fe2',
  onEdge: '#d93b3b',
  onFace: '#2f6fd0',
  onPlane: '#7fa8e8',
  guide: '#9aa0a6',
  tangent: '#e24fe2',
  /** Gummiband / Vorschau ohne besondere Inferenz */
  preview: '#e8e8e8',
  previewFill: '#5b8dd9',
  selection: '#3b82f6',
  highlight: '#f2c14e',
  warn: '#e8a33d',
  neutral: '#c8c8c8',
  erase: '#e05252',
} as const

export function axisColor(axis: AxisKey): string {
  return AXIS_COLORS[axis]
}
