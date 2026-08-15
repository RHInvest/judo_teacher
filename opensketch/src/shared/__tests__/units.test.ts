/**
 * QA-Tests fuer `@/shared/units`.
 *
 * Interne Arbeitseinheit ist EIN METER (ARCHITECTURE Abschnitt 2).
 * Geprueft werden alle im Kommentar von `parseLength` zugesagten Formate
 * sowie die Formatierung dezimal / architektonisch / bruchweise.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UNITS,
  IMPERIAL_UNITS,
  LENGTH_TO_M,
  formatAngle,
  formatArea,
  formatLength,
  formatPoint,
  formatVolume,
  parseAngle,
  parseLength,
  parseLengthList,
  parseNumber,
  snapAngle,
  snapLength,
} from '../units'
import type { UnitSettings } from '../types'

const IN = LENGTH_TO_M.in // 0.0254
const FT = LENGTH_TO_M.ft // 0.3048

const metric = (patch: Partial<UnitSettings> = {}): UnitSettings => ({ ...DEFAULT_UNITS, ...patch })
const imperial = (patch: Partial<UnitSettings> = {}): UnitSettings => ({ ...IMPERIAL_UNITS, ...patch })

const M_UNITS = metric({ lengthUnit: 'm', precision: 3 })

function expectLength(input: string, expected: number, units: UnitSettings = M_UNITS): void {
  const got = parseLength(input, units)
  expect(got, `parseLength(${JSON.stringify(input)}) === null`).not.toBeNull()
  expect(Math.abs((got as number) - expected) <= 1e-12, `${input}: ${got} != ${expected}`).toBe(true)
}

/* ------------------------------------------------------------------ */
/* Umrechnungsfaktoren                                                 */
/* ------------------------------------------------------------------ */

describe('units - Konstanten', () => {
  it('LENGTH_TO_M nutzt die exakten Normwerte', () => {
    expect(LENGTH_TO_M.m).toBe(1)
    expect(LENGTH_TO_M.cm).toBe(0.01)
    expect(LENGTH_TO_M.mm).toBe(0.001)
    expect(LENGTH_TO_M.in).toBe(0.0254)
    expect(LENGTH_TO_M.ft).toBe(0.3048)
    expect(LENGTH_TO_M.yd).toBe(0.9144)
    // ftin ist eine reine ANZEIGE-Variante von Fuss
    expect(LENGTH_TO_M.ftin).toBe(LENGTH_TO_M.ft)
  })
})

/* ------------------------------------------------------------------ */
/* parseLength - alle im Kommentar zugesagten Formate                  */
/* ------------------------------------------------------------------ */

describe('parseLength - metrische Eingaben', () => {
  it('"5m" / "2.5m" / "1,5m"', () => {
    expectLength('5m', 5)
    expectLength('2.5m', 2.5)
    expectLength('1,5m', 1.5)
    expectLength('2.5 m', 2.5)
  })

  it('"500mm" und "12,5 cm" (deutsches Dezimalkomma)', () => {
    expectLength('500mm', 0.5)
    expectLength('12,5 cm', 0.125)
    expectLength('12.5cm', 0.125)
    expectLength('1 mm', 0.001)
  })

  it('Vorzeichen und Null', () => {
    expectLength('-2m', -2)
    expectLength('+2m', 2)
    expectLength('0', 0, metric({ lengthUnit: 'm' }))
    expectLength('0m', 0)
  })

  it('Grossbuchstaben und Leerzeichen werden toleriert', () => {
    expectLength('  2.5 M  ', 2.5)
    expectLength('500 MM', 0.5)
  })
})

describe('parseLength - imperiale Eingaben', () => {
  it('"3\'6\\"" -> 42 Zoll', () => {
    expectLength(`3'6"`, 42 * IN)
  })

  it('"3\' 6\\"" mit Leerzeichen und "3\'6" ohne Zollzeichen', () => {
    expectLength(`3' 6"`, 42 * IN)
    expectLength(`3'6`, 42 * IN)
  })

  it('"3\'" allein sind 3 Fuss', () => {
    expectLength(`3'`, 3 * FT)
  })

  it('"6\\"" allein sind 6 Zoll', () => {
    expectLength(`6"`, 6 * IN)
  })

  it('"1 1/2\\"" -> gemischter Bruch', () => {
    expectLength(`1 1/2"`, 1.5 * IN)
  })

  it('"3/4\\"" -> reiner Bruch', () => {
    expectLength(`3/4"`, 0.75 * IN)
  })

  it('"3\' 6 1/2\\"" -> Fuss plus gemischter Bruch', () => {
    expectLength(`3' 6 1/2"`, 42.5 * IN)
  })

  it('"5ft" / "5 feet" / "5 in" / "2yd"', () => {
    expectLength('5ft', 5 * FT)
    expectLength('5 feet', 5 * FT)
    expectLength('1 foot', FT)
    expectLength('5 in', 5 * IN)
    expectLength('5 inches', 5 * IN)
    expectLength('2yd', 2 * LENGTH_TO_M.yd)
  })

  it('negative Fuss-Zoll-Kombination behaelt das Vorzeichen im ganzen Ausdruck', () => {
    expectLength(`-3'6"`, -42 * IN)
  })

  it('typografische Anfuehrungszeichen werden normalisiert', () => {
    expectLength('3′ 6″', 42 * IN)
  })
})

describe('parseLength - blanke Zahl folgt units.lengthUnit', () => {
  it('mm-Dokument: "5" sind 5 mm', () => {
    expectLength('5', 0.005, metric({ lengthUnit: 'mm' }))
  })

  it('m-Dokument: "5" sind 5 m', () => {
    expectLength('5', 5, metric({ lengthUnit: 'm' }))
  })

  it('cm-Dokument: "12,5" sind 12,5 cm', () => {
    expectLength('12,5', 0.125, metric({ lengthUnit: 'cm' }))
  })

  it('ftin-Dokument: "5" sind 5 ZOLL (wie in SketchUp)', () => {
    expectLength('5', 5 * IN, imperial())
  })

  it('ft-Dokument: "5" sind 5 Fuss', () => {
    expectLength('5', 5 * FT, metric({ lengthUnit: 'ft' }))
  })
})

describe('parseLength - ungueltige Eingaben liefern null', () => {
  it.each(['', '   ', 'abc', '5 parsec', '1/0', '--3', 'm', '5m5'])('%s', (bad) => {
    expect(parseLength(bad, M_UNITS)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* parseAngle / parseNumber / parseLengthList                          */
/* ------------------------------------------------------------------ */

describe('parseAngle', () => {
  const deg = metric({ angleUnit: 'deg' })
  const rad = metric({ angleUnit: 'rad' })

  it('Gradangaben in allen Schreibweisen', () => {
    for (const s of ['45', '45deg', '45d', '45°', '45 deg']) {
      const got = parseAngle(s, deg)
      expect(got, s).not.toBeNull()
      expect(Math.abs((got as number) - Math.PI / 4) < 1e-12, s).toBe(true)
    }
  })

  it('explizites rad schlaegt die Dokumenteinstellung', () => {
    expect(parseAngle('0.5rad', deg)).toBeCloseTo(0.5, 12)
    expect(parseAngle('0,5 rad', deg)).toBeCloseTo(0.5, 12)
  })

  it('blanke Zahl folgt units.angleUnit', () => {
    expect(parseAngle('45', rad)).toBeCloseTo(45, 12)
    expect(parseAngle('45', deg)).toBeCloseTo(Math.PI / 4, 12)
  })

  it('negative Winkel und Unsinn', () => {
    expect(parseAngle('-90', deg)).toBeCloseTo(-Math.PI / 2, 12)
    expect(parseAngle('abc', deg)).toBeNull()
  })
})

describe('parseNumber', () => {
  it('erlaubt blanke Zahlen, Komma und x-Praefix/-Suffix', () => {
    expect(parseNumber('2')).toBe(2)
    expect(parseNumber('1,5')).toBe(1.5)
    expect(parseNumber('x3')).toBe(3)
    expect(parseNumber('3x')).toBe(3)
    expect(parseNumber('abc')).toBeNull()
  })
})

describe('parseLengthList', () => {
  it('trennt an ";" damit das Dezimalkomma erhalten bleibt', () => {
    expect(parseLengthList('2;3', metric({ lengthUnit: 'm' }))).toEqual([2, 3])
    const res = parseLengthList('2,5; 4', metric({ lengthUnit: 'm' }))
    expect(res[0]).toBeCloseTo(2.5, 12)
    expect(res[1]).toBeCloseTo(4, 12)
  })

  it('leere Teilstuecke werden zu null (Nutzer hat nur eine Achse getippt)', () => {
    expect(parseLengthList('2;', metric({ lengthUnit: 'm' }))).toEqual([2, null])
    expect(parseLengthList(';3', metric({ lengthUnit: 'm' }))).toEqual([null, 3])
  })

  it('trennt auch an "x"', () => {
    expect(parseLengthList('2x3', metric({ lengthUnit: 'm' }))).toEqual([2, 3])
  })
})

/* ------------------------------------------------------------------ */
/* formatLength                                                        */
/* ------------------------------------------------------------------ */

describe('formatLength - dezimal', () => {
  it('mm-Dokument mit einer Nachkommastelle', () => {
    expect(formatLength(1, metric({ lengthUnit: 'mm', precision: 1 }))).toBe('1000 mm')
    expect(formatLength(0.0125, metric({ lengthUnit: 'mm', precision: 1 }))).toBe('12.5 mm')
  })

  it('m-Dokument', () => {
    expect(formatLength(1.5, metric({ lengthUnit: 'm', precision: 2 }))).toBe('1.5 m')
    expect(formatLength(2, metric({ lengthUnit: 'm', precision: 2 }))).toBe('2 m')
  })

  it('cm-Dokument', () => {
    expect(formatLength(0.12, metric({ lengthUnit: 'cm', precision: 0 }))).toBe('12 cm')
  })

  it('Suffix laesst sich abschalten - global und pro Aufruf', () => {
    expect(formatLength(1.5, metric({ lengthUnit: 'm', precision: 2, displayUnitSuffix: false }))).toBe('1.5')
    expect(formatLength(1.5, metric({ lengthUnit: 'm', precision: 2 }), { suffix: false })).toBe('1.5')
  })

  it('Zoll und Fuss haengen ihr Zeichen ohne Leerzeichen an', () => {
    expect(formatLength(IN, metric({ lengthUnit: 'in', precision: 2 }))).toBe('1"')
    expect(formatLength(FT, metric({ lengthUnit: 'ft', precision: 2 }))).toBe("1'")
  })

  it('nicht endliche Werte ergeben "-"', () => {
    expect(formatLength(Number.NaN, M_UNITS)).toBe('-')
    expect(formatLength(Number.POSITIVE_INFINITY, M_UNITS)).toBe('-')
  })

  it('negative Laengen behalten ihr Vorzeichen', () => {
    expect(formatLength(-1.5, metric({ lengthUnit: 'm', precision: 2 }))).toBe('-1.5 m')
  })
})

describe('formatLength - architektonisch', () => {
  const arch = imperial()

  it('volle Fuss ohne Zollanteil', () => {
    expect(formatLength(3 * FT, arch)).toBe(`3'`)
    expect(formatLength(FT, arch)).toBe(`1'`)
  })

  it('Fuss und Zoll', () => {
    expect(formatLength(42 * IN, arch)).toBe(`3' 6"`)
  })

  it('Fuss, Zoll und Bruch', () => {
    expect(formatLength(42.5 * IN, arch)).toBe(`3' 6 1/2"`)
    expect(formatLength(42.25 * IN, arch)).toBe(`3' 6 1/4"`)
  })

  it('reine Zollangaben unterhalb eines Fusses', () => {
    expect(formatLength(6 * IN, arch)).toBe(`6"`)
    expect(formatLength(1.5 * IN, arch)).toBe(`1 1/2"`)
    expect(formatLength(0.5 * IN, arch)).toBe(`1/2"`)
    expect(formatLength(0, arch)).toBe(`0"`)
  })

  it('Brueche werden vollstaendig gekuerzt', () => {
    expect(formatLength(0.25 * IN, arch)).toBe(`1/4"`)
    expect(formatLength(0.125 * IN, arch)).toBe(`1/8"`)
    expect(formatLength(0.0625 * IN, arch)).toBe(`1/16"`)
    // 8/16 -> 1/2, 12/16 -> 3/4
    expect(formatLength(0.75 * IN, arch)).toBe(`3/4"`)
  })

  it('negative Werte', () => {
    expect(formatLength(-42 * IN, arch)).toBe(`-3' 6"`)
    expect(formatLength(-6 * IN, arch)).toBe(`-6"`)
  })

  it('lengthUnit "ftin" erzwingt die architektonische Anzeige auch bei format "decimal"', () => {
    expect(formatLength(42 * IN, imperial({ format: 'decimal' }))).toBe(`3' 6"`)
  })

  /* -------------------------------------------------------------- */
  /* BLOCKER B-3 - siehe QA-REVIEW.md                                */
  /* -------------------------------------------------------------- */

  it('B-3 (IST-Zustand): der Uebertrag der Bruchrundung erreicht die Fuss-Stelle nicht', () => {
    // 11,99 Zoll runden bei 1/16 auf 12/12 Zoll - der Uebertrag bleibt im Zollteil stehen
    expect(formatLength(11.99 * IN, arch)).toBe(`12"`)
    expect(formatLength(23.99 * IN, arch)).toBe(`1' 12"`)
  })

  it.fails('B-3 (SOLL): Rundung auf 12 Zoll muss auf den Fuss aufaddieren', () => {
    expect(formatLength(11.99 * IN, arch)).toBe(`1'`)
    expect(formatLength(23.99 * IN, arch)).toBe(`2'`)
  })

  it('formatLength/parseLength sind fuer architektonische Werte rundlaufend', () => {
    for (const inches of [0.5, 6, 42, 42.5, 100.25]) {
      const text = formatLength(inches * IN, arch)
      const back = parseLength(text, arch)
      expect(back, `Rueckparsen von ${text}`).not.toBeNull()
      expect(Math.abs((back as number) - inches * IN) < 1e-12, `${text}: ${back}`).toBe(true)
    }
  })
})

describe('formatLength - bruchweise (fractional)', () => {
  const frac = metric({ format: 'fractional', lengthUnit: 'in', fractionDenominator: 16 })

  it('ganze und gemischte Zoll', () => {
    expect(formatLength(2 * IN, frac)).toBe(`2"`)
    expect(formatLength(1.5 * IN, frac)).toBe(`1 1/2"`)
    expect(formatLength(0.25 * IN, frac)).toBe(`1/4"`)
  })

  it('negative gemischte Brueche behalten ihr Vorzeichen', () => {
    expect(formatLength(-1.5 * IN, frac)).toBe(`-1 1/2"`)
  })

  /* -------------------------------------------------------------- */
  /* WICHTIG W-1 - siehe QA-REVIEW.md                                */
  /* -------------------------------------------------------------- */

  it('W-1 (IST-Zustand): das Vorzeichen geht bei reinen Bruchwerten verloren', () => {
    // toFraction liefert whole = -0; der Test `whole !== 0` greift nicht,
    // weil -0 === 0 gilt. Ergebnis: -1/2" wird als 1/2" angezeigt.
    expect(formatLength(-0.5 * IN, frac)).toBe(`1/2"`)
    expect(formatLength(-0.25 * IN, frac)).toBe(`1/4"`)
  })

  it.fails('W-1 (SOLL): negative Brueche unterhalb von 1 behalten ihr Vorzeichen', () => {
    expect(formatLength(-0.5 * IN, frac)).toBe(`-1/2"`)
  })
})

/* ------------------------------------------------------------------ */
/* Uebrige Formatierer                                                 */
/* ------------------------------------------------------------------ */

describe('formatAngle / formatArea / formatVolume / formatPoint', () => {
  it('formatAngle in Grad und Radiant', () => {
    expect(formatAngle(Math.PI / 4, metric({ angleUnit: 'deg' }))).toBe('45°')
    expect(formatAngle(Math.PI, metric({ angleUnit: 'deg' }))).toBe('180°')
    expect(formatAngle(0.5, metric({ angleUnit: 'rad', precision: 2 }))).toBe('0.5 rad')
    expect(formatAngle(Math.PI / 4, metric({ angleUnit: 'deg', displayUnitSuffix: false }))).toBe('45')
  })

  it('formatArea rechnet in die eingestellte Flaecheneinheit', () => {
    expect(formatArea(2.5, metric({ areaUnit: 'm2' }))).toBe('2.5 m²')
    expect(formatArea(1, metric({ areaUnit: 'cm2' }))).toBe('10000 cm²')
  })

  it('formatVolume rechnet in die eingestellte Volumeneinheit', () => {
    expect(formatVolume(1.5, metric({ volumeUnit: 'm3' }))).toBe('1.5 m³')
    expect(formatVolume(1, metric({ volumeUnit: 'l' }))).toBe('1000 l')
  })

  it('formatPoint nutzt formatLength ohne Suffix', () => {
    expect(formatPoint({ x: 2, y: 1.5, z: 0 }, metric({ lengthUnit: 'm', precision: 2 }))).toBe('[2; 1.5; 0]')
  })
})

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

describe('snapLength / snapAngle', () => {
  it('snapLength ist ohne enableLengthSnap wirkungslos', () => {
    expect(snapLength(1.23456, metric({ enableLengthSnap: false, lengthSnap: 0.01 }))).toBe(1.23456)
  })

  it('snapLength rastet auf das Inkrement', () => {
    expect(snapLength(1.234, metric({ enableLengthSnap: true, lengthSnap: 0.01 }))).toBeCloseTo(1.23, 10)
    expect(snapLength(1.236, metric({ enableLengthSnap: true, lengthSnap: 0.01 }))).toBeCloseTo(1.24, 10)
  })

  it('snapLength mit lengthSnap 0 ist wirkungslos', () => {
    expect(snapLength(1.23456, metric({ enableLengthSnap: true, lengthSnap: 0 }))).toBe(1.23456)
  })

  it('snapAngle rastet auf das Gradinkrement', () => {
    const u = metric({ enableAngleSnap: true, angleSnap: 15 })
    expect(snapAngle((17 * Math.PI) / 180, u)).toBeCloseTo((15 * Math.PI) / 180, 12)
    expect(snapAngle((23 * Math.PI) / 180, u)).toBeCloseTo((30 * Math.PI) / 180, 12)
    expect(snapAngle(1, metric({ enableAngleSnap: false, angleSnap: 15 }))).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Vorgabe-Einstellungen                                               */
/* ------------------------------------------------------------------ */

describe('units - Vorgaben', () => {
  it('DEFAULT_UNITS ist metrisch und dezimal', () => {
    expect(DEFAULT_UNITS.format).toBe('decimal')
    expect(DEFAULT_UNITS.angleUnit).toBe('deg')
  })

  it('IMPERIAL_UNITS ist architektonisch mit Fuss/Zoll', () => {
    expect(IMPERIAL_UNITS.format).toBe('architectural')
    expect(IMPERIAL_UNITS.lengthUnit).toBe('ftin')
    expect(IMPERIAL_UNITS.areaUnit).toBe('ft2')
  })
})
