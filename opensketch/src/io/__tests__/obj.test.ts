/**
 * OBJ: Export, Reimport, und was dabei erhalten bleiben muss.
 *
 * Der wichtigste Punkt ist, dass N-Gons N-Gons bleiben. Ein Wuerfel hat sechs
 * Vierecke - kommt er als zwoelf Dreiecke zurueck, ist der Export kaputt, auch
 * wenn das Bild danach gleich aussieht.
 */

import { describe, expect, it } from 'vitest'
import { exportObj } from '../exporters/obj'
import { parseMtl, parseObj } from '../importers/obj'
import { blobText, cubeDoc, cubeWithMaterial, emptyDoc, rootGeometry, addBox } from './helpers'
import { faceRing } from '../common/geom'
import { M } from '@/core/math'
import { addGroup } from './helpers'

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

describe('OBJ-Export', () => {
  it('schreibt Kopf, Vertices und Flaechen', async () => {
    const text = await blobText(exportObj(cubeDoc(2)).blob)
    expect(text).toContain('# OpenSketch Studio')
    expect(text).toContain('Z-up')
    const v = text.split('\n').filter((l) => l.startsWith('v '))
    const f = text.split('\n').filter((l) => l.startsWith('f '))
    expect(v.length).toBe(8)
    expect(f.length).toBe(6)
  })

  it('laesst N-Gons stehen, solange nicht trianguliert verlangt wird', async () => {
    const text = await blobText(exportObj(cubeDoc(2)).blob)
    for (const line of text.split('\n').filter((l) => l.startsWith('f '))) {
      expect(line.trim().split(/\s+/).length - 1).toBe(4)
    }
  })

  it('trianguliert auf Wunsch', async () => {
    const text = await blobText(exportObj(cubeDoc(2), { triangulate: true }).blob)
    const f = text.split('\n').filter((l) => l.startsWith('f '))
    expect(f.length).toBe(12)
    for (const line of f) expect(line.trim().split(/\s+/).length - 1).toBe(3)
  })

  it('schreibt jede Ecke als v/vt/vn mit gueltigen Indizes', async () => {
    const text = await blobText(exportObj(cubeWithMaterial(2).doc).blob)
    const lines = text.split('\n')
    const counts = {
      v: lines.filter((l) => l.startsWith('v ')).length,
      vt: lines.filter((l) => l.startsWith('vt ')).length,
      vn: lines.filter((l) => l.startsWith('vn ')).length,
    }
    expect(counts.vt).toBeGreaterThan(0)
    expect(counts.vn).toBe(6) // sechs Wuerfelnormalen
    for (const line of lines.filter((l) => l.startsWith('f '))) {
      for (const corner of line.trim().split(/\s+/).slice(1)) {
        const [v, t, n] = corner.split('/').map((s) => parseInt(s, 10))
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(counts.v)
        expect(t).toBeGreaterThanOrEqual(1)
        expect(t).toBeLessThanOrEqual(counts.vt)
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(counts.vn)
      }
    }
  })

  it('legt UVs in der realen Kachelgroesse des Materials an', async () => {
    // Kachel 1,2 m, Wuerfel 2,4 m Kante -> die Flaeche belegt genau 2 Kacheln
    const { doc, material } = cubeWithMaterial(2.4)
    material.textureWidth = 1.2
    material.textureHeight = 1.2
    const lines = (await blobText(exportObj(doc).blob)).split('\n')
    const uvs = lines
      .filter((l) => l.startsWith('vt '))
      .map((l) => l.trim().split(/\s+/).slice(1).map(Number))
    const faces = lines.filter((l) => l.startsWith('f '))
    expect(faces.length).toBe(6)
    // Jede Seitenflaeche fuer sich spannt genau zwei Kacheln in u und in v.
    for (const line of faces) {
      const corners = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((c) => uvs[parseInt(c.split('/')[1], 10) - 1])
      for (const axis of [0, 1]) {
        const values = corners.map((uv) => uv[axis])
        expect(Math.max(...values) - Math.min(...values)).toBeCloseTo(2, 5)
      }
    }
  })

  it('legt eine MTL-Beidatei an und verweist per mtllib darauf', async () => {
    const { doc, material } = cubeWithMaterial(2)
    doc.meta.name = 'Mein Modell'
    const result = exportObj(doc)
    expect(result.filename).toBe('Mein_Modell.obj')
    expect(result.files?.length).toBe(1)
    expect(result.files![0].filename).toBe('Mein_Modell.mtl')
    const obj = await blobText(result.blob)
    expect(obj).toContain('mtllib Mein_Modell.mtl')
    expect(obj).toContain('usemtl Eiche_hell')
    const mtl = await blobText(result.files![0].blob)
    expect(mtl).toContain('newmtl Eiche_hell')
    expect(mtl).toMatch(/Kd 0\.7843 0\.6353 0\.4157/)
    expect(material.color).toBe('#c8a26a')
  })

  it('schreibt Gruppen als g-Bloecke', async () => {
    const doc = emptyDoc('Mit Gruppe')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    addGroup(doc, 'Anbau', M.translation({ x: 5, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
    )
    const text = await blobText(exportObj(doc).blob)
    expect(text).toContain('g Mit_Gruppe')
    expect(text).toContain('g Anbau')
    // die Instanztransformation ist eingebacken
    expect(text).toContain('v 5 0 0')
  })

  it('schreibt Kanten nur auf Wunsch als l', async () => {
    const doc = cubeDoc(2)
    expect(await blobText(exportObj(doc).blob)).not.toMatch(/^l /m)
    const withEdges = await blobText(exportObj(doc, { includeEdges: true }).blob)
    expect(withEdges).toContain('g OpenSketch_Kanten')
    expect(withEdges.split('\n').filter((l) => l.startsWith('l ')).length).toBe(12)
  })

  it('skaliert ueber unitScale', async () => {
    const text = await blobText(exportObj(cubeDoc(1), { unitScale: 100 }).blob)
    expect(text).toContain('v 100 100 100')
    expect(text).toContain('Meter x 100')
  })
})

/* ------------------------------------------------------------------ */
/* Round-Trip                                                          */
/* ------------------------------------------------------------------ */

describe('OBJ-Round-Trip', () => {
  it('erhaelt Vertex- und Flaechenzahl eines Wuerfels', async () => {
    const text = await blobText(exportObj(cubeDoc(2)).blob)
    const result = parseObj(text, 'wuerfel.obj')
    const definition = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)
    expect(definition, 'kein Import-Ergebnis mit Flaechen').toBeTruthy()
    const geom = definition!.geometry
    expect(Object.keys(geom.vertices).length).toBe(8)
    expect(Object.keys(geom.faces).length).toBe(6)
    expect(Object.keys(geom.edges).length).toBe(12)
  })

  it('trianguliert die N-Gons beim Reimport nicht', async () => {
    const text = await blobText(exportObj(cubeDoc(2)).blob)
    const result = parseObj(text, 'wuerfel.obj')
    const definition = result.definitions.find((d) => Object.keys(d.geometry.faces).length > 0)!
    for (const id of Object.keys(definition.geometry.faces)) {
      expect(faceRing(definition.geometry, id).length).toBe(4)
    }
  })

  it('behaelt die Koordinaten bei', async () => {
    const text = await blobText(exportObj(cubeDoc(2)).blob)
    const geom = firstGeometry(parseObj(text, 'wuerfel.obj'))
    const xs = Object.values(geom.vertices).map((v) => v.p.x)
    const zs = Object.values(geom.vertices).map((v) => v.p.z)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(2, 6)
    expect(Math.min(...zs)).toBeCloseTo(0, 6)
    expect(Math.max(...zs)).toBeCloseTo(2, 6)
  })

  it('holt die Materialien ueber die mitgelieferte MTL zurueck', async () => {
    const { doc } = cubeWithMaterial(2)
    const result = exportObj(doc)
    const objText = await blobText(result.blob)
    const mtlText = await blobText(result.files![0].blob)
    const imported = parseObj(objText, 'wuerfel.obj', {
      companions: { [result.files![0].filename]: new TextEncoder().encode(mtlText) },
    })
    const material = imported.materials.find((m) => m.name === 'Eiche_hell')
    expect(material, `Materialien: ${imported.materials.map((m) => m.name).join(', ')}`).toBeTruthy()
    expect(material!.color).toBe('#c8a26a')
    expect(material!.opacity).toBe(1)
    // jede importierte Flaeche traegt das Material
    const geom = firstGeometry(imported)
    for (const face of Object.values(geom.faces)) {
      expect(face.frontMaterialId).toBe(material!.id)
    }
  })

  it('warnt, wenn die MTL fehlt, und benutzt Ersatzfarben', async () => {
    const { doc } = cubeWithMaterial(2)
    const objText = await blobText(exportObj(doc).blob)
    const imported = parseObj(objText, 'wuerfel.obj')
    expect(imported.warnings.some((w) => w.includes('Materialdatei'))).toBe(true)
    expect(imported.materials.length).toBe(1)
    expect(imported.materials[0].color).toBe('#cccccc')
  })

  it('haelt einen zweiten Durchlauf stabil', async () => {
    const first = await blobText(exportObj(cubeDoc(2)).blob)
    const geom = firstGeometry(parseObj(first, 'wuerfel.obj'))
    expect(Object.keys(geom.faces).length).toBe(6)
    // erneut exportieren: derselbe Wuerfel, dieselben Zahlen
    const doc = emptyDoc('Zweiter')
    doc.definitions[doc.rootId].geometry = geom
    const second = await blobText(exportObj(doc).blob)
    expect(second.split('\n').filter((l) => l.startsWith('v ')).length).toBe(8)
    expect(second.split('\n').filter((l) => l.startsWith('f ')).length).toBe(6)
  })
})

/* ------------------------------------------------------------------ */
/* Parser im Detail                                                    */
/* ------------------------------------------------------------------ */

describe('OBJ-Parser', () => {
  it('versteht alle Eckenformen', () => {
    const text = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'vt 0 0',
      'vt 1 0',
      'vt 1 1',
      'vt 0 1',
      'vn 0 0 1',
      'f 1 2 3 4',
      'f 1/1 2/2 3/3',
      'f 1//1 2//1 3//1',
      'f 1/1/1 2/2/1 3/3/1',
    ].join('\n')
    const result = parseObj(text, 'formen.obj')
    const geom = firstGeometry(result)
    expect(Object.keys(geom.vertices).length).toBe(4)
    // vier Deklarationen derselben Flaechen - die erste ist das Viereck
    expect(Object.keys(geom.faces).length).toBeGreaterThanOrEqual(1)
  })

  it('versteht negative Indizes', () => {
    const text = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'f -3 -2 -1'].join('\n')
    const geom = firstGeometry(parseObj(text, 'negativ.obj'))
    expect(Object.keys(geom.faces).length).toBe(1)
    expect(faceRing(geom, Object.keys(geom.faces)[0]).length).toBe(3)
  })

  it('zerlegt nur nicht-planare Polygone', () => {
    const planar = ['v 0 0 0', 'v 2 0 0', 'v 2 2 0', 'v 0 2 0', 'f 1 2 3 4'].join('\n')
    expect(Object.keys(firstGeometry(parseObj(planar, 'a.obj')).faces).length).toBe(1)

    const skew = ['v 0 0 0', 'v 2 0 0', 'v 2 2 1', 'v 0 2 0', 'f 1 2 3 4'].join('\n')
    const geom = firstGeometry(parseObj(skew, 'b.obj'))
    expect(Object.keys(geom.faces).length).toBe(2)
  })

  it('legt je g-Block eine eigene Definition an', () => {
    const text = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'g Eins',
      'f 1 2 3',
      'g Zwei',
      'f 3 2 1',
    ].join('\n')
    const result = parseObj(text, 'gruppen.obj')
    const named = result.definitions.filter((d) => d.name === 'Eins' || d.name === 'Zwei')
    expect(named.length).toBe(2)
    expect(result.entities.length).toBe(2)
    // die Instanzen haengen unter der Wurzel
    const root = result.definitions.find((d) => d.id === result.rootDefinitionId)!
    expect(root.children.length).toBe(2)
  })

  it('liest Kanten aus l-Zeilen', () => {
    const text = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'l 1 2 3'].join('\n')
    const geom = firstGeometry(parseObj(text, 'linien.obj'))
    expect(Object.keys(geom.edges).length).toBe(2)
    expect(Object.keys(geom.faces).length).toBe(0)
  })

  it('warnt bei leeren Dateien statt zu werfen', () => {
    const result = parseObj('# nur ein Kommentar\n', 'leer.obj')
    expect(result.warnings.some((w) => w.includes('keine Vertices'))).toBe(true)
    expect(result.definitions.length).toBeGreaterThan(0)
  })

  it('skaliert ueber unitScale', () => {
    const text = ['v 0 0 0', 'v 100 0 0', 'v 100 100 0', 'f 1 2 3'].join('\n')
    const geom = firstGeometry(parseObj(text, 'cm.obj', { unitScale: 0.01 }))
    const xs = Object.values(geom.vertices).map((v) => v.p.x)
    expect(Math.max(...xs)).toBeCloseTo(1, 6)
  })
})

describe('MTL-Parser', () => {
  it('liest Farbe, Deckkraft, Rauheit und Metallanteil', () => {
    const mtl = [
      'newmtl Holz',
      'Kd 0.8 0.6 0.4',
      'Ns 100',
      'Ks 0.29 0.29 0.29',
      'd 0.5',
      '',
      'newmtl Glas',
      'Kd 1 1 1',
      'Tr 0.8',
    ].join('\n')
    const materials = parseMtl(mtl)
    expect(materials.length).toBe(2)
    expect(materials[0].name).toBe('Holz')
    expect(materials[0].color).toBe('#cc9966')
    expect(materials[0].opacity).toBeCloseTo(0.5, 6)
    expect(materials[0].roughness).toBeCloseTo(0.5, 6)
    expect(materials[0].metalness).toBeCloseTo(0.5, 6)
    expect(materials[1].opacity).toBeCloseTo(0.2, 6)
  })

  it('haelt alle Werte in ihren Grenzen', () => {
    const materials = parseMtl(['newmtl X', 'Ns 9999', 'Ks 5 5 5', 'd 7'].join('\n'))
    expect(materials[0].roughness).toBe(0)
    expect(materials[0].metalness).toBe(1)
    expect(materials[0].opacity).toBe(1)
  })
})

function firstGeometry(result: { definitions: { geometry: import('@/shared/types').Geometry }[] }) {
  const withFaces = result.definitions.find(
    (d) => Object.keys(d.geometry.faces).length > 0 || Object.keys(d.geometry.edges).length > 0,
  )
  return (withFaces ?? result.definitions[0]).geometry
}
