/** Defensive Wrapper um `@/shared/units` - jede Zahl laeuft hier durch. */

import { DEFAULT_UNITS, formatAngle, formatArea, formatLength, formatVolume } from '@/shared/units'
import type { UnitSettings } from '@/shared/types'
import { useAppSelector } from '@/ui/state/store'

export function useUnits(): UnitSettings {
  return useAppSelector((state) => state.doc?.units ?? DEFAULT_UNITS)
}

export function fmtLength(metres: number, units: UnitSettings): string {
  try {
    return formatLength(metres, units)
  } catch {
    return `${metres.toFixed(3)} m`
  }
}

export function fmtAngle(radians: number, units: UnitSettings): string {
  try {
    return formatAngle(radians, units)
  } catch {
    return `${((radians * 180) / Math.PI).toFixed(1)}°`
  }
}

export function fmtArea(m2: number, units: UnitSettings): string {
  try {
    return formatArea(m2, units)
  } catch {
    return `${m2.toFixed(2)} m²`
  }
}

export function fmtVolume(m3: number, units: UnitSettings): string {
  try {
    return formatVolume(m3, units)
  } catch {
    return `${m3.toFixed(3)} m³`
  }
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
