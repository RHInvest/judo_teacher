/**
 * Kreiswerkzeug: Mittelpunkt + Radius.
 * Massfeld: vor dem ersten Klick „Segmente" (`24s` oder nur die Zahl),
 * danach „Radius".
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PlaneLike, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, DEFAULT_CIRCLE_SEGMENTS, MAX_CIRCLE_SEGMENTS, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { circlePoints, usablePoints } from './geom'
import { clampInt } from './helpers'
import { parseLengthInput, parseSegmentsInput } from './vcbInput'

export class CircleTool extends BaseTool {
  readonly id: ToolId = 'circle'
  readonly name: string = 'Kreis'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Kreis: Mittelpunkt wählen'

  protected center: Vec3Like | null = null
  protected plane: PlaneLike | null = null
  protected radius = 0
  protected rim: Vec3Like | null = null
  protected segments = DEFAULT_CIRCLE_SEGMENTS

  protected onActivate(): void {
    this.center = null
    this.plane = null
    this.radius = 0
    this.rim = null
    this.updateVcb()
  }

  protected referencePoint(): Vec3Like | null {
    return this.center
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    if (!this.center) {
      const inf = this.infer(e, { from: null })
      this.center = V.clone(inf.point)
      this.plane = inf.plane ?? this.workPlane(this.center)
      this.status(`${this.name}: Radius wählen`, 'Massfeld: Radius oder Segmentzahl (24s)')
      this.updateVcb()
      return
    }
    this.updateRadius(e)
    this.commit()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.center) {
      this.infer(e, { from: null })
      return
    }
    this.updateRadius(e)
    this.updateVcb()
  }

  onValueEntry(text: string): boolean {
    const seg = parseSegmentsInput(text, this.center === null)
    if (seg !== null) {
      this.segments = clampInt(seg, 3, MAX_CIRCLE_SEGMENTS)
      this.updateVcb()
      return true
    }
    if (!this.center) return false
    const radius = parseLengthInput(text, this.units())
    if (radius === null || radius <= POINT_TOL) return false
    this.radius = radius
    this.commit()
    return true
  }

  cancel(): void {
    this.center = null
    this.plane = null
    this.radius = 0
    this.rim = null
    this.clearLock()
    this.updateVcb()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      const points = this.previewPoints()
      if (points && this.center) {
        overlay.polyline(points, true, { color: COLORS.preview, width: 2, onTop: true })
        overlay.polygonFill(points, { color: COLORS.previewFill, opacity: 0.15 })
        if (this.rim) {
          overlay.line(this.center, this.rim, { color: COLORS.guide, width: 1, dashed: true, onTop: true })
          overlay.text(this.rim, formatLength(this.radius, this.units()), {
            color: COLORS.neutral,
            size: 12,
            offsetX: 12,
            offsetY: -12,
            onTop: true,
            background: 'rgba(20,20,22,0.72)',
          })
        }
      }
    } catch (err) {
      console.warn(`[tools] ${this.name}: Vorschau fehlgeschlagen`, err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  protected normal(): Vec3Like {
    return this.plane ? this.plane.n : V.AXIS_Z
  }

  protected updateRadius(e: PointerInfo): void {
    if (!this.center || !this.plane) return
    const inf = this.infer(e, { from: this.center, plane: this.plane })
    const projected = P.projectPoint(this.plane, inf.point)
    this.rim = projected
    this.radius = V.distance(this.center, projected)
  }

  protected previewPoints(): Vec3Like[] | null {
    if (!this.center || this.radius <= POINT_TOL) return null
    return usablePoints(circlePoints(this.center, this.normal(), this.radius, this.segments, this.rim), 3)
  }

  /**
   * Sagt dem Nutzer, WARUM nichts entstanden ist. Ein leeres Ergebnis aus dem
   * Kern ist eine Antwort, kein Ausfall - sie wird hier uebersetzt.
   */
  protected degenerateReason(): string {
    if (this.radius <= POINT_TOL) return `${this.name}: Radius 0 - der Punkt liegt auf dem Mittelpunkt`
    if (this.segments < 3) return `${this.name}: mindestens 3 Segmente nötig, eingestellt sind ${this.segments}`
    return `${this.name}: aus Mittelpunkt, Radius und Ebene lässt sich keine Form bilden`
  }

  protected commit(): void {
    const points = this.previewPoints()
    if (!points) {
      const hadCenter = this.center !== null
      const reason = this.degenerateReason()
      this.cancel()
      if (hadCenter) this.abortDegenerate(reason)
      return
    }
    this.modify(`${this.name} zeichnen`, (state) => state.addFace(points))
    this.center = null
    this.plane = null
    this.radius = 0
    this.rim = null
    this.updateVcb()
    this.status(this.hint)
  }

  protected updateVcb(): void {
    if (!this.center) {
      this.vcb('Segmente', String(this.segments), 'Segmentzahl')
      return
    }
    this.vcb(
      'Radius',
      this.radius > POINT_TOL ? formatLength(this.radius, this.units(), { suffix: false }) : '',
      'Radius oder 24s',
    )
  }
}
