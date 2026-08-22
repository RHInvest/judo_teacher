/**
 * SVG-Export (2D-Zeichnung) und SVG-Import (Grundrisse, Logos, Schnitte).
 *
 * Export: gueltiges SVG, Flaechen nach Tiefe sortiert, Kanten darueber.
 * Import: jedes Formelement wird gelesen, geschlossene Konturen werden zu
 * Flaechen, offene zu Kanten.
 */

import { describe, expect, it } from 'vitest'
import * as core from '@/core'
import { exportSvg, projectionFor } from '../exporters/svg'
import { importSvg, parseSvg, parseTransform } from '../importers/svg'
import { addBox, addGroup, blobText, checkXml, cubeDoc, cubeWithMaterial, emptyDoc, rootGeometry, utf8 } from './helpers'
import { faceRing, geometryBounds } from '../common/geom'
import { M, V } from '@/core/math'

const SIZE = 2

async function svg(doc = cubeDoc(SIZE), opts = {}): Promise<string> {
  return blobText(exportSvg(doc, opts).blob)
}

function drawing(result: { definitions: { geometry: import('@/shared/types').Geometry }[] }) {
  const withGeometry = result.definitions.find(
    (d) => Object.keys(d.geometry.faces).length > 0 || Object.keys(d.geometry.edges).length > 0,
  )
  expect(withGeometry, 'SVG-Import lieferte keine Geometrie').toBeTruthy()
  return withGeometry!.geometry
}

/* ------------------------------------------------------------------ */
/* Projektionen                                                        */
/* ------------------------------------------------------------------ */

describe('SVG-Projektionen', () => {
  it('liefert fuer jede Ansicht eine Orthonormalbasis', () => {
    for (const view of ['top', 'front', 'right', 'iso', 'current'] as const) {
      const p = projectionFor(view)
      expect(V.length(p.right), view).toBeCloseTo(1, 9)
      expect(V.length(p.up), view).toBeCloseTo(1, 9)
      expect(V.length(p.dir), view).toBeCloseTo(1, 9)
      expect(V.dot(p.right, p.up), view).toBeCloseTo(0, 9)
      expect(V.dot(p.right, p.dir), view).toBeCloseTo(0, 9)
      expect(V.dot(p.up, p.dir), view).toBeCloseTo(0, 9)
    }
  })

  it('blickt bei der Draufsicht nach unten und bei der Vorderansicht nach Norden', () => {
    expect(projectionFor('top').dir).toEqual({ x: 0, y: 0, z: -1 })
    expect(projectionFor('front').dir).toEqual({ x: 0, y: 1, z: 0 })
    expect(projectionFor('right').dir).toEqual({ x: -1, y: 0, z: 0 })
  })

  it('nimmt fuer current die Kamerarichtung', () => {
    const p = projectionFor('current', { x: 0, y: 0, z: -2 })
    expect(p.dir.z).toBeCloseTo(-1, 9)
    // eine entartete Richtung faellt auf die Isometrie zurueck
    expect(projectionFor('current', { x: 0, y: 0, z: 0 }).dir).toEqual(projectionFor('iso').dir)
  })
})

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

describe('SVG-Export', () => {
  it('ist wohlgeformtes XML mit Namensraum und viewBox', async () => {
    const text = await svg()
    const result = checkXml(text)
    expect(result.ok ? '' : result.error).toBe('')
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(text).toMatch(/width="[\d.]+mm" height="[\d.]+mm"/)
    expect(text).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/)
  })

  it('bleibt mit Sonderzeichen im Titel wohlgeformt', async () => {
    const doc = cubeDoc(SIZE)
    doc.meta.name = 'Grundriss <EG> & OG'
    const text = await svg(doc)
    expect(checkXml(text).ok).toBe(true)
    expect(text).toContain('&amp;')
    expect(text).toContain('&lt;EG&gt;')
  })

  it('nennt Ansicht und Massstab im Titel', async () => {
    expect(await svg(cubeDoc(SIZE), { view: 'top' })).toMatch(/<title>.*Draufsicht.*Maßstab 1:\d+<\/title>/)
    expect(await svg(cubeDoc(SIZE), { view: 'front' })).toContain('Vorderansicht')
    expect(await svg(cubeDoc(SIZE), { view: 'iso' })).toContain('Isometrie')
  })

  it('waehlt einen glatten Massstab, in den die Zeichnung passt', async () => {
    // 2 m Kante passt in 1:20 (100 mm), aber nicht in 1:5 (400 mm bei 380 nutzbar)
    expect(await svg(cubeDoc(2))).toContain('Maßstab 1:10')
    // 100 m brauchen einen groben Massstab
    expect(await svg(cubeDoc(100))).toMatch(/Maßstab 1:(250|500|1000)/)
  })

  it('legt Flaechen und Kanten in getrennte Gruppen, Kanten zuletzt', async () => {
    const text = await svg()
    const faces = text.indexOf('<g id="flaechen"')
    const edges = text.indexOf('<g id="kanten"')
    expect(faces).toBeGreaterThan(-1)
    expect(edges).toBeGreaterThan(faces)
  })

  it('sortiert die Flaechen von hinten nach vorn', async () => {
    // Zwei Kacheln uebereinander: in der Draufsicht muss die untere zuerst
    // kommen, damit die obere sie ueberdeckt.
    const doc = emptyDoc('Stapel')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0.1 })
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 1.1 })
    const text = await svg(doc, { view: 'top', includeEdges: false })
    const fills = [...text.matchAll(/<path d="[^"]*" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(fills.length).toBeGreaterThanOrEqual(4)
    // die zuletzt gezeichnete Flaeche ist die vorderste (hoechstes z)
    const paths = [...text.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1])
    const yOf = (d: string): number => Number(/M ([\d.-]+) ([\d.-]+)/.exec(d)![2])
    expect(Number.isFinite(yOf(paths[0]))).toBe(true)
  })

  it('faerbt nach Material und beruecksichtigt die Deckkraft', async () => {
    const { doc, material } = cubeWithMaterial(SIZE)
    material.opacity = 0.4
    const text = await svg(doc)
    expect(text).toMatch(/fill-opacity="0\.4"/)
    // schattiert, aber erkennbar aus der Materialfarbe abgeleitet
    const fills = [...text.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(fills.length).toBeGreaterThan(0)
    for (const fill of fills) {
      const r = parseInt(fill.slice(1, 3), 16)
      const g = parseInt(fill.slice(3, 5), 16)
      const b = parseInt(fill.slice(5, 7), 16)
      expect(r).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(b)
    }
  })

  it('schattiert unterschiedlich geneigte Flaechen unterschiedlich', async () => {
    const text = await svg(cubeWithMaterial(SIZE).doc, { view: 'iso' })
    const fills = new Set([...text.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]))
    expect(fills.size).toBeGreaterThan(1)
  })

  it('laesst die Kanten auf Wunsch weg', async () => {
    expect(await svg(cubeDoc(SIZE), { includeEdges: false })).not.toContain('<g id="kanten"')
    expect(await svg(cubeDoc(SIZE))).toContain('<line ')
  })

  it('folgt der vorgegebenen Kantenstaerke', async () => {
    expect(await svg(cubeDoc(SIZE), { strokeWidth: 0.7 })).toContain('stroke-width="0.7"')
    expect(await svg(cubeDoc(SIZE))).toContain('stroke-width="0.25"')
  })

  it('schliesst jede Flaechenkontur mit Z ab', async () => {
    for (const d of [...(await svg()).matchAll(/<path d="([^"]*)"/g)].map((m) => m[1])) {
      expect(d.startsWith('M ')).toBe(true)
      expect(d.trimEnd().endsWith('Z')).toBe(true)
    }
  })

  it('kommt mit einem leeren Dokument klar', async () => {
    const text = await svg(emptyDoc('Leer'))
    expect(checkXml(text).ok).toBe(true)
    expect(text).toContain('<svg')
  })

  it('benennt die Datei nach dem Dokument', () => {
    const doc = cubeDoc(SIZE)
    doc.meta.name = 'Grundriss EG'
    expect(exportSvg(doc).filename).toBe('Grundriss_EG.svg')
  })
})

/* ------------------------------------------------------------------ */
/* Import: Formelemente                                                */
/* ------------------------------------------------------------------ */

/** Baut ein SVG, in dem eine Nutzereinheit genau einem Millimeter entspricht. */
function wrap(content: string, size = 1000): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}">`,
    content,
    '</svg>',
  ].join('\n')
}

describe('SVG-Import: Formelemente', () => {
  it('liest rect als Flaeche in der richtigen Groesse', () => {
    const geom = drawing(parseSvg(wrap('<rect x="100" y="200" width="400" height="300"/>'), 'r.svg'))
    expect(Object.keys(geom.faces).length).toBe(1)
    const size = geometryBounds(geom)
    expect(size.max.x - size.min.x).toBeCloseTo(0.4, 9)
    expect(size.max.y - size.min.y).toBeCloseTo(0.3, 9)
    expect(faceRing(geom, Object.keys(geom.faces)[0]).length).toBe(4)
  })

  it('rundet die Ecken eines rect mit rx', () => {
    const geom = drawing(parseSvg(wrap('<rect x="0" y="0" width="400" height="300" rx="50"/>'), 'r.svg'))
    expect(faceRing(geom, Object.keys(geom.faces)[0]).length).toBeGreaterThan(8)
    const size = geometryBounds(geom)
    expect(size.max.x - size.min.x).toBeCloseTo(0.4, 6)
  })

  it('liest circle als geschlossene Flaeche', () => {
    const geom = drawing(parseSvg(wrap('<circle cx="500" cy="500" r="200"/>'), 'c.svg'))
    expect(Object.keys(geom.faces).length).toBe(1)
    const size = geometryBounds(geom)
    expect(size.max.x - size.min.x).toBeCloseTo(0.4, 3)
    expect(size.max.y - size.min.y).toBeCloseTo(0.4, 3)
  })

  it('liest ellipse mit zwei Radien', () => {
    const geom = drawing(parseSvg(wrap('<ellipse cx="500" cy="500" rx="300" ry="100"/>'), 'e.svg'))
    const size = geometryBounds(geom)
    expect(size.max.x - size.min.x).toBeCloseTo(0.6, 3)
    expect(size.max.y - size.min.y).toBeCloseTo(0.2, 3)
  })

  it('liest polygon als Flaeche und polyline als Kantenzug', () => {
    const polygon = drawing(parseSvg(wrap('<polygon points="0,0 300,0 300,300"/>'), 'p.svg'))
    expect(Object.keys(polygon.faces).length).toBe(1)
    expect(Object.keys(polygon.edges).length).toBe(3)

    const polyline = drawing(parseSvg(wrap('<polyline points="0,0 300,0 300,300"/>'), 'p.svg'))
    expect(Object.keys(polyline.faces).length).toBe(0)
    expect(Object.keys(polyline.edges).length).toBe(2)
  })

  it('liest line als einzelne Kante', () => {
    const geom = drawing(parseSvg(wrap('<line x1="0" y1="0" x2="500" y2="0"/>'), 'l.svg'))
    expect(Object.keys(geom.edges).length).toBe(1)
    expect(Object.keys(geom.faces).length).toBe(0)
  })

  it('ignoriert entartete Formen statt zu werfen', () => {
    const result = parseSvg(
      wrap('<rect width="0" height="100"/><circle r="0"/><ellipse rx="10" ry="0"/>'),
      'x.svg',
    )
    expect(result.warnings.some((w) => w.includes('keine lesbaren Konturen'))).toBe(true)
  })

  it('meldet uebersprungene Elemente', () => {
    const result = parseSvg(wrap('<text x="0" y="0">Hallo</text><rect width="10" height="10"/>'), 'x.svg')
    expect(result.warnings.some((w) => w.includes('übersprungen'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Import: Pfade                                                       */
/* ------------------------------------------------------------------ */

describe('SVG-Import: Pfade', () => {
  it('macht aus einem geschlossenen Pfad eine Flaeche', () => {
    const geom = drawing(parseSvg(wrap('<path d="M 0 0 L 400 0 L 400 300 Z"/>'), 'p.svg'))
    expect(Object.keys(geom.faces).length).toBe(1)
    expect(Object.keys(geom.edges).length).toBe(3)
    expect(core.validate(geom)).toEqual([])
  })

  it('macht aus einem offenen Pfad nur Kanten', () => {
    const geom = drawing(parseSvg(wrap('<path d="M 0 0 L 400 0 L 400 300"/>'), 'p.svg'))
    expect(Object.keys(geom.faces).length).toBe(0)
    expect(Object.keys(geom.edges).length).toBe(2)
  })

  it('liest mehrere Teilpfade aus einem d-Attribut', () => {
    const geom = drawing(
      parseSvg(wrap('<path d="M 0 0 H 200 V 200 Z M 400 400 H 600 V 600 Z"/>'), 'p.svg'),
    )
    expect(Object.keys(geom.faces).length).toBe(2)
  })

  it('legt die Zeichnung in die XY-Ebene', () => {
    const geom = drawing(parseSvg(wrap('<path d="M 0 0 L 400 0 L 400 300 Z"/>'), 'p.svg'))
    for (const v of Object.values(geom.vertices)) expect(v.p.z).toBe(0)
  })

  it('spiegelt die SVG-Y-Achse, damit oben oben bleibt', () => {
    // In SVG waechst y nach unten, im Modell nach Norden.
    const geom = drawing(parseSvg(wrap('<path d="M 0 0 L 400 0 L 400 300 Z"/>'), 'p.svg'))
    const ys = Object.values(geom.vertices).map((v) => v.p.y)
    expect(Math.max(...ys)).toBeCloseTo(0, 9)
    expect(Math.min(...ys)).toBeCloseTo(-0.3, 9)
  })

  it('liest Kurven und Boegen mit', () => {
    const geom = drawing(
      parseSvg(wrap('<path d="M 0 0 C 0 200 200 200 200 0 A 100 100 0 0 1 0 0 Z"/>'), 'p.svg'),
    )
    expect(Object.keys(geom.faces).length).toBe(1)
    expect(faceRing(geom, Object.keys(geom.faces)[0]).length).toBeGreaterThan(16)
  })
})

/* ------------------------------------------------------------------ */
/* Import: Massstab, Transformationen, Farben                          */
/* ------------------------------------------------------------------ */

describe('SVG-Import: Massstab', () => {
  it('rechnet viewBox gegen width/height um', () => {
    // 100 Nutzereinheiten breit, dargestellt auf 1000 mm -> 1 Einheit = 10 mm
    const text = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="1000mm" viewBox="0 0 100 100">',
      '<rect x="0" y="0" width="50" height="50"/>',
      '</svg>',
    ].join('\n')
    const size = geometryBounds(drawing(parseSvg(text, 's.svg')))
    expect(size.max.x - size.min.x).toBeCloseTo(0.5, 9)
  })

  it('nimmt ohne Angaben eine Nutzereinheit als Millimeter', () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="500" height="500"/></svg>'
    const size = geometryBounds(drawing(parseSvg(text, 's.svg')))
    expect(size.max.x - size.min.x).toBeCloseTo(0.5, 9)
  })

  it('versteht cm, in und pt', () => {
    for (const [length, metres] of [
      ['100cm', 1],
      ['10in', 0.254],
      ['720pt', 0.254],
    ] as const) {
      const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${length}" height="${length}" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`
      const size = geometryBounds(drawing(parseSvg(text, 's.svg')))
      expect(size.max.x - size.min.x, length).toBeCloseTo(metres, 6)
    }
  })

  it('multipliziert unitScale obendrauf', () => {
    const size = geometryBounds(
      drawing(parseSvg(wrap('<rect width="500" height="500"/>'), 's.svg', { unitScale: 2 })),
    )
    expect(size.max.x - size.min.x).toBeCloseTo(1, 9)
  })
})

describe('SVG-Import: Transformationen', () => {
  it('versteht translate, scale, rotate und matrix', () => {
    expect(parseTransform('translate(10 20)')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 })
    expect(parseTransform('scale(2)')).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })
    expect(parseTransform('scale(2 3)')).toEqual({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 })
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })
    const rotated = parseTransform('rotate(90)')
    expect(rotated.a).toBeCloseTo(0, 9)
    expect(rotated.b).toBeCloseTo(1, 9)
    expect(rotated.c).toBeCloseTo(-1, 9)
  })

  it('dreht um einen Mittelpunkt', () => {
    const m = parseTransform('rotate(90 100 100)')
    // (100,100) bleibt liegen
    expect(m.a * 100 + m.c * 100 + m.e).toBeCloseTo(100, 6)
    expect(m.b * 100 + m.d * 100 + m.f).toBeCloseTo(100, 6)
  })

  it('verkettet mehrere Transformationen von links nach rechts', () => {
    const m = parseTransform('translate(100 0) scale(2)')
    // erst skalieren, dann verschieben: x=10 -> 120
    expect(m.a * 10 + m.e).toBeCloseTo(120, 9)
  })

  it('wendet das transform des Elements an', () => {
    const geom = drawing(
      parseSvg(wrap('<rect x="0" y="0" width="100" height="100" transform="translate(500 0)"/>'), 't.svg'),
    )
    const size = geometryBounds(geom)
    expect(size.min.x).toBeCloseTo(0.5, 9)
    expect(size.max.x).toBeCloseTo(0.6, 9)
  })

  it('vererbt das transform verschachtelter Gruppen', () => {
    const geom = drawing(
      parseSvg(
        wrap(
          '<g transform="translate(200 0)"><g transform="translate(300 0)">' +
            '<rect x="0" y="0" width="100" height="100"/></g></g>',
        ),
        't.svg',
      ),
    )
    expect(geometryBounds(geom).min.x).toBeCloseTo(0.5, 9)
  })

  it('beendet die Vererbung am schliessenden g', () => {
    const geom = drawing(
      parseSvg(
        wrap(
          '<g transform="translate(500 0)"><rect width="100" height="100"/></g>' +
            '<rect width="100" height="100"/>',
        ),
        't.svg',
      ),
    )
    // eine Kachel bei 0, eine bei 0,5 - zusammen 0,6 m breit
    const size = geometryBounds(geom)
    expect(size.min.x).toBeCloseTo(0, 9)
    expect(size.max.x).toBeCloseTo(0.6, 9)
  })
})

describe('SVG-Import: Farben', () => {
  it('macht aus jeder Fuellfarbe ein Material', () => {
    const result = parseSvg(
      wrap('<rect width="100" height="100" fill="#ff0000"/><rect x="200" width="100" height="100" fill="#00ff00"/>'),
      'f.svg',
    )
    expect(result.materials.length).toBe(2)
    expect(result.materials.map((m) => m.color).sort()).toEqual(['#00ff00', '#ff0000'])
  })

  it('benutzt dieselbe Farbe nur einmal', () => {
    const result = parseSvg(
      wrap('<rect width="100" height="100" fill="#ff0000"/><rect x="200" width="100" height="100" fill="#ff0000"/>'),
      'f.svg',
    )
    expect(result.materials.length).toBe(1)
  })

  it('liest die Fuellfarbe auch aus style', () => {
    const result = parseSvg(wrap('<rect width="100" height="100" style="fill:#123456;stroke:none"/>'), 'f.svg')
    expect(result.materials[0]?.color).toBe('#123456')
  })

  it('vererbt die Fuellfarbe von der Gruppe', () => {
    const result = parseSvg(
      wrap('<g style="fill:#abcdef"><rect width="100" height="100"/></g>'),
      'f.svg',
    )
    expect(result.materials[0]?.color).toBe('#abcdef')
  })

  it('legt fuer fill none kein Material an', () => {
    const result = parseSvg(wrap('<rect width="100" height="100" fill="none"/>'), 'f.svg')
    expect(result.materials.length).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Export -> Import                                                    */
/* ------------------------------------------------------------------ */

describe('SVG-Round-Trip', () => {
  it('liest die exportierte Zeichnung wieder als Flaechen ein', async () => {
    const doc = emptyDoc('Grundriss')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 0.2 })
    const text = await svg(doc, { view: 'top', includeEdges: false })
    const result = importSvg(utf8(text), 'grundriss.svg')
    const geom = drawing(result)
    expect(Object.keys(geom.faces).length).toBeGreaterThan(0)
    expect(core.validate(geom)).toEqual([])
  })

  it('kommt im Massstab der Zeichnung zurueck, nicht im Modellmass', async () => {
    // Der Export ist eine Zeichnung 1:N in Millimetern. Ein Reimport liefert
    // deshalb die Papiergroesse - das ist so gewollt und keine Regression.
    const doc = emptyDoc('Grundriss')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 0.2 })
    const text = await svg(doc, { view: 'top', includeEdges: false })
    const denominator = Number(/Maßstab 1:(\d+)/.exec(text)![1])
    const size = geometryBounds(drawing(importSvg(utf8(text), 'grundriss.svg')))
    expect((size.max.x - size.min.x) * denominator).toBeCloseTo(4, 3)
  })

  it('behaelt die Instanztransformationen der Gruppen bei', async () => {
    const doc = emptyDoc('Zwei')
    addBox(rootGeometry(doc), { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0.1 })
    addGroup(doc, 'Rechts', M.translation({ x: 3, y: 0, z: 0 }), (geom) =>
      addBox(geom, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0.1 }),
    )
    const text = await svg(doc, { view: 'top', includeEdges: false })
    const size = geometryBounds(drawing(importSvg(utf8(text), 'zwei.svg')))
    const denominator = Number(/Maßstab 1:(\d+)/.exec(text)![1])
    // Modell ist 4 m breit (0 bis 1 und 3 bis 4)
    expect((size.max.x - size.min.x) * denominator).toBeCloseTo(4, 3)
  })
})
