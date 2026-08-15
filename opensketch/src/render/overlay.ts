/**
 * Overlay im Immediate-Mode.
 *
 * Werkzeuge zeichnen ihr Feedback (Gummiband, Inferenzmarker, Vorschauflaechen)
 * jeden Frame neu. `clear()` setzt nur Schreibzeiger zurueck - die Puffer selbst
 * bleiben bestehen, dadurch entsteht im laufenden Betrieb KEINE Allokation.
 *
 * Zwei Ebenen:
 *
 *  1. WebGL - Linien, Bogen, Fuellflaechen und Vorschau-Meshes. Linien laufen
 *     ueber `LineSegments2`, damit die Breite in Pixeln stimmt. Pro Kombination
 *     aus (Breite, gestrichelt, onTop, Deckkraft) gibt es genau einen Batch.
 *  2. Canvas-2D - Marker, Text und Bildschirmformen. Diese Ebene liegt ueber
 *     dem WebGL-Canvas, dadurch ist Text pixelgenau scharf.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { B, M, V } from '@/core/math'
import type {
  BBox3Like,
  InferenceResult,
  Mat4Like,
  OverlayApi,
  OverlayStyle,
  Vec2Like,
  Vec3Like,
} from '@/shared/types'
import { SketchLineMaterial } from './lineMaterial'
import { clamp, parseColor } from './util'

const DEFAULT_COLOR = '#111827'
const MIN_SEGMENTS = 12
const MAX_SEGMENTS = 96
/** Ueberlaenge einer Inferenz-Hilfslinie in Pixeln, pro Seite. */
const GUIDE_OVERSHOOT_PX = 700

/** Was der Overlay von der Kamera braucht. */
export interface OverlayHost {
  worldToScreen(p: Vec3Like): { x: number; y: number; depth: number; visible: boolean }
  pixelsPerUnit(p: Vec3Like): number
  getSize(): { width: number; height: number }
}

/* ------------------------------------------------------------------ */
/* Gepoolter Liniensatz                                                */
/* ------------------------------------------------------------------ */

/**
 * Ein wachsender Puffer aus Liniensegmenten. Die three.js-Attribute werden
 * einmal auf voller Kapazitaet angelegt; pro Frame wird nur hineingeschrieben
 * und `instanceCount` gesetzt.
 */
class SegmentBatch {
  readonly geometry = new LineSegmentsGeometry()
  readonly object: LineSegments2

  private positions = new Float32Array(0)
  private colors = new Float32Array(0)
  private distances = new Float32Array(0)
  private capacity = 0
  private count = 0

  constructor(material: SketchLineMaterial, renderOrder: number) {
    this.object = new LineSegments2(this.geometry, material)
    this.object.frustumCulled = false
    this.object.renderOrder = renderOrder
    this.object.visible = false
    this.object.matrixAutoUpdate = false
  }

  reset(): void {
    this.count = 0
  }

  get segments(): number {
    return this.count
  }

  /** Haengt ein Segment an. `distanceStart` steuert die Strichphase. */
  push(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    g: number,
    b: number,
    distanceStart: number,
  ): number {
    this.ensure(this.count + 1)
    const p = this.count * 6
    this.positions[p] = ax
    this.positions[p + 1] = ay
    this.positions[p + 2] = az
    this.positions[p + 3] = bx
    this.positions[p + 4] = by
    this.positions[p + 5] = bz
    for (let i = 0; i < 6; i += 3) {
      this.colors[p + i] = r
      this.colors[p + i + 1] = g
      this.colors[p + i + 2] = b
    }
    const d = this.count * 2
    const length = Math.hypot(bx - ax, by - ay, bz - az)
    this.distances[d] = distanceStart
    this.distances[d + 1] = distanceStart + length
    this.count++
    return distanceStart + length
  }

  /** Uebertraegt den Puffer an die GPU. */
  flush(): void {
    if (this.capacity === 0) {
      this.object.visible = false
      return
    }
    this.geometry.instanceCount = this.count
    this.object.visible = this.count > 0
    if (this.count === 0) return
    const start = this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute | undefined
    const color = this.geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute | undefined
    const dist = this.geometry.attributes.instanceDistanceStart as THREE.InterleavedBufferAttribute | undefined
    if (start) start.data.needsUpdate = true
    if (color) color.data.needsUpdate = true
    if (dist) dist.data.needsUpdate = true
  }

  private ensure(needed: number): void {
    if (needed <= this.capacity) return
    let next = Math.max(this.capacity || 64, 64)
    while (next < needed) next *= 2

    const positions = new Float32Array(next * 6)
    const colors = new Float32Array(next * 6)
    const distances = new Float32Array(next * 2)
    positions.set(this.positions)
    colors.set(this.colors)
    distances.set(this.distances)
    this.positions = positions
    this.colors = colors
    this.distances = distances
    this.capacity = next

    this.geometry.setPositions(this.positions)
    this.geometry.setColors(this.colors)
    const buffer = new THREE.InstancedInterleavedBuffer(this.distances, 2, 1)
    this.geometry.setAttribute('instanceDistanceStart', new THREE.InterleavedBufferAttribute(buffer, 1, 0))
    this.geometry.setAttribute('instanceDistanceEnd', new THREE.InterleavedBufferAttribute(buffer, 1, 1))
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    this.geometry.boundingBox = null
  }

  dispose(): void {
    this.geometry.dispose()
    this.object.removeFromParent()
  }
}

/* ------------------------------------------------------------------ */
/* Gepoolte Dreiecke                                                   */
/* ------------------------------------------------------------------ */

class TriangleBatch {
  readonly geometry = new THREE.BufferGeometry()
  readonly object: THREE.Mesh

  private positions = new Float32Array(0)
  private colors = new Float32Array(0)
  private capacity = 0
  private count = 0

  constructor(material: THREE.Material, renderOrder: number) {
    this.object = new THREE.Mesh(this.geometry, material)
    this.object.frustumCulled = false
    this.object.renderOrder = renderOrder
    this.object.visible = false
    this.object.matrixAutoUpdate = false
    this.object.castShadow = false
    this.object.receiveShadow = false
  }

  reset(): void {
    this.count = 0
  }

  pushTriangle(a: Vec3Like, b: Vec3Like, c: Vec3Like, r: number, g: number, bl: number): void {
    this.ensure(this.count + 3)
    const o = this.count * 3
    this.positions[o] = a.x
    this.positions[o + 1] = a.y
    this.positions[o + 2] = a.z
    this.positions[o + 3] = b.x
    this.positions[o + 4] = b.y
    this.positions[o + 5] = b.z
    this.positions[o + 6] = c.x
    this.positions[o + 7] = c.y
    this.positions[o + 8] = c.z
    for (let i = 0; i < 9; i += 3) {
      this.colors[o + i] = r
      this.colors[o + i + 1] = g
      this.colors[o + i + 2] = bl
    }
    this.count += 3
  }

  pushRaw(positions: Float32Array, indices: Uint32Array, r: number, g: number, b: number): void {
    const triangles = Math.floor(indices.length / 3)
    this.ensure(this.count + triangles * 3)
    for (let i = 0; i < triangles * 3; i++) {
      const src = indices[i] * 3
      if (src + 2 >= positions.length) continue
      const o = (this.count + i) * 3
      this.positions[o] = positions[src]
      this.positions[o + 1] = positions[src + 1]
      this.positions[o + 2] = positions[src + 2]
      this.colors[o] = r
      this.colors[o + 1] = g
      this.colors[o + 2] = b
    }
    this.count += triangles * 3
  }

  flush(): void {
    this.object.visible = this.count > 0
    this.geometry.setDrawRange(0, this.count)
    if (this.count === 0 || this.capacity === 0) return
    const position = this.geometry.getAttribute('position')
    const color = this.geometry.getAttribute('color')
    if (position) position.needsUpdate = true
    if (color) color.needsUpdate = true
  }

  private ensure(needed: number): void {
    if (needed <= this.capacity) return
    let next = Math.max(this.capacity || 192, 192)
    while (next < needed) next *= 2
    const positions = new Float32Array(next * 3)
    const colors = new Float32Array(next * 3)
    positions.set(this.positions)
    colors.set(this.colors)
    this.positions = positions
    this.colors = colors
    this.capacity = next
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
  }

  dispose(): void {
    this.geometry.dispose()
    this.object.removeFromParent()
  }
}

/* ------------------------------------------------------------------ */
/* Befehle der 2D-Ebene                                                */
/* ------------------------------------------------------------------ */

interface MarkerCommand {
  x: number
  y: number
  z: number
  marker: InferenceResult['marker']
  color: string
  size: number
  opacity: number
}

interface TextCommand {
  x: number
  y: number
  z: number
  text: string
  color: string
  size: number
  opacity: number
  offsetX: number
  offsetY: number
  background: string | null
}

interface ScreenShapeCommand {
  points: number[]
  closed: boolean
  color: string
  width: number
  dashed: boolean
  opacity: number
  fill: string | null
}

/** Wiederverwendbare Befehlsliste - Objekte werden nie neu erzeugt. */
class CommandPool<T> {
  private items: T[] = []
  private used = 0

  constructor(private readonly create: () => T) {}

  next(): T {
    if (this.used === this.items.length) this.items.push(this.create())
    return this.items[this.used++]
  }

  reset(): void {
    this.used = 0
  }

  get length(): number {
    return this.used
  }

  at(index: number): T {
    return this.items[index]
  }
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

export class OverlayRenderer implements OverlayApi {
  readonly group = new THREE.Group()

  private host: OverlayHost
  private batches = new Map<string, SegmentBatch>()
  private materials = new Map<string, SketchLineMaterial>()
  private fills = new Map<string, TriangleBatch>()
  private fillMaterials = new Map<string, THREE.MeshBasicMaterial>()

  private markers = new CommandPool<MarkerCommand>(() => ({
    x: 0,
    y: 0,
    z: 0,
    marker: 'square',
    color: DEFAULT_COLOR,
    size: 6,
    opacity: 1,
  }))
  private texts = new CommandPool<TextCommand>(() => ({
    x: 0,
    y: 0,
    z: 0,
    text: '',
    color: DEFAULT_COLOR,
    size: 12,
    opacity: 1,
    offsetX: 12,
    offsetY: -12,
    background: null,
  }))
  private shapes = new CommandPool<ScreenShapeCommand>(() => ({
    points: [],
    closed: false,
    color: DEFAULT_COLOR,
    width: 1,
    dashed: false,
    opacity: 1,
    fill: null,
  }))

  private width = 1
  private height = 1

  constructor(host: OverlayHost) {
    this.host = host
    this.group.name = 'overlay'
    this.group.matrixAutoUpdate = false
    this.group.renderOrder = 10
  }

  /* ---------------------------------------------------------------- */
  /* Lebenszyklus                                                     */
  /* ---------------------------------------------------------------- */

  clear(): void {
    for (const batch of this.batches.values()) batch.reset()
    for (const batch of this.fills.values()) batch.reset()
    this.markers.reset()
    this.texts.reset()
    this.shapes.reset()
  }

  /** Muss vor dem Zeichnen des Frames laufen. */
  flush(): void {
    for (const batch of this.batches.values()) batch.flush()
    for (const batch of this.fills.values()) batch.flush()
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    for (const material of this.materials.values()) material.resolution.set(this.width, this.height)
  }

  /** true, wenn die 2D-Ebene ueberhaupt etwas zu zeichnen hat. */
  get hasScreenContent(): boolean {
    return this.markers.length > 0 || this.texts.length > 0 || this.shapes.length > 0
  }

  /* ---------------------------------------------------------------- */
  /* 3D-Primitive                                                     */
  /* ---------------------------------------------------------------- */

  line(a: Vec3Like, b: Vec3Like, style?: OverlayStyle): void {
    if (!isFinitePoint(a) || !isFinitePoint(b)) return
    const batch = this.batchFor(style)
    const c = parseColor(style?.color, DEFAULT_COLOR)
    batch.push(a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, 0)
  }

  polyline(points: Vec3Like[], closed: boolean, style?: OverlayStyle): void {
    if (!Array.isArray(points) || points.length < 2) return
    const batch = this.batchFor(style)
    const c = parseColor(style?.color, DEFAULT_COLOR)
    let distance = 0
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue
      distance = batch.push(a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, distance)
    }
    if (closed && points.length > 2) {
      const a = points[points.length - 1]
      const b = points[0]
      if (isFinitePoint(a) && isFinitePoint(b)) batch.push(a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, distance)
    }
  }

  /**
   * Inferenz-Hilfslinie: gepunktet und ueber beide Enden hinaus verlaengert,
   * damit sie wie eine unendliche Konstruktionslinie wirkt.
   */
  guide(a: Vec3Like, b: Vec3Like, style?: OverlayStyle): void {
    if (!isFinitePoint(a) || !isFinitePoint(b)) return
    const dir = V.sub(b, a)
    const length = V.length(dir)
    if (length < 1e-9) return
    const unit = V.mul(dir, 1 / length)
    const mid = V.midpoint(a, b)
    const ppu = this.host.pixelsPerUnit(mid)
    const overshoot = Number.isFinite(ppu) && ppu > 1e-9 ? GUIDE_OVERSHOOT_PX / ppu : length * 4
    const from = V.addScaled(a, unit, -overshoot)
    const to = V.addScaled(b, unit, overshoot)

    const batch = this.batchFor({
      ...style,
      dashed: true,
      dashSize: style?.dashSize ?? Math.max(overshoot * 0.006, 1e-5),
      width: style?.width ?? 1,
    })
    const c = parseColor(style?.color, '#6b7280')
    batch.push(from.x, from.y, from.z, to.x, to.y, to.z, c.r, c.g, c.b, 0)
  }

  circle(center: Vec3Like, normal: Vec3Like, radius: number, style?: OverlayStyle): void {
    this.arc(center, normal, radius, 0, Math.PI * 2, style)
  }

  arc(
    center: Vec3Like,
    normal: Vec3Like,
    radius: number,
    start: number,
    end: number,
    style?: OverlayStyle,
  ): void {
    if (!isFinitePoint(center) || !Number.isFinite(radius) || radius <= 0) return
    const n = V.normalizeOr(normal, V.AXIS_Z)
    const u = V.normalizeOr(V.anyPerpendicular(n), V.AXIS_X)
    const v = V.cross(n, u)
    const sweep = Math.abs(end - start)
    const segments = this.segmentCount(center, radius, sweep)
    const batch = this.batchFor(style)
    const c = parseColor(style?.color, DEFAULT_COLOR)

    let previous = pointOnArc(center, u, v, radius, start)
    let distance = 0
    for (let i = 1; i <= segments; i++) {
      const angle = start + ((end - start) * i) / segments
      const point = pointOnArc(center, u, v, radius, angle)
      distance = batch.push(previous.x, previous.y, previous.z, point.x, point.y, point.z, c.r, c.g, c.b, distance)
      previous = point
    }
  }

  polygonFill(points: Vec3Like[], style?: OverlayStyle): void {
    if (!Array.isArray(points) || points.length < 3) return
    const batch = this.fillFor(style)
    const c = parseColor(style?.color, '#1e88e5')
    // Faecher-Triangulierung: fuer die konvexen Vorschauflaechen der Werkzeuge
    // vollkommen ausreichend und ohne Allokation.
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[0]
      const b = points[i]
      const d = points[i + 1]
      if (!isFinitePoint(a) || !isFinitePoint(b) || !isFinitePoint(d)) continue
      batch.pushTriangle(a, b, d, c.r, c.g, c.b)
    }
  }

  ghost(positions: Float32Array, indices: Uint32Array, style?: OverlayStyle): void {
    if (!(positions instanceof Float32Array) || positions.length < 9) return
    if (!(indices instanceof Uint32Array) || indices.length < 3) return
    const batch = this.fillFor({ opacity: 0.35, ...style })
    const c = parseColor(style?.color, '#1e88e5')
    batch.pushRaw(positions, indices, c.r, c.g, c.b)
  }

  box(bbox: BBox3Like, transform?: Mat4Like, style?: OverlayStyle): void {
    if (!bbox || B.isEmpty(bbox)) return
    const segments = B.edgeSegments(bbox)
    const batch = this.batchFor(style)
    const c = parseColor(style?.color, DEFAULT_COLOR)
    for (const [rawA, rawB] of segments) {
      const a = transform ? M.transformPoint(transform, rawA) : rawA
      const b = transform ? M.transformPoint(transform, rawB) : rawB
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue
      batch.push(a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, 0)
    }
  }

  /* ---------------------------------------------------------------- */
  /* 2D-Primitive                                                     */
  /* ---------------------------------------------------------------- */

  point(p: Vec3Like, marker: InferenceResult['marker'], style?: OverlayStyle & { size?: number }): void {
    if (!isFinitePoint(p) || marker === 'none') return
    const cmd = this.markers.next()
    cmd.x = p.x
    cmd.y = p.y
    cmd.z = p.z
    cmd.marker = marker
    cmd.color = style?.color ?? DEFAULT_COLOR
    cmd.size = Math.max(2, style?.size ?? 7)
    cmd.opacity = clamp(style?.opacity ?? 1, 0, 1)
  }

  text(
    p: Vec3Like,
    text: string,
    style?: OverlayStyle & { offsetX?: number; offsetY?: number; size?: number; background?: string },
  ): void {
    if (!isFinitePoint(p) || typeof text !== 'string' || text.length === 0) return
    const cmd = this.texts.next()
    cmd.x = p.x
    cmd.y = p.y
    cmd.z = p.z
    cmd.text = text
    cmd.color = style?.color ?? DEFAULT_COLOR
    cmd.size = Math.max(6, style?.size ?? 12)
    cmd.opacity = clamp(style?.opacity ?? 1, 0, 1)
    cmd.offsetX = style?.offsetX ?? 12
    cmd.offsetY = style?.offsetY ?? -12
    cmd.background = style?.background ?? null
  }

  screenRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style?: OverlayStyle & { fill?: string },
  ): void {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return
    const cmd = this.shapes.next()
    cmd.points.length = 0
    cmd.points.push(x0, y0, x1, y0, x1, y1, x0, y1)
    cmd.closed = true
    cmd.color = style?.color ?? DEFAULT_COLOR
    cmd.width = Math.max(0.5, style?.width ?? 1)
    cmd.dashed = style?.dashed === true
    cmd.opacity = clamp(style?.opacity ?? 1, 0, 1)
    cmd.fill = style?.fill ?? null
  }

  screenPolyline(points: Vec2Like[], closed: boolean, style?: OverlayStyle): void {
    if (!Array.isArray(points) || points.length < 2) return
    const cmd = this.shapes.next()
    cmd.points.length = 0
    for (const p of points) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
      cmd.points.push(p.x, p.y)
    }
    cmd.closed = closed === true
    cmd.color = style?.color ?? DEFAULT_COLOR
    cmd.width = Math.max(0.5, style?.width ?? 1)
    cmd.dashed = style?.dashed === true
    cmd.opacity = clamp(style?.opacity ?? 1, 0, 1)
    cmd.fill = null
  }

  /* ---------------------------------------------------------------- */
  /* 2D-Ebene zeichnen                                                */
  /* ---------------------------------------------------------------- */

  /** Zeichnet Marker, Text und Bildschirmformen in einen 2D-Kontext. */
  draw2d(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (let i = 0; i < this.shapes.length; i++) this.drawShape(ctx, this.shapes.at(i))
    for (let i = 0; i < this.markers.length; i++) this.drawMarker(ctx, this.markers.at(i))
    for (let i = 0; i < this.texts.length; i++) this.drawText(ctx, this.texts.at(i))

    ctx.restore()
  }

  private drawShape(ctx: CanvasRenderingContext2D, cmd: ScreenShapeCommand): void {
    if (cmd.points.length < 4) return
    ctx.globalAlpha = cmd.opacity
    ctx.beginPath()
    ctx.moveTo(cmd.points[0], cmd.points[1])
    for (let i = 2; i < cmd.points.length; i += 2) ctx.lineTo(cmd.points[i], cmd.points[i + 1])
    if (cmd.closed) ctx.closePath()
    if (cmd.fill) {
      ctx.fillStyle = cmd.fill
      ctx.fill()
    }
    ctx.setLineDash(cmd.dashed ? [4, 3] : [])
    ctx.lineWidth = cmd.width
    ctx.strokeStyle = cmd.color
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  private drawMarker(ctx: CanvasRenderingContext2D, cmd: MarkerCommand): void {
    const screen = this.host.worldToScreen(cmd)
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return
    if (screen.depth > 1 || screen.depth < -1) return
    const s = cmd.size
    const half = s / 2
    ctx.globalAlpha = cmd.opacity
    ctx.strokeStyle = cmd.color
    ctx.fillStyle = cmd.color
    ctx.lineWidth = 1.75
    ctx.beginPath()

    switch (cmd.marker) {
      case 'square':
        ctx.rect(screen.x - half, screen.y - half, s, s)
        ctx.stroke()
        break
      case 'circle':
        ctx.arc(screen.x, screen.y, half, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'diamond':
        ctx.moveTo(screen.x, screen.y - half)
        ctx.lineTo(screen.x + half, screen.y)
        ctx.lineTo(screen.x, screen.y + half)
        ctx.lineTo(screen.x - half, screen.y)
        ctx.closePath()
        ctx.stroke()
        break
      case 'triangle':
        ctx.moveTo(screen.x, screen.y - half)
        ctx.lineTo(screen.x + half, screen.y + half)
        ctx.lineTo(screen.x - half, screen.y + half)
        ctx.closePath()
        ctx.stroke()
        break
      case 'cross':
        ctx.moveTo(screen.x - half, screen.y)
        ctx.lineTo(screen.x + half, screen.y)
        ctx.moveTo(screen.x, screen.y - half)
        ctx.lineTo(screen.x, screen.y + half)
        ctx.stroke()
        break
      case 'x':
        ctx.moveTo(screen.x - half, screen.y - half)
        ctx.lineTo(screen.x + half, screen.y + half)
        ctx.moveTo(screen.x + half, screen.y - half)
        ctx.lineTo(screen.x - half, screen.y + half)
        ctx.stroke()
        break
      default:
        break
    }
    ctx.globalAlpha = 1
  }

  private drawText(ctx: CanvasRenderingContext2D, cmd: TextCommand): void {
    const screen = this.host.worldToScreen(cmd)
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return
    if (screen.depth > 1 || screen.depth < -1) return

    ctx.globalAlpha = cmd.opacity
    ctx.font = `${cmd.size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'

    const x = screen.x + cmd.offsetX
    const y = screen.y + cmd.offsetY

    if (cmd.background) {
      const metrics = ctx.measureText(cmd.text)
      const padX = 5
      const padY = 3
      const height = cmd.size + padY * 2
      ctx.fillStyle = cmd.background
      ctx.fillRect(x - padX, y - height / 2, metrics.width + padX * 2, height)
    }

    ctx.fillStyle = cmd.color
    ctx.fillText(cmd.text, x, y)
    ctx.globalAlpha = 1
  }

  /* ---------------------------------------------------------------- */
  /* Batches                                                          */
  /* ---------------------------------------------------------------- */

  private batchFor(style?: OverlayStyle): SegmentBatch {
    const width = quantize(Math.max(0.5, style?.width ?? 1.5), 0.5)
    const dashed = style?.dashed === true
    const onTop = style?.onTop === true
    const opacity = quantize(clamp(style?.opacity ?? 1, 0.02, 1), 0.05)
    const dashSize = dashed ? quantize(Math.max(style?.dashSize ?? 0.05, 1e-5), 1e-5) : 0
    const key = `${width}|${dashed ? 1 : 0}|${onTop ? 1 : 0}|${opacity}|${dashSize}`

    let batch = this.batches.get(key)
    if (!batch) {
      const material = new SketchLineMaterial({
        linewidth: width,
        dashed,
        dashSize,
        gapSize: dashSize * 0.9,
        vertexColors: true,
        transparent: opacity < 0.999,
        opacity,
        depthTest: !onTop,
        depthWrite: false,
      })
      material.resolution.set(this.width, this.height)
      this.materials.set(key, material)
      batch = new SegmentBatch(material, onTop ? 60 : 40)
      this.batches.set(key, batch)
      this.group.add(batch.object)
    }
    return batch
  }

  private fillFor(style?: OverlayStyle): TriangleBatch {
    const onTop = style?.onTop === true
    const opacity = quantize(clamp(style?.opacity ?? 0.25, 0.02, 1), 0.05)
    const key = `${onTop ? 1 : 0}|${opacity}`
    let batch = this.fills.get(key)
    if (!batch) {
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthTest: !onTop,
        depthWrite: false,
      })
      material.polygonOffset = true
      material.polygonOffsetFactor = -2
      material.polygonOffsetUnits = -2
      this.fillMaterials.set(key, material)
      batch = new TriangleBatch(material, onTop ? 55 : 35)
      this.fills.set(key, batch)
      this.group.add(batch.object)
    }
    return batch
  }

  /** Segmentanzahl eines Bogens aus seiner Groesse auf dem Bildschirm. */
  private segmentCount(center: Vec3Like, radius: number, sweep: number): number {
    const ppu = this.host.pixelsPerUnit(center)
    const pixels = Number.isFinite(ppu) ? Math.abs(radius * ppu * sweep) : 200
    return Math.round(clamp(pixels / 6, MIN_SEGMENTS, MAX_SEGMENTS))
  }

  dispose(): void {
    for (const batch of this.batches.values()) batch.dispose()
    for (const batch of this.fills.values()) batch.dispose()
    for (const material of this.materials.values()) material.dispose()
    for (const material of this.fillMaterials.values()) material.dispose()
    this.batches.clear()
    this.fills.clear()
    this.materials.clear()
    this.fillMaterials.clear()
    this.group.removeFromParent()
  }
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function pointOnArc(center: Vec3Like, u: Vec3Like, v: Vec3Like, radius: number, angle: number): Vec3Like {
  const cos = Math.cos(angle) * radius
  const sin = Math.sin(angle) * radius
  return {
    x: center.x + u.x * cos + v.x * sin,
    y: center.y + u.y * cos + v.y * sin,
    z: center.z + u.z * cos + v.z * sin,
  }
}

export function isFinitePoint(p: Vec3Like | null | undefined): p is Vec3Like {
  return (
    !!p &&
    typeof p.x === 'number' &&
    typeof p.y === 'number' &&
    typeof p.z === 'number' &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z)
  )
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step
}
