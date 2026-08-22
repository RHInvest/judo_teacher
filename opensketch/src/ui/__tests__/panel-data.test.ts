/**
 * Echte Daten statt Attrappen.
 *
 * Die Panels sollen am fertigen Modell haengen, nicht an Beispieldaten. Diese
 * Tests fragen genau die Quellen ab, aus denen die Panels lesen, und pruefen,
 * dass dort tatsaechlich etwas steht und die Felder gefuellt sind, die die
 * Kacheln anzeigen. Ein Panel, das eine leere Bibliothek hoeflich mit
 * "noch nicht gefuellt" quittiert, sieht sonst genauso aus wie eins, das
 * funktioniert.
 */

import { describe, expect, it } from 'vitest'
import { detectFormat, getLibraryCategories, getLibraryComponents, getLibraryMaterials, importableExtensions } from '@/io'
import { importAccept } from '@/ui/lib/commands'
import { store } from '@/model'
import { FALLBACK_STATE } from '@/ui/state/fallback'
import { appState, storeReady } from '@/ui/state/store'

/* ------------------------------------------------------------------ */
/* Materialbibliothek (MaterialsPanel)                                 */
/* ------------------------------------------------------------------ */

describe('Materialbibliothek', () => {
  const materials = getLibraryMaterials()

  it('liefert eine gefuellte Bibliothek', () => {
    // Stand beim Abschluss: 61 Materialien in 10 Kategorien. Die Schranke
    // liegt bewusst darunter - sie soll den Wegfall der halben Bibliothek
    // melden, nicht jede Ergaenzung.
    expect(materials.length).toBeGreaterThanOrEqual(50)
  })

  it('gibt jedem Material die Felder, die die Kachel anzeigt', () => {
    for (const material of materials) {
      expect(material.id, 'Material ohne Id').toBeTruthy()
      expect(material.name.trim().length, `Material "${material.id}" ohne Namen`).toBeGreaterThan(0)
      expect(material.color, `Material "${material.name}" ohne Farbe`).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(material.opacity, `Deckkraft von "${material.name}"`).toBeGreaterThan(0)
      expect(material.opacity, `Deckkraft von "${material.name}"`).toBeLessThanOrEqual(1)
    }
  })

  it('ordnet jedes Material einer Kategorie zu', () => {
    // Ohne Kategorie faellt das Material aus dem Filter des Panels heraus.
    for (const material of materials) {
      expect(material.category?.trim().length, `Material "${material.name}" ohne Kategorie`).toBeGreaterThan(0)
    }
  })

  it('vergibt keine Id doppelt', () => {
    const ids = materials.map((material) => material.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('bietet mehr als eine Kategorie zum Filtern an', () => {
    const categories = new Set(materials.map((material) => material.category))
    expect(categories.size).toBeGreaterThan(1)
  })

  it('beschriftet die Materialien deutsch und ohne Platzhalter', () => {
    for (const material of materials) {
      expect(material.name, `Name "${material.name}"`).not.toMatch(/\b(TODO|TBD|Lorem|Placeholder|Muster)\b/i)
      expect(material.name, `Name "${material.name}"`).not.toMatch(/^(Material|Item|Entry)\s*\d+$/)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Komponentenbibliothek (ComponentsPanel)                             */
/* ------------------------------------------------------------------ */

describe('Komponentenbibliothek', () => {
  const entries = getLibraryComponents()
  const categories = getLibraryCategories()

  it('liefert eine gefuellte Bibliothek', () => {
    // Stand beim Abschluss: 77 Eintraege in 5 Kategorien.
    expect(entries.length).toBeGreaterThanOrEqual(60)
  })

  it('gibt jeder Kachel Name, Kategorie und Beschreibung', () => {
    for (const entry of entries) {
      expect(entry.id, 'Eintrag ohne Id').toBeTruthy()
      expect(entry.name.trim().length, `Eintrag "${entry.id}" ohne Namen`).toBeGreaterThan(0)
      expect(entry.category.trim().length, `Eintrag "${entry.name}" ohne Kategorie`).toBeGreaterThan(0)
      expect(entry.description.trim().length, `Eintrag "${entry.name}" ohne Beschreibung`).toBeGreaterThan(0)
      expect(entry.build, `Eintrag "${entry.name}" ohne build()`).toBeTypeOf('function')
    }
  })

  it('vergibt keine Id doppelt', () => {
    const ids = entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('nennt in getLibraryCategories genau die Kategorien der Einträge', () => {
    const used = new Set(entries.map((entry) => entry.category))
    for (const category of categories) {
      expect(used.has(category), `Kategorie "${category}" ohne Einträge`).toBe(true)
    }
    for (const category of used) {
      expect(categories, `Kategorie "${category}" fehlt in der Auswahlliste`).toContain(category)
    }
  })

  it('filtert nach Kategorie so, wie das Panel es aufruft', () => {
    for (const category of categories) {
      const filtered = getLibraryComponents(category)
      expect(filtered.length, `Kategorie "${category}" liefert nichts`).toBeGreaterThan(0)
      for (const entry of filtered) expect(entry.category).toBe(category)
    }
  })

  it('baut jede Komponente ohne Fehler und mit erreichbarer Wurzel', () => {
    for (const entry of entries) {
      const built = entry.build()
      expect(built.definitions.length, `"${entry.name}" liefert keine Definition`).toBeGreaterThan(0)
      const root = built.definitions.find((definition) => definition.id === built.rootId)
      expect(root, `"${entry.name}": rootId "${built.rootId}" steht nicht in definitions`).toBeDefined()
    }
  })

  it('beschriftet die Kacheln deutsch und ohne Platzhalter', () => {
    for (const entry of entries) {
      expect(entry.name, `Name "${entry.name}"`).not.toMatch(/\b(TODO|TBD|Lorem|Placeholder|Muster)\b/i)
      expect(entry.description, `Beschreibung von "${entry.name}"`).not.toMatch(/\b(TODO|TBD|Lorem)\b/i)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Store statt Fallback                                                */
/* ------------------------------------------------------------------ */

describe('Anbindung an den Store', () => {
  it('antwortet der echte Store', () => {
    // Der Fallback ist nur ein Notnagel fuer den Bauzustand. Antwortet der
    // echte Store, darf die Oberflaeche ihn nie wieder sehen.
    expect(storeReady()).toBe(true)
  })

  it('liest die Oberfläche aus dem echten Store, nicht aus dem Fallback', () => {
    const state = appState()
    expect(state).not.toBe(FALLBACK_STATE)
    expect(state).toBe(store.getState())
  })

  it('liefert der Store ein Dokument mit Wurzeldefinition', () => {
    const doc = appState().doc
    expect(doc, 'kein Dokument').toBeTruthy()
    expect(doc.rootId, 'keine rootId').toBeTruthy()
    expect(doc.definitions[doc.rootId], 'Wurzeldefinition fehlt').toBeDefined()
  })

  it('hält der Store die UI-Felder bereit, aus denen die Panels lesen', () => {
    const state = appState()
    expect(state.ui, 'kein UI-Zustand').toBeTruthy()
    expect(Array.isArray(state.ui.openPanels)).toBe(true)
    expect(state.ui.stats, 'keine Modellstatistik').toBeTruthy()
    // `triangles` ist erst nachtraeglich in den Contract gekommen - fehlt es,
    // zeigt die Statuszeile dauerhaft nichts an.
    expect(state.ui.stats.triangles, 'stats.triangles fehlt').toBeTypeOf('number')
  })

  it('hält der Store Materialien, Tags, Stile und Szenen als eigene Toepfe', () => {
    const doc = appState().doc
    expect(doc.materials, 'materials fehlt').toBeTruthy()
    expect(doc.tags, 'tags fehlt').toBeTruthy()
    expect(doc.styles, 'styles fehlt').toBeTruthy()
    expect(Array.isArray(doc.scenes), 'scenes ist keine Liste').toBe(true)
    expect(doc.styles[doc.activeStyleId], 'aktiver Stil steht nicht in styles').toBeDefined()
  })

  it('liefert der Store Sonne und Nebel, sodass der Notnagel nie greift', () => {
    // StylesPanel, ShadowsPanel und FogPanel lesen `doc.style/sun/fog` und
    // greifen nur bei `undefined` auf `state/fallback.ts` zurueck. Liefert der
    // Store diese Felder, ist der Notnagel toter Code - und genau das soll er
    // sein.
    const doc = appState().doc
    expect(doc.sun, 'sun fehlt').toBeTruthy()
    expect(doc.fog, 'fog fehlt').toBeTruthy()
    expect(doc.sun.date, 'sun.date fehlt').toBeTruthy()
    expect(doc.fog.color, 'fog.color fehlt').toBeTruthy()
    expect(doc.units, 'units fehlt').toBeTruthy()
  })
})

/* ------------------------------------------------------------------ */
/* Importformate (Menue "Datei -> Importieren")                        */
/* ------------------------------------------------------------------ */

describe('Importformate', () => {
  it('nimmt die Endungsliste aus der IO-Schicht, nicht aus einer Kopie', () => {
    // Vorher stand die Liste fest verdrahtet im Aufruf und war bereits
    // auseinandergelaufen: .gif, .webp, .bmp und .json fehlten im Dateidialog,
    // obwohl detectFormat sie erkennt.
    const accept = importAccept().split(',')
    expect([...accept].sort()).toEqual([...importableExtensions()].sort())
  })

  it('bietet jede Endung an, die die IO-Schicht auch erkennt', () => {
    for (const extension of importAccept().split(',')) {
      expect(detectFormat(`modell${extension}`), `Endung "${extension}" wird nicht erkannt`).toBeTruthy()
    }
  })

  it('lässt keine erkannte Bildendung aus', () => {
    for (const extension of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']) {
      expect(importAccept(), `Endung "${extension}" fehlt im Dateidialog`).toContain(extension)
    }
  })
})
