/**
 * Bildimport als Referenzbild.
 *
 * Das Bild wird zu einer `Texture` (Data-URL) und einer `ImageEntity`, die
 * flach in der XY-Ebene liegt. Das Seitenverhaeltnis kommt aus dem
 * Dateikopf - PNG, JPEG, GIF, BMP und WebP werden ohne Browser-API gelesen,
 * damit der Import auch in Node funktioniert.
 */

import type { ImageEntity } from '@/shared/types'
import type { ImportOptions, ImportResult } from '../api-types'
import { baseName, bytesToDataUrl, extensionOf } from '../common/util'
import { ImportScene } from './common'
import { M } from '@/core/math'
import { newId } from '@/shared/ids'

/** Standardbreite eines eingefuegten Referenzbildes in Metern. */
const DEFAULT_WIDTH = 2

export function importImage(bytes: Uint8Array, filename: string, opts: ImportOptions = {}): ImportResult {
  const scene = new ImportScene(opts.name ?? baseName(filename) ?? 'Bild')
  const mime = mimeOf(filename, bytes)
  const size = readImageSize(bytes) ?? { width: 1024, height: 1024 }
  if (size.width <= 0 || size.height <= 0) {
    size.width = 1024
    size.height = 1024
  }

  const textureId = newId('x')
  scene.addTexture({
    id: textureId,
    name: baseName(filename) || 'Bild',
    dataUrl: bytesToDataUrl(mime, bytes),
    width: size.width,
    height: size.height,
  })

  const width = DEFAULT_WIDTH * (opts.unitScale ?? 1)
  const height = (width * size.height) / size.width
  const entity: ImageEntity = {
    id: newId('n'),
    type: 'image',
    name: baseName(filename) || 'Referenzbild',
    tagId: null,
    hidden: false,
    locked: false,
    textureId,
    transform: M.identity(),
    width,
    height,
    usage: 'model',
  }
  scene.entities.push(entity)
  scene.root.children.push(entity.id)

  scene.warn(
    `Referenzbild ${size.width} × ${size.height} px eingefügt, Breite ${width.toFixed(2)} m (Seitenverhältnis erhalten).`,
  )
  return scene.toResult()
}

/* ------------------------------------------------------------------ */
/* Bildmasse aus dem Dateikopf                                         */
/* ------------------------------------------------------------------ */

export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  return readPngSize(bytes) ?? readJpegSize(bytes) ?? readGifSize(bytes) ?? readBmpSize(bytes) ?? readWebpSize(bytes)
}

function readPngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
}

function readJpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let offset = 2
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = b[offset + 1]
    // SOF0..SOF15 ohne die Nicht-Rahmen-Marker DHT/JPG/DAC
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) }
    }
    const length = view.getUint16(offset + 2, false)
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function readGifSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 10) return null
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) }
}

function readBmpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
}

function readWebpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null
  const riff = String.fromCharCode(b[0], b[1], b[2], b[3])
  const webp = String.fromCharCode(b[8], b[9], b[10], b[11])
  if (riff !== 'RIFF' || webp !== 'WEBP') return null
  const format = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (format === 'VP8 ') {
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff }
  }
  if (format === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (format === 'VP8X') {
    return {
      width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    }
  }
  return null
}

function mimeOf(filename: string, bytes: Uint8Array): string {
  switch (extensionOf(filename)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'png':
      return 'image/png'
    default:
      return readPngSize(bytes) ? 'image/png' : readJpegSize(bytes) ? 'image/jpeg' : 'image/png'
  }
}
