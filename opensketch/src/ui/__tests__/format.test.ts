/**
 * Formatierung fuer die Anzeige.
 *
 * `@/ui/lib/format` ist der defensive Mantel um `@/shared/units`: jede Zahl,
 * die der Nutzer zu sehen bekommt, laeuft hier durch. Wirft die Einheiten-
 * bibliothek, muss trotzdem etwas Lesbares herauskommen - eine Statuszeile
 * mit "NaN" oder eine leere Zelle ist schlimmer als eine grobe Naeherung.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS } from '@/shared/units'
import type { UnitSettings } from '@/shared/types'
import {
  fmtAngle,
  fmtArea,
  fmtBytes,
  fmtClock,
  fmtCount,
  fmtDate,
  fmtLength,
  fmtTimestamp,
  fmtVolume,
  normalizeHex,
} from '@/ui/lib/format'

const METRIC: UnitSettings = { ...DEFAULT_UNITS }

/** Einheiten-Einstellung, deren Zugriff wirft. */
const THROWS = {
  get lengthUnit(): never {
    throw new Error('kaputt')
  },
} as unknown as UnitSettings

/**
 * Einheiten-Einstellung, die nicht wirft, sondern still Unsinn erzeugt:
 * unbekannte Einheitennamen ergeben einen `undefined`-Umrechnungsfaktor und
 * damit die Zeichenkette "NaN".
 */
const GARBAGE = {
  lengthUnit: 'ellen',
  areaUnit: 'morgen',
  volumeUnit: 'scheffel',
  angleUnit: 'strich',
  precision: 2,
  displayUnitSuffix: true,
} as unknown as UnitSettings

/* ------------------------------------------------------------------ */
/* Zahlen                                                              */
/* ------------------------------------------------------------------ */

describe('fmtCount', () => {
  it('setzt Tausenderpunkte', () => {
    expect(fmtCount(1234)).toBe('1.234')
    expect(fmtCount(1234567)).toBe('1.234.567')
  })

  it('rundet auf ganze Zahlen', () => {
    expect(fmtCount(12.4)).toBe('12')
    expect(fmtCount(12.6)).toBe('13')
  })

  it('zeigt kleine Zahlen unveraendert', () => {
    expect(fmtCount(0)).toBe('0')
    expect(fmtCount(7)).toBe('7')
  })

  it('faengt NaN und Unendlich ab', () => {
    // Die Modellstatistik zeigt sonst "NaN" in der Statuszeile.
    expect(fmtCount(Number.NaN)).toBe('0')
    expect(fmtCount(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

/* ------------------------------------------------------------------ */
/* Einheiten                                                           */
/* ------------------------------------------------------------------ */

describe('Einheiten-Wrapper', () => {
  it('formatiert Laengen ueber die Einheitenbibliothek', () => {
    const text = fmtLength(2, METRIC)
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toMatch(/NaN|undefined/)
  })

  it('formatiert Flaechen und Volumen', () => {
    expect(fmtArea(12, METRIC)).not.toMatch(/NaN|undefined/)
    expect(fmtVolume(24, METRIC)).not.toMatch(/NaN|undefined/)
  })

  it('formatiert Winkel', () => {
    expect(fmtAngle(Math.PI / 4, METRIC)).not.toMatch(/NaN|undefined/)
  })

  it('liefert eine metrische Naeherung, wenn die Bibliothek wirft', () => {
    expect(fmtLength(2, THROWS)).toBe('2.000 m')
    expect(fmtArea(12, THROWS)).toBe('12.00 m²')
    expect(fmtVolume(24, THROWS)).toBe('24.000 m³')
    expect(fmtAngle(Math.PI, THROWS)).toMatch(/^180/)
  })

  it('zeigt niemals "NaN", auch wenn die Bibliothek es liefert', () => {
    // Unbekannte Einheitennamen werfen nicht, sie ergeben "NaN". Genau das
    // stand vorher ungeprueft in der Entitaetsinfo.
    expect(fmtLength(2, GARBAGE)).toBe('2.000 m')
    expect(fmtArea(12, GARBAGE)).toBe('12.00 m²')
    expect(fmtVolume(24, GARBAGE)).toBe('24.000 m³')
    expect(fmtAngle(Math.PI, GARBAGE)).toMatch(/^180/)
  })

  it('macht aus einer unbrauchbaren Zahl einen Strich', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(fmtLength(value, METRIC), `Laenge ${value}`).toBe('- m')
      expect(fmtArea(value, METRIC), `Flaeche ${value}`).toBe('- m²')
      expect(fmtVolume(value, METRIC), `Volumen ${value}`).toBe('- m³')
      expect(fmtAngle(value, METRIC), `Winkel ${value}`).toBe('-°')
    }
  })

  it('formatiert Null und negative Werte ohne Rueckfall', () => {
    expect(fmtLength(0, METRIC)).not.toMatch(/^-\s/)
    expect(fmtLength(-2.5, METRIC)).not.toMatch(/NaN/)
    expect(fmtArea(0, METRIC)).not.toMatch(/NaN/)
  })
})

/* ------------------------------------------------------------------ */
/* Zeit                                                                */
/* ------------------------------------------------------------------ */

describe('fmtClock', () => {
  it('formatiert Minuten seit Mitternacht', () => {
    expect(fmtClock(0)).toBe('00:00')
    expect(fmtClock(12 * 60)).toBe('12:00')
    expect(fmtClock(13 * 60 + 5)).toBe('13:05')
    expect(fmtClock(23 * 60 + 59)).toBe('23:59')
  })

  it('rechnet ueber den Tagesrand hinweg', () => {
    expect(fmtClock(1440)).toBe('00:00')
    expect(fmtClock(1500)).toBe('01:00')
  })

  it('rechnet negative Zeiten in den Vortag', () => {
    // Der Sonnenstands-Schieber laeuft in beide Richtungen ueber.
    expect(fmtClock(-60)).toBe('23:00')
    expect(fmtClock(-1)).toBe('23:59')
  })

  it('rundet auf ganze Minuten', () => {
    expect(fmtClock(90.4)).toBe('01:30')
  })
})

describe('fmtDate', () => {
  it('dreht ISO-Datum auf die deutsche Schreibweise', () => {
    expect(fmtDate('2026-06-21')).toBe('21.06.2026')
    expect(fmtDate('2026-01-05')).toBe('05.01.2026')
  })

  it('vertraegt einen angehaengten Zeitanteil', () => {
    expect(fmtDate('2026-06-21T12:30:00Z')).toBe('21.06.2026')
  })

  it('gibt Unlesbares unveraendert zurueck', () => {
    expect(fmtDate('irgendwas')).toBe('irgendwas')
    expect(fmtDate('')).toBe('')
  })
})

describe('fmtTimestamp', () => {
  it('formatiert einen gueltigen Zeitpunkt', () => {
    expect(fmtTimestamp(Date.UTC(2026, 5, 21, 10, 0, 0))).not.toBe('-')
  })

  it('meldet Unlesbares als Strich', () => {
    expect(fmtTimestamp('kein Datum')).toBe('-')
    expect(fmtTimestamp(Number.NaN)).toBe('-')
  })
})

/* ------------------------------------------------------------------ */
/* Groessen und Farben                                                  */
/* ------------------------------------------------------------------ */

describe('fmtBytes', () => {
  it('waehlt die passende Einheit', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 kB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('laesst grosse Werte ohne Nachkommastelle', () => {
    expect(fmtBytes(64 * 1024)).toBe('64 kB')
  })

  it('faengt Null und Unsinn ab', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(-5)).toBe('0 B')
    expect(fmtBytes(Number.NaN)).toBe('0 B')
  })
})

describe('normalizeHex', () => {
  it('laesst gueltige Farben stehen', () => {
    expect(normalizeHex('#a1b2c3')).toBe('#a1b2c3')
  })

  it('schreibt klein', () => {
    expect(normalizeHex('#A1B2C3')).toBe('#a1b2c3')
  })

  it('erweitert die Kurzschreibweise', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('#F00')).toBe('#ff0000')
  })

  it('ergaenzt das fehlende Doppelkreuz', () => {
    expect(normalizeHex('a1b2c3')).toBe('#a1b2c3')
  })

  it('vertraegt Leerzeichen', () => {
    expect(normalizeHex('  #a1b2c3  ')).toBe('#a1b2c3')
  })

  it('faellt bei Unsinn auf den Vorgabewert zurueck', () => {
    expect(normalizeHex('rot')).toBe('#ffffff')
    expect(normalizeHex('')).toBe('#ffffff')
    expect(normalizeHex('#12345')).toBe('#ffffff')
    expect(normalizeHex('kein-hex', '#000000')).toBe('#000000')
  })
})
