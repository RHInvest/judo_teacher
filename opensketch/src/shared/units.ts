/**
 * Unit parsing and formatting.
 *
 * The internal working unit of the whole application is ONE METRE.
 * Never format a number by hand - always go through this module so the
 * measurement box, the entity info panel and dimensions stay consistent.
 *
 * OWNERSHIP: lead developer.
 */

import type { AreaUnit, LengthUnit, UnitSettings, VolumeUnit } from './types'

/* ------------------------------------------------------------------ */
/* Conversion factors: value * factor = metres                         */
/* ------------------------------------------------------------------ */

export const LENGTH_TO_M: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
  ftin: 0.3048,
  yd: 0.9144,
}

export const AREA_TO_M2: Record<AreaUnit, number> = {
  m2: 1,
  cm2: 0.0001,
  mm2: 0.000001,
  ft2: 0.09290304,
  in2: 0.00064516,
}

export const VOLUME_TO_M3: Record<VolumeUnit, number> = {
  m3: 1,
  cm3: 0.000001,
  l: 0.001,
  ft3: 0.028316846592,
}

export const LENGTH_SUFFIX: Record<LengthUnit, string> = {
  m: 'm',
  cm: 'cm',
  mm: 'mm',
  in: '"',
  ft: "'",
  ftin: "'",
  yd: 'yd',
}

export const AREA_SUFFIX: Record<AreaUnit, string> = {
  m2: 'm²',
  cm2: 'cm²',
  mm2: 'mm²',
  ft2: 'ft²',
  in2: 'in²',
}

export const VOLUME_SUFFIX: Record<VolumeUnit, string> = {
  m3: 'm³',
  cm3: 'cm³',
  l: 'l',
  ft3: 'ft³',
}

/**
 * Voreinstellung fuer metrische Dokumente.
 *
 * Die Laengeneinheit ist METER, nicht Millimeter: die Anwendung ist fuer
 * Haeuser, Moebel und Architektur gedacht, und dort tippt man "3" fuer eine
 * drei Meter hohe Wand. Mit Millimetern als Grundeinheit erzeugt dieselbe
 * Eingabe eine unsichtbare 3-mm-Extrusion - ein Stolperstein direkt beim
 * ersten Kontakt (im Browsertest genau so passiert). Millimetergenauigkeit
 * bleibt ueber `precision: 3` erhalten, und die Einheit ist in der Modellinfo
 * jederzeit umstellbar.
 */
export const DEFAULT_UNITS: UnitSettings = {
  format: 'decimal',
  lengthUnit: 'm',
  angleUnit: 'deg',
  areaUnit: 'm2',
  volumeUnit: 'm3',
  precision: 3,
  fractionDenominator: 16,
  displayUnitSuffix: true,
  lengthSnap: 0.001,
  angleSnap: 15,
  enableLengthSnap: false,
  enableAngleSnap: true,
}

export const IMPERIAL_UNITS: UnitSettings = {
  ...DEFAULT_UNITS,
  format: 'architectural',
  lengthUnit: 'ftin',
  areaUnit: 'ft2',
  volumeUnit: 'ft3',
  precision: 0,
  fractionDenominator: 16,
  lengthSnap: 0.0254,
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const NUMBER = String.raw`[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)`

/** "1 1/2" or "3/4" or "12.5" -> number */
function parseNumeric(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '.')
  if (!s) return null
  // mixed fraction: 1 1/2
  const mixed = s.match(new RegExp(`^(${NUMBER})\\s+(\\d+)\\s*/\\s*(\\d+)$`))
  if (mixed) {
    const whole = parseFloat(mixed[1])
    const num = parseFloat(mixed[2])
    const den = parseFloat(mixed[3])
    if (den === 0) return null
    return whole < 0 ? whole - num / den : whole + num / den
  }
  // plain fraction: 3/4
  const frac = s.match(/^([-+]?\d+)\s*\/\s*(\d+)$/)
  if (frac) {
    const den = parseFloat(frac[2])
    if (den === 0) return null
    return parseFloat(frac[1]) / den
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Parses a user typed length into METRES.
 *
 * Accepted:  `5`, `5m`, `500mm`, `12,5 cm`, `3'`, `6"`, `3' 6"`, `3'6`,
 *            `1 1/2"`, `5ft`, `5 in`, `2yd`
 * A bare number uses `units.lengthUnit` (ftin -> inches, like SketchUp).
 * Returns null when the input cannot be parsed.
 */
export function parseLength(input: string, units: UnitSettings): number | null {
  const s = input.trim().toLowerCase().replace(/′/g, "'").replace(/″|”/g, '"')
  if (!s) return null

  // feet+inches combinations: 3'6", 3' 6 1/2", 3'
  const ftin = s.match(new RegExp(`^(${NUMBER})\\s*'\\s*(?:(${NUMBER}(?:\\s+\\d+\\s*/\\s*\\d+)?|\\d+\\s*/\\s*\\d+)\\s*"?)?$`))
  if (ftin) {
    const feet = parseNumeric(ftin[1])
    if (feet === null) return null
    const inches = ftin[2] !== undefined ? parseNumeric(ftin[2]) : 0
    if (inches === null) return null
    const sign = feet < 0 ? -1 : 1
    return (Math.abs(feet) * 12 + inches) * sign * LENGTH_TO_M.in
  }

  const withSuffix = s.match(
    new RegExp(`^(${NUMBER}(?:\\s+\\d+\\s*/\\s*\\d+)?|\\d+\\s*/\\s*\\d+)\\s*(mm|cm|m|km|in|inch|inches|"|ft|feet|foot|yd|yard)?$`),
  )
  if (!withSuffix) return null
  const value = parseNumeric(withSuffix[1])
  if (value === null) return null
  const suffix = withSuffix[2]

  if (!suffix) {
    const unit = units.lengthUnit === 'ftin' ? 'in' : units.lengthUnit
    return value * LENGTH_TO_M[unit]
  }
  switch (suffix) {
    case 'mm':
      return value * 0.001
    case 'cm':
      return value * 0.01
    case 'm':
      return value
    case 'km':
      return value * 1000
    case 'in':
    case 'inch':
    case 'inches':
    case '"':
      return value * LENGTH_TO_M.in
    case 'ft':
    case 'feet':
    case 'foot':
      return value * LENGTH_TO_M.ft
    case 'yd':
    case 'yard':
      return value * LENGTH_TO_M.yd
    default:
      return null
  }
}

/** Parses an angle into RADIANS. Accepts `45`, `45d`, `45deg`, `45°`, `0.5rad`. */
export function parseAngle(input: string, units: UnitSettings): number | null {
  const s = input.trim().toLowerCase().replace(/°/g, 'deg')
  const m = s.match(new RegExp(`^(${NUMBER})\\s*(deg|d|rad|r|g)?$`))
  if (!m) return null
  const value = parseNumeric(m[1])
  if (value === null) return null
  const suffix = m[2]
  if (suffix === 'rad' || suffix === 'r') return value
  if (suffix === 'g') return (value * Math.PI) / 200
  if (suffix || units.angleUnit === 'deg') return (value * Math.PI) / 180
  return value
}

/** Parses a plain multiplier such as `2`, `1,5`, `x3`, `3x` (scale tool, arrays). */
export function parseNumber(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/^x/, '').replace(/x$/, '')
  return parseNumeric(s)
}

/**
 * Parses dimension triples used by the rectangle / box tools: `2;3`, `2,5; 4`.
 * The separator is `;` so the German decimal comma keeps working.
 */
export function parseLengthList(input: string, units: UnitSettings): (number | null)[] {
  return input
    .split(/[;x]/)
    .map((part) => (part.trim() === '' ? null : parseLength(part, units)))
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/**
 * Zerlegt eine Zahl in Ganzzahl plus gekuerzten Bruch.
 *
 * `whole` ist immer der BETRAG - das Vorzeichen steht separat in `negative`.
 * Frueher trug `whole` das Vorzeichen, was bei reinen Bruechen (`whole === 0`)
 * verloren ging und `-1/2` als `1/2` anzeigte.
 */
function toFraction(
  value: number,
  denominator: number,
): { negative: boolean; whole: number; num: number; den: number } {
  const negative = value < 0
  const abs = Math.abs(value)
  let whole = Math.floor(abs)
  let num = Math.round((abs - whole) * denominator)
  let den = denominator
  if (num >= den) {
    whole += 1
    num = 0
  }
  while (num > 0 && num % 2 === 0 && den % 2 === 0) {
    num /= 2
    den /= 2
  }
  return { negative, whole, num, den }
}

function formatArchitectural(metres: number, units: UnitSettings): string {
  const totalInches = metres / LENGTH_TO_M.in
  const sign = totalInches < 0 ? '-' : ''
  const abs = Math.abs(totalInches)
  let feet = Math.floor(abs / 12)
  const rest = abs - feet * 12
  const frac = toFraction(rest, units.fractionDenominator)
  let whole = frac.whole
  const { num, den } = frac
  /*
   * Die Bruchrundung in toFraction kann `whole` auf 12 hochziehen (11,99" mit
   * Nenner 16 rundet auf 12"). Der Uebertrag muss auf die Fuss-Stelle
   * weitergereicht werden, sonst steht dort "12"" statt "1'".
   */
  if (whole >= 12) {
    feet += Math.floor(whole / 12)
    whole %= 12
  }
  let inchPart = String(whole)
  if (num > 0) inchPart += `${whole > 0 ? ' ' : ''}${num}/${den}`
  if (whole === 0 && num > 0) inchPart = `${num}/${den}`
  if (feet === 0) return `${sign}${inchPart}"`
  if (whole === 0 && num === 0) return `${sign}${feet}'`
  return `${sign}${feet}' ${inchPart}"`
}

/** Formats a length given in METRES for display. */
export function formatLength(metres: number, units: UnitSettings, opts?: { suffix?: boolean }): string {
  const showSuffix = opts?.suffix ?? units.displayUnitSuffix
  if (!Number.isFinite(metres)) return '-'

  if (units.format === 'architectural' || units.lengthUnit === 'ftin') {
    return formatArchitectural(metres, units)
  }
  if (units.format === 'fractional') {
    const { negative, whole, num, den } = toFraction(metres / LENGTH_TO_M.in, units.fractionDenominator)
    // Vorzeichen separat setzen - bei reinen Bruechen ist `whole` 0 und wuerde es schlucken.
    const sign = negative && (whole !== 0 || num !== 0) ? '-' : ''
    const magnitude = num > 0 ? (whole !== 0 ? `${whole} ${num}/${den}` : `${num}/${den}`) : `${whole}`
    const body = `${sign}${magnitude}`
    return showSuffix ? `${body}"` : body
  }

  if (units.format === 'engineering') {
    // Ingenieurformat ist immer dezimaler Fuss, unabhaengig von `lengthUnit`.
    const body = trimZeros((metres / LENGTH_TO_M.ft).toFixed(Math.max(0, units.precision)))
    return showSuffix ? `${body}'` : body
  }

  const factor = LENGTH_TO_M[units.lengthUnit] ?? LENGTH_TO_M.m
  const value = metres / factor
  const body = trimZeros(value.toFixed(Math.max(0, units.precision)))
  return showSuffix ? `${body} ${LENGTH_SUFFIX[units.lengthUnit] ?? LENGTH_SUFFIX.m}`.replace(' "', '"').replace(" '", "'") : body
}

/** Formats an angle given in RADIANS. */
export function formatAngle(radians: number, units: UnitSettings, opts?: { suffix?: boolean }): string {
  const showSuffix = opts?.suffix ?? units.displayUnitSuffix
  if (units.angleUnit === 'rad') {
    const body = trimZeros(radians.toFixed(Math.max(2, units.precision)))
    return showSuffix ? `${body} rad` : body
  }
  const deg = (radians * 180) / Math.PI
  const body = trimZeros(deg.toFixed(Math.max(1, units.precision)))
  return showSuffix ? `${body}°` : body
}

/**
 * Formats an area given in SQUARE METRES.
 *
 * Unbekannte Einheitenschluessel (aus einem aelteren oder beschaedigten
 * Dokument) fallen auf die metrische Grundeinheit zurueck. Ohne diesen
 * Rueckfall waere der Faktor `undefined`, die Division liefert NaN, und in der
 * Entitaetsinfo stuende die Zeichenkette "NaN" - ohne dass irgendetwas wirft,
 * also von keinem try/catch zu fangen.
 */
export function formatArea(m2: number, units: UnitSettings): string {
  if (!Number.isFinite(m2)) return units.displayUnitSuffix ? `- ${AREA_SUFFIX.m2}` : '-'
  const value = m2 / (AREA_TO_M2[units.areaUnit] ?? AREA_TO_M2.m2)
  const body = trimZeros(value.toFixed(Math.max(2, units.precision)))
  return units.displayUnitSuffix ? `${body} ${AREA_SUFFIX[units.areaUnit] ?? AREA_SUFFIX.m2}` : body
}

/** Formats a volume given in CUBIC METRES. */
export function formatVolume(m3: number, units: UnitSettings): string {
  if (!Number.isFinite(m3)) return units.displayUnitSuffix ? `- ${VOLUME_SUFFIX.m3}` : '-'
  const value = m3 / (VOLUME_TO_M3[units.volumeUnit] ?? VOLUME_TO_M3.m3)
  const body = trimZeros(value.toFixed(Math.max(2, units.precision)))
  return units.displayUnitSuffix ? `${body} ${VOLUME_SUFFIX[units.volumeUnit] ?? VOLUME_SUFFIX.m3}` : body
}

/** Formats a coordinate triple for the measurement box, e.g. `[2,00; 1,50; 0,00]`. */
export function formatPoint(p: { x: number; y: number; z: number }, units: UnitSettings): string {
  const f = (v: number) => formatLength(v, units, { suffix: false })
  return `[${f(p.x)}; ${f(p.y)}; ${f(p.z)}]`
}

/** Snaps a length in metres to the configured increment. */
export function snapLength(metres: number, units: UnitSettings): number {
  if (!units.enableLengthSnap || units.lengthSnap <= 0) return metres
  return Math.round(metres / units.lengthSnap) * units.lengthSnap
}

/** Snaps an angle in radians to the configured increment (degrees). */
export function snapAngle(radians: number, units: UnitSettings): number {
  if (!units.enableAngleSnap || units.angleSnap <= 0) return radians
  const step = (units.angleSnap * Math.PI) / 180
  return Math.round(radians / step) * step
}
