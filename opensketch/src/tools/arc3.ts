/**
 * 3-Punkt-Bogen: der Bogen laeuft durch alle drei geklickten Punkte.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { arc3Points, circumcenter } from './geom'
import { clampInt } from './helpers'
import { parseLengthInput, parseSegmentsInput } from './vcbInput'

export class Arc3Tool extends BaseTool {
  readonly id: ToolId = 'arc3'
  readonly name: string = '3-Punkt-Bogen'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = '3-Punkt-Bogen: ersten Punkt wählen'

  private points: Vec3Like[] = []
  private preview: Vec3Like | null = null
  private segments = 12

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.points.length ? this.points[this.points.length - 1] : null
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    const inf = this.infer(e, { from: this.referencePoint() })
    const point = V.clone(inf.point)
    if (this.points.some((p) => V.distance(p, point) < POINT_TOL)) return
    this.points.push(point)
    if (this.points.length >= 3) {
      this.commit()
      return
    }
    this.status(
      this.points.length === 1 ? '3-Punkt-Bogen: zweiten Punkt auf dem Bogen wählen' : '3-Punkt-Bogen: Endpunkt wählen',
      'Maßfeld: 12s = Segmente',
    )
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    const inf = this.infer(e, { from: this.referencePoint() })
    this.preview = V.clone(inf.point)
    if (this.points.length === 2) {
      const circle = circumcenter(this.points[0], this.points[1], this.preview)
      this.vcb('Radius', circle ? formatLength(circle.radius, this.units(), { suffix: false }) : '', 'Radius')
    }
  }

  onValueEntry(text: string): boolean {
    const seg = parseSegmentsInput(text, this.points.length === 0)
    if (seg !== null) {
      this.segments = clampInt(seg, 1, 999)
      return true
    }
    if (this.points.length === 1 && this.preview) {
      const length = parseLengthInput(text, this.units())
      if (length === null || length <= POINT_TOL) return false
      const dir = V.distance(this.preview, this.points[0]) > POINT_TOL
        ? V.normalize(V.sub(this.preview, this.points[0]))
        : V.AXIS_X
      this.points.push(V.addScaled(this.points[0], dir, length))
      return true
    }
    return false
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      const all = this.preview ? [...this.points, this.preview] : this.points
      if (all.length === 2) {
        overlay.line(all[0], all[1], { color: COLORS.preview, width: 2, onTop: true })
      } else if (all.length >= 3) {
        const arc = arc3Points(all[0], all[1], all[2], this.segments)
        if (arc.length >= 2) overlay.polyline(arc, false, { color: COLORS.preview, width: 2, onTop: true })
      }
      for (const p of this.points) {
        overlay.point(p, 'circle', { color: COLORS.highlight, size: 6, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] 3-Punkt-Bogen: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  private commit(): void {
    /*
     * Kollineare Punkte haben keinen Umkreis. `arc3Points` gibt dann die drei
     * Punkte unveraendert zurueck - daraus wuerde ein gerader Streckenzug, der
     * sich Bogen nennt. Das ist keine Geometrie, die jemand gewollt hat:
     * meistens ist der dritte Punkt auf eine Achsengerade durch den zweiten
     * gerastet, die zufaellig durch den ersten laeuft.
     */
    if (!circumcenter(this.points[0], this.points[1], this.points[2])) {
      this.reset()
      this.abortDegenerate('3-Punkt-Bogen: die drei Punkte liegen auf einer Geraden')
      return
    }
    const arc = arc3Points(this.points[0], this.points[1], this.points[2], this.segments)
    if (arc.length < 2) {
      this.reset()
      this.abortDegenerate('3-Punkt-Bogen: aus diesen drei Punkten lässt sich kein Bogen bilden')
      return
    }
    this.modify('Bogen zeichnen', (state) => state.addPolyline(arc, false))
    this.reset()
    this.status(this.hint)
  }

  private reset(): void {
    this.points = []
    this.preview = null
    this.vcb('', '', '')
  }
}
