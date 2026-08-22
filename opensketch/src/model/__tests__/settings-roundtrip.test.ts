/**
 * Generische Absicherung gegen stillen Datenverlust beim Laden.
 *
 * `normalizeStyles`, `normalizeUnits`, `normalizeSun` und `normalizeFog` in
 * serialize.ts zaehlen jedes Feld EINZELN auf und nehmen die Voreinstellung
 * als Basis. Ein Feld, das dort fehlt, faellt beim Lesen still auf den
 * Standard zurueck - ohne Fehler, ohne Hinweis. Genau so waere `showGuides`
 * durchgerutscht: der Nutzer schaltet die Hilfslinien ab, speichert, oeffnet
 * wieder, und sie sind zurueck.
 *
 * Ein Round-Trip mit einem handgeschriebenen Testdokument faengt das nur,
 * wenn zufaellig genau dieses Feld abweichend gesetzt wurde. Dieser Test
 * laeuft stattdessen ueber die SCHLUESSEL der Voreinstellung und veraendert
 * jeden einzelnen automatisch - er kennt kuenftige Felder also von selbst.
 *
 * OWNERSHIP: Lead (uebernommen nach Abschluss der Modellschicht).
 */

import { describe, expect, it } from 'vitest'
import {
  createDefaultFog,
  createDefaultStyle,
  createDefaultSun,
  createEmptyDocument,
  deserializeDocument,
  serializeDocument,
} from '@/model'
import { DEFAULT_UNITS } from '@/shared/units'

/**
 * Erzeugt zu jedem Wert einen garantiert abweichenden, aber GUELTIGEN Wert
 * gleichen Typs.
 *
 * Die Gueltigkeit ist der Knackpunkt: `normalizeUnits` klemmt `precision` auf
 * ganze Zahlen und laesst fuer `fractionDenominator` nur Zweierpotenzen zu.
 * Ein automatisch erzeugter Wert wie 3,07 wird dort zu Recht verworfen - der
 * Test haette dann Datenverlust gemeldet, wo saubere Validierung stattfand.
 * Beschraenkte Felder brauchen deshalb eine eigene Regel.
 */
const ERLAUBTE_NENNER = [2, 4, 8, 16, 32, 64]

function abweichend(wert: unknown, schluessel: string): unknown {
  if (typeof wert === 'boolean') return !wert
  if (schluessel === 'fractionDenominator') {
    return ERLAUBTE_NENNER.find((n) => n !== wert) ?? 8
  }
  if (typeof wert === 'number') {
    // Ganzzahlige Felder ganzzahlig veraendern, sonst greifen Rundungsklemmen.
    if (Number.isInteger(wert)) return wert === 0 ? 1 : wert + 1
    return Math.round(wert * 100 + 7) / 100
  }
  if (typeof wert === 'string') {
    // Farben muessen Farben bleiben, Aufzaehlungen brauchen gueltige Werte.
    if (/^#[0-9a-f]{6}$/i.test(wert)) return wert === '#123456' ? '#654321' : '#123456'
    if (schluessel === 'faceStyle') return wert === 'wireframe' ? 'monochrome' : 'wireframe'
    if (schluessel === 'edgeColorMode') return wert === 'byTag' ? 'byMaterial' : 'byTag'
    if (schluessel === 'format') return wert === 'architectural' ? 'decimal' : 'architectural'
    if (schluessel === 'lengthUnit') return wert === 'cm' ? 'mm' : 'cm'
    if (schluessel === 'angleUnit') return wert === 'rad' ? 'deg' : 'rad'
    if (schluessel === 'areaUnit') return wert === 'cm2' ? 'mm2' : 'cm2'
    if (schluessel === 'volumeUnit') return wert === 'cm3' ? 'l' : 'cm3'
    if (schluessel === 'date') return '2001-02-03'
    if (schluessel === 'id') return wert
    return `${wert}-x`
  }
  return wert
}

/** Feldnamen, die absichtlich nicht ueberleben sollen. */
const AUSGENOMMEN = new Set(['id'])

function pruefeRoundTrip(
  name: string,
  standard: Record<string, unknown>,
  einsetzen: (doc: ReturnType<typeof createEmptyDocument>, wert: Record<string, unknown>) => void,
  auslesen: (doc: ReturnType<typeof createEmptyDocument>) => Record<string, unknown>,
): void {
  describe(name, () => {
    const schluessel = Object.keys(standard).filter((k) => !AUSGENOMMEN.has(k))

    it(`deckt alle ${schluessel.length} Felder ab`, () => {
      expect(schluessel.length).toBeGreaterThan(0)
    })

    for (const k of schluessel) {
      it(`erhaelt "${k}" ueber Speichern und Laden`, () => {
        const doc = createEmptyDocument('metric')
        const veraendert = { ...standard, [k]: abweichend(standard[k], k) }
        // Nur pruefen, wenn sich der Wert wirklich unterscheidet - sonst
        // waere der Test blind.
        expect(veraendert[k]).not.toEqual(standard[k])
        einsetzen(doc, veraendert)
        const zurueck = deserializeDocument(serializeDocument(doc))
        expect(auslesen(zurueck)[k]).toEqual(veraendert[k])
      })
    }
  })
}

pruefeRoundTrip(
  'StyleSettings',
  createDefaultStyle() as unknown as Record<string, unknown>,
  (doc, wert) => {
    const id = doc.activeStyleId
    doc.styles[id] = { ...(wert as Record<string, unknown>), id } as never
  },
  (doc) => doc.styles[doc.activeStyleId] as unknown as Record<string, unknown>,
)

pruefeRoundTrip(
  'SunSettings',
  createDefaultSun() as unknown as Record<string, unknown>,
  (doc, wert) => {
    doc.sun = wert as never
  },
  (doc) => doc.sun as unknown as Record<string, unknown>,
)

pruefeRoundTrip(
  'FogSettings',
  createDefaultFog() as unknown as Record<string, unknown>,
  (doc, wert) => {
    doc.fog = wert as never
  },
  (doc) => doc.fog as unknown as Record<string, unknown>,
)

pruefeRoundTrip(
  'UnitSettings',
  DEFAULT_UNITS as unknown as Record<string, unknown>,
  (doc, wert) => {
    doc.units = wert as never
  },
  (doc) => doc.units as unknown as Record<string, unknown>,
)
