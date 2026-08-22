/**
 * Bezierkurve: Startpunkt, Endpunkt, dann die beiden Kontrollpunkte.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { V, POINT_TOL } from '@/core/math'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { bezierPoints } from './geom'
import { clampInt } from './helpers'
import { parseSegmentsInput } from './vcbInput'

const HINTS = [
  'Bezier: Startpunkt wählen',
  'Bezier: Endpunkt wählen',
  'Bezier: ersten Kontrollpunkt wählen',
  'Bezier: zweiten Kontrollpunkt wählen',
]

export class BezierTool extends BaseTool {
  readonly id: ToolId = 'bezier'
  readonly name: string = 'Bezier'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = HINTS[0]

  /** [start, ende, kontrolle1, kontrolle2] */
  private pts: Vec3Like[] = []
  private preview: Vec3Like | null = null
  private segments = 24

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.pts.length ? this.pts[this.pts.length - 1] : null
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    const inf = this.infer(e, { from: this.referencePoint() })
    this.pts.push(V.clone(inf.point))
    if (this.pts.length >= 4) {
      this.commit()
      return
    }
    this.status(HINTS[Math.min(this.pts.length, HINTS.length - 1)], 'Maßfeld: 24s = Segmente')
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    const inf = this.infer(e, { from: this.referencePoint() })
    this.preview = V.clone(inf.point)
  }

  onValueEntry(text: string): boolean {
    const seg = parseSegmentsInput(text, true)
    if (seg === null) return false
    this.segments = clampInt(seg, 2, 999)
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      const control = this.controlPoints()
      if (control) {
        const curve = bezierPoints(control[0], control[1], control[2], control[3], this.segments)
        if (curve.length >= 2) overlay.polyline(curve, false, { color: COLORS.preview, width: 2, onTop: true })
        overlay.line(control[0], control[1], { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        overlay.line(control[3], control[2], { color: COLORS.guide, width: 1, dashed: true, onTop: true })
      } else if (this.pts.length === 1 && this.preview) {
        overlay.line(this.pts[0], this.preview, { color: COLORS.preview, width: 2, onTop: true })
      }
      for (const p of this.pts) overlay.point(p, 'circle', { color: COLORS.highlight, size: 6, onTop: true })
    } catch (err) {
      console.warn('[tools] Bezier: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /** [p0, c1, c2, p3] fuer die kubische Kurve. */
  private controlPoints(): [Vec3Like, Vec3Like, Vec3Like, Vec3Like] | null {
    const all = this.preview ? [...this.pts, this.preview] : this.pts
    if (all.length < 3) return null
    const [start, end, c1] = all
    const c2 = all.length >= 4 ? all[3] : c1
    return [start, c1, c2, end]
  }

  private commit(): void {
    const control = this.controlPoints()
    if (!control) {
      this.reset()
      this.abortDegenerate('Bezierkurve: es fehlen Punkte')
      return
    }
    const curve = bezierPoints(control[0], control[1], control[2], control[3], this.segments)
    if (curve.length < 2 || V.distance(curve[0], curve[curve.length - 1]) <= POINT_TOL) {
      this.reset()
      this.abortDegenerate('Bezierkurve: Start- und Endpunkt liegen aufeinander')
      return
    }
    this.modify('Bezierkurve zeichnen', (state) => state.addPolyline(curve, false))
    this.reset()
    this.status(this.hint)
  }

  private reset(): void {
    this.pts = []
    this.preview = null
    this.vcb('', '', '')
  }
}
