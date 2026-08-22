/** Defensive Wrapper um `@/shared/units` - jede Zahl laeuft hier durch. */

import { DEFAULT_UNITS, formatAngle, formatArea, formatLength, formatVolume } from '@/shared/units'
import type { UnitSettings } from '@/shared/types'
import { useAppSelector } from '@/ui/state/store'

export function useUnits(): UnitSettings {
  return useAppSelector((state) => state.doc?.units ?? DEFAULT_UNITS)
}

/**
 * Nimmt das Ergebnis der Einheitenbibliothek an - oder die metrische
 * Naeherung.
 *
 * Der `try`/`catch` allein reicht nicht: eine unbekannte Einheiteneinstellung
 * bringt `formatArea` nicht zum Werfen, sondern liefert glatt `"NaN"`, weil
 * der Umrechnungsfaktor `undefined` ist. Das landete ungeprueft in der
 * Entitaetsinfo. Deshalb wird hier auch das Ergebnis geprueft, nicht nur der
 * Weg dorthin.
 */
function accept(result: string, fallback: () => string): string {
  if (typeof result !== 'string') return fallback()
  const text = result.trim()
  if (text === '' || /NaN|undefined|Infinity/.test(text)) return fallback()
  return result
}

function safeFormat(value: number, format: () => string, fallback: () => string): string {
  if (!Number.isFinite(value)) return fallback()
  try {
    return accept(format(), fallback)
  } catch {
    return fallback()
  }
}

export function fmtLength(metres: number, units: UnitSettings): string {
  const fallback = () => (Number.isFinite(metres) ? `${metres.toFixed(3)} m` : '- m')
  return safeFormat(metres, () => formatLength(metres, units), fallback)
}

export function fmtAngle(radians: number, units: UnitSettings): string {
  const fallback = () => (Number.isFinite(radians) ? `${((radians * 180) / Math.PI).toFixed(1)}°` : '-°')
  return safeFormat(radians, () => formatAngle(radians, units), fallback)
}

export function fmtArea(m2: number, units: UnitSettings): string {
  const fallback = () => (Number.isFinite(m2) ? `${m2.toFixed(2)} m²` : '- m²')
  return safeFormat(m2, () => formatArea(m2, units), fallback)
}

export function fmtVolume(m3: number, units: UnitSettings): string {
  const fallback = () => (Number.isFinite(m3) ? `${m3.toFixed(3)} m³` : '- m³')
  return safeFormat(m3, () => formatVolume(m3, units), fallback)
}

/** Ganzzahl mit Tausenderpunkten. */
export function fmtCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('de-DE')
}

/** Minuten seit Mitternacht als "HH:MM". */
export function fmtClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/** ISO-Datum "YYYY-MM-DD" als "TT.MM.JJJJ". */
export function fmtDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!match) return iso ?? ''
  return `${match[3]}.${match[2]}.${match[1]}`
}

/** Zeitstempel fuer Listen. */
export function fmtTimestamp(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

/** Byte-Groesse. */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'kB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value < 10 && index > 0 ? 1 : 0)} ${units[index]}`
}

/** Normalisiert eine Hex-Farbe auf "#rrggbb". */
export function normalizeHex(input: string, fallback = '#ffffff'): string {
  const value = (input ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value.toLowerCase()}`
  return fallback
}
