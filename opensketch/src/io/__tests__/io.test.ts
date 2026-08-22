/**
 * Die oeffentliche Fassade: osk, Bild, PNG, Formaterkennung.
 *
 * Der wichtigste Punkt hier ist, dass `detectFormat`, `importableExtensions`
 * und `exportableFormats` zueinander passen. Ein Format, das `exportAs`
 * beherrscht, aber nicht im Menue steht, existiert fuer den Nutzer nicht - und
 * eine Endung im Dateidialog, die `detectFormat` nicht kennt, fuehrt beim
 * Anklicken zu einer Fehlermeldung.
 */

import { describe, expect, it } from 'vitest'
import {
  detectFormat,
  exportDocument,
  exportableFormats,
  getLibraryTextures,
  importBytes,
  importableExtensions,
} from '..'
import type { ExportFormat, ImportFormat } from '../api-types'
import { exportAs, exportOsk } from '../exporters'
import { exportPng, pngFromDataUrl } from '../exporters/png'
import { importOsk, readOskDocument } from '../importers/osk'
import { importImage, readImageSize } from '../importers/image'
import { addBox, addGroup, blobBytes, blobText, cubeWithMaterial, emptyDoc, rootGeometry, utf8 } from './helpers'
import { bytesToDataUrl } from '../common/util'
import { OSK_FORMAT, OSK_VERSION, serializeDocument } from '@/model'
import { M } from '@/core/math'

/* ------------------------------------------------------------------ */
/* Formate                                                             */
/* ------------------------------------------------------------------ */

const ALL_EXPORT_FORMATS: ExportFormat[] = [
  'osk',
  'obj',
  'stl',
  'stl-ascii',
  'gltf',
  'glb',
  'dae',
  'svg',
  'png',
]

const ALL_IMPORT_FORMATS: ImportFormat[] = ['osk', 'obj', 'stl', 'gltf', 'glb', 'svg', 'image']

describe('Formatlisten', () => {
  it('fuehrt in exportableFormats jedes Format, das exportAs beherrscht', async () => {
    const listed = exportableFormats().map((f) => f.format)
    expect([...listed].sort()).toEqual([...ALL_EXPORT_FORMATS].sort())
    // und jedes gelistete Format laeuft auch wirklich durch
    const doc = cubeWithMaterial(2).doc
    for (const format of listed) {
      if (format === 'png') continue // braucht ein Bild vom Viewport
      const result = await exportDocument(doc, format)
      expect(result.blob.size, format).toBeGreaterThan(0)
      expect(result.filename, format).toContain('.')
    }
  })

  it('gibt zu jedem Format Beschriftung und Endung an', () => {
    for (const entry of exportableFormats()) {
      expect(entry.label.trim().length, entry.format).toBeGreaterThan(0)
      expect(entry.extension.startsWith('.'), entry.format).toBe(true)
      expect(entry.label, entry.format).not.toMatch(/\b(export|file|model)\b/i)
    }
  })

  it('lehnt ein unbekanntes Exportformat mit klarer Meldung ab', async () => {
    await expect(exportAs(emptyDoc(), 'xyz' as ExportFormat)).rejects.toThrow(/Unbekanntes Exportformat/)
  })

  it('haelt detectFormat und importableExtensions deckungsgleich', () => {
    // jede angebotene Endung wird auch erkannt
    for (const extension of importableExtensions()) {
      expect(extension.startsWith('.'), extension).toBe(true)
      expect(detectFormat(`modell${extension}`), extension).not.toBeNull()
    }
    // und jedes erkannte Format kommt ueber mindestens eine Endung vor
    const reachable = new Set(
      importableExtensions().map((e) => detectFormat(`modell${e}`)).filter((f): f is ImportFormat => !!f),
    )
    expect([...reachable].sort()).toEqual([...ALL_IMPORT_FORMATS].sort())
  })

  it('erkennt Endungen unabhaengig von Gross- und Kleinschreibung und Pfad', () => {
    expect(detectFormat('MODELL.OBJ')).toBe('obj')
    expect(detectFormat('/pfad/zum/Modell.Stl')).toBe('stl')
    expect(detectFormat('C:\\Ordner\\Bild.PNG')).toBe('image')
    expect(detectFormat('archiv.tar.gz')).toBeNull()
    expect(detectFormat('ohne-endung')).toBeNull()
    expect(detectFormat('')).toBeNull()
  })

  it('meldet ein unbekanntes Importformat statt still nichts zu tun', async () => {
    await expect(importBytes(utf8('x'), 'modell.dwg')).rejects.toThrow(/Unbekanntes Dateiformat/)
  })
})

/* ------------------------------------------------------------------ */
/* osk                                                                 */
/* ------------------------------------------------------------------ */

describe('osk-Round-Trip', () => {
  it('schreibt den Formatkopf von @/model', async () => {
    const text = await blobText(exportOsk(emptyDoc('Haus')).blob)
    const raw = JSON.parse(text) as Record<string, unknown>
    expect(raw.format).toBe(OSK_FORMAT)
    expect(raw.version).toBe(OSK_VERSION)
    expect(raw.document).toBeTruthy()
    expect(exportOsk(emptyDoc('Mein Haus')).filename).toBe('Mein_Haus.osk')
  })

  it('liest die eigene Ausgabe wieder ein', async () => {
    const doc = emptyDoc('Haus')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 })
    const bytes = await blobBytes(exportOsk(doc).blob)
    const back = readOskDocument(bytes)
    expect(back.rootId).toBe(doc.rootId)
    const geom = back.definitions[back.rootId].geometry
    expect(Object.keys(geom.faces).length).toBe(6)
    expect(Object.keys(geom.vertices).length).toBe(8)
  })

  it('liest auch ein roh geschriebenes Dokument ohne Formatkopf', () => {
    const doc = emptyDoc('Roh')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    const back = readOskDocument(utf8(JSON.stringify(doc)))
    expect(Object.keys(back.definitions[back.rootId].geometry.faces).length).toBe(6)
  })

  it('fuegt ein fremdes Modell mit frischen Ids ein', async () => {
    const doc = emptyDoc('Fremd')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })
    addGroup(doc, 'Anbau', M.translation({ x: 5, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const bytes = await blobBytes(exportOsk(doc).blob)
    const result = importOsk(bytes, 'fremd.osk')

    // keine einzige Id des Quelldokuments taucht wieder auf
    const sourceIds = new Set([...Object.keys(doc.definitions), ...Object.keys(doc.entities)])
    for (const definition of result.definitions) expect(sourceIds.has(definition.id)).toBe(false)
    for (const entity of result.entities) expect(sourceIds.has(entity.id)).toBe(false)

    // die Verweise zeigen trotzdem alle ins Ziel
    const definitionIds = new Set(result.definitions.map((d) => d.id))
    const entityIds = new Set(result.entities.map((e) => e.id))
    for (const entity of result.entities) {
      if (entity.type === 'instance') expect(definitionIds.has(entity.definitionId)).toBe(true)
    }
    for (const definition of result.definitions) {
      for (const child of definition.children) expect(entityIds.has(child)).toBe(true)
    }
  })

  it('macht aus der fremden Wurzel eine Gruppe', async () => {
    const bytes = await blobBytes(exportOsk(emptyDoc('Fremd')).blob)
    const result = importOsk(bytes, 'fremd.osk')
    expect(result.definitions.every((d) => d.kind !== 'model')).toBe(true)
  })

  it('zieht Material- und Texturverweise mit um', async () => {
    const { doc, material } = cubeWithMaterial(2)
    doc.textures['x_alt'] = { id: 'x_alt', name: 'Holz', dataUrl: 'data:image/png;base64,AA==', width: 4, height: 4 }
    doc.materials[material.id].textureId = 'x_alt'
    const bytes = await blobBytes(exportOsk(doc).blob)
    const result = importOsk(bytes, 'fremd.osk')

    expect(result.textures.length).toBe(1)
    expect(result.textures[0].id).not.toBe('x_alt')
    const imported = result.materials.find((m) => m.name === 'Eiche hell')!
    expect(imported.id).not.toBe(material.id)
    expect(imported.textureId).toBe(result.textures[0].id)

    // die Flaechen zeigen auf das neue Material
    const geometry = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)!.geometry
    for (const face of Object.values(geometry.faces)) expect(face.frontMaterialId).toBe(imported.id)
  })

  it('skaliert Geometrie und Instanzen ueber unitScale', async () => {
    const doc = emptyDoc('Fremd')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    addGroup(doc, 'Weit', M.translation({ x: 1, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }),
    )
    const bytes = await blobBytes(exportOsk(doc).blob)
    const result = importOsk(bytes, 'fremd.osk', { unitScale: 10 })
    const geometry = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)!.geometry
    const xs = Object.values(geometry.vertices).map((v) => v.p.x)
    expect(Math.max(...xs)).toBeCloseTo(10, 9)
    const instance = result.entities.find((e) => e.type === 'instance' && e.name === 'Weit')
    if (instance?.type !== 'instance') throw new Error('Instanz "Weit" fehlt')
    expect(instance.transform[12]).toBeCloseTo(10, 9)
  })

  it('sagt, was nicht mitkommt', async () => {
    const bytes = await blobBytes(exportOsk(emptyDoc('Fremd')).blob)
    const result = importOsk(bytes, 'fremd.osk')
    expect(result.warnings.some((w) => w.includes('Tags, Szenen, Stile'))).toBe(true)
  })

  it('meldet kaputte Dateien verstaendlich', () => {
    expect(() => readOskDocument(utf8('{kein json'))).toThrow(/OSK: .*JSON/)
    expect(() => readOskDocument(utf8('42'))).toThrow(/OSK:/)
    expect(() => readOskDocument(utf8(JSON.stringify({ format: 'fremd', version: 1 })))).toThrow(
      /OSK:.*Dateiformat/,
    )
  })

  it('lehnt eine Datei aus einer neueren Programmversion ab', () => {
    const doc = emptyDoc('Zukunft')
    const json = JSON.parse(serializeDocument(doc)) as Record<string, unknown>
    json.version = OSK_VERSION + 5
    expect(() => readOskDocument(utf8(JSON.stringify(json)))).toThrow(/neueren Version/)
  })
})

/* ------------------------------------------------------------------ */
/* Bild                                                                */
/* ------------------------------------------------------------------ */

/** Kleinstmoegliche gueltige PNG-Kopfzeile mit den gewuenschten Massen. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13, false)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return bytes
}

describe('Bildimport', () => {
  it('liest die Masse aus dem PNG-Kopf', () => {
    expect(readImageSize(pngHeader(800, 600))).toEqual({ width: 800, height: 600 })
  })

  it('liest die Masse aus GIF und BMP', () => {
    const gif = new Uint8Array(16)
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
    gif[6] = 0x20 // 32
    gif[8] = 0x10 // 16
    expect(readImageSize(gif)).toEqual({ width: 32, height: 16 })

    const bmp = new Uint8Array(32)
    bmp.set([0x42, 0x4d], 0)
    new DataView(bmp.buffer).setInt32(18, 64, true)
    new DataView(bmp.buffer).setInt32(22, -48, true) // negative Hoehe kommt vor
    expect(readImageSize(bmp)).toEqual({ width: 64, height: 48 })
  })

  it('liefert null fuer unbekannte Formate', () => {
    expect(readImageSize(utf8('kein Bild'))).toBeNull()
  })

  it('legt Textur und Referenzbild mit erhaltenem Seitenverhaeltnis an', () => {
    const result = importImage(pngHeader(1600, 800), 'plan.png')
    expect(result.textures.length).toBe(1)
    expect(result.textures[0].name).toBe('plan')
    expect(result.textures[0].width).toBe(1600)
    expect(result.textures[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true)

    const image = result.entities.find((e) => e.type === 'image')
    expect(image, 'kein Referenzbild angelegt').toBeTruthy()
    const entity = image as { width: number; height: number; textureId: string }
    expect(entity.width).toBe(2)
    expect(entity.height).toBe(1)
    expect(entity.textureId).toBe(result.textures[0].id)
  })

  it('haengt das Referenzbild unter die Wurzel', () => {
    const result = importImage(pngHeader(100, 100), 'plan.png')
    const root = result.definitions.find((d) => d.id === result.rootDefinitionId)!
    expect(root.children.length).toBe(1)
    expect(root.children[0]).toBe(result.entities[0].id)
  })

  it('leitet den MIME-Typ aus der Endung ab', () => {
    expect(importImage(pngHeader(4, 4), 'a.jpg').textures[0].dataUrl.startsWith('data:image/jpeg')).toBe(true)
    expect(importImage(pngHeader(4, 4), 'a.webp').textures[0].dataUrl.startsWith('data:image/webp')).toBe(true)
  })

  it('faellt bei unlesbaren Massen auf ein Quadrat zurueck', () => {
    const result = importImage(utf8('kaputt'), 'x.png')
    expect(result.textures[0].width).toBe(1024)
    const entity = result.entities[0] as { width: number; height: number }
    expect(entity.width).toBe(entity.height)
  })

  it('skaliert die Einfuegebreite ueber unitScale', () => {
    const entity = importImage(pngHeader(100, 100), 'a.png', { unitScale: 5 }).entities[0] as {
      width: number
    }
    expect(entity.width).toBe(10)
  })

  it('meldet die Bildgroesse als Warnung', () => {
    expect(importImage(pngHeader(800, 600), 'a.png').warnings[0]).toContain('800 × 600 px')
  })
})

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

describe('PNG-Export', () => {
  it('reicht das Bild des Viewports durch', async () => {
    const image = new Blob([pngHeader(10, 10).slice().buffer], { type: 'image/png' })
    const result = exportPng(emptyDoc('Ansicht'), { image })
    expect(result.blob).toBe(image)
    expect(result.filename).toBe('Ansicht.png')
  })

  it('setzt den MIME-Typ, wenn der Viewport etwas anderes liefert', async () => {
    const image = new Blob([pngHeader(10, 10).slice().buffer], { type: 'application/octet-stream' })
    const result = exportPng(emptyDoc('Ansicht'), { image })
    expect(result.blob.type).toBe('image/png')
    expect((await blobBytes(result.blob)).length).toBe(32)
  })

  it('sagt deutlich, wenn kein Bild geliefert wurde', () => {
    expect(() => exportPng(emptyDoc('Ansicht'))).toThrow(/Viewport/)
    expect(() => exportPng(emptyDoc('Ansicht'), { image: null })).toThrow(/ExportOptions.image/)
  })

  it('nimmt auch eine Data-URL', async () => {
    const dataUrl = bytesToDataUrl('image/png', pngHeader(10, 10))
    const result = pngFromDataUrl(dataUrl, 'Ansicht Nord')
    expect(result.filename).toBe('Ansicht_Nord.png')
    expect((await blobBytes(result.blob)).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(() => pngFromDataUrl('kein data url', 'x')).toThrow(/Data-URL/)
  })
})

/* ------------------------------------------------------------------ */
/* Texturen in Node                                                    */
/* ------------------------------------------------------------------ */

describe('Fassade', () => {
  it('liefert in Node ohne document eine leere Texturliste, statt zu werfen', () => {
    expect(typeof document).toBe('undefined')
    expect(getLibraryTextures()).toEqual([])
  })
})
