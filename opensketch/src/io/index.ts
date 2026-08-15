/**
 * STUB - wird vom IO-Entwickler ersetzt.
 * Die Signaturen sind Contract.
 */

import type { Definition, Id, Material, SketchDocument } from '@/shared/types'

export type ExportFormat = 'osk' | 'obj' | 'stl' | 'stl-ascii' | 'gltf' | 'glb' | 'dae' | 'svg' | 'png'
export type ImportFormat = 'osk' | 'obj' | 'stl' | 'gltf' | 'glb' | 'svg' | 'image'

export interface ExportOptions {
  /** nur die aktuelle Auswahl exportieren */
  selectionOnly?: boolean
  /** Einheit der Zieldatei (Standard: Meter) */
  unitScale?: number
  /** Kanten mitexportieren (OBJ/SVG) */
  includeEdges?: boolean
  /** Texturen einbetten */
  embedTextures?: boolean
  /** Dreiecke statt N-Gons */
  triangulate?: boolean
  /** Projektion fuer SVG-Export */
  view?: 'top' | 'front' | 'right' | 'iso' | 'current'
}

export interface ImportResult {
  /** neue Definitionen, die in das Dokument uebernommen werden */
  definitions: Definition[]
  /** Wurzeldefinition des Imports (wird als Instanz platziert) */
  rootDefinitionId: Id
  materials: Material[]
  textures: { id: Id; name: string; dataUrl: string; width: number; height: number }[]
  warnings: string[]
}

export interface ExportResult {
  blob: Blob
  filename: string
}

export function exportDocument(doc: SketchDocument, format: ExportFormat, opts?: ExportOptions): Promise<ExportResult> {
  throw new Error('io/exporters ist noch nicht implementiert')
}

export function importFile(file: File, opts?: { unitScale?: number }): Promise<ImportResult> {
  throw new Error('io/importers ist noch nicht implementiert')
}

export function detectFormat(filename: string): ImportFormat | null {
  return null
}

/* ---------------- Bibliothek ---------------- */

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

export function getLibraryCategories(): string[] {
  return []
}

export function getLibraryComponents(category?: string): LibraryEntry[] {
  return []
}

export function getLibraryMaterials(): Material[] {
  return []
}
