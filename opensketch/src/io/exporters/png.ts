/**
 * PNG-Export.
 *
 * Das Bild rendert der Viewport, nicht die IO-Schicht - hier passiert nur
 * die Blob-Konvertierung und die Benennung. Der Aufrufer reicht das fertige
 * Bild ueber `ExportOptions.image` durch (z.B. aus
 * `viewport.captureImage()` oder `canvas.toBlob()`).
 */

import type { SketchDocument } from '@/shared/types'
import type { ExportOptions, ExportResult } from '../api-types'
import { binaryBlob, dataUrlToBytes, sanitizeFilename } from '../common/util'

export function exportPng(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const filename = `${sanitizeFilename(opts.filename ?? doc.meta.name)}.png`
  const image = opts.image
  if (!image) {
    throw new Error(
      'PNG-Export: Der Viewport hat kein Bild geliefert. `ExportOptions.image` muss den gerenderten Blob enthalten.',
    )
  }
  // Der Viewport liefert je nach Weg einen Blob oder eine Data-URL.
  if (image.type === 'image/png') return { blob: image, filename }
  return { blob: new Blob([image], { type: 'image/png' }), filename }
}

/** Bequemer Weg fuer Aufrufer, die nur eine Data-URL haben. */
export function pngFromDataUrl(dataUrl: string, name: string): ExportResult {
  const decoded = dataUrlToBytes(dataUrl)
  if (!decoded) throw new Error('PNG-Export: ungültige Data-URL.')
  return {
    blob: binaryBlob(decoded.bytes, 'image/png'),
    filename: `${sanitizeFilename(name)}.png`,
  }
}
