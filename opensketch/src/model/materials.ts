/**
 * Standard-Materialbibliothek.
 *
 * 24 Farbmaterialien in sechs Kategorien - bewusst ohne Texturen, damit ein
 * frisches Dokument klein bleibt und sofort ohne Ladezeit nutzbar ist.
 * `roughness` / `metalness` sind Hinweise fuer den Renderer (0..1).
 *
 * OWNERSHIP: Model.
 */

import type { Material } from '@/shared/types'
import { newId } from '@/shared/ids'

export const MATERIAL_CATEGORIES = [
  'Holz',
  'Beton & Stein',
  'Mauerwerk',
  'Glas',
  'Metall',
  'Farbe',
] as const

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

interface MaterialSpec {
  name: string
  color: string
  category: MaterialCategory
  roughness: number
  metalness: number
  opacity?: number
  /** Kantenlaenge einer Texturkachel in Metern */
  tile?: number
}

/** Die Reihenfolge bestimmt die Sortierung im Material-Browser. */
export const DEFAULT_MATERIAL_SPECS: readonly MaterialSpec[] = [
  /* -------- Holz (5) -------- */
  { name: 'Eiche hell', color: '#c79a62', category: 'Holz', roughness: 0.65, metalness: 0, tile: 0.6 },
  { name: 'Eiche dunkel', color: '#7a5230', category: 'Holz', roughness: 0.6, metalness: 0, tile: 0.6 },
  { name: 'Buche', color: '#dbb789', category: 'Holz', roughness: 0.68, metalness: 0, tile: 0.6 },
  { name: 'Nussbaum', color: '#5a3a26', category: 'Holz', roughness: 0.55, metalness: 0, tile: 0.6 },
  { name: 'Kiefer', color: '#e2c391', category: 'Holz', roughness: 0.72, metalness: 0, tile: 0.6 },

  /* -------- Beton & Stein (4) -------- */
  { name: 'Sichtbeton', color: '#a8a8a4', category: 'Beton & Stein', roughness: 0.9, metalness: 0, tile: 2 },
  { name: 'Estrich', color: '#bdbab2', category: 'Beton & Stein', roughness: 0.85, metalness: 0, tile: 2 },
  { name: 'Naturstein', color: '#8d8b83', category: 'Beton & Stein', roughness: 0.95, metalness: 0, tile: 1 },
  { name: 'Marmor weiss', color: '#eeece6', category: 'Beton & Stein', roughness: 0.25, metalness: 0, tile: 1.2 },

  /* -------- Mauerwerk (3) -------- */
  { name: 'Ziegel rot', color: '#a24f36', category: 'Mauerwerk', roughness: 0.88, metalness: 0, tile: 1 },
  { name: 'Klinker braun', color: '#6f4032', category: 'Mauerwerk', roughness: 0.85, metalness: 0, tile: 1 },
  { name: 'Putz weiss', color: '#f0ece4', category: 'Mauerwerk', roughness: 0.92, metalness: 0, tile: 1.5 },

  /* -------- Glas (3) -------- */
  { name: 'Klarglas', color: '#cfe4ec', category: 'Glas', roughness: 0.05, metalness: 0, opacity: 0.25 },
  { name: 'Milchglas', color: '#e3ecef', category: 'Glas', roughness: 0.4, metalness: 0, opacity: 0.6 },
  { name: 'Glas getoent', color: '#5c7f8c', category: 'Glas', roughness: 0.08, metalness: 0, opacity: 0.45 },

  /* -------- Metall (4) -------- */
  { name: 'Stahl verzinkt', color: '#9aa1a6', category: 'Metall', roughness: 0.45, metalness: 0.9 },
  { name: 'Edelstahl', color: '#c3c8cb', category: 'Metall', roughness: 0.28, metalness: 1 },
  { name: 'Aluminium', color: '#d2d6d9', category: 'Metall', roughness: 0.35, metalness: 1 },
  { name: 'Messing', color: '#c8a349', category: 'Metall', roughness: 0.3, metalness: 1 },

  /* -------- Farbe (5) -------- */
  { name: 'Weiss', color: '#f7f7f5', category: 'Farbe', roughness: 0.8, metalness: 0 },
  { name: 'Hellgrau', color: '#b9bcc0', category: 'Farbe', roughness: 0.8, metalness: 0 },
  { name: 'Anthrazit', color: '#3b3f45', category: 'Farbe', roughness: 0.75, metalness: 0 },
  { name: 'Signalrot', color: '#b62d24', category: 'Farbe', roughness: 0.7, metalness: 0 },
  { name: 'Himmelblau', color: '#4a7fb5', category: 'Farbe', roughness: 0.7, metalness: 0 },
]

/** Erzeugt die Standardbibliothek mit frischen Ids. */
export function createDefaultMaterials(): Material[] {
  return DEFAULT_MATERIAL_SPECS.map((spec) => ({
    id: newId('m'),
    name: spec.name,
    color: spec.color,
    opacity: spec.opacity ?? 1,
    textureId: null,
    textureWidth: spec.tile ?? 1,
    textureHeight: spec.tile ?? 1,
    roughness: spec.roughness,
    metalness: spec.metalness,
    category: spec.category,
    colorize: false,
  }))
}

/** Vollstaendiges Material aus einer Teilangabe - fuellt jedes Pflichtfeld. */
export function normalizeMaterial(partial: Partial<Material> & { id: string }): Material {
  return {
    id: partial.id,
    name: partial.name ?? 'Material',
    color: partial.color ?? '#c8c8c8',
    opacity: clamp01(partial.opacity ?? 1),
    textureId: partial.textureId ?? null,
    textureWidth: positive(partial.textureWidth, 1),
    textureHeight: positive(partial.textureHeight, 1),
    roughness: clamp01(partial.roughness ?? 0.7),
    metalness: clamp01(partial.metalness ?? 0),
    category: partial.category ?? 'Eigene',
    colorize: partial.colorize ?? false,
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function positive(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}
