/**
 * Materialbibliothek.
 *
 * Rund 50 Materialien in zehn Kategorien mit realistischen Farben, Rauheiten
 * und Deckkraeften. Wo eine Textur den Unterschied macht (Holz, Ziegel,
 * Fliesen, Rasen, Beton, Kies ...) wird sie beim ERSTEN Zugriff prozedural
 * ueber ein Canvas erzeugt - kein einziger externer Download.
 *
 * In Node/vitest gibt es kein `document`; dann bleiben die Materialien reine
 * Farben (`textureId === null`) und `getLibraryTextures()` liefert eine leere
 * Liste. Genau so ist es gewollt.
 */

import type { Id, Material, Texture } from '@/shared/types'
import { createTexture, type TextureRecipe } from '../common/texture'

export const MATERIAL_CATEGORIES = [
  'Holz',
  'Stein',
  'Metall',
  'Glas',
  'Kunststoff',
  'Textil',
  'Farben',
  'Dach',
  'Boden',
  'Vegetation',
] as const

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

interface MaterialSpec {
  slug: string
  name: string
  category: MaterialCategory
  color: string
  opacity?: number
  roughness: number
  metalness: number
  /** Kachelgroesse in Metern */
  tile?: [number, number]
  texture?: Omit<TextureRecipe, 'seed'> & { seed?: number }
  colorize?: boolean
}

/* ------------------------------------------------------------------ */
/* Katalog                                                             */
/* ------------------------------------------------------------------ */

const SPECS: MaterialSpec[] = [
  /* --------------------------- Holz --------------------------- */
  { slug: 'eiche-hell', name: 'Eiche hell', category: 'Holz', color: '#c8a26a', roughness: 0.65, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'wood', base: '#c8a26a', accent: '#9b7440' } },
  { slug: 'eiche-dunkel', name: 'Eiche dunkel', category: 'Holz', color: '#7b5230', roughness: 0.6, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'wood', base: '#7b5230', accent: '#4e3018', seed: 21 } },
  { slug: 'buche', name: 'Buche', category: 'Holz', color: '#d9b489', roughness: 0.62, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'wood', base: '#d9b489', accent: '#b18a5c', seed: 33 } },
  { slug: 'kiefer', name: 'Kiefer', category: 'Holz', color: '#e0c08c', roughness: 0.7, metalness: 0, tile: [1.0, 1.0], texture: { kind: 'wood', base: '#e0c08c', accent: '#b3915c', seed: 44 } },
  { slug: 'nussbaum', name: 'Nussbaum', category: 'Holz', color: '#6b432a', roughness: 0.55, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'wood', base: '#6b432a', accent: '#42281a', seed: 55 } },
  { slug: 'sperrholz', name: 'Sperrholz', category: 'Holz', color: '#d8bb8d', roughness: 0.78, metalness: 0, tile: [1.5, 1.5], texture: { kind: 'wood', base: '#d8bb8d', accent: '#bb9a68', scale: 0.6, seed: 66 } },
  { slug: 'mdf-weiss', name: 'MDF weiss lackiert', category: 'Holz', color: '#f2f0ec', roughness: 0.4, metalness: 0 },
  { slug: 'osb', name: 'OSB-Platte', category: 'Holz', color: '#c9a86e', roughness: 0.85, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'gravel', base: '#c9a86e', accent: '#a8863f', seed: 77 } },

  /* --------------------------- Stein -------------------------- */
  { slug: 'beton', name: 'Beton', category: 'Stein', color: '#a8a8a4', roughness: 0.9, metalness: 0, tile: [2, 2], texture: { kind: 'concrete', base: '#a8a8a4', accent: '#8d8d88' } },
  { slug: 'sichtbeton', name: 'Sichtbeton', category: 'Stein', color: '#bfbfba', roughness: 0.75, metalness: 0, tile: [2.5, 2.5], texture: { kind: 'concrete', base: '#bfbfba', accent: '#a4a49e', seed: 12 } },
  { slug: 'ziegel-rot', name: 'Ziegel rot', category: 'Stein', color: '#9c4a34', roughness: 0.88, metalness: 0, tile: [1.0, 0.5], texture: { kind: 'brick', base: '#9c4a34', accent: '#cfc7b6' } },
  { slug: 'klinker', name: 'Klinker', category: 'Stein', color: '#6f3a2c', roughness: 0.8, metalness: 0, tile: [1.0, 0.5], texture: { kind: 'brick', base: '#6f3a2c', accent: '#b9b1a2', seed: 9 } },
  { slug: 'naturstein', name: 'Naturstein', category: 'Stein', color: '#8d8579', roughness: 0.92, metalness: 0, tile: [1.5, 1.5], texture: { kind: 'gravel', base: '#8d8579', accent: '#6d675d', seed: 88 } },
  { slug: 'marmor-weiss', name: 'Marmor weiss', category: 'Stein', color: '#eeece7', roughness: 0.25, metalness: 0, tile: [2, 2], texture: { kind: 'wood', base: '#eeece7', accent: '#c2bfb6', scale: 0.35, seed: 99 } },
  { slug: 'granit', name: 'Granit', category: 'Stein', color: '#6d6d70', roughness: 0.45, metalness: 0, tile: [1.5, 1.5], texture: { kind: 'gravel', base: '#6d6d70', accent: '#3f3f43', seed: 111 } },
  { slug: 'kies', name: 'Kies', category: 'Stein', color: '#9a9188', roughness: 1, metalness: 0, tile: [1, 1], texture: { kind: 'gravel', base: '#9a9188', accent: '#6f675f', seed: 222 } },

  /* --------------------------- Metall ------------------------- */
  { slug: 'stahl-gebuerstet', name: 'Stahl gebuerstet', category: 'Metall', color: '#9aa0a6', roughness: 0.35, metalness: 0.9, tile: [1, 1], texture: { kind: 'brushed', base: '#9aa0a6', accent: '#c9ced3' } },
  { slug: 'aluminium', name: 'Aluminium', category: 'Metall', color: '#c4c8cc', roughness: 0.3, metalness: 0.95, tile: [1, 1], texture: { kind: 'brushed', base: '#c4c8cc', accent: '#e6e9ec', seed: 5 } },
  { slug: 'edelstahl', name: 'Edelstahl', category: 'Metall', color: '#b6bbc0', roughness: 0.22, metalness: 1, tile: [1, 1], texture: { kind: 'brushed', base: '#b6bbc0', accent: '#dde1e5', seed: 6 } },
  { slug: 'messing', name: 'Messing', category: 'Metall', color: '#c9a227', roughness: 0.3, metalness: 1 },
  { slug: 'kupfer', name: 'Kupfer', category: 'Metall', color: '#b87333', roughness: 0.35, metalness: 1 },
  { slug: 'chrom', name: 'Chrom', category: 'Metall', color: '#dfe3e6', roughness: 0.06, metalness: 1 },
  { slug: 'zinkblech', name: 'Verzinktes Blech', category: 'Metall', color: '#8f9498', roughness: 0.5, metalness: 0.85 },
  { slug: 'stahl-lackiert', name: 'Stahl anthrazit', category: 'Metall', color: '#3c4043', roughness: 0.45, metalness: 0.6 },

  /* --------------------------- Glas --------------------------- */
  { slug: 'klarglas', name: 'Klarglas', category: 'Glas', color: '#cfe3ea', opacity: 0.22, roughness: 0.05, metalness: 0 },
  { slug: 'milchglas', name: 'Milchglas', category: 'Glas', color: '#e4eef1', opacity: 0.55, roughness: 0.5, metalness: 0 },
  { slug: 'getoentes-glas', name: 'Getoentes Glas', category: 'Glas', color: '#5f7a82', opacity: 0.4, roughness: 0.08, metalness: 0 },
  { slug: 'spiegel', name: 'Spiegel', category: 'Glas', color: '#dfe8ea', roughness: 0.02, metalness: 1 },

  /* ------------------------ Kunststoff ------------------------ */
  { slug: 'kunststoff-weiss', name: 'Kunststoff weiss', category: 'Kunststoff', color: '#f4f4f2', roughness: 0.35, metalness: 0 },
  { slug: 'kunststoff-schwarz', name: 'Kunststoff schwarz', category: 'Kunststoff', color: '#212326', roughness: 0.4, metalness: 0 },
  { slug: 'pvc-grau', name: 'PVC grau', category: 'Kunststoff', color: '#7f8385', roughness: 0.55, metalness: 0 },
  { slug: 'acryl', name: 'Acryl transparent', category: 'Kunststoff', color: '#dfe7ea', opacity: 0.5, roughness: 0.15, metalness: 0 },

  /* --------------------------- Textil ------------------------- */
  { slug: 'stoff-grau', name: 'Stoff grau', category: 'Textil', color: '#8b8b86', roughness: 0.95, metalness: 0, tile: [0.5, 0.5], texture: { kind: 'fabric', base: '#8b8b86', accent: '#6f6f6a' } },
  { slug: 'stoff-blau', name: 'Stoff blau', category: 'Textil', color: '#4a5f7a', roughness: 0.95, metalness: 0, tile: [0.5, 0.5], texture: { kind: 'fabric', base: '#4a5f7a', accent: '#36485d', seed: 17 } },
  { slug: 'stoff-beige', name: 'Stoff beige', category: 'Textil', color: '#cbbda6', roughness: 0.95, metalness: 0, tile: [0.5, 0.5], texture: { kind: 'fabric', base: '#cbbda6', accent: '#a99b84', seed: 18 } },
  { slug: 'leder-braun', name: 'Leder braun', category: 'Textil', color: '#6f4630', roughness: 0.6, metalness: 0, tile: [0.6, 0.6], texture: { kind: 'carpet', base: '#6f4630', accent: '#8b5c40', seed: 19 } },
  { slug: 'teppich-beige', name: 'Teppich beige', category: 'Textil', color: '#c3b49a', roughness: 1, metalness: 0, tile: [1, 1], texture: { kind: 'carpet', base: '#c3b49a', accent: '#a4967d', seed: 20 } },
  { slug: 'filz-grau', name: 'Filz grau', category: 'Textil', color: '#6e7073', roughness: 1, metalness: 0, tile: [0.5, 0.5], texture: { kind: 'carpet', base: '#6e7073', accent: '#5a5c5f', seed: 23 } },

  /* --------------------------- Farben ------------------------- */
  { slug: 'farbe-weiss', name: 'Weiss', category: 'Farben', color: '#f5f5f3', roughness: 0.7, metalness: 0 },
  { slug: 'farbe-cremeweiss', name: 'Cremeweiss', category: 'Farben', color: '#efe8da', roughness: 0.7, metalness: 0 },
  { slug: 'farbe-hellgrau', name: 'Hellgrau', category: 'Farben', color: '#c9cac6', roughness: 0.7, metalness: 0 },
  { slug: 'farbe-anthrazit', name: 'Anthrazit', category: 'Farben', color: '#3a3d40', roughness: 0.7, metalness: 0 },
  { slug: 'farbe-schwarz', name: 'Schwarz', category: 'Farben', color: '#1c1d1f', roughness: 0.7, metalness: 0 },
  { slug: 'farbe-rot', name: 'Signalrot', category: 'Farben', color: '#b32b23', roughness: 0.6, metalness: 0 },
  { slug: 'farbe-blau', name: 'Taubenblau', category: 'Farben', color: '#3d6285', roughness: 0.6, metalness: 0 },
  { slug: 'farbe-gruen', name: 'Salbeigruen', category: 'Farben', color: '#6d8467', roughness: 0.6, metalness: 0 },
  { slug: 'farbe-gelb', name: 'Sonnengelb', category: 'Farben', color: '#d8a72b', roughness: 0.6, metalness: 0 },

  /* ---------------------------- Dach -------------------------- */
  { slug: 'dachziegel-rot', name: 'Dachziegel rot', category: 'Dach', color: '#a3462c', roughness: 0.85, metalness: 0, tile: [0.8, 0.8], texture: { kind: 'roof', base: '#a3462c', accent: '#7b3421' } },
  { slug: 'dachziegel-anthrazit', name: 'Dachziegel anthrazit', category: 'Dach', color: '#43464a', roughness: 0.85, metalness: 0, tile: [0.8, 0.8], texture: { kind: 'roof', base: '#43464a', accent: '#2c2e31', seed: 31 } },
  { slug: 'schiefer', name: 'Schiefer', category: 'Dach', color: '#3f4448', roughness: 0.6, metalness: 0, tile: [1, 1], texture: { kind: 'tile', base: '#3f4448', accent: '#2a2e31', scale: 2, seed: 32 } },
  { slug: 'bitumen', name: 'Bitumenbahn', category: 'Dach', color: '#33353a', roughness: 0.95, metalness: 0, tile: [1.5, 1.5], texture: { kind: 'concrete', base: '#33353a', accent: '#22242a', seed: 34 } },

  /* --------------------------- Boden -------------------------- */
  { slug: 'fliesen-weiss', name: 'Fliesen weiss', category: 'Boden', color: '#eceae5', roughness: 0.2, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'tile', base: '#eceae5', accent: '#c6c3bb', scale: 1 } },
  { slug: 'fliesen-grau', name: 'Fliesen grau', category: 'Boden', color: '#9b9c99', roughness: 0.25, metalness: 0, tile: [1.2, 1.2], texture: { kind: 'tile', base: '#9b9c99', accent: '#777875', scale: 1, seed: 41 } },
  { slug: 'parkett-eiche', name: 'Parkett Eiche', category: 'Boden', color: '#c09257', roughness: 0.4, metalness: 0, tile: [2, 2], texture: { kind: 'plank', base: '#c09257', accent: '#8d6835' } },
  { slug: 'laminat-hell', name: 'Laminat hell', category: 'Boden', color: '#d5bb92', roughness: 0.35, metalness: 0, tile: [2, 2], texture: { kind: 'plank', base: '#d5bb92', accent: '#ab8f68', seed: 43 } },
  { slug: 'estrich', name: 'Estrich', category: 'Boden', color: '#b0aca4', roughness: 0.9, metalness: 0, tile: [2, 2], texture: { kind: 'concrete', base: '#b0aca4', accent: '#96928a', seed: 45 } },

  /* ------------------------ Vegetation ------------------------ */
  { slug: 'rasen', name: 'Rasen', category: 'Vegetation', color: '#5c8a3c', roughness: 1, metalness: 0, tile: [1, 1], texture: { kind: 'grass', base: '#5c8a3c', accent: '#3f6b28' } },
  { slug: 'laub-gruen', name: 'Laub gruen', category: 'Vegetation', color: '#4e7a34', roughness: 0.95, metalness: 0, tile: [0.8, 0.8], texture: { kind: 'foliage', base: '#4e7a34', accent: '#6c9a48' } },
  { slug: 'laub-herbst', name: 'Laub herbstlich', category: 'Vegetation', color: '#96682a', roughness: 0.95, metalness: 0, tile: [0.8, 0.8], texture: { kind: 'foliage', base: '#96682a', accent: '#c08c37', seed: 51 } },
  { slug: 'rinde', name: 'Baumrinde', category: 'Vegetation', color: '#5b4a38', roughness: 1, metalness: 0, tile: [0.6, 0.6], texture: { kind: 'wood', base: '#5b4a38', accent: '#3a2e22', scale: 2, seed: 52 } },
  { slug: 'erde', name: 'Erde', category: 'Vegetation', color: '#5d4632', roughness: 1, metalness: 0, tile: [1, 1], texture: { kind: 'soil', base: '#5d4632', accent: '#3f2f21', seed: 53 } },
]

/* ------------------------------------------------------------------ */
/* Stabile Ids                                                         */
/* ------------------------------------------------------------------ */

/**
 * Bibliotheksmaterialien haben feste Ids (kein `newId`), damit Komponenten
 * dauerhaft darauf zeigen koennen und mehrfaches Einfuegen keine Duplikate
 * erzeugt.
 */
export function libraryMaterialId(slug: string): Id {
  return `mlib_${slug}`
}

export function libraryTextureId(slug: string): Id {
  return `xlib_${slug}`
}

/** Kurzform fuer die Komponentenbauer. */
export const MAT = Object.fromEntries(SPECS.map((s) => [s.slug, libraryMaterialId(s.slug)])) as Record<string, Id>

/* ------------------------------------------------------------------ */
/* Lazy Aufbau                                                         */
/* ------------------------------------------------------------------ */

let cachedMaterials: Material[] | null = null
let cachedTextures: Texture[] | null = null

function build(): void {
  if (cachedMaterials && cachedTextures) return
  const materials: Material[] = []
  const textures: Texture[] = []

  for (const spec of SPECS) {
    let textureId: Id | null = null
    if (spec.texture) {
      const generated = createTexture({ seed: 1337, ...spec.texture })
      if (generated) {
        textureId = libraryTextureId(spec.slug)
        textures.push({
          id: textureId,
          name: spec.name,
          dataUrl: generated.dataUrl,
          width: generated.width,
          height: generated.height,
        })
      }
    }
    materials.push({
      id: libraryMaterialId(spec.slug),
      name: spec.name,
      color: spec.color,
      opacity: spec.opacity ?? 1,
      textureId,
      textureWidth: spec.tile?.[0] ?? 1,
      textureHeight: spec.tile?.[1] ?? 1,
      roughness: spec.roughness,
      metalness: spec.metalness,
      category: spec.category,
      colorize: spec.colorize ?? false,
    })
  }

  cachedMaterials = materials
  cachedTextures = textures
}

/** Alle Bibliotheksmaterialien (Erzeugung laeuft nur beim ersten Aufruf). */
export function getLibraryMaterials(): Material[] {
  build()
  return cachedMaterials!.map((m) => ({ ...m }))
}

/** Die zugehoerigen prozeduralen Texturen; in Node leer. */
export function getLibraryTextures(): Texture[] {
  build()
  return cachedTextures!.map((t) => ({ ...t }))
}

export function getMaterialCategories(): string[] {
  return [...MATERIAL_CATEGORIES]
}

/** Nur fuer Tests: Cache leeren. */
export function resetMaterialCache(): void {
  cachedMaterials = null
  cachedTextures = null
}
