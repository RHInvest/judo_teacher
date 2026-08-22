/**
 * STRICHZEICHENSATZ UND SATZ DES 3D-TEXTS.
 *
 * Die Zeichenabbildung (welches Zeichen wird zu welchem) liegt in
 * `@/shared/text3d` und wird von Dialogvorschau UND Werkzeug benutzt. Hier
 * wird geprueft, dass die Strichtabelle dazu passt: fuer jedes Zeichen, das
 * die Abbildung durchlaesst, muss es auch Striche geben - sonst verspricht
 * der Dialog etwas, das nicht gebaut wird.
 */

import { describe, expect, it } from 'vitest'
import { TEXT3D_GLYPHS, mapText3d, mapText3dChar } from '@/shared/text3d'
import { TEXT3D_STROKES, layoutText3d } from '../text3dFont'
import { buildTextGeometry } from '../text3d'
import type { Text3dRequest } from '../text3d'

function request(patch: Partial<Text3dRequest> = {}): Text3dRequest {
  return { text: 'A', height: 1, extrude: 0, bold: false, italic: false, filled: true, align: 'left', ...patch }
}

describe('Zeichenvorrat', () => {
  it('hat für jedes Zeichen der geteilten Tabelle Striche', () => {
    const missing = TEXT3D_GLYPHS.split('').filter((char) => !TEXT3D_STROKES[char])
    expect(missing, `ohne Striche: ${missing.join(' ')}`).toEqual([])
  })

  it('baut nichts, wofür die Abbildung kein Zeichen kennt', () => {
    for (const char of Object.keys(TEXT3D_STROKES)) {
      expect(mapText3dChar(char), `${char} fehlt in @/shared/text3d`).toBe(char)
    }
  })

  it('folgt der Abbildung: Kleinbuchstaben, Umlaute, Eszett', () => {
    expect(layoutText3d('a', { height: 1 }).glyphCount).toBe(1)
    // "Ä" wird zu "AE", also zwei Zeichen.
    expect(layoutText3d('Ä', { height: 1 }).glyphCount).toBe(2)
    expect(mapText3d('Straße')).toBe('STRASSE')
    expect(layoutText3d('Straße', { height: 1 }).glyphCount).toBe(7)
  })

  it('liefert für nicht darstellbare Zeichen kein einziges Rechteck', () => {
    const layout = layoutText3d('→ ☺', { height: 1 })
    expect(layout.rects).toEqual([])
    expect(layout.glyphCount).toBe(0)
  })
})

describe('Satz', () => {
  it('skaliert mit der Versalhöhe', () => {
    const small = layoutText3d('HAUS', { height: 0.5 })
    const large = layoutText3d('HAUS', { height: 1 })
    expect(large.width).toBeCloseTo(small.width * 2)
    expect(large.height).toBeCloseTo(small.height * 2)
    expect(large.rects.length).toBe(small.rects.length)
  })

  it('richtet links, zentriert und rechts unterschiedlich aus', () => {
    const leftEdge = (align: 'left' | 'center' | 'right') => {
      const layout = layoutText3d('HAUS', { height: 1, align })
      return Math.min(...layout.rects.flat().map((p) => p.x))
    }
    // Linksbuendig beginnt bei x = 0, minus der halben Strichstaerke.
    expect(leftEdge('left')).toBeCloseTo(-0.0575, 3)
    expect(leftEdge('center')).toBeLessThan(leftEdge('left'))
    expect(leftEdge('right')).toBeLessThan(leftEdge('center'))
  })

  it('macht fett breitere Striche und kursiv geneigte', () => {
    const normal = layoutText3d('I', { height: 1 })
    const bold = layoutText3d('I', { height: 1, bold: true })
    const widthOf = (rect: { x: number; y: number }[]) =>
      Math.max(...rect.map((p) => p.x)) - Math.min(...rect.map((p) => p.x))
    expect(widthOf(bold.rects[0])).toBeGreaterThan(widthOf(normal.rects[0]))

    const italic = layoutText3d('I', { height: 1, italic: true })
    const topOf = (layout: typeof italic) => Math.max(...layout.rects.flat().map((p) => p.x))
    expect(topOf(italic)).toBeGreaterThan(topOf(normal))
  })

  it('setzt mehrere Zeilen untereinander', () => {
    const layout = layoutText3d('A\nB', { height: 1 })
    const ys = layout.rects.flat().map((p) => p.y)
    expect(Math.min(...ys)).toBeLessThan(-0.4)
    expect(layout.height).toBeGreaterThan(1)
  })
})

describe('Geometrie', () => {
  it('erzeugt aus jedem Rechteck eine Fläche', () => {
    const layout = layoutText3d('L', { height: 1 })
    const geometry = buildTextGeometry(layout, request({ text: 'L' }))
    expect(Object.keys(geometry.faces)).toHaveLength(layout.rects.length)
  })

  it('zieht mit Tiefe einen geschlossenen Quader je Rechteck hoch', () => {
    const layout = layoutText3d('L', { height: 1 })
    const geometry = buildTextGeometry(layout, request({ text: 'L', extrude: 0.2 }))
    // Boden, Deckel und vier Waende je Rechteck.
    expect(Object.keys(geometry.faces)).toHaveLength(layout.rects.length * 6)
    const zs = Object.values(geometry.vertices).map((v) => v.p.z)
    expect(Math.min(...zs)).toBeCloseTo(0)
    expect(Math.max(...zs)).toBeCloseTo(0.2)
  })

  it('erzeugt ohne Füllung nur Kanten - der Kern schliesst keine Fläche', () => {
    const layout = layoutText3d('L', { height: 1 })
    const geometry = buildTextGeometry(layout, request({ text: 'L', filled: false }))
    expect(Object.keys(geometry.faces)).toHaveLength(0)
    expect(Object.keys(geometry.edges).length).toBeGreaterThan(0)
  })
})
