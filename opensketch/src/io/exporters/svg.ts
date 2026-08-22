/**
 * SVG-Export: 2D-Vektorzeichnung aus einer waehlbaren Ansicht.
 *
 * Bewusst OHNE Verdeckte-Linien-Berechnung: die Flaechen werden nach Tiefe
 * sortiert und als gefuellte Polygone uebereinandergelegt (Malerverfahren),
 * die Kanten kommen darueber. Das ergibt fuer Grundrisse, Ansichten und
 * Isometrien saubere, direkt weiterverarbeitbare Zeichnungen.
 *
 * Die Zeichnung wird in Millimetern ausgegeben und auf einen glatten Massstab
 * (1:1 ... 1:1000) gerundet; der Massstab steht im Titel.
 */

import type { SketchDocument, Vec3Like } from '@/shared/types'
import type { ExportOptions, ExportResult, ExportView } from '../api-types'
import { flattenDocument, usedMaterials, type FacePolygon } from '../common/scene'
import { escapeXml, num, sanitizeFilename, textBlob } from '../common/util'
import {
  WarningList,
  degenerateEdgesWarning,
  degenerateFacesWarning,
  edgesDisabledWarning,
  emptyExportWarning,
  flatLoss,
  skippedInstancesWarning,
  svgProjectionWarning,
  svgTexturesWarning,
  usedTextures,
} from '../common/warnings'
import { V } from '@/core/math'

/** Nutzbare Zeichenflaeche in Millimetern (A3 quer, 10 mm Rand). */
const PAGE_WIDTH = 400
const PAGE_HEIGHT = 277
const MARGIN = 10

const SCALE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]

const VIEW_LABEL: Record<ExportView, string> = {
  top: 'Draufsicht',
  front: 'Vorderansicht',
  right: 'Seitenansicht rechts',
  iso: 'Isometrie',
  current: 'Aktuelle Ansicht',
}

interface Projection {
  right: Vec3Like
  up: Vec3Like
  /** Blickrichtung Kamera -> Modell */
  dir: Vec3Like
}

/** Orthogonalbasis fuer die gewuenschte Ansicht. */
export function projectionFor(view: ExportView, cameraDirection?: Vec3Like): Projection {
  let dir: Vec3Like
  switch (view) {
    case 'top':
      dir = { x: 0, y: 0, z: -1 }
      break
    case 'front':
      dir = { x: 0, y: 1, z: 0 }
      break
    case 'right':
      dir = { x: -1, y: 0, z: 0 }
      break
    case 'current':
      dir = cameraDirection && V.length(cameraDirection) > 1e-9 ? V.normalize(cameraDirection) : isoDirection()
      break
    case 'iso':
    default:
      dir = isoDirection()
      break
  }
  const worldUp = Math.abs(dir.z) > 0.999 ? V.AXIS_Y : V.AXIS_Z
  let right = V.cross(dir, worldUp)
  if (V.length(right) < 1e-9) right = V.anyPerpendicular(dir)
  right = V.normalize(right)
  const up = V.normalize(V.cross(right, dir))
  return { right, up, dir }
}

function isoDirection(): Vec3Like {
  // Kamera vorne rechts oben, Blick zum Ursprung
  return V.normalize({ x: -1, y: 1, z: -1 })
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function exportSvg(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const view: ExportView = opts.view ?? 'top'
  const projection = projectionFor(view, opts.cameraDirection)
  const flat = flattenDocument(doc, {
    unitScale: opts.unitScale ?? 1,
    onlyEntityIds: opts.selectionOnly ? opts.selectedEntityIds : undefined,
  })

  const to2 = (p: Vec3Like) => ({ x: V.dot(p, projection.right), y: -V.dot(p, projection.up) })
  const depthOf = (p: Vec3Like) => V.dot(p, projection.dir)

  /* ---- Projizieren ---- */
  interface DrawFace {
    points: { x: number; y: number }[]
    holes: { x: number; y: number }[][]
    depth: number
    fill: string
    opacity: number
  }
  // Tiefenbereich in Blickrichtung: Er entscheidet, ob der Hinweis "das ist
  // eine Projektion" ueberhaupt etwas aussagt. Bei einem flachen Grundriss
  // in der Draufsicht geht nichts verloren, dort waere er nur Laerm.
  let minDepth = Infinity
  let maxDepth = -Infinity
  const trackDepth = (p: Vec3Like): void => {
    const d = depthOf(p)
    if (!Number.isFinite(d)) return
    if (d < minDepth) minDepth = d
    if (d > maxDepth) maxDepth = d
  }

  const faces: DrawFace[] = []
  for (const poly of flat.faces) {
    const points = poly.outer.map(to2)
    if (points.length < 3) continue
    for (const p of poly.outer) trackDepth(p)
    const material = poly.frontMaterialId ? doc.materials[poly.frontMaterialId] : undefined
    faces.push({
      points,
      holes: poly.holes.map((ring) => ring.map(to2)),
      depth: averageDepth(poly, depthOf),
      fill: shadeOf(poly, material?.color ?? '#e8e4dc'),
      opacity: material?.opacity ?? 1,
    })
  }
  // Malerverfahren: das Fernste zuerst
  faces.sort((a, b) => b.depth - a.depth)

  const edges: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
  if (opts.includeEdges !== false) {
    for (const edge of flat.edges) {
      if (edge.soft) continue
      trackDepth(edge.a)
      trackDepth(edge.b)
      edges.push({ a: to2(edge.a), b: to2(edge.b) })
    }
  }

  /* ---- Massstab und Ausschnitt ---- */
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const track = (p: { x: number; y: number }): void => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  for (const face of faces) {
    for (const p of face.points) track(p)
  }
  for (const edge of edges) {
    track(edge.a)
    track(edge.b)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 1
    maxY = 1
  }

  const widthM = Math.max(maxX - minX, 1e-6)
  const heightM = Math.max(maxY - minY, 1e-6)
  const denominator = pickScale(widthM, heightM)
  const mmPerMetre = 1000 / denominator
  const drawWidth = widthM * mmPerMetre
  const drawHeight = heightM * mmPerMetre
  const px = (p: { x: number; y: number }) => ({
    x: (p.x - minX) * mmPerMetre + MARGIN,
    y: (p.y - minY) * mmPerMetre + MARGIN,
  })

  const totalWidth = drawWidth + 2 * MARGIN
  const totalHeight = drawHeight + 2 * MARGIN
  const stroke = opts.strokeWidth ?? 0.25

  /* ---- Ausgabe ---- */
  const title = `${doc.meta.name || 'Modell'} - ${VIEW_LABEL[view]} - Maßstab 1:${denominator}`
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="utf-8"?>')
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(totalWidth, 3)}mm" height="${num(totalHeight, 3)}mm" viewBox="0 0 ${num(totalWidth, 3)} ${num(totalHeight, 3)}">`,
  )
  out.push(`  <title>${escapeXml(title)}</title>`)
  out.push(`  <desc>Erzeugt von OpenSketch Studio. 1 Einheit = 1 mm.</desc>`)
  out.push(`  <g id="flaechen" stroke="none">`)
  for (const face of faces) {
    const d = [pathOf(face.points.map(px)), ...face.holes.map((ring) => pathOf(ring.map(px)))].join(' ')
    const opacity = face.opacity < 1 ? ` fill-opacity="${num(face.opacity, 3)}"` : ''
    out.push(`    <path d="${d}" fill="${face.fill}" fill-rule="evenodd"${opacity}/>`)
  }
  out.push('  </g>')
  if (edges.length > 0) {
    out.push(
      `  <g id="kanten" fill="none" stroke="#1a1a1a" stroke-width="${num(stroke, 3)}" stroke-linecap="round">`,
    )
    for (const edge of edges) {
      const a = px(edge.a)
      const b = px(edge.b)
      out.push(`    <line x1="${num(a.x, 3)}" y1="${num(a.y, 3)}" x2="${num(b.x, 3)}" y2="${num(b.y, 3)}"/>`)
    }
    out.push('  </g>')
  }
  out.push('</svg>')
  out.push('')

  /* ---- Warnungen ---- */
  const warnings = new WarningList()
  const loss = flatLoss(flat)
  if (faces.length === 0 && edges.length === 0) {
    warnings.add(
      emptyExportWarning(
        'SVG-Zeichnung',
        opts.selectionOnly === true,
        opts.includeEdges === false
          ? 'Zeichne Geometrie, oder schalte die Kanten wieder ein.'
          : 'Zeichne Geometrie, bevor du eine Ansicht exportierst.',
      ),
    )
  } else {
    const depth = Number.isFinite(minDepth) ? maxDepth - minDepth : 0
    // "Nicht triviale Tiefe": mehr als ein Prozent der Zeichnungsausdehnung.
    if (depth > 1e-9 && depth > 0.01 * Math.max(widthM, heightM)) {
      warnings.add(svgProjectionWarning(VIEW_LABEL[view]))
    }
    if (opts.includeEdges === false) warnings.add(edgesDisabledWarning(loss.facelessEdges, 'die Zeichnung'))
    warnings.add(svgTexturesWarning(usedTextures(doc, usedMaterials(doc, flat)).length))
  }
  warnings.add(degenerateFacesWarning(flat.degenerateFaces))
  warnings.add(degenerateEdgesWarning(flat.degenerateEdges))
  warnings.add(skippedInstancesWarning(flat.skipped))

  return {
    blob: textBlob(out.join('\n'), 'image/svg+xml'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.svg`,
    warnings: warnings.list(),
  }
}

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */

function averageDepth(poly: FacePolygon, depthOf: (p: Vec3Like) => number): number {
  let sum = 0
  for (const p of poly.outer) sum += depthOf(p)
  return sum / poly.outer.length
}

function pathOf(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const parts = [`M ${num(points[0].x, 3)} ${num(points[0].y, 3)}`]
  for (let i = 1; i < points.length; i++) parts.push(`L ${num(points[i].x, 3)} ${num(points[i].y, 3)}`)
  parts.push('Z')
  return parts.join(' ')
}

function pickScale(widthM: number, heightM: number): number {
  for (const step of SCALE_STEPS) {
    const w = (widthM * 1000) / step
    const h = (heightM * 1000) / step
    if (w <= PAGE_WIDTH - 2 * MARGIN && h <= PAGE_HEIGHT - 2 * MARGIN) return step
  }
  return SCALE_STEPS[SCALE_STEPS.length - 1]
}

/**
 * Leichte Schattierung nach Flaechenneigung - ohne sie sehen Isometrien
 * flach und unlesbar aus.
 */
function shadeOf(poly: FacePolygon, hex: string): string {
  const lambert = 0.55 + 0.45 * Math.abs(V.dot(V.normalize(poly.normal), { x: 0.3, y: -0.45, z: 0.84 }))
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#e8e4dc'
  const int = parseInt(clean.slice(1), 16)
  const mix = (v: number) => Math.max(0, Math.min(255, Math.round(v * lambert)))
  const r = mix((int >> 16) & 255)
  const g = mix((int >> 8) & 255)
  const b = mix(int & 255)
  const hexPart = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hexPart(r)}${hexPart(g)}${hexPart(b)}`
}
