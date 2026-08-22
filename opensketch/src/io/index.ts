/**
 * OEFFENTLICHE API DER IO-SCHICHT.
 *
 * Import, Export und die prozedurale Komponenten- und Materialbibliothek.
 * Die Signaturen sind Contract - die UI und der Store programmieren nur
 * gegen diese Datei.
 */

import type { Material, SketchDocument, Texture } from '@/shared/types'
import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  ImportFormat,
  ImportOptions,
  ImportResult,
} from './api-types'
import { exportAs } from './exporters'
import { importFromBytes } from './importers'
import { extensionOf } from './common/util'
import { getLibraryMaterials as libraryMaterials, getLibraryTextures as libraryTextures } from './library'

export type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  ExportView,
  ImportFormat,
  ImportOptions,
  ImportResult,
} from './api-types'

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function exportDocument(
  doc: SketchDocument,
  format: ExportFormat,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  return exportAs(doc, format, opts)
}

/** Alle Formate, die `exportDocument` beherrscht - fuer das Export-Menue. */
export function exportableFormats(): { format: ExportFormat; label: string; extension: string }[] {
  return [
    { format: 'osk', label: 'OpenSketch-Modell', extension: '.osk' },
    { format: 'obj', label: 'Wavefront OBJ', extension: '.obj' },
    { format: 'stl', label: 'STL binär', extension: '.stl' },
    { format: 'stl-ascii', label: 'STL ASCII', extension: '.stl' },
    { format: 'gltf', label: 'glTF 2.0', extension: '.gltf' },
    { format: 'glb', label: 'glTF binär', extension: '.glb' },
    { format: 'dae', label: 'COLLADA', extension: '.dae' },
    { format: 'svg', label: 'SVG-Zeichnung', extension: '.svg' },
    { format: 'png', label: 'PNG-Bild', extension: '.png' },
  ]
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/**
 * `opts.companions` nimmt Beidateien auf, die der Aufrufer mitgeladen hat -
 * die `.mtl` eines OBJ, die `.bin` und Texturen eines glTF. Ohne sie fallen
 * die Importer auf Ersatzfarben zurueck und melden das als Warnung.
 */
export async function importFile(file: File, opts: ImportOptions = {}): Promise<ImportResult> {
  const format = detectFormat(file.name)
  if (!format) throw new Error(`Unbekanntes Dateiformat: ${file.name}`)
  const buffer = await file.arrayBuffer()
  return importFromBytes(new Uint8Array(buffer), file.name, format, opts)
}

/** Import direkt aus einem Puffer - fuer Tests und Drag & Drop. */
export function importBytes(
  bytes: Uint8Array,
  filename: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const format = detectFormat(filename)
  if (!format) throw new Error(`Unbekanntes Dateiformat: ${filename}`)
  return importFromBytes(bytes, filename, format, opts)
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

export function detectFormat(filename: string): ImportFormat | null {
  const ext = extensionOf(filename)
  switch (ext) {
    case 'osk':
    case 'json':
      return 'osk'
    case 'obj':
      return 'obj'
    case 'stl':
      return 'stl'
    case 'gltf':
      return 'gltf'
    case 'glb':
      return 'glb'
    case 'svg':
      return 'svg'
    default:
      return IMAGE_EXTENSIONS.has(ext) ? 'image' : null
  }
}

/**
 * Alle Endungen, die `importFile` verarbeiten kann - fuer den Datei-Dialog.
 * Die Liste muss zu `detectFormat` passen; `io.test.ts` prueft das in beide
 * Richtungen.
 */
export function importableExtensions(): string[] {
  return [
    '.osk',
    '.json',
    '.obj',
    '.stl',
    '.gltf',
    '.glb',
    '.svg',
    ...[...IMAGE_EXTENSIONS].map((e) => `.${e}`),
  ]
}

/* ------------------------------------------------------------------ */
/* Bibliothek                                                          */
/* ------------------------------------------------------------------ */

export type { LibraryEntry } from './library/types'

export {
  buildLibraryComponent,
  getLibraryCategories,
  getLibraryComponent,
  getLibraryComponents,
  getMaterialCategories,
  libraryComponentCount,
  libraryMaterialId,
  libraryTextureId,
} from './library'

/** Rund 60 Materialien in zehn Kategorien, Texturen prozedural als Data-URL. */
export function getLibraryMaterials(): Material[] {
  return libraryMaterials()
}

/**
 * Die zu `getLibraryMaterials()` gehoerenden Texturen. In Node-Umgebungen
 * (kein `document`) ist die Liste leer und die Materialien bleiben reine
 * Farben - das ist gewollt und kein Fehler.
 */
export function getLibraryTextures(): Texture[] {
  return libraryTextures()
}
