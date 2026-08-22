/**
 * COLLADA-Export.
 *
 * COLLADA hat keinen Importer im Projekt, deshalb pruefen wir die Datei
 * selbst: wohlgeformtes XML, `up_axis` ist `Z_UP`, die vier Bibliotheken sind
 * da, und jede id, auf die verwiesen wird, existiert auch.
 */

import { describe, expect, it } from 'vitest'
import { exportDae } from '../exporters/dae'
import { addBox, addGroup, blobText, cubeDoc, cubeWithMaterial, emptyDoc, rootGeometry } from './helpers'
import { M } from '@/core/math'

const SIZE = 2

async function dae(doc = cubeDoc(SIZE), opts = {}): Promise<string> {
  return blobText(exportDae(doc, opts).blob)
}

/* ------------------------------------------------------------------ */
/* Wohlgeformtheit                                                     */
/* ------------------------------------------------------------------ */

/**
 * Minimaler XML-Wohlgeformtheitspruefer: Tags muessen sich in der richtigen
 * Reihenfolge schliessen, Attribute in Anfuehrungszeichen stehen, und im Text
 * darf kein unmaskiertes `<` oder `&` vorkommen. Reicht, um jeden Fehler zu
 * finden, den ein String-Zusammenbau produzieren kann.
 */
export function checkXml(xml: string): { ok: true } | { ok: false; error: string } {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  const stack: string[] = []
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"<]*")*)\s*(\/?)>/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tag.exec(body)) !== null) {
    const text = body.slice(cursor, match.index)
    if (text.includes('<')) return { ok: false, error: `Unmaskiertes < in "${text.slice(0, 60)}"` }
    if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(text)) {
      return { ok: false, error: `Unmaskiertes & in "${text.slice(0, 60)}"` }
    }
    cursor = match.index + match[0].length
    const [, closing, name, , selfClosing] = match
    if (selfClosing) continue
    if (closing) {
      const open = stack.pop()
      if (open !== name) return { ok: false, error: `</${name}> schliesst <${open ?? 'nichts'}>` }
    } else {
      stack.push(name)
    }
  }
  const rest = body.slice(cursor)
  if (rest.includes('<')) return { ok: false, error: `Unvollstaendiges Tag: "${rest.slice(0, 60)}"` }
  if (stack.length > 0) return { ok: false, error: `Nicht geschlossen: ${stack.join(', ')}` }
  return { ok: true }
}

describe('COLLADA-Grundgeruest', () => {
  it('ist wohlgeformtes XML', async () => {
    const result = checkXml(await dae(cubeWithMaterial(SIZE).doc))
    expect(result.ok ? '' : result.error).toBe('')
  })

  it('bleibt auch mit Sonderzeichen im Namen wohlgeformt', async () => {
    const doc = cubeDoc(SIZE)
    doc.meta.name = 'Haus <A & B> "Süd"'
    doc.meta.author = 'Müller & Söhne'
    const text = await dae(doc)
    const result = checkXml(text)
    expect(result.ok ? '' : result.error).toBe('')
    expect(text).toContain('&amp;')
    expect(text).not.toMatch(/name="[^"]*</)
  })

  it('nennt XML-Deklaration, Namensraum und Version 1.4.1', async () => {
    const text = await dae()
    expect(text.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true)
    expect(text).toContain('xmlns="http://www.collada.org/2005/11/COLLADASchema"')
    expect(text).toContain('version="1.4.1"')
  })

  it('setzt up_axis auf Z_UP', async () => {
    const text = await dae()
    expect(text).toContain('<up_axis>Z_UP</up_axis>')
    expect(text).not.toContain('Y_UP')
  })

  it('fuehrt alle vier Bibliotheken und die Szene', async () => {
    const text = await dae(cubeWithMaterial(SIZE).doc)
    for (const block of [
      '<asset>',
      '<library_effects>',
      '<library_materials>',
      '<library_geometries>',
      '<library_visual_scenes>',
      '<instance_visual_scene url="#Szene"/>',
    ]) {
      expect(text, `${block} fehlt`).toContain(block)
    }
  })

  it('gibt die Einheit passend zu unitScale an', async () => {
    expect(await dae(cubeDoc(1))).toContain('<unit meter="1" name="meter"/>')
    // in Zentimetern exportiert: eine Einheit ist ein Hundertstel Meter
    expect(await dae(cubeDoc(1), { unitScale: 100 })).toContain('<unit meter="0.01" name="meter"/>')
  })
})

/* ------------------------------------------------------------------ */
/* Geometrie                                                           */
/* ------------------------------------------------------------------ */

describe('COLLADA-Geometrie', () => {
  it('schreibt Positionen, Normalen und UVs als sources', async () => {
    const text = await dae(cubeWithMaterial(SIZE).doc)
    expect(text).toMatch(/<source id="geometry_\d+-positions">/)
    expect(text).toMatch(/<source id="geometry_\d+-normals">/)
    expect(text).toMatch(/<source id="geometry_\d+-uv">/)
    expect(text).toMatch(/<param name="S" type="float"\/>/)
  })

  it('haelt float_array count, accessor count und stride konsistent', async () => {
    const text = await dae(cubeWithMaterial(SIZE).doc)
    const sources = [...text.matchAll(/<source id="([^"]+)">([\s\S]*?)<\/source>/g)]
    expect(sources.length).toBeGreaterThanOrEqual(3)
    for (const [, id, block] of sources) {
      const declared = Number(/<float_array id="[^"]*" count="(\d+)">/.exec(block)![1])
      const values = /<float_array[^>]*>([^<]*)<\/float_array>/.exec(block)![1].trim().split(/\s+/)
      expect(values.length, `${id}: float_array count stimmt nicht`).toBe(declared)
      const accessor = /<accessor source="#([^"]+)" count="(\d+)" stride="(\d+)"/.exec(block)!
      expect(accessor[1]).toBe(`${id}-array`)
      expect(Number(accessor[2]) * Number(accessor[3])).toBe(declared)
      const params = block.match(/<param name="/g)?.length ?? 0
      expect(params).toBe(Number(accessor[3]))
    }
  })

  it('schreibt genau so viele Dreiecke, wie triangles count behauptet', async () => {
    const text = await dae()
    const blocks = [...text.matchAll(/<triangles count="(\d+)"[^>]*>([\s\S]*?)<\/triangles>/g)]
    expect(blocks.length).toBeGreaterThan(0)
    let total = 0
    for (const [, count, block] of blocks) {
      const inputs = block.match(/<input semantic="/g)!.length
      const indices = /<p>([^<]*)<\/p>/.exec(block)![1].trim().split(/\s+/)
      expect(indices.length).toBe(Number(count) * 3 * inputs)
      total += Number(count)
    }
    expect(total).toBe(12) // Wuerfel
  })

  it('nummeriert die input-offsets luecken- und doppelfrei', async () => {
    const text = await dae(cubeWithMaterial(SIZE).doc)
    const block = /<triangles[^>]*>([\s\S]*?)<\/triangles>/.exec(text)![1]
    const offsets = [...block.matchAll(/offset="(\d+)"/g)].map((m) => Number(m[1]))
    expect(offsets).toEqual([0, 1, 2])
  })

  it('haelt jeden Index innerhalb des Vertexpuffers', async () => {
    const text = await dae()
    const count = Number(
      /<accessor source="#geometry_0-positions-array" count="(\d+)"/.exec(text)![1],
    )
    const indices = /<p>([^<]*)<\/p>/.exec(text)![1].trim().split(/\s+/).map(Number)
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(count)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Materialien                                                         */
/* ------------------------------------------------------------------ */

describe('COLLADA-Materialien', () => {
  it('verbindet material, effect und instance_material zu einer Kette', async () => {
    const text = await dae(cubeWithMaterial(SIZE).doc)
    const materialId = /<material id="([^"]+)"/.exec(text)![1]
    expect(text).toContain(`<effect id="${materialId}_effect">`)
    expect(text).toContain(`<instance_effect url="#${materialId}_effect"/>`)
    expect(text).toContain(`<instance_material symbol="${materialId}" target="#${materialId}"/>`)
    expect(text).toContain(`<triangles count="12" material="${materialId}">`)
  })

  it('schreibt Diffusfarbe und Deckkraft aus dem Material', async () => {
    const { doc, material } = cubeWithMaterial(SIZE)
    material.opacity = 0.5
    const text = await dae(doc)
    expect(text).toContain('<diffuse><color>0.7843 0.6353 0.4157 0.5</color></diffuse>')
    expect(text).toContain('<transparency><float>0.5</float></transparency>')
    expect(text).toContain('name="Eiche hell"')
  })

  it('laesst bind_material weg, wenn es nichts zu binden gibt', async () => {
    const text = await dae(cubeDoc(SIZE))
    expect(text).toContain('<instance_geometry url="#geometry_0"/>')
    expect(text).not.toContain('<bind_material>')
    expect(text).not.toMatch(/<triangles[^>]*material=/)
  })

  it('verweist nur auf ids, die es auch gibt', async () => {
    const text = await dae(cubeWithMaterial(SIZE).doc)
    const declared = new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    const referenced = [...text.matchAll(/(?:url|source|target)="#([^"]+)"/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(0)
    for (const id of referenced) {
      expect(declared.has(id), `Verweis auf unbekannte id "${id}"`).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Szene                                                               */
/* ------------------------------------------------------------------ */

describe('COLLADA-Szene', () => {
  it('bildet Gruppen als verschachtelte nodes ab', async () => {
    const doc = emptyDoc('Haus')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    addGroup(doc, 'Anbau', M.translation({ x: 5, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const text = await dae(doc)
    expect(checkXml(text).ok).toBe(true)
    expect(text).toContain('name="Haus"')
    expect(text).toContain('name="Anbau"')
    expect((text.match(/<node /g) ?? []).length).toBe(2)
  })

  it('transponiert die Matrix nach COLLADA-Zeilenreihenfolge', async () => {
    const doc = emptyDoc('Haus')
    addGroup(doc, 'Verschoben', M.translation({ x: 1, y: 2, z: 3 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const text = await dae(doc)
    const matrix = /<matrix sid="transform">([^<]+)<\/matrix>/.exec(text)![1].split(/\s+/).map(Number)
    // zeilenweise: Translation steht in der letzten SPALTE, also an 3, 7, 11
    expect(matrix).toEqual([1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1])
  })

  it('skaliert die Translation der Instanzen mit', async () => {
    const doc = emptyDoc('Haus')
    addGroup(doc, 'Verschoben', M.translation({ x: 1, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const text = await dae(doc, { unitScale: 100 })
    const matrix = /<matrix sid="transform">([^<]+)<\/matrix>/.exec(text)![1].split(/\s+/).map(Number)
    expect(matrix[3]).toBe(100)
  })

  it('gibt der Wurzel keine Matrix', async () => {
    const text = await dae()
    expect(text).not.toContain('<matrix')
  })

  it('benennt die Datei nach dem Dokument', () => {
    const doc = cubeDoc(SIZE)
    doc.meta.name = 'Mein Haus'
    expect(exportDae(doc).filename).toBe('Mein_Haus.dae')
    expect(exportDae(doc, { filename: 'anders' }).filename).toBe('anders.dae')
  })
})
