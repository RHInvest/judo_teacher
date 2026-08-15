/**
 * Auswertung der Eingaben aus dem Massfeld (VCB).
 *
 * Das Massfeld ist der zentrale Praezisionsmechanismus: nach dem Setzen des
 * ersten Punktes kann der Nutzer jederzeit tippen und mit Enter bestaetigen.
 * Hier liegen ausschliesslich REINE Parserfunktionen - sie sind vollstaendig
 * testbar und haengen an keinem Werkzeugzustand.
 *
 * Unterstuetzte Formen:
 *   `2,5`  `250cm`  `3' 6"`            -> Laenge (ueber @/shared/units)
 *   `2;3`  `2;3;4`                     -> Liste von Laengen (Rechteck, Box)
 *   `[2;3;1]`                          -> absolute Koordinate
 *   `<2;3;1>`                          -> relative Koordinate
 *   `24s`  `s24`                       -> Segment-/Seitenzahl
 *   `x3`   `3x`                        -> 3 Kopien (Array)
 *   `/3`   `3/`                        -> 3 gleichmaessige Zwischenkopien
 *   `45`   `45°` `0.5rad`              -> Winkel (ueber @/shared/units)
 *
 * OWNERSHIP: Tools.
 */

import type { UnitSettings, Vec3Like } from '@/shared/types'
import { parseAngle, parseLength, parseNumber } from '@/shared/units'

/* ------------------------------------------------------------------ */
/* Laengen                                                             */
/* ------------------------------------------------------------------ */

/** Eine einzelne Laenge in Metern, null wenn nicht lesbar. */
export function parseLengthInput(text: string, units: UnitSettings): number | null {
  const value = parseLength(text.trim(), units)
  return value !== null && Number.isFinite(value) ? value : null
}

/**
 * Liste von Laengen (`2;3`, `2;3;4`, auch `2x3`).
 * Leere Felder liefern null an der jeweiligen Position, damit ein Werkzeug
 * `;3` als "nur die zweite Kante" lesen kann.
 */
export function parseLengthPair(text: string, units: UnitSettings): (number | null)[] | null {
  const parts = text.split(/[;x*]/i)
  if (parts.length < 2) return null
  const out: (number | null)[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed === '') {
      out.push(null)
      continue
    }
    const value = parseLength(trimmed, units)
    if (value === null) return null
    out.push(value)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Koordinaten                                                         */
/* ------------------------------------------------------------------ */

export interface CoordinateInput {
  /** `[...]` = absolut zum Modellursprung, `<...>` = relativ zum letzten Punkt */
  kind: 'absolute' | 'relative'
  point: Vec3Like
  /** true wenn der Nutzer nur zwei Komponenten angegeben hat (z bleibt 0) */
  partial: boolean
}

/** `[2;3;1]` (absolut) oder `<2;3;1>` (relativ). */
export function parseCoordinateInput(text: string, units: UnitSettings): CoordinateInput | null {
  const s = text.trim()
  if (s.length < 3) return null
  const first = s[0]
  const last = s[s.length - 1]
  let kind: CoordinateInput['kind']
  if (first === '[' && last === ']') kind = 'absolute'
  else if (first === '<' && last === '>') kind = 'relative'
  else return null

  const body = s.slice(1, -1)
  const parts = body.split(';')
  if (parts.length < 2 || parts.length > 3) return null

  const values: number[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed === '') {
      values.push(0)
      continue
    }
    const value = parseLength(trimmed, units)
    if (value === null) return null
    values.push(value)
  }
  return {
    kind,
    point: { x: values[0], y: values[1], z: values.length > 2 ? values[2] : 0 },
    partial: values.length === 2,
  }
}

/* ------------------------------------------------------------------ */
/* Segmente / Seiten                                                   */
/* ------------------------------------------------------------------ */

/**
 * Segment- bzw. Seitenzahl: `24s`, `s24`, `24S`.
 * `allowBare` erlaubt zusaetzlich die nackte Zahl (vor dem ersten Klick).
 */
export function parseSegmentsInput(text: string, allowBare = false): number | null {
  const s = text.trim().toLowerCase()
  if (!s) return null
  const suffixed = s.match(/^(\d+)\s*s$/)
  const prefixed = s.match(/^s\s*(\d+)$/)
  const match = suffixed ?? prefixed
  if (match) {
    const n = parseInt(match[1], 10)
    return Number.isFinite(n) && n >= 3 ? n : null
  }
  if (allowBare) {
    const bare = s.match(/^(\d+)$/)
    if (bare) {
      const n = parseInt(bare[1], 10)
      return Number.isFinite(n) && n >= 3 ? n : null
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Arrays (Kopien)                                                     */
/* ------------------------------------------------------------------ */

export interface ArrayInput {
  /** `external` = n Kopien im Abstand des Ausgangsvektors, `internal` = n gleiche Teile */
  mode: 'external' | 'internal'
  count: number
}

/** `x3` / `3x` = 3 Kopien im Array, `/3` / `3/` = 3 gleichmaessige Zwischenkopien. */
export function parseArrayInput(text: string): ArrayInput | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  const external = s.match(/^(?:\*|x)(\d+)$/) ?? s.match(/^(\d+)(?:\*|x)$/)
  if (external) {
    const count = parseInt(external[1], 10)
    return count >= 1 ? { mode: 'external', count } : null
  }
  const internal = s.match(/^\/(\d+)$/) ?? s.match(/^(\d+)\/$/)
  if (internal) {
    const count = parseInt(internal[1], 10)
    return count >= 1 ? { mode: 'internal', count } : null
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Winkel und Faktoren                                                 */
/* ------------------------------------------------------------------ */

export function parseAngleInput(text: string, units: UnitSettings): number | null {
  const value = parseAngle(text.trim(), units)
  return value !== null && Number.isFinite(value) ? value : null
}

/**
 * Skalierungseingabe: entweder ein Faktor (`2`, `1,5`) oder eine Ziellaenge
 * (`2m`, `250cm`, `3'`). Erkennung ueber die Einheitenangabe.
 */
export function parseScaleInput(
  text: string,
  units: UnitSettings,
): { kind: 'factor'; value: number } | { kind: 'length'; value: number } | null {
  const s = text.trim()
  if (!s) return null
  const hasUnit = /[a-z"'°]/i.test(s)
  if (hasUnit) {
    const length = parseLength(s, units)
    if (length !== null && Number.isFinite(length)) return { kind: 'length', value: length }
    return null
  }
  const factor = parseNumber(s)
  if (factor !== null && Number.isFinite(factor)) return { kind: 'factor', value: factor }
  return null
}

/**
 * Mehrere durch `;` getrennte Skalierungsfaktoren (nicht-uniformes Skalieren
 * ueber einen Eckgriff): `2;1;0,5`.
 */
export function parseScaleList(text: string): number[] | null {
  const parts = text.split(';')
  if (parts.length < 2) return null
  const out: number[] = []
  for (const part of parts) {
    const value = parseNumber(part.trim())
    if (value === null || !Number.isFinite(value)) return null
    out.push(value)
  }
  return out
}
