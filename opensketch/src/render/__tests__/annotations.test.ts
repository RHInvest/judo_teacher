/**
 * Annotationen.
 *
 * Geprueft wird beides: was im Szenengraph landet (Linien, Bildrechtecke) und
 * was die Textebene zeichnet. Fuer die Textebene dient ein Aufnahme-Kontext,
 * der `fillText`, `transform` und Farben mitschreibt - so laesst sich ohne
 * echten Canvas pruefen, ob der Text an der richtigen Stelle, in der richtigen
 * Groesse und in der Massebene steht.
 */

import { describe, expect, it } from 'vitest'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { M, V } from '@/core/math'
import type {
  DimensionEntity,
  GuideLineEntity,
  GuidePointEntity,
  ImageEntity,
  SketchDocument,
  TextEntity,
  Vec3Like,
} from '@/shared/types'
import { AnnotationLayer, axisColor, type AnnotationHost } from '../annotations'
import { AXIS_X_COLOR, AXIS_Z_COLOR, DEFAULT_STYLE, GUIDE_COLOR, SELECT_COLOR } from '../defaults'
import { EdgeMaterials } from '../edges'
import { MaterialCache } from '../materials'
import { SceneSync } from '../sceneSync'
import type { RenderSnapshot } from '../snapshot'
import { addEntity, addInstance, documentWithSquare, emptyDocument, snapshotOf, squareGeometry } from './helpers'

/* ------------------------------------------------------------------ */
/* Aufbau                                                              */
/* ------------------------------------------------------------------ */

function build(doc: SketchDocument, patch: Partial<RenderSnapshot> = {}): { layer: AnnotationLayer; snapshot: RenderSnapshot; sync: SceneSync } {
  const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
  const sync = new SceneSync(materials, new EdgeMaterials())
  const snapshot = snapshotOf(doc, patch)
  materials.update(doc, snapshot.style, true)
  sync.update(snapshot)

  const layer = new AnnotationLayer()
  layer.setResolution(800, 600)
  layer.update(snapshot, sync)
  return { layer, snapshot, sync }
}

/** Alle Segmentpositionen der Ebene, als Punktpaare. */
function segments(layer: AnnotationLayer): { a: Vec3Like; b: Vec3Like }[] {
  const out: { a: Vec3Like; b: Vec3Like }[] = []
  for (const child of layer.group.children) {
    if (!(child instanceof LineSegments2)) continue
    const start = child.geometry.attributes.instanceStart
    if (!start) continue
    const count = child.geometry.instanceCount ?? start.count
    for (let i = 0; i < count; i++) {
      out.push({
        a: { x: start.getX(i), y: start.getY(i), z: start.getZ(i) },
        b: {
          x: child.geometry.attributes.instanceEnd.getX(i),
          y: child.geometry.attributes.instanceEnd.getY(i),
          z: child.geometry.attributes.instanceEnd.getZ(i),
        },
      })
    }
  }
  return out
}

function segmentColors(layer: AnnotationLayer): { r: number; g: number; b: number }[] {
  const out: { r: number; g: number; b: number }[] = []
  for (const child of layer.group.children) {
    if (!(child instanceof LineSegments2)) continue
    const color = child.geometry.attributes.instanceColorStart
    if (!color) continue
    const count = child.geometry.instanceCount ?? color.count
    for (let i = 0; i < count; i++) out.push({ r: color.getX(i), g: color.getY(i), b: color.getZ(i) })
  }
  return out
}

function hasColor(layer: AnnotationLayer, hex: string): boolean {
  const target = hexToLinear(hex)
  return segmentColors(layer).some(
    (c) => Math.abs(c.r - target.r) < 1e-3 && Math.abs(c.g - target.g) < 1e-3 && Math.abs(c.b - target.b) < 1e-3,
  )
}

/** '#rrggbb' in denselben Arbeitsfarbraum, den three.js benutzt. */
function hexToLinear(hex: string): { r: number; g: number; b: number } {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const toLinear = (c: number): number => (c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return { r: toLinear(srgb[0]), g: toLinear(srgb[1]), b: toLinear(srgb[2]) }
}

/* ------------------------------------------------------------------ */
/* 2D-Aufnahme                                                         */
/* ------------------------------------------------------------------ */

interface TextRecord {
  text: string
  x: number
  y: number
  font: string
  color: string
  alpha: number
  transform: number[] | null
}

/** Minimaler 2D-Kontext, der nur mitschreibt. */
function recorder(): { ctx: CanvasRenderingContext2D; texts: TextRecord[]; strokes: number } {
  const texts: TextRecord[] = []
  const state = { transform: null as number[] | null }
  let strokes = 0
  const stack: (number[] | null)[] = []

  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    globalAlpha: 1,
    textAlign: '',
    textBaseline: '',
    save(): void {
      stack.push(state.transform)
    },
    restore(): void {
      state.transform = stack.length > 0 ? (stack.pop() as number[] | null) : null
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      state.transform = [a, b, c, d, e, f]
    },
    setTransform(): void {
      state.transform = null
    },
    fillText(text: string, x: number, y: number): void {
      texts.push({
        text,
        x,
        y,
        font: ctx.font,
        color: String(ctx.fillStyle),
        alpha: ctx.globalAlpha,
        transform: state.transform,
      })
    },
    measureText(text: string): { width: number } {
      return { width: text.length * 6 }
    },
    fillRect(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    arc(): void {},
    fill(): void {},
    stroke(): void {
      strokes++
    },
    setLineDash(): void {},
    clearRect(): void {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, get strokes() { return strokes } }
}

/** Kamera senkrecht ueber dem Ursprung, 800x600. */
function host(): AnnotationHost {
  const scale = 100
  return {
    worldToScreen: (p) => ({ x: 400 + p.x * scale, y: 300 - p.y * scale, depth: 0, visible: true }),
    pixelsPerUnit: () => scale,
    getSize: () => ({ width: 800, height: 600 }),
  }
}

/* ------------------------------------------------------------------ */
/* Vorlagen                                                            */
/* ------------------------------------------------------------------ */

function dimension(patch: Partial<DimensionEntity> = {}): DimensionEntity {
  return {
    id: 'dim-1',
    type: 'dimension',
    name: 'Mass',
    tagId: null,
    hidden: false,
    locked: false,
    kind: 'linear',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 4, y: 0, z: 0 },
    offset: { x: 0, y: 0.5, z: 0 },
    text: null,
    fontSize: 12,
    color: '#333333',
    screenSpace: true,
    arrowStyle: 'closedArrow',
    ...patch,
  }
}

function textEntity(patch: Partial<TextEntity> = {}): TextEntity {
  return {
    id: 'txt-1',
    type: 'text',
    name: 'Text',
    tagId: null,
    hidden: false,
    locked: false,
    anchor: { x: 0, y: 0, z: 0 },
    position: { x: 1, y: 1, z: 0 },
    text: 'Wohnzimmer',
    fontSize: 14,
    color: '#222222',
    screenSpace: true,
    leader: 'viewBased',
    ...patch,
  }
}

function guideLine(patch: Partial<GuideLineEntity> = {}): GuideLineEntity {
  return {
    id: 'gl-1',
    type: 'guideLine',
    name: 'Hilfslinie',
    tagId: null,
    hidden: false,
    locked: false,
    origin: { x: 0, y: 2, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    length: null,
    ...patch,
  }
}

function guidePoint(patch: Partial<GuidePointEntity> = {}): GuidePointEntity {
  return {
    id: 'gp-1',
    type: 'guidePoint',
    name: 'Hilfspunkt',
    tagId: null,
    hidden: false,
    locked: false,
    position: { x: 1, y: 1, z: 0 },
    ...patch,
  }
}

function imageEntity(patch: Partial<ImageEntity> = {}): ImageEntity {
  return {
    id: 'img-1',
    type: 'image',
    name: 'Bild',
    tagId: null,
    hidden: false,
    locked: false,
    textureId: 'tex-1',
    transform: M.identity(),
    width: 2,
    height: 1,
    usage: 'model',
    ...patch,
  }
}

/* ================================================================== */

describe('Bemassung', () => {
  it('zeichnet Masslinie, Hilfslinien und Pfeile', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension())
    const { layer } = build(doc)

    expect(layer.counts.dimensions).toBe(1)
    const lines = segments(layer)
    // Masslinie auf y = 0,5 von x=0 bis x=4
    expect(lines.some((s) => close(s.a, { x: 0, y: 0.5, z: 0 }) && close(s.b, { x: 4, y: 0.5, z: 0 }))).toBe(true)
    // je Messpunkt eine Hilfslinie: senkrecht zur Messstrecke
    const extension = lines.filter((s) => Math.abs(s.a.x - s.b.x) < 1e-6 && Math.abs(s.a.y - s.b.y) > 1e-6)
    expect(extension.length).toBeGreaterThanOrEqual(2)
    // Pfeilspitzen: geschlossener Pfeil = 3 Segmente je Ende
    expect(lines.length).toBeGreaterThanOrEqual(1 + 2 + 6)
  })

  it('formatiert den gemessenen Wert ueber die Dokumenteinheiten', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension())
    const { layer } = build(doc)
    const rec = recorder()
    layer.draw2d(rec.ctx, host())
    expect(rec.texts.map((t) => t.text)).toContain('4 m')
  })

  it('laesst `text` den gemessenen Wert ueberschreiben', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension({ text: 'ca. 4 m' }))
    const { layer } = build(doc)
    const rec = recorder()
    layer.draw2d(rec.ctx, host())
    expect(rec.texts.map((t) => t.text)).toContain('ca. 4 m')
    expect(rec.texts.map((t) => t.text)).not.toContain('4 m')
  })

  it('kennt Radius und Durchmesser ueber den Kreismittelpunkt', () => {
    for (const [kind, expected] of [
      ['radius', 'R 4 m'],
      ['diameter', '⌀ 8 m'],
    ] as const) {
      const doc = emptyDocument()
      // Mittelpunkt im Ursprung, Kreispunkt bei x = 4
      addEntity(doc, dimension({ kind, center: { x: 0, y: 0, z: 0 }, start: { x: 4, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 } }))
      const { layer } = build(doc)
      const rec = recorder()
      layer.draw2d(rec.ctx, host())
      expect(rec.texts.map((t) => t.text)).toContain(expected)
    }
  })

  it('zieht die Durchmesserlinie durch den Mittelpunkt, die Radiuslinie nur nach aussen', () => {
    const base = { center: { x: 0, y: 0, z: 0 }, start: { x: 4, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 }, offset: V.ORIGIN }

    const durchmesser = emptyDocument()
    addEntity(durchmesser, dimension({ kind: 'diameter', ...base }))
    const dLines = segments(build(durchmesser).layer)
    expect(dLines.some((s) => close(s.a, { x: -4, y: 0, z: 0 }) && close(s.b, { x: 4, y: 0, z: 0 }))).toBe(true)

    const radius = emptyDocument()
    addEntity(radius, dimension({ kind: 'radius', ...base }))
    const rLines = segments(build(radius).layer)
    expect(rLines.some((s) => close(s.a, { x: 0, y: 0, z: 0 }) && close(s.b, { x: 4, y: 0, z: 0 }))).toBe(true)
    expect(rLines.some((s) => s.a.x < -1e-6 || s.b.x < -1e-6)).toBe(true) // Mittelpunktkreuz
  })

  it('nimmt ohne Mittelpunkt den ersten Messpunkt als Mittelpunkt', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension({ kind: 'radius' }))
    const rec = recorder()
    build(doc).layer.draw2d(rec.ctx, host())
    expect(rec.texts.map((t) => t.text)).toContain('R 4 m')
  })

  it('misst Winkel ueber den dritten Punkt', () => {
    const doc = emptyDocument()
    addEntity(
      doc,
      dimension({
        kind: 'angular',
        center: { x: 0, y: 0, z: 0 },
        start: { x: 1, y: 0, z: 0 },
        end: { x: 0, y: 1, z: 0 },
      }),
    )
    const { layer } = build(doc)
    const rec = recorder()
    layer.draw2d(rec.ctx, host())
    expect(rec.texts.map((t) => t.text)).toContain('90°')
    // Der Bogen liefert deutlich mehr Segmente als eine gerade Masslinie
    expect(segments(layer).length).toBeGreaterThan(10)
  })

  it('zeichnet ohne Pfeile, wenn arrowStyle none ist', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension({ arrowStyle: 'none' }))
    const withArrows = build(withDimension(dimension({ arrowStyle: 'closedArrow' })))
    const { layer } = build(doc)
    expect(segments(layer).length).toBeLessThan(segments(withArrows.layer).length)
  })

  it('haelt Bildschirmtext in Pixelgroesse und Ebenentext in Metern', () => {
    const screenDoc = emptyDocument()
    addEntity(screenDoc, dimension({ screenSpace: true, fontSize: 12 }))
    const screenRec = recorder()
    build(screenDoc).layer.draw2d(screenRec.ctx, host())
    expect(screenRec.texts[0].font).toContain('12px')
    expect(screenRec.texts[0].transform).toBeNull()

    const planeDoc = emptyDocument()
    addEntity(planeDoc, dimension({ screenSpace: false, fontSize: 0.5 }))
    const planeRec = recorder()
    build(planeDoc).layer.draw2d(planeRec.ctx, host())
    const label = planeRec.texts[0]
    expect(label.transform).not.toBeNull()
    // 0,5 m Texthoehe bei 100 px/m = 50 px auf dem Bildschirm
    const t = label.transform as number[]
    const fontPx = Number(label.font.split('px')[0])
    expect(Math.hypot(t[0], t[1]) * fontPx).toBeCloseTo(50, 3)
  })

  it('dreht Ebenentext nie spiegelverkehrt', () => {
    const doc = emptyDocument()
    // Messstrecke laeuft nach -x, der Text stuende sonst rueckwaerts
    addEntity(doc, dimension({ screenSpace: false, fontSize: 0.5, start: { x: 4, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } }))
    const rec = recorder()
    build(doc).layer.draw2d(rec.ctx, host())
    const t = rec.texts[0].transform as number[]
    // positive Determinante = aufrechte, lesbare Schrift
    expect(t[0] * t[3] - t[1] * t[2]).toBeGreaterThan(0)
  })
})

function withDimension(entity: DimensionEntity): SketchDocument {
  const doc = emptyDocument()
  addEntity(doc, entity)
  return doc
}

describe('Text', () => {
  it('zeichnet Text und Fuehrungslinie', () => {
    const doc = emptyDocument()
    addEntity(doc, textEntity())
    const { layer } = build(doc)
    expect(layer.counts.texts).toBe(1)
    const rec = recorder()
    layer.draw2d(rec.ctx, host())
    expect(rec.texts.map((t) => t.text)).toContain('Wohnzimmer')
    // viewBased: die Fuehrungslinie liegt auf der Textebene
    expect(rec.strokes).toBeGreaterThan(0)
    expect(segments(layer).length).toBe(0)
  })

  it('legt die pushPin-Fuehrungslinie in den Weltraum', () => {
    const doc = emptyDocument()
    addEntity(doc, textEntity({ leader: 'pushPin' }))
    const { layer } = build(doc)
    const lines = segments(layer)
    expect(lines.some((s) => close(s.a, { x: 0, y: 0, z: 0 }) && close(s.b, { x: 1, y: 1, z: 0 }))).toBe(true)
    const rec = recorder()
    layer.draw2d(rec.ctx, host())
    expect(rec.strokes).toBe(0)
  })

  it('zeichnet ohne Fuehrungslinie bei leader none', () => {
    const doc = emptyDocument()
    addEntity(doc, textEntity({ leader: 'none' }))
    const { layer } = build(doc)
    expect(segments(layer).length).toBe(0)
    const rec = recorder()
    layer.draw2d(rec.ctx, host())
    expect(rec.strokes).toBe(0)
    expect(rec.texts.length).toBe(1)
  })
})

describe('Hilfslinien und Hilfspunkte', () => {
  it('verlaengert eine unendliche Hilfslinie ueber das Modell hinaus', () => {
    const doc = documentWithSquare(2)
    addEntity(doc, guideLine())
    const { layer } = build(doc)
    const lines = segments(layer)
    expect(lines.length).toBe(1)
    expect(lines[0].b.x - lines[0].a.x).toBeGreaterThan(50)
  })

  it('begrenzt eine Hilfslinie mit Laenge', () => {
    const doc = emptyDocument()
    addEntity(doc, guideLine({ length: 3 }))
    const { layer } = build(doc)
    const lines = segments(layer)
    expect(lines.length).toBe(1)
    expect(close(lines[0].a, { x: 0, y: 2, z: 0 })).toBe(true)
    expect(close(lines[0].b, { x: 3, y: 2, z: 0 })).toBe(true)
  })

  it('faerbt achsenparallele Hilfslinien in der Achsenfarbe', () => {
    const doc = emptyDocument()
    addEntity(doc, guideLine())
    expect(hasColor(build(doc).layer, AXIS_X_COLOR)).toBe(true)

    const schraeg = emptyDocument()
    addEntity(schraeg, guideLine({ direction: { x: 1, y: 1, z: 0 } }))
    expect(hasColor(build(schraeg).layer, GUIDE_COLOR)).toBe(true)
    expect(hasColor(build(schraeg).layer, AXIS_X_COLOR)).toBe(false)
  })

  it('zeichnet den Hilfspunkt als Kreuz', () => {
    const doc = emptyDocument()
    addEntity(doc, guidePoint())
    const { layer } = build(doc)
    expect(layer.counts.guidePoints).toBe(1)
    expect(segments(layer).length).toBe(3)
  })

  it('zieht die Linie zum Ursprung der Messung', () => {
    const doc = emptyDocument()
    addEntity(doc, guidePoint({ from: { x: 0, y: 0, z: 0 } }))
    const { layer } = build(doc)
    const lines = segments(layer)
    expect(lines.some((s) => close(s.a, { x: 0, y: 0, z: 0 }) && close(s.b, { x: 1, y: 1, z: 0 }))).toBe(true)
  })

  it('blendet Hilfslinien und Hilfspunkte ueber showGuides aus', () => {
    const doc = emptyDocument()
    addEntity(doc, guideLine())
    addEntity(doc, guidePoint())
    addEntity(doc, dimension())
    const { layer } = build(doc, { style: { ...DEFAULT_STYLE, showGuides: false } })
    expect(layer.counts.guideLines).toBe(0)
    expect(layer.counts.guidePoints).toBe(0)
    // Die Bemassung bleibt sichtbar - sie ist keine Konstruktionshilfe
    expect(layer.counts.dimensions).toBe(1)
  })

  it('nutzt die Achsenfarbe nur bei echter Achsenparallelitaet', () => {
    expect(axisColor({ x: 1, y: 0, z: 0 })).toBe(AXIS_X_COLOR)
    expect(axisColor({ x: 0, y: 0, z: -1 })).toBe(AXIS_Z_COLOR)
    expect(axisColor({ x: 1, y: 0.01, z: 0 })).toBe(GUIDE_COLOR)
  })
})

describe('Bilder', () => {
  it('baut ein Rechteck aus Transformation, Breite und Hoehe', () => {
    const doc = emptyDocument()
    doc.textures['tex-1'] = { id: 'tex-1', name: 'Foto', dataUrl: '', width: 4, height: 2 }
    addEntity(doc, imageEntity({ transform: M.translation({ x: 1, y: 0, z: 0 }) }))
    const { layer } = build(doc)
    expect(layer.counts.images).toBe(1)
    const mesh = layer.group.children.find((c) => (c as { isMesh?: boolean }).isMesh)
    expect(mesh).toBeDefined()
    // Rahmen: vier Segmente von (1,0) bis (3,1)
    const lines = segments(layer)
    expect(lines.length).toBe(4)
    expect(lines.some((s) => close(s.a, { x: 1, y: 0, z: 0 }) && close(s.b, { x: 3, y: 0, z: 0 }))).toBe(true)
    expect(lines.some((s) => close(s.a, { x: 3, y: 1, z: 0 }) && close(s.b, { x: 1, y: 1, z: 0 }))).toBe(true)
  })

  it('laesst Wasserzeichen ungezeichnet', () => {
    const doc = emptyDocument()
    addEntity(doc, imageEntity({ usage: 'watermark' }))
    const { layer } = build(doc)
    expect(layer.counts.images).toBe(0)
    expect(layer.group.children.length).toBe(0)
  })
})

describe('Sichtbarkeit und Auswahl', () => {
  it('ueberspringt versteckte Entitaeten', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension({ hidden: true }))
    expect(build(doc).layer.counts.dimensions).toBe(0)
  })

  it('folgt der Tag-Sichtbarkeit', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension({ tagId: 'tag-mass' }))
    const { layer } = build(doc, { isTagVisible: (id) => id !== 'tag-mass' })
    expect(layer.counts.dimensions).toBe(0)
  })

  it('faerbt die Auswahl blau', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension())
    const { layer } = build(doc, {
      selection: { edgeIds: [], faceIds: [], vertexIds: [], entityIds: ['dim-1'] },
    })
    expect(hasColor(layer, SELECT_COLOR)).toBe(true)
  })

  it('zeichnet Annotationen verschachtelter Definitionen mit deren Welttransformation', () => {
    const doc = documentWithSquare(2)
    addInstance(doc, 'raum', squareGeometry(2), M.translation({ x: 10, y: 0, z: 0 }))
    const point = guidePoint({ id: 'gp-innen', position: { x: 0, y: 0, z: 0 } })
    doc.entities['gp-innen'] = point
    doc.definitions.raum.children.push('gp-innen')

    const { layer } = build(doc)
    expect(layer.counts.guidePoints).toBe(1)
    const lines = segments(layer)
    // Der Kreuzmarker sitzt bei x = 10, nicht im Ursprung
    expect(lines.every((s) => Math.abs(V.midpoint(s.a, s.b).x - 10) < 1e-6)).toBe(true)
  })
})

describe('Neuaufbau', () => {
  it('baut bei gleicher Signatur nicht neu', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension())
    const { layer, snapshot, sync } = build(doc)
    const before = layer.group.children[0]
    layer.update(snapshot, sync)
    expect(layer.group.children[0]).toBe(before)
  })

  it('baut bei neuer Szenenrevision neu', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension())
    const { layer, snapshot, sync } = build(doc)
    const before = layer.group.children[0]
    layer.update({ ...snapshot, revisions: { ...snapshot.revisions, scene: 99 } }, sync)
    expect(layer.group.children[0]).not.toBe(before)
  })

  it('raeumt beim Entfernen der Entitaet auf', () => {
    const doc = emptyDocument()
    addEntity(doc, dimension())
    const { layer, snapshot, sync } = build(doc)
    expect(layer.group.children.length).toBeGreaterThan(0)

    delete doc.entities['dim-1']
    doc.definitions.root.children = []
    layer.update({ ...snapshot, revisions: { ...snapshot.revisions, scene: 2 } }, sync)
    expect(layer.group.children.length).toBe(0)
    expect(layer.hasScreenContent).toBe(false)
  })

  it('ueberlebt ein leeres Dokument', () => {
    const materials = new MaterialCache(DEFAULT_STYLE, () => undefined)
    const sync = new SceneSync(materials, new EdgeMaterials())
    const layer = new AnnotationLayer()
    layer.update(snapshotOf(null), sync)
    expect(layer.group.children.length).toBe(0)
    expect(layer.hasScreenContent).toBe(false)
    layer.dispose()
  })
})

/* ------------------------------------------------------------------ */

function close(a: Vec3Like, b: Vec3Like, tol = 1e-5): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol
}
