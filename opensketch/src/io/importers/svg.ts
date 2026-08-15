/**
 * SVG-Import in die XY-Ebene - gedacht fuer Grundrisse, Logos und Schnitte.
 *
 * Gelesen werden `path`, `polygon`, `polyline`, `rect`, `circle`, `ellipse`
 * und `line`, inklusive der `transform`-Attribute von Elementen UND
 * verschachtelten `<g>`-Gruppen.
 *
 * Der Parser kommt bewusst ohne DOM aus (vitest laeuft in Node): ein
 * Tag-Scanner mit Transformationsstapel reicht fuer SVG-Dateien voellig und
 * macht den Importer testbar.
 *
 * Massstab: `viewBox` zusammen mit `width`/`height` legt fest, wie gross die
 * Zeichnung wird. Ohne Angaben gilt 1 px = 1 mm - das ist die Konvention,
 * mit der die meisten CAD-Exporte herauskommen.
 */

import type { Id } from '@/shared/types'
import type { ImportOptions, ImportResult } from '../api-types'
import { GeomBuilder } from '../common/geom'
import { baseName, parseCssColor, utf8Text } from '../common/util'
import { ImportScene, makeMaterial } from './common'
import { parsePath, type Pt, type SubPath } from './svg-path'
import { POINT_TOL } from '@/core/math'

/** Standardumrechnung: 1 SVG-Nutzereinheit = 1 mm. */
const DEFAULT_UNITS_PER_METRE = 1000

interface Mat2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const IDENTITY_2D: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function importSvg(bytes: Uint8Array, filename: string, opts: ImportOptions = {}): ImportResult {
  return parseSvg(utf8Text(bytes), filename, opts)
}

export function parseSvg(text: string, filename: string, opts: ImportOptions = {}): ImportResult {
  const scene = new ImportScene(opts.name ?? baseName(filename) ?? 'SVG-Import')
  const body = scene.addDefinition(baseName(filename) || 'Zeichnung', 'group')
  scene.addInstance(scene.root, body, undefined, body.name)
  const g = new GeomBuilder(body.geometry)

  const rootAttributes = firstTagAttributes(text, 'svg')
  const unitScale = (opts.unitScale ?? 1) * metresPerUnit(rootAttributes, scene)

  const fills = new Map<string, Id>()
  const materialFor = (color: string | null): Id | null => {
    if (!color) return null
    const existing = fills.get(color)
    if (existing) return existing
    const material = makeMaterial(`SVG ${color}`, color, 'Import')
    scene.addMaterial(material)
    fills.set(color, material.id)
    return material.id
  }

  let faces = 0
  let edges = 0
  let skipped = 0

  const emit = (subPaths: SubPath[], matrix: Mat2D, fill: string | null): void => {
    for (const sub of subPaths) {
      const points = sub.points
        .map((p) => applyMatrix(matrix, p))
        .map((p) => ({ x: p.x * unitScale, y: -p.y * unitScale, z: 0 }))
      const ring = dropDuplicates(points)
      if (ring.length < 2) {
        skipped++
        continue
      }
      if (sub.closed && ring.length >= 3) {
        const materialId = materialFor(fill)
        if (g.face(ring, [], { materialId })) {
          faces++
          continue
        }
        // entartete Kontur: wenigstens die Kanten retten
        edges += g.polyline(ring, true).length
      } else {
        edges += g.polyline(ring, false).length
      }
    }
  }

  /* ---- Tags durchlaufen ---- */
  const stack: { matrix: Mat2D; fill: string | null }[] = [{ matrix: IDENTITY_2D, fill: '#c8c8c8' }]
  const tagRe = /<\s*(\/?)\s*([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)\s*>/g
  let match: RegExpExecArray | null

  while ((match = tagRe.exec(text)) !== null) {
    const closing = match[1] === '/'
    const name = match[2].toLowerCase().replace(/^svg:/, '')
    const attributeText = match[3]
    const selfClosing = match[4] === '/'

    if (closing) {
      if ((name === 'g' || name === 'svg') && stack.length > 1) stack.pop()
      continue
    }

    const attributes = parseAttributes(attributeText)
    const parent = stack[stack.length - 1]
    const matrix = attributes.transform
      ? multiply2D(parent.matrix, parseTransform(attributes.transform))
      : parent.matrix
    const fill = attributes.fill !== undefined ? parseCssColor(attributes.fill) : styleFill(attributes.style, parent.fill)

    if (name === 'g' || name === 'svg') {
      if (!selfClosing) stack.push({ matrix, fill })
      continue
    }

    switch (name) {
      case 'path': {
        const d = attributes.d
        if (!d) break
        emit(parsePath(d), matrix, fill)
        break
      }
      case 'polygon':
      case 'polyline': {
        const points = parsePointList(attributes.points ?? '')
        if (points.length < 2) break
        emit([{ points, closed: name === 'polygon' }], matrix, fill)
        break
      }
      case 'rect': {
        const x = numberOf(attributes.x)
        const y = numberOf(attributes.y)
        const w = numberOf(attributes.width)
        const h = numberOf(attributes.height)
        if (w <= 0 || h <= 0) break
        const rx = Math.min(numberOf(attributes.rx || attributes.ry), w / 2)
        const ry = Math.min(numberOf(attributes.ry || attributes.rx), h / 2)
        emit([{ points: rectPoints(x, y, w, h, rx, ry), closed: true }], matrix, fill)
        break
      }
      case 'circle': {
        const r = numberOf(attributes.r)
        if (r <= 0) break
        emit(
          [{ points: ellipsePoints(numberOf(attributes.cx), numberOf(attributes.cy), r, r), closed: true }],
          matrix,
          fill,
        )
        break
      }
      case 'ellipse': {
        const rx = numberOf(attributes.rx)
        const ry = numberOf(attributes.ry)
        if (rx <= 0 || ry <= 0) break
        emit(
          [{ points: ellipsePoints(numberOf(attributes.cx), numberOf(attributes.cy), rx, ry), closed: true }],
          matrix,
          fill,
        )
        break
      }
      case 'line': {
        emit(
          [
            {
              points: [
                { x: numberOf(attributes.x1), y: numberOf(attributes.y1) },
                { x: numberOf(attributes.x2), y: numberOf(attributes.y2) },
              ],
              closed: false,
            },
          ],
          matrix,
          null,
        )
        break
      }
      case 'text':
      case 'image':
      case 'use':
        skipped++
        break
      default:
        break
    }
  }

  if (faces === 0 && edges === 0) scene.warn('Die SVG-Datei enthält keine lesbaren Konturen.')
  else scene.warn(`SVG gelesen: ${faces} Fläche(n), ${edges} Kante(n). Maßstab: 1 m = ${Math.round(1 / unitScale)} Einheiten.`)
  if (skipped > 0) scene.warn(`${skipped} Element(e) ohne Geometrie wurden übersprungen (z. B. Text, Bilder, <use>).`)

  return scene.toResult()
}

/* ------------------------------------------------------------------ */
/* Massstab                                                            */
/* ------------------------------------------------------------------ */

/** Meter je SVG-Nutzereinheit. */
function metresPerUnit(attributes: Record<string, string>, scene: ImportScene): number {
  const viewBox = (attributes.viewbox ?? attributes.viewBox ?? '').trim()
  const width = parseLength(attributes.width)
  const height = parseLength(attributes.height)
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map((v) => parseFloat(v))
    const vw = parts[2]
    const vh = parts[3]
    if (Number.isFinite(vw) && vw > 0 && width) {
      return width.metres / vw
    }
    if (Number.isFinite(vh) && vh > 0 && height) {
      return height.metres / vh
    }
  }
  if (width && width.explicit) {
    scene.warn('Kein viewBox gefunden - die Breitenangabe wird direkt als Maß benutzt.')
  }
  return 1 / DEFAULT_UNITS_PER_METRE
}

const UNIT_TO_METRE: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  pt: 0.0254 / 72,
  pc: 0.0254 / 6,
  px: 0.001,
  '': 0.001,
}

function parseLength(raw: string | undefined): { metres: number; explicit: boolean } | null {
  if (!raw) return null
  const match = /^\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/.exec(raw)
  if (!match) return null
  const value = parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2].toLowerCase()
  if (unit === '%') return null
  const factor = UNIT_TO_METRE[unit]
  if (factor === undefined) return null
  return { metres: value * factor, explicit: unit !== '' && unit !== 'px' }
}

/* ------------------------------------------------------------------ */
/* Elementgeometrie                                                    */
/* ------------------------------------------------------------------ */

function rectPoints(x: number, y: number, w: number, h: number, rx: number, ry: number): Pt[] {
  if (rx <= 0 || ry <= 0) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]
  }
  const segments = 6
  const out: Pt[] = []
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= segments; i++) {
      const t = from + (i / segments) * (Math.PI / 2)
      out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry })
    }
  }
  corner(x + w - rx, y + ry, -Math.PI / 2)
  corner(x + w - rx, y + h - ry, 0)
  corner(x + rx, y + h - ry, Math.PI / 2)
  corner(x + rx, y + ry, Math.PI)
  return out
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const segments = Math.max(12, Math.min(96, Math.round(Math.max(rx, ry) * 1.2)))
  const out: Pt[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry })
  }
  return out
}

function parsePointList(raw: string): Pt[] {
  const numbers = raw
    .trim()
    .split(/[\s,]+/)
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v))
  const out: Pt[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push({ x: numbers[i], y: numbers[i + 1] })
  return out
}

function dropDuplicates(points: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < POINT_TOL && Math.abs(last.y - p.y) < POINT_TOL) continue
    out.push(p)
  }
  while (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.abs(first.x - last.x) < POINT_TOL && Math.abs(first.y - last.y) < POINT_TOL) out.pop()
    else break
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Attribute und Transformationen                                      */
/* ------------------------------------------------------------------ */

function firstTagAttributes(text: string, tag: string): Record<string, string> {
  const re = new RegExp(`<\\s*(?:svg:)?${tag}((?:"[^"]*"|'[^']*'|[^>"'])*)>`, 'i')
  const match = re.exec(text)
  return match ? parseAttributes(match[1]) : {}
}

/** Attributnamen werden zusaetzlich in Kleinschreibung abgelegt. */
export function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const value = decodeEntities(match[3] ?? match[4] ?? '')
    out[match[1]] = value
    const lower = match[1].toLowerCase()
    if (!(lower in out)) out[lower] = value
  }
  return out
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

function styleFill(style: string | undefined, inherited: string | null): string | null {
  if (!style) return inherited
  const match = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style)
  return match ? parseCssColor(match[1].trim()) : inherited
}

function numberOf(raw: string | undefined): number {
  if (!raw) return 0
  const value = parseFloat(raw)
  return Number.isFinite(value) ? value : 0
}

/** `transform`-Attribut in eine 2x3-Matrix uebersetzen. */
export function parseTransform(raw: string): Mat2D {
  let matrix = IDENTITY_2D
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .map((v) => parseFloat(v))
      .filter((v) => Number.isFinite(v))
    matrix = multiply2D(matrix, singleTransform(match[1].toLowerCase(), args))
  }
  return matrix
}

function singleTransform(name: string, a: number[]): Mat2D {
  switch (name) {
    case 'translate':
      return { a: 1, b: 0, c: 0, d: 1, e: a[0] ?? 0, f: a[1] ?? 0 }
    case 'scale': {
      const sx = a[0] ?? 1
      return { a: sx, b: 0, c: 0, d: a[1] ?? sx, e: 0, f: 0 }
    }
    case 'rotate': {
      const angle = ((a[0] ?? 0) * Math.PI) / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const rotation: Mat2D = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
      if (a.length < 3) return rotation
      const cx = a[1]
      const cy = a[2]
      return multiply2D(
        multiply2D({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, rotation),
        { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy },
      )
    }
    case 'skewx': {
      const t = Math.tan(((a[0] ?? 0) * Math.PI) / 180)
      return { a: 1, b: 0, c: t, d: 1, e: 0, f: 0 }
    }
    case 'skewy': {
      const t = Math.tan(((a[0] ?? 0) * Math.PI) / 180)
      return { a: 1, b: t, c: 0, d: 1, e: 0, f: 0 }
    }
    case 'matrix':
      return { a: a[0] ?? 1, b: a[1] ?? 0, c: a[2] ?? 0, d: a[3] ?? 1, e: a[4] ?? 0, f: a[5] ?? 0 }
    default:
      return IDENTITY_2D
  }
}

function multiply2D(m: Mat2D, n: Mat2D): Mat2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

function applyMatrix(m: Mat2D, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}
