/**
 * Verteiler der Exportformate.
 *
 * Jeder Exporter ist eine reine Funktion `(doc, opts) -> ExportResult`.
 * Asynchron ist nur die Fassade, damit spaeter zusaetzliche Formate
 * (z.B. mit Kompression) ohne Signaturaenderung dazukommen koennen.
 */

import type { SketchDocument } from '@/shared/types'
import { serializeDocument } from '@/model'
import type { ExportFormat, ExportOptions, ExportResult } from '../api-types'
import { sanitizeFilename, textBlob } from '../common/util'
import { WarningList, selectionIgnoredWarning } from '../common/warnings'
import { exportObj } from './obj'
import { exportStlAscii, exportStlBinary } from './stl'
import { exportGlb, exportGltf } from './gltf'
import { exportDae } from './dae'
import { exportSvg } from './svg'
import { exportPng } from './png'

export { exportObj } from './obj'
export { collectTriangles, exportStlAscii, exportStlBinary, writeStlAscii, writeStlBinary } from './stl'
export { buildGltfJson, exportGlb, exportGltf, packGlb, zUpToYUpMatrix } from './gltf'
export { exportDae } from './dae'
export { exportSvg, projectionFor } from './svg'
export { exportPng, pngFromDataUrl } from './png'

/**
 * Natives Format.
 *
 * Geschrieben wird ueber `@/model`s `serializeDocument` und NICHT ueber ein
 * eigenes `JSON.stringify`: nur so bekommt die Datei den Formatkopf
 * (`format`, `version`, `savedAt`), den `deserializeDocument` zum Migrieren
 * braucht. Ein roh geschriebenes Dokument liesse sich zwar noch lesen, wuerde
 * aber bei der naechsten Formatversion still falsch interpretiert.
 */
export function exportOsk(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const warnings = new WarningList()
  // Das eigene Format ist verlustfrei - die einzige Abweichung von der
  // Bestellung ist eine Auswahl, die es nicht auswerten kann.
  warnings.addIf(
    opts.selectionOnly === true,
    selectionIgnoredWarning('Das OpenSketch-Format speichert immer das vollständige Dokument.'),
  )
  return {
    blob: textBlob(serializeDocument(doc, { pretty: true }), 'application/json'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.osk`,
    warnings: warnings.list(),
  }
}

export function exportAs(
  doc: SketchDocument,
  format: ExportFormat,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  return new Promise((resolve) => {
    switch (format) {
      case 'osk':
        resolve(exportOsk(doc, opts))
        return
      case 'obj':
        resolve(exportObj(doc, opts))
        return
      case 'stl':
        resolve(exportStlBinary(doc, opts))
        return
      case 'stl-ascii':
        resolve(exportStlAscii(doc, opts))
        return
      case 'gltf':
        resolve(exportGltf(doc, opts))
        return
      case 'glb':
        resolve(exportGlb(doc, opts))
        return
      case 'dae':
        resolve(exportDae(doc, opts))
        return
      case 'svg':
        resolve(exportSvg(doc, opts))
        return
      case 'png':
        resolve(exportPng(doc, opts))
        return
      default:
        throw new Error(`Unbekanntes Exportformat: ${String(format)}`)
    }
  })
}
