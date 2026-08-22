/**
 * STL binaer und ASCII: schreiben, wieder lesen, vergleichen.
 *
 * STL ist eine Dreieckssuppe ohne Materialien. Entscheidend ist deshalb, ob
 * `mergeCoplanarFaces` aus dem Reimport wieder brauchbare Flaechen macht:
 * ein Wuerfel muss als sechs Vierecke zurueckkommen, nicht als zwoelf
 * Dreiecke.
 */

import { describe, expect, it } from 'vitest'
import * as core from '@/core'
import {
  collectTriangles,
  exportStlAscii,
  exportStlBinary,
  writeStlAscii,
  writeStlBinary,
} from '../exporters/stl'
import { importStl, isBinaryStl, readAsciiStl, readBinaryStl } from '../importers/stl'
import { blobBytes, blobText, cubeDoc, utf8, volumeOfTriangles } from './helpers'
import { faceRing } from '../common/geom'
import type { Geometry } from '@/shared/types'

const SIZE = 2
const VOLUME = SIZE ** 3

function bodyGeometry(result: { definitions: { geometry: Geometry }[] }): Geometry {
  const withFaces = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)
  expect(withFaces, 'Import lieferte keine Flaechen').toBeTruthy()
  return withFaces!.geometry
}

/* ------------------------------------------------------------------ */
/* Dreiecke                                                            */
/* ------------------------------------------------------------------ */

describe('STL-Dreiecke', () => {
  it('zerlegt einen Wuerfel in zwoelf Dreiecke', () => {
    const tris = collectTriangles(cubeDoc(SIZE))
    expect(tris.length).toBe(12)
  })

  it('richtet alle Normalen nach aussen', () => {
    const tris = collectTriangles(cubeDoc(SIZE))
    // positives Volumen = alle Dreiecke laufen von aussen gesehen gegen den
    // Uhrzeigersinn
    expect(volumeOfTriangles(tris)).toBeCloseTo(VOLUME, 6)
    for (const tri of tris) {
      expect(Math.hypot(tri.normal.x, tri.normal.y, tri.normal.z)).toBeCloseTo(1, 6)
    }
  })

  it('skaliert ueber unitScale', () => {
    const tris = collectTriangles(cubeDoc(1), { unitScale: 1000 })
    expect(volumeOfTriangles(tris)).toBeCloseTo(1e9, 0)
  })
})

/* ------------------------------------------------------------------ */
/* Binaer                                                              */
/* ------------------------------------------------------------------ */

describe('STL binaer', () => {
  it('schreibt genau 84 + n * 50 Byte', async () => {
    const bytes = await blobBytes(exportStlBinary(cubeDoc(SIZE)).blob)
    expect(bytes.length).toBe(84 + 12 * 50)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint32(80, true)).toBe(12)
  })

  it('haelt den Kopf auf reinem ASCII', async () => {
    const doc = cubeDoc(SIZE)
    doc.meta.name = 'Würfel mit Ümlaut'
    const bytes = await blobBytes(exportStlBinary(doc).blob)
    for (let i = 0; i < 80; i++) expect(bytes[i]).toBeLessThan(128)
  })

  it('wird als binaer erkannt', async () => {
    const bytes = await blobBytes(exportStlBinary(cubeDoc(SIZE)).blob)
    expect(isBinaryStl(bytes)).toBe(true)
  })

  it('liest dieselben Dreiecke zurueck', async () => {
    const bytes = await blobBytes(exportStlBinary(cubeDoc(SIZE)).blob)
    const tris = readBinaryStl(bytes)
    expect(tris.length).toBe(12)
    expect(volumeOfTriangles(tris)).toBeCloseTo(VOLUME, 4)
  })

  it('bricht bei abgeschnittenen Dateien nicht ab', () => {
    const bytes = writeStlBinary(collectTriangles(cubeDoc(SIZE)), 'Test')
    const truncated = bytes.subarray(0, 84 + 5 * 50)
    expect(readBinaryStl(truncated).length).toBe(5)
    expect(readBinaryStl(new Uint8Array(10))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* ASCII                                                               */
/* ------------------------------------------------------------------ */

describe('STL ASCII', () => {
  it('schreibt solid / facet / endsolid', async () => {
    const text = await blobText(exportStlAscii(cubeDoc(SIZE)).blob)
    expect(text.startsWith('solid ')).toBe(true)
    expect(text.trimEnd().endsWith('endsolid Wuerfel')).toBe(true)
    expect(text.split('facet normal').length - 1).toBe(12)
    expect(text.split('outer loop').length - 1).toBe(12)
    expect(text.split('vertex').length - 1).toBe(36)
  })

  it('wird nicht faelschlich als binaer erkannt', async () => {
    const bytes = await blobBytes(exportStlAscii(cubeDoc(SIZE)).blob)
    expect(isBinaryStl(bytes)).toBe(false)
  })

  it('liest dieselben Dreiecke zurueck', async () => {
    const text = await blobText(exportStlAscii(cubeDoc(SIZE)).blob)
    const tris = readAsciiStl(text)
    expect(tris.length).toBe(12)
    expect(volumeOfTriangles(tris)).toBeCloseTo(VOLUME, 6)
  })

  it('zerlegt Facetten mit mehr als drei Vertices in einen Faecher', () => {
    const text = writeStlAscii([], 'X').replace(
      'endsolid X',
      [
        '  facet normal 0 0 1',
        '    outer loop',
        '      vertex 0 0 0',
        '      vertex 1 0 0',
        '      vertex 1 1 0',
        '      vertex 0 1 0',
        '    endloop',
        '  endfacet',
        'endsolid X',
      ].join('\n'),
    )
    expect(readAsciiStl(text).length).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* Round-Trip                                                          */
/* ------------------------------------------------------------------ */

describe.each([
  ['binaer', async () => blobBytes(exportStlBinary(cubeDoc(SIZE)).blob)],
  ['ASCII', async () => utf8(await blobText(exportStlAscii(cubeDoc(SIZE)).blob))],
] as const)('STL-Round-Trip (%s)', (_label, makeBytes) => {
  it('fasst die Dreieckssuppe wieder zu sechs Wuerfelflaechen zusammen', async () => {
    const result = await importStl(await makeBytes(), 'wuerfel.stl')
    const geom = bodyGeometry(result)
    expect(Object.keys(geom.vertices).length).toBe(8)
    expect(Object.keys(geom.edges).length).toBe(12)
    expect(Object.keys(geom.faces).length).toBe(6)
    for (const id of Object.keys(geom.faces)) {
      expect(faceRing(geom, id).length, 'Flaeche ist kein Viereck mehr').toBe(4)
    }
  })

  it('liefert einen gueltigen, geschlossenen Koerper mit demselben Volumen', async () => {
    const result = await importStl(await makeBytes(), 'wuerfel.stl')
    const geom = bodyGeometry(result)
    expect(core.validate(geom)).toEqual([])
    expect(core.isSolid(geom)).toBe(true)
    expect(core.solidVolume(geom)).toBeCloseTo(VOLUME, 4)
  })

  it('meldet, was passiert ist', async () => {
    const result = await importStl(await makeBytes(), 'wuerfel.stl')
    expect(result.warnings.some((w) => w.includes('12 Dreiecke'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('keine Materialien'))).toBe(true)
    expect(result.materials).toEqual([])
  })

  it('behaelt die Abmessungen bei', async () => {
    const result = await importStl(await makeBytes(), 'wuerfel.stl')
    const geom = bodyGeometry(result)
    const xs = Object.values(geom.vertices).map((v) => v.p.x)
    expect(Math.min(...xs)).toBeCloseTo(0, 4)
    expect(Math.max(...xs)).toBeCloseTo(SIZE, 4)
  })
})

describe('STL-Import, Sonderfaelle', () => {
  it('warnt bei einer Datei ohne Dreiecke', async () => {
    const result = await importStl(utf8('solid leer\nendsolid leer\n'), 'leer.stl')
    expect(result.warnings.some((w) => w.includes('keine Dreiecke'))).toBe(true)
  })

  it('ueberspringt entartete Dreiecke', async () => {
    const text = [
      'solid x',
      '  facet normal 0 0 1',
      '    outer loop',
      '      vertex 0 0 0',
      '      vertex 1 0 0',
      '      vertex 2 0 0',
      '    endloop',
      '  endfacet',
      'endsolid x',
      '',
    ].join('\n')
    const result = await importStl(utf8(text), 'entartet.stl')
    expect(result.warnings.some((w) => w.includes('entartete'))).toBe(true)
  })

  it('dreht Dreiecke um, die der Facettennormale widersprechen', async () => {
    // Umlaufrichtung gegen den Uhrzeigersinn (Normale +Z), Facette sagt -Z
    const text = [
      'solid x',
      '  facet normal 0 0 -1',
      '    outer loop',
      '      vertex 0 0 0',
      '      vertex 1 0 0',
      '      vertex 1 1 0',
      '    endloop',
      '  endfacet',
      'endsolid x',
      '',
    ].join('\n')
    const result = await importStl(utf8(text), 'gedreht.stl')
    const geom = bodyGeometry(result)
    const face = Object.values(geom.faces)[0]
    expect(face.normal.z).toBeLessThan(0)
  })

  it('skaliert ueber unitScale', async () => {
    const bytes = await blobBytes(exportStlBinary(cubeDoc(1)).blob)
    const result = await importStl(bytes, 'mm.stl', { unitScale: 0.001 })
    const geom = bodyGeometry(result)
    const xs = Object.values(geom.vertices).map((v) => v.p.x)
    expect(Math.max(...xs)).toBeCloseTo(0.001, 6)
  })
})
