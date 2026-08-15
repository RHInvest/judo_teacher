/**
 * Verteiler der Importformate.
 *
 * Alle Importer liefern ein `ImportResult` mit Definitionen, Instanzen,
 * Materialien, Texturen und - wichtig fuer den Nutzer - Warnungen darueber,
 * was uebersprungen wurde.
 */

import type { ImportFormat, ImportOptions, ImportResult } from '../api-types'
import { importObj } from './obj'
import { importStl } from './stl'
import { importGltf } from './gltf'
import { importSvg } from './svg'
import { importImage } from './image'
import { importOsk } from './osk'

export { importObj, parseMtl, parseObj } from './obj'
export { importStl, isBinaryStl, readAsciiStl, readBinaryStl } from './stl'
export { importGltf, looksLikeGlb, quaternionMatrix, unpackGlb, yUpToZUpMatrix } from './gltf'
export { importSvg, parseSvg, parseTransform } from './svg'
export { parsePath, tokenizePath } from './svg-path'
export { importImage, readImageSize } from './image'
export { importOsk, readOskDocument } from './osk'
export { ImportScene, makeMaterial } from './common'

export async function importFromBytes(
  bytes: Uint8Array,
  filename: string,
  format: ImportFormat,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  switch (format) {
    case 'osk':
      return importOsk(bytes, filename, opts)
    case 'obj':
      return importObj(bytes, filename, opts)
    case 'stl':
      return importStl(bytes, filename, opts)
    case 'gltf':
    case 'glb':
      return importGltf(bytes, filename, opts)
    case 'svg':
      return importSvg(bytes, filename, opts)
    case 'image':
      return importImage(bytes, filename, opts)
    default:
      throw new Error(`Unbekanntes Importformat: ${String(format)}`)
  }
}
