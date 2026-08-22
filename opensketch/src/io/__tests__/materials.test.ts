/**
 * Materialbibliothek.
 *
 * Der Katalog wird vom Material-Browser direkt angezeigt und von den
 * Komponenten ueber feste Ids referenziert - beides bricht still, wenn hier
 * etwas nicht stimmt. Ausserdem muss die Texturerzeugung in Node (kein
 * `document`) sauber auf reine Farben zurueckfallen, statt zu werfen.
 */

import { describe, expect, it } from 'vitest'
import {
  getLibraryMaterials,
  getLibraryTextures,
  getMaterialCategories,
  libraryMaterialId,
  libraryTextureId,
  MATERIAL_CATEGORIES,
  resetMaterialCache,
} from '../library/materials'
import { canGenerateTextures, createTexture, TEXTURE_SIZE } from '../common/texture'
import { getLibraryComponents } from '../library'
import { hexToRgb01, parseCssColor } from '../common/util'

const MATERIALS = getLibraryMaterials()

/* ------------------------------------------------------------------ */
/* Katalog                                                             */
/* ------------------------------------------------------------------ */

describe('Materialbibliothek', () => {
  it('liefert die versprochenen rund 50 Materialien', () => {
    expect(MATERIALS.length).toBeGreaterThanOrEqual(50)
  })

  it('vergibt eindeutige, stabile Ids', () => {
    const ids = MATERIALS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('mlib_')).toBe(true)
    // zweiter Aufruf liefert dieselben Ids
    expect(getLibraryMaterials().map((m) => m.id)).toEqual(ids)
  })

  it('baut Ids nach dem vereinbarten Muster', () => {
    expect(libraryMaterialId('eiche-hell')).toBe('mlib_eiche-hell')
    expect(libraryTextureId('eiche-hell')).toBe('xlib_eiche-hell')
  })

  it('fuellt jede der zehn Kategorien', () => {
    expect(getMaterialCategories()).toEqual([...MATERIAL_CATEGORIES])
    expect(MATERIAL_CATEGORIES.length).toBe(10)
    for (const category of MATERIAL_CATEGORIES) {
      const inCategory = MATERIALS.filter((m) => m.category === category)
      expect(inCategory.length, `Kategorie ${category} ist leer`).toBeGreaterThan(0)
    }
  })

  it('benutzt keine Kategorie ausserhalb der Liste', () => {
    for (const material of MATERIALS) {
      expect(MATERIAL_CATEGORIES, material.name).toContain(material.category)
    }
  })

  it('hat gueltige Hex-Farben', () => {
    for (const material of MATERIALS) {
      expect(material.color, material.name).toMatch(/^#[0-9a-f]{6}$/)
      expect(parseCssColor(material.color)).toBe(material.color)
      for (const channel of hexToRgb01(material.color)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('haelt opacity, roughness und metalness in [0, 1]', () => {
    for (const material of MATERIALS) {
      for (const [label, value] of [
        ['opacity', material.opacity],
        ['roughness', material.roughness],
        ['metalness', material.metalness],
      ] as const) {
        expect(Number.isFinite(value), `${material.name}.${label}`).toBe(true)
        expect(value, `${material.name}.${label}`).toBeGreaterThanOrEqual(0)
        expect(value, `${material.name}.${label}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('gibt jeder Kachel eine positive Groesse in Metern', () => {
    for (const material of MATERIALS) {
      expect(material.textureWidth, material.name).toBeGreaterThan(0)
      expect(material.textureHeight, material.name).toBeGreaterThan(0)
      expect(material.textureWidth, material.name).toBeLessThanOrEqual(10)
    }
  })

  it('benennt alles auf Deutsch, ohne Doppelungen', () => {
    const names = MATERIALS.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name.trim().length).toBeGreaterThan(0)
      expect(name).not.toMatch(/\b(wood|stone|metal|glass|plastic|fabric|paint|roof|floor|grass)\b/i)
    }
  })

  it('gibt Glas und Acryl eine Deckkraft unter 1', () => {
    const glass = MATERIALS.filter((m) => m.category === 'Glas')
    expect(glass.length).toBeGreaterThan(0)
    expect(glass.some((m) => m.opacity < 1)).toBe(true)
    expect(MATERIALS.find((m) => m.id === 'mlib_klarglas')!.opacity).toBeLessThan(0.5)
  })

  it('liefert bei jedem Aufruf eine eigene Kopie', () => {
    const first = getLibraryMaterials()
    first[0].color = '#000000'
    expect(getLibraryMaterials()[0].color).not.toBe('#000000')
  })
})

/* ------------------------------------------------------------------ */
/* Verwendung durch die Komponenten                                    */
/* ------------------------------------------------------------------ */

describe('Materialverweise der Bibliothekskomponenten', () => {
  it('benutzt ausschliesslich Materialien, die es gibt', () => {
    const known = new Set(MATERIALS.map((m) => m.id))
    const missing = new Map<string, string[]>()
    for (const entry of getLibraryComponents()) {
      const geometry = entry.build().definitions[0].geometry
      for (const face of Object.values(geometry.faces)) {
        for (const id of [face.frontMaterialId, face.backMaterialId]) {
          if (!id || known.has(id)) continue
          const list = missing.get(id) ?? []
          if (!list.includes(entry.id)) list.push(entry.id)
          missing.set(id, list)
        }
      }
    }
    expect([...missing.entries()].map(([id, ids]) => `${id} in ${ids.join(', ')}`)).toEqual([])
  })

  it('bemalt praktisch jede Flaeche', () => {
    let painted = 0
    let total = 0
    for (const entry of getLibraryComponents()) {
      for (const face of Object.values(entry.build().definitions[0].geometry.faces)) {
        total++
        if (face.frontMaterialId) painted++
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(painted / total).toBeGreaterThan(0.95)
  })
})

/* ------------------------------------------------------------------ */
/* Texturen ohne Browser                                               */
/* ------------------------------------------------------------------ */

describe('Texturerzeugung in Node', () => {
  it('erkennt, dass hier kein Canvas zur Verfuegung steht', () => {
    expect(typeof document).toBe('undefined')
    expect(canGenerateTextures()).toBe(false)
  })

  it('liefert null statt zu werfen', () => {
    for (const kind of ['wood', 'brick', 'tile', 'grass', 'gravel', 'roof'] as const) {
      expect(createTexture({ kind, base: '#c8a26a', accent: '#9b7440' })).toBeNull()
    }
    expect(TEXTURE_SIZE).toBeGreaterThan(0)
  })

  it('laesst die Materialien dann reine Farben bleiben', () => {
    resetMaterialCache()
    const materials = getLibraryMaterials()
    expect(getLibraryTextures()).toEqual([])
    for (const material of materials) {
      expect(material.textureId, `${material.name} hat eine Textur ohne Canvas`).toBeNull()
      // die Kachelgroesse bleibt trotzdem erhalten, damit UVs stimmen
      expect(material.textureWidth).toBeGreaterThan(0)
    }
  })

  it('baut den Katalog nach einem Cache-Reset unveraendert wieder auf', () => {
    const before = getLibraryMaterials()
    resetMaterialCache()
    expect(getLibraryMaterials()).toEqual(before)
  })
})
