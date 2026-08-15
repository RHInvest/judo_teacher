/**
 * Fassade der Komponenten- und Materialbibliothek.
 *
 * Alles ist prozedural erzeugt - kein einziges externes Asset. Die Eintraege
 * selbst sind billig (nur Metadaten plus eine `build()`-Funktion); Geometrie
 * entsteht erst beim Einfuegen.
 */

import type { Definition, Id } from '@/shared/types'
import { BUILDING } from './building'
import { FURNITURE } from './furniture'
import { OUTDOOR } from './outdoor'
import { PRIMITIVES } from './primitives'
import { SANITARY } from './sanitary'
import { COMPONENT_CATEGORIES, type LibraryEntry } from './types'

export type { LibraryEntry } from './types'
export {
  CATEGORY_BUILDING,
  CATEGORY_FURNITURE,
  CATEGORY_OUTDOOR,
  CATEGORY_PRIMITIVE,
  CATEGORY_SANITARY,
  COMPONENT_CATEGORIES,
} from './types'
export {
  getLibraryMaterials,
  getLibraryTextures,
  getMaterialCategories,
  libraryMaterialId,
  libraryTextureId,
  MATERIAL_CATEGORIES,
  resetMaterialCache,
} from './materials'

/** Alle Eintraege in Anzeigereihenfolge. */
const ALL: LibraryEntry[] = [...FURNITURE, ...BUILDING, ...SANITARY, ...OUTDOOR, ...PRIMITIVES]

/** Kategorien, die tatsaechlich Eintraege haben. */
export function getLibraryCategories(): string[] {
  const present = new Set(ALL.map((e) => e.category))
  const ordered = COMPONENT_CATEGORIES.filter((c) => present.has(c))
  for (const c of present) if (!ordered.includes(c)) ordered.push(c)
  return ordered
}

/** Eintraege, optional auf eine Kategorie gefiltert. */
export function getLibraryComponents(category?: string): LibraryEntry[] {
  if (!category) return [...ALL]
  return ALL.filter((e) => e.category === category)
}

export function getLibraryComponent(id: string): LibraryEntry | null {
  return ALL.find((e) => e.id === id) ?? null
}

/**
 * Baut einen Eintrag und liefert die Definitionen. Bequemer Umweg fuer
 * Aufrufer, die nur die Id kennen.
 */
export function buildLibraryComponent(id: string): { definitions: Definition[]; rootId: Id } | null {
  const entry = getLibraryComponent(id)
  return entry ? entry.build() : null
}

/** Anzahl der Eintraege - fuer Tests und die Statusleiste. */
export function libraryComponentCount(): number {
  return ALL.length
}
