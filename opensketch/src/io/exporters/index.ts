/**
 * Verteiler der Exportformate.
 *
 * Jeder Exporter ist eine reine Funktion `(doc, opts) -> ExportResult`.
 * Asynchron ist nur die Fassade, damit spaeter zusaetzliche Formate
 * (z.B. mit Kompression) ohne Signaturaenderung dazukommen koennen.
 */

import type { SketchDocument } from '@/shared/types'
import type { ExportFormat, ExportOptions, ExportResult } from '../api-types'
import { sanitizeFilename, textBlob } from '../common/util'
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

/** Natives Format: das Dokument als JSON. */
export function exportOsk(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  return {
    blob: textBlob(JSON.stringify(doc), 'application/json'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.osk`,
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
        return resolve(exportOsk(doc, opts))
      case 'obj':
        return resolve(exportObj(doc, opts))
      case 'stl':
        return resolve(exportStlBinary(doc, opts))
      case 'stl-ascii':
        return resolve(exportStlAscii(doc, opts))
      case 'gltf':
        return resolve(exportGltf(doc, opts))
      case 'glb':
        return resolve(exportGlb(doc, opts))
      case 'dae':
        return resolve(exportDae(doc, opts))
      case 'svg':
        return resolve(exportSvg(doc, opts))
      case 'png':
        return resolve(exportPng(doc, opts))
      default:
        throw new Error(`Unbekanntes Exportformat: ${String(format)}`)
    }
  })
}
