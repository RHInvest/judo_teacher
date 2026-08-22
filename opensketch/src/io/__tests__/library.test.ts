/**
 * Jeder einzelne Bibliothekseintrag wird gebaut und geprueft.
 *
 * Der Katalog ist reiner Code - ein Tippfehler in einer Koordinate faellt sonst
 * erst dem Nutzer auf. Deshalb laeuft hier `build()` fuer JEDEN Eintrag:
 * fehlerfrei, nicht leer, topologisch gueltig, Abmessungen wie angegeben,
 * Beschriftungen auf Deutsch.
 */

import { describe, expect, it } from 'vitest'
import * as core from '@/core'
import {
  buildLibraryComponent,
  getLibraryCategories,
  getLibraryComponent,
  getLibraryComponents,
  libraryComponentCount,
} from '../library'
import { COMPONENT_CATEGORIES, type LibraryEntry } from '../library/types'
import { geometryBounds } from '../common/geom'

const ALL = getLibraryComponents()

/* ------------------------------------------------------------------ */
/* Groessenangaben                                                     */
/* ------------------------------------------------------------------ */

interface SizeSpec {
  /** Abmessungen in Metern, unsortiert */
  dims: number[]
  /** rotationssymmetrisch: "Ø 100 × 100 cm" */
  round: boolean
  /** Angabe beschreibt nur die Oeffnung, nicht das Bauteil */
  opening: boolean
}

/** Zerlegt "88,5 × 201 cm (Öffnung)" oder "Ø 100 × 50 cm" in Meter. */
export function parseSize(size: string): SizeSpec | null {
  const opening = /Öffnung/i.test(size)
  const round = size.includes('Ø')
  const numbers = size
    .replace(/\(.*?\)/g, '')
    .match(/\d+(?:[.,]\d+)?/g)
  if (!numbers || numbers.length === 0) return null
  const unit = /\bmm\b/.test(size) ? 0.001 : /\bm\b/.test(size) && !/\bcm\b/.test(size) ? 1 : 0.01
  const dims = numbers.map((n) => parseFloat(n.replace(',', '.')) * unit)
  if (round) {
    // "Ø D" = Kugel, "Ø D × H" = Rotationskoerper
    if (dims.length === 1) return { dims: [dims[0], dims[0], dims[0]], round, opening }
    if (dims.length === 2) return { dims: [dims[0], dims[0], dims[1]], round, opening }
  }
  return { dims, round, opening }
}

/** Toleranz: 3 % der Kante, mindestens 1 cm - Segmentierung rundet Kreise ab. */
function sizeTolerance(value: number): number {
  return Math.max(0.01, value * 0.03)
}

/* ------------------------------------------------------------------ */
/* Katalog                                                             */
/* ------------------------------------------------------------------ */

describe('Komponentenbibliothek - Katalog', () => {
  it('enthaelt ausreichend viele Eintraege', () => {
    expect(ALL.length).toBe(libraryComponentCount())
    expect(ALL.length).toBeGreaterThanOrEqual(50)
  })

  it('vergibt eindeutige Ids', () => {
    const ids = ALL.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('kennt jede Id ueber getLibraryComponent', () => {
    for (const entry of ALL) {
      expect(getLibraryComponent(entry.id)).toBe(entry)
    }
    expect(getLibraryComponent('gibt-es-nicht')).toBeNull()
  })

  it('benutzt nur bekannte Kategorien und liefert sie in Reihenfolge', () => {
    const categories = getLibraryCategories()
    for (const entry of ALL) expect(COMPONENT_CATEGORIES).toContain(entry.category)
    for (const category of categories) {
      expect(getLibraryComponents(category).length).toBeGreaterThan(0)
    }
    expect(categories).toEqual(COMPONENT_CATEGORIES.filter((c) => categories.includes(c)))
  })

  it('fuellt jede Kategorie', () => {
    for (const category of COMPONENT_CATEGORIES) {
      expect(getLibraryComponents(category).length, `Kategorie ${category} ist leer`).toBeGreaterThan(0)
    }
  })

  it('beschriftet alles auf Deutsch ohne Platzhalter', () => {
    for (const entry of ALL) {
      expect(entry.name.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.description.trim().length, entry.id).toBeGreaterThan(0)
      // Beschreibung ist ein Satz, kein Bezeichner
      expect(entry.description, entry.id).not.toMatch(/^[a-z0-9_-]+$/)
      expect(entry.description, entry.id).not.toMatch(/\b(TODO|TBD|Lorem|placeholder)\b/i)
      // Englische Fuellwoerter deuten auf vergessene Uebersetzung hin
      expect(`${entry.name} ${entry.description}`, entry.id).not.toMatch(
        /\b(the|with|width|height|depth|and|from|default)\b/i,
      )
    }
  })

  it('gibt jedem Eintrag eine Groessenangabe', () => {
    for (const entry of ALL) {
      expect(entry.size, `${entry.id} ohne size`).toBeTruthy()
      expect(parseSize(entry.size ?? ''), `${entry.id}: "${entry.size}" nicht lesbar`).not.toBeNull()
    }
  })

  it('liefert build() auch ueber buildLibraryComponent', () => {
    const built = buildLibraryComponent(ALL[0].id)
    expect(built).not.toBeNull()
    expect(built!.definitions.some((d) => d.id === built!.rootId)).toBe(true)
    expect(buildLibraryComponent('gibt-es-nicht')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Jeder einzelne Eintrag                                              */
/* ------------------------------------------------------------------ */

describe.each(ALL.map((e) => [e.id, e] as [string, LibraryEntry]))(
  'Bibliothekseintrag %s',
  (_id, entry) => {
    const built = entry.build()
    const root = built.definitions.find((d) => d.id === built.rootId)

    it('liefert eine Wurzeldefinition', () => {
      expect(built.definitions.length).toBeGreaterThan(0)
      expect(root, 'rootId zeigt auf keine gelieferte Definition').toBeTruthy()
      expect(root!.name).toBe(entry.name)
      expect(root!.isLibrary).toBe(true)
      expect(root!.kind).toBe('component')
    })

    it('erzeugt nicht-leere Geometrie', () => {
      const geom = root!.geometry
      expect(Object.keys(geom.vertices).length).toBeGreaterThan(3)
      expect(Object.keys(geom.edges).length).toBeGreaterThan(2)
      expect(Object.keys(geom.faces).length).toBeGreaterThan(0)
    })

    it('ist topologisch gueltig', () => {
      expect(core.validate(root!.geometry)).toEqual([])
    })

    it('hat eine Flaeche mit endlichem Inhalt', () => {
      const geom = root!.geometry
      let area = 0
      for (const id of Object.keys(geom.faces)) area += core.faceArea(geom, id)
      expect(Number.isFinite(area)).toBe(true)
      expect(area).toBeGreaterThan(0)
    })

    it('steht ohne NaN im Raum', () => {
      for (const v of Object.values(root!.geometry.vertices)) {
        expect(Number.isFinite(v.p.x) && Number.isFinite(v.p.y) && Number.isFinite(v.p.z), v.id).toBe(true)
      }
    })

    it('haelt die angegebene Groesse ein', () => {
      const spec = parseSize(entry.size ?? '')
      expect(spec).not.toBeNull()
      const b = geometryBounds(root!.geometry)
      const actual = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]

      if (spec!.opening) {
        // Die Angabe beschreibt die Rohbauoeffnung; das Bauteil selbst ist
        // hoechstens ein Rahmen groesser, aber nie kleiner.
        const wanted = [...spec!.dims].sort((a, b2) => b2 - a)
        const have = [...actual].sort((a, b2) => b2 - a)
        for (let i = 0; i < wanted.length; i++) {
          expect(have[i], `${entry.id}: Achse ${i} kleiner als die Öffnung`).toBeGreaterThanOrEqual(
            wanted[i] - sizeTolerance(wanted[i]),
          )
        }
        return
      }

      const wanted = [...spec!.dims].sort((a, b2) => a - b2)
      const have = [...actual].sort((a, b2) => a - b2)
      expect(have.length).toBe(wanted.length)
      for (let i = 0; i < wanted.length; i++) {
        expect(
          Math.abs(have[i] - wanted[i]),
          `${entry.id}: "${entry.size}" vs. ${actual.map((v) => (v * 100).toFixed(1)).join(' × ')} cm`,
        ).toBeLessThanOrEqual(sizeTolerance(wanted[i]))
      }
    })
  },
)
