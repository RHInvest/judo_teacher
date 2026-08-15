/**
 * Contract der Komponentenbibliothek. Wird von `@/io` re-exportiert.
 */

import type { ComponentBehavior, Definition, Id } from '@/shared/types'
import { newId } from '@/shared/ids'
import { GeomBuilder } from '../common/geom'

export interface LibraryEntry {
  id: string
  name: string
  category: string
  /** Beschreibung fuer die Kachel */
  description: string
  /** erzeugt die Definition(en) beim ersten Einfuegen */
  build(): { definitions: Definition[]; rootId: Id }
  /** Groessenangabe fuer die Kachel, z.B. "80 x 80 x 75 cm" */
  size?: string
}

export interface EntrySpec {
  id: string
  name: string
  category: string
  description: string
  size?: string
  behavior?: ComponentBehavior
  /** baut die Geometrie in Metern, Z ist oben */
  geometry(g: GeomBuilder): void
}

/** Erzeugt einen Bibliothekseintrag aus einer Geometriefunktion. */
export function defineEntry(spec: EntrySpec): LibraryEntry {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    size: spec.size,
    build() {
      const g = new GeomBuilder()
      spec.geometry(g)
      const definition: Definition = {
        id: newId('d'),
        name: spec.name,
        kind: 'component',
        description: spec.description,
        geometry: g.geom,
        children: [],
        behavior: spec.behavior,
        isLibrary: true,
      }
      return { definitions: [definition], rootId: definition.id }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Kategorien                                                          */
/* ------------------------------------------------------------------ */

export const CATEGORY_FURNITURE = 'Möbel'
export const CATEGORY_BUILDING = 'Bau'
export const CATEGORY_SANITARY = 'Sanitär & Küche'
export const CATEGORY_OUTDOOR = 'Außen'
export const CATEGORY_PRIMITIVE = 'Grundkörper'

export const COMPONENT_CATEGORIES: string[] = [
  CATEGORY_FURNITURE,
  CATEGORY_BUILDING,
  CATEGORY_SANITARY,
  CATEGORY_OUTDOOR,
  CATEGORY_PRIMITIVE,
]

/** Verhalten fuer Bauteile, die eine Oeffnung schneiden (Tueren, Fenster). */
export const OPENING_BEHAVIOR: ComponentBehavior = {
  glueTo: 'vertical',
  cutsOpening: true,
  alwaysFaceCamera: false,
  shadowsFaceSun: false,
}

export const FLOOR_BEHAVIOR: ComponentBehavior = {
  glueTo: 'horizontal',
  cutsOpening: false,
  alwaysFaceCamera: false,
  shadowsFaceSun: false,
}
