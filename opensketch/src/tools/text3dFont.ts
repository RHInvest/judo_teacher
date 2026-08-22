/**
 * Eingebauter Strichzeichensatz fuer das Werkzeug `text3d`: die STRICHE.
 *
 * Keine Schriftdatei, keine Abhaengigkeit: jedes Zeichen ist eine Liste von
 * Strichen in einem Einheitsquadrat (x, y jeweils 0..1, Grundlinie bei y = 0,
 * Versalhoehe bei y = 1). Jeder Strich wird zu einem geschlossenen RECHTECK
 * aufgedickt - daraus entstehen fuellbare und extrudierbare Flaechen. Das
 * Ergebnis sieht blockig aus wie eine Schablone; genau das ist beabsichtigt.
 *
 * WELCHE Zeichen es gibt und worauf Umlaute, Akzente und Kleinbuchstaben
 * abgebildet werden, steht NICHT hier, sondern in `@/shared/text3d` - die
 * Oberflaeche zeigt daraus die Dialogvorschau, dieses Modul baut daraus die
 * Geometrie. Eine Tabelle, zwei Verwender, keine zweite Wahrheit.
 *
 * Fuer jedes Zeichen aus `TEXT3D_GLYPHS` muss hier ein Eintrag stehen; ein
 * Test in `__tests__/text3d.test.ts` prueft das ab.
 *
 * OWNERSHIP: Tools.
 */

import { mapText3d } from '@/shared/text3d'

/** Ein Strich: x0, y0, x1, y1 im Einheitsquadrat des Zeichens. */
export type Stroke = readonly [number, number, number, number]

/* ------------------------------------------------------------------ */
/* Die Striche                                                         */
/* ------------------------------------------------------------------ */

/* eslint-disable prettier/prettier */
export const TEXT3D_STROKES: Record<string, readonly Stroke[]> = {
  A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.18, 0.34, 0.82, 0.34]],
  B: [[0, 0, 0, 1], [0, 1, 0.8, 1], [0.8, 1, 0.8, 0.55], [0, 0.55, 0.8, 0.55], [0.8, 0.55, 0.8, 0], [0, 0, 0.8, 0]],
  C: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0]],
  D: [[0, 0, 0, 1], [0, 1, 0.7, 1], [0.7, 1, 1, 0.7], [1, 0.7, 1, 0.3], [1, 0.3, 0.7, 0], [0.7, 0, 0, 0]],
  E: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.8, 0.5], [0, 0, 1, 0]],
  F: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.8, 0.5]],
  G: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0.45], [1, 0.45, 0.5, 0.45]],
  H: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]],
  I: [[0.5, 0, 0.5, 1], [0.15, 1, 0.85, 1], [0.15, 0, 0.85, 0]],
  J: [[0.85, 1, 0.85, 0.2], [0.85, 0.2, 0.45, 0], [0.45, 0, 0.05, 0.25]],
  K: [[0, 0, 0, 1], [1, 1, 0, 0.45], [0, 0.45, 1, 0]],
  L: [[0, 1, 0, 0], [0, 0, 1, 0]],
  M: [[0, 0, 0, 1], [0, 1, 0.5, 0.4], [0.5, 0.4, 1, 1], [1, 1, 1, 0]],
  N: [[0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 1]],
  O: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0]],
  P: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5]],
  Q: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0], [0.6, 0.35, 1.05, -0.05]],
  R: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5], [0.45, 0.5, 1, 0]],
  S: [[1, 1, 0, 1], [0, 1, 0, 0.55], [0, 0.55, 1, 0.55], [1, 0.55, 1, 0], [1, 0, 0, 0]],
  T: [[0, 1, 1, 1], [0.5, 1, 0.5, 0]],
  U: [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 1]],
  V: [[0, 1, 0.5, 0], [0.5, 0, 1, 1]],
  W: [[0, 1, 0.25, 0], [0.25, 0, 0.5, 0.6], [0.5, 0.6, 0.75, 0], [0.75, 0, 1, 1]],
  X: [[0, 0, 1, 1], [0, 1, 1, 0]],
  Y: [[0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0]],
  Z: [[0, 1, 1, 1], [1, 1, 0, 0], [0, 0, 1, 0]],

  0: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0], [0, 0, 1, 1]],
  1: [[0.15, 0.78, 0.5, 1], [0.5, 1, 0.5, 0], [0.15, 0, 0.85, 0]],
  2: [[0, 1, 1, 1], [1, 1, 1, 0.55], [1, 0.55, 0, 0], [0, 0, 1, 0]],
  3: [[0, 1, 1, 1], [1, 1, 1, 0.55], [1, 0.55, 0.3, 0.55], [1, 0.55, 1, 0], [1, 0, 0, 0]],
  4: [[0, 1, 0, 0.4], [0, 0.4, 1, 0.4], [0.78, 1, 0.78, 0]],
  5: [[1, 1, 0, 1], [0, 1, 0, 0.55], [0, 0.55, 1, 0.55], [1, 0.55, 1, 0], [1, 0, 0, 0]],
  6: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0.5], [1, 0.5, 0, 0.5]],
  7: [[0, 1, 1, 1], [1, 1, 0.3, 0]],
  8: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0], [0, 0.5, 1, 0.5]],
  9: [[1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5]],

  '.': [[0.42, 0, 0.58, 0]],
  ',': [[0.52, 0.12, 0.36, -0.16]],
  ':': [[0.42, 0.62, 0.58, 0.62], [0.42, 0.14, 0.58, 0.14]],
  ';': [[0.42, 0.62, 0.58, 0.62], [0.52, 0.12, 0.36, -0.16]],
  '!': [[0.5, 1, 0.5, 0.28], [0.5, 0.02, 0.5, 0.1]],
  '?': [[0, 0.78, 0.22, 1], [0.22, 1, 0.78, 1], [0.78, 1, 1, 0.78], [1, 0.78, 0.5, 0.44], [0.5, 0.44, 0.5, 0.28], [0.5, 0.02, 0.5, 0.1]],
  "'": [[0.5, 1, 0.5, 0.7]],
  '"': [[0.3, 1, 0.3, 0.7], [0.7, 1, 0.7, 0.7]],
  '(': [[0.72, 1, 0.32, 0.7], [0.32, 0.7, 0.32, 0.3], [0.32, 0.3, 0.72, 0]],
  ')': [[0.28, 1, 0.68, 0.7], [0.68, 0.7, 0.68, 0.3], [0.68, 0.3, 0.28, 0]],
  '[': [[0.72, 1, 0.32, 1], [0.32, 1, 0.32, 0], [0.32, 0, 0.72, 0]],
  ']': [[0.28, 1, 0.68, 1], [0.68, 1, 0.68, 0], [0.68, 0, 0.28, 0]],
  '{': [[0.78, 1, 0.48, 0.86], [0.48, 0.86, 0.48, 0.6], [0.48, 0.6, 0.2, 0.5], [0.2, 0.5, 0.48, 0.4], [0.48, 0.4, 0.48, 0.14], [0.48, 0.14, 0.78, 0]],
  '}': [[0.22, 1, 0.52, 0.86], [0.52, 0.86, 0.52, 0.6], [0.52, 0.6, 0.8, 0.5], [0.8, 0.5, 0.52, 0.4], [0.52, 0.4, 0.52, 0.14], [0.52, 0.14, 0.22, 0]],
  '<': [[0.85, 0.85, 0.2, 0.45], [0.2, 0.45, 0.85, 0.05]],
  '>': [[0.15, 0.85, 0.8, 0.45], [0.8, 0.45, 0.15, 0.05]],
  '+': [[0.12, 0.5, 0.88, 0.5], [0.5, 0.12, 0.5, 0.88]],
  '-': [[0.12, 0.5, 0.88, 0.5]],
  '*': [[0.5, 0.96, 0.5, 0.44], [0.24, 0.86, 0.76, 0.54], [0.76, 0.86, 0.24, 0.54]],
  '/': [[0, 0, 1, 1]],
  '=': [[0.12, 0.34, 0.88, 0.34], [0.12, 0.66, 0.88, 0.66]],
  _: [[0, -0.06, 1, -0.06]],
  '#': [[0.24, 0, 0.36, 1], [0.64, 0, 0.76, 1], [0.05, 0.34, 0.95, 0.34], [0.05, 0.68, 0.95, 0.68]],
  '%': [
    [0.15, 0, 0.85, 1],
    [0.02, 0.74, 0.02, 1], [0.02, 1, 0.32, 1], [0.32, 1, 0.32, 0.74], [0.32, 0.74, 0.02, 0.74],
    [0.68, 0, 0.68, 0.26], [0.68, 0.26, 0.98, 0.26], [0.98, 0.26, 0.98, 0], [0.98, 0, 0.68, 0],
  ],
  '&': [[1, 0, 0.2, 0.72], [0.2, 0.72, 0.5, 1], [0.5, 1, 0.78, 0.74], [0.78, 0.74, 0, 0.26], [0, 0.26, 0.3, 0], [0.3, 0, 1, 0.42]],
  '@': [
    [1, 0.3, 0.7, 0], [0.7, 0, 0.3, 0], [0.3, 0, 0, 0.3], [0, 0.3, 0, 0.7], [0, 0.7, 0.3, 1],
    [0.3, 1, 0.7, 1], [0.7, 1, 1, 0.7], [1, 0.7, 1, 0.36], [1, 0.36, 0.66, 0.36],
    [0.66, 0.36, 0.66, 0.64], [0.66, 0.64, 0.34, 0.64], [0.34, 0.64, 0.34, 0.36], [0.34, 0.36, 0.7, 0.36],
  ],
  $: [[1, 0.88, 0, 0.88], [0, 0.88, 0, 0.52], [0, 0.52, 1, 0.52], [1, 0.52, 1, 0.16], [1, 0.16, 0, 0.16], [0.5, 1, 0.5, 0.04]],
}
/* eslint-enable prettier/prettier */

/* ------------------------------------------------------------------ */
/* Satz                                                                */
/* ------------------------------------------------------------------ */

/** Breite eines Zeichenkastens, bezogen auf die Versalhoehe 1. */
const GLYPH_WIDTH = 0.62
/** Abstand von Zeichenanfang zu Zeichenanfang. */
const ADVANCE = 0.8
/** Vorschub eines Leerzeichens. */
const SPACE_ADVANCE = 0.45
/** Strichstaerke, bezogen auf die Versalhoehe 1. */
const STROKE_WIDTH = 0.115
const BOLD_STROKE_WIDTH = 0.19
/** Neigung des Kursivschnitts: Versatz in x pro Einheit y. */
const ITALIC_SHEAR = 0.22
/** Zeilenabstand, bezogen auf die Versalhoehe 1. */
const LINE_HEIGHT = 1.5

export interface Text3dOptions {
  /** Versalhoehe in Metern */
  height: number
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
}

export interface Text3dLayout {
  /** Jedes Rechteck als vier Punkte gegen den Uhrzeigersinn, in Metern */
  rects: { x: number; y: number }[][]
  /** Breite des Textblocks in Metern */
  width: number
  /** Hoehe des Textblocks in Metern */
  height: number
  /** Zeichen, die tatsaechlich gebaut wurden (ohne Leerzeichen) */
  glyphCount: number
}

function advanceOf(char: string): number {
  return char === ' ' ? SPACE_ADVANCE : ADVANCE
}

/** Breite einer Zeile in Einheiten der Versalhoehe. */
function lineWidth(line: string): number {
  let width = 0
  for (const char of line) width += advanceOf(char)
  // Der letzte Vorschub enthaelt den Zwischenraum; fuer die Blockbreite zaehlt
  // nur der Zeichenkasten.
  return line.length === 0 ? 0 : width - (ADVANCE - GLYPH_WIDTH)
}

/**
 * Setzt Text in Rechtecke.
 *
 * Rueckgabe ist ein flaches Feld von Vierecken in der Textebene: x nach
 * rechts, y nach oben, Ursprung am Einfuegepunkt (Grundlinie der ersten
 * Zeile, Ausrichtung nach `align`).
 */
export function layoutText3d(text: string, opts: Text3dOptions): Text3dLayout {
  const scale = Number.isFinite(opts.height) && opts.height > 0 ? opts.height : 1
  const thickness = (opts.bold ? BOLD_STROKE_WIDTH : STROKE_WIDTH) * scale
  const shear = opts.italic ? ITALIC_SHEAR : 0
  const align = opts.align ?? 'left'

  // Erst trennen, dann abbilden: die Abbildung kennt den Zeilenumbruch nicht
  // und wuerde ihn wegwerfen - aus zwei Zeilen wuerde eine.
  const lines = text.split('\n').map(mapText3d)
  const widths = lines.map((line) => lineWidth(line) * scale)
  const blockWidth = widths.reduce((max, w) => Math.max(max, w), 0)

  const rects: { x: number; y: number }[][] = []
  let glyphCount = 0

  lines.forEach((line, lineIndex) => {
    const baseline = -lineIndex * LINE_HEIGHT * scale
    const lineOffset =
      align === 'center' ? -widths[lineIndex] / 2 : align === 'right' ? -widths[lineIndex] : 0
    let penX = lineOffset
    for (const char of line) {
      const strokes = TEXT3D_STROKES[char]
      if (strokes) {
        glyphCount += 1
        for (const stroke of strokes) {
          const quad = strokeQuad(stroke, penX, baseline, scale, thickness, shear)
          if (quad) rects.push(quad)
        }
      }
      penX += advanceOf(char) * scale
    }
  })

  return {
    rects,
    width: blockWidth,
    height: (lines.length - 1) * LINE_HEIGHT * scale + scale,
    glyphCount,
  }
}

/**
 * Ein Strich wird zum Rechteck: um die halbe Strichstaerke seitlich
 * aufgedickt und an beiden Enden um dasselbe Mass verlaengert, damit Ecken
 * geschlossen wirken. Ein Strich der Laenge null (Punkt, Umlautpunkt) wird zum
 * Quadrat.
 */
function strokeQuad(
  stroke: Stroke,
  penX: number,
  baseline: number,
  scale: number,
  thickness: number,
  shear: number,
): { x: number; y: number }[] | null {
  const half = thickness / 2
  const place = (gx: number, gy: number) => ({
    x: penX + (gx * GLYPH_WIDTH + gy * shear) * scale,
    y: baseline + gy * scale,
  })
  const a = place(stroke[0], stroke[1])
  const b = place(stroke[2], stroke[3])
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length)) return null
  if (length < 1e-9) {
    return [
      { x: a.x - half, y: a.y - half },
      { x: a.x + half, y: a.y - half },
      { x: a.x + half, y: a.y + half },
      { x: a.x - half, y: a.y + half },
    ]
  }
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const sx = a.x - ux * half
  const sy = a.y - uy * half
  const ex = b.x + ux * half
  const ey = b.y + uy * half
  return [
    { x: sx - nx * half, y: sy - ny * half },
    { x: ex - nx * half, y: ey - ny * half },
    { x: ex + nx * half, y: ey + ny * half },
    { x: sx + nx * half, y: sy + ny * half },
  ]
}
