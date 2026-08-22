/**
 * Polygonwerkzeug: Mittelpunkt + Radius, Seitenzahl ueber das Massfeld
 * (`6s` oder vor dem ersten Klick die nackte Zahl).
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, KeyInfo, ToolId, Vec3Like } from '@/shared/types'
import { POINT_TOL } from '@/core/math'
import { CircleTool } from './circle'
import { polygonPoints, usablePoints } from './geom'

export class PolygonTool extends CircleTool {
  readonly id: ToolId = 'polygon'
  readonly name: string = 'Polygon'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Polygon: Mittelpunkt wählen'

  /** true = Eckpunkte auf dem Kreis (SketchUp-Standard) */
  private inscribed = true

  protected onActivate(): void {
    this.segments = 6
    super.onActivate()
  }

  protected previewPoints(): Vec3Like[] | null {
    if (!this.center || this.radius <= POINT_TOL) return null
    return usablePoints(
      polygonPoints(this.center, this.normal(), this.radius, this.segments, this.inscribed, this.rim),
      3,
    )
  }

  protected degenerateReason(): string {
    if (this.radius <= POINT_TOL) return `${this.name}: Radius 0 - der Punkt liegt auf dem Mittelpunkt`
    if (this.segments < 3) return `${this.name}: mindestens 3 Seiten nötig, eingestellt sind ${this.segments}`
    return `${this.name}: aus Mittelpunkt, Radius und Seitenzahl lässt sich keine Form bilden`
  }

  protected updateVcb(): void {
    if (!this.center) {
      this.vcb('Seiten', String(this.segments), 'Seitenzahl')
      return
    }
    super.updateVcb()
  }

  onKeyDown(e: KeyInfo): boolean {
    if (e.key === 'ArrowUp' && e.ctrl) {
      this.segments += 1
      this.updateVcb()
      return true
    }
    if (e.key === 'ArrowDown' && e.ctrl) {
      this.segments = Math.max(3, this.segments - 1)
      this.updateVcb()
      return true
    }
    if (e.key === 'Alt' || (e.key === 'i' && e.ctrl)) {
      this.inscribed = !this.inscribed
      this.notify(this.inscribed ? 'Polygon: einbeschrieben' : 'Polygon: umbeschrieben')
      return true
    }
    return super.onKeyDown(e)
  }
}
