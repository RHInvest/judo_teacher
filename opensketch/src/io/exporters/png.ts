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
import { WarningList, pngMimeWarning, selectionIgnoredWarning } from '../common/warnings'

/**
 * Ohne Bild gibt es nichts zu speichern: Der Aufruf wirft weiter, statt eine
 * leere Datei mit Warnung zu liefern. Eine 0-Byte-Datei mit der Endung .png
 * waere kein Hinweis, sondern ein zweiter Fehler - der Nutzer bekaeme etwas
 * Kaputtes in den Downloadordner. Alles, was trotzdem eine Datei ergibt,
 * meldet sich ueber `warnings`.
 */
export function exportPng(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const filename = `${sanitizeFilename(opts.filename ?? doc.meta.name)}.png`
  const image = opts.image
  if (!image) {
    throw new Error(
      'PNG-Export: Der Viewport hat kein Bild geliefert. `ExportOptions.image` muss den gerenderten Blob enthalten.',
    )
  }

  const warnings = new WarningList()
  warnings.addIf(
    opts.selectionOnly === true,
    selectionIgnoredWarning('Das PNG zeigt immer die gerenderte Ansicht des Viewports.'),
  )

  // Der Viewport liefert je nach Weg einen Blob oder eine Data-URL.
  if (image.type === 'image/png') return { blob: image, filename, warnings: warnings.list() }
  // Der Inhalt wird NICHT umgewandelt - ein JPEG bleibt ein JPEG und
  // bekommt hier nur eine PNG-Etikette. Bisher geschah das lautlos.
  warnings.addIf(image.type.length > 0, pngMimeWarning(image.type))
  return { blob: new Blob([image], { type: 'image/png' }), filename, warnings: warnings.list() }
}

/** Bequemer Weg fuer Aufrufer, die nur eine Data-URL haben. */
export function pngFromDataUrl(dataUrl: string, name: string): ExportResult {
  const decoded = dataUrlToBytes(dataUrl)
  if (!decoded) throw new Error('PNG-Export: ungültige Data-URL.')
  const warnings = new WarningList()
  warnings.addIf(
    decoded.mime.length > 0 && decoded.mime !== 'image/png',
    pngMimeWarning(decoded.mime),
  )
  return {
    blob: binaryBlob(decoded.bytes, 'image/png'),
    filename: `${sanitizeFilename(name)}.png`,
    warnings: warnings.list(),
  }
}
