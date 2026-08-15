/**
 * Kreissegment-Bogen: Zentrum, Radius, Winkel (drei Klicks).
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PlaneLike, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, POINT_TOL, normalizeAngle } from '@/core/math'
import { formatAngle, formatLength, snapAngle } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { arcPoints } from './geom'
import { clampInt } from './helpers'
import { parseAngleInput, parseLengthInput, parseSegmentsInput } from './vcbInput'

export class ArcTool extends BaseTool {
  readonly id: ToolId = 'arc'
  readonly name: string = 'Bogen'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Bogen: Mittelpunkt wählen'

  /** true = geschlossenes Tortenstueck (Unterklasse `pie`) */
  protected closeToCenter = false

  protected center: Vec3Like | null = null
  protected plane: PlaneLike | null = null
  protected startDir: Vec3Like | null = null
  protected radius = 0
  protected sweep = 0
  protected segments = 12

  protected onActivate(): void {
    this.reset()
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
      this.status(`${this.name}: Radius und Startwinkel wählen`, 'Massfeld: Radius')
      this.vcb('Radius', '', 'Radius')
      return
    }
    if (!this.startDir) {
      const inf = this.infer(e, { from: this.center, plane: this.plane })
      const rel = V.sub(P.projectPoint(this.planeOrDefault(), inf.point), this.center)
      if (V.length(rel) < POINT_TOL) return
      this.radius = V.length(rel)
      this.startDir = V.normalize(rel)
      this.status(`${this.name}: Winkel wählen`, 'Massfeld: Winkel')
      this.vcb('Winkel', '', 'Winkel')
      return
    }
    this.updateSweep(e)
    this.commit()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.center) {
      this.infer(e, { from: null })
      return
    }
    if (!this.startDir) {
      const inf = this.infer(e, { from: this.center, plane: this.plane })
      this.radius = V.distance(this.center, P.projectPoint(this.planeOrDefault(), inf.point))
      this.vcb('Radius', formatLength(this.radius, this.units(), { suffix: false }), 'Radius')
      return
    }
    this.updateSweep(e)
    this.vcb('Winkel', formatAngle(Math.abs(this.sweep), this.units(), { suffix: false }), 'Winkel')
  }

  onValueEntry(text: string): boolean {
    const seg = parseSegmentsInput(text, false)
    if (seg !== null) {
      this.segments = clampInt(seg, 1, 999)
      return true
    }
    if (this.center && !this.startDir) {
      const radius = parseLengthInput(text, this.units())
      if (radius === null || radius <= POINT_TOL) return false
      this.radius = radius
      const dir = this.inf && V.distance(this.inf.point, this.center) > POINT_TOL
        ? V.normalize(V.sub(P.projectPoint(this.planeOrDefault(), this.inf.point), this.center))
        : V.AXIS_X
      this.startDir = dir
      this.status(`${this.name}: Winkel wählen`)
      this.vcb('Winkel', '', 'Winkel')
      return true
    }
    if (this.center && this.startDir) {
      const angle = parseAngleInput(text, this.units())
      if (angle === null || Math.abs(angle) < 1e-6) return false
      this.sweep = angle
      this.commit()
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
      if (this.center && this.radius > POINT_TOL && !this.startDir) {
        overlay.circle(this.center, this.normal(), this.radius, {
          color: COLORS.guide,
          width: 1,
          dashed: true,
          onTop: true,
        })
      }
      const points = this.previewPoints()
      if (points && this.center) {
        if (this.closeToCenter) {
          const ring = [this.center, ...points]
          overlay.polyline(ring, true, { color: COLORS.preview, width: 2, onTop: true })
          overlay.polygonFill(ring, { color: COLORS.previewFill, opacity: 0.15 })
        } else {
          overlay.polyline(points, false, { color: COLORS.preview, width: 2, onTop: true })
        }
        overlay.line(this.center, points[0], { color: COLORS.guide, width: 1, dashed: true, onTop: true })
        overlay.line(this.center, points[points.length - 1], {
          color: COLORS.guide,
          width: 1,
          dashed: true,
          onTop: true,
        })
        overlay.text(points[points.length - 1], formatAngle(Math.abs(this.sweep), this.units()), {
          color: COLORS.neutral,
          size: 12,
          offsetX: 12,
          offsetY: -12,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
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

  protected planeOrDefault(): PlaneLike {
    return this.plane ?? { n: V.AXIS_Z, d: this.center ? this.center.z : 0 }
  }

  private updateSweep(e: PointerInfo): void {
    if (!this.center || !this.startDir) return
    const inf = this.infer(e, { from: this.center, plane: this.plane })
    const rel = V.sub(P.projectPoint(this.planeOrDefault(), inf.point), this.center)
    if (V.length(rel) < POINT_TOL) return
    let angle = V.signedAngle(this.startDir, V.normalize(rel), this.normal())
    if (angle < 0) angle += Math.PI * 2
    const snapped = snapAngle(angle, this.units())
    this.sweep = normalizeAngle(snapped) === 0 && angle > Math.PI ? Math.PI * 2 : snapped
  }

  protected previewPoints(): Vec3Like[] | null {
    if (!this.center || !this.startDir || this.radius <= POINT_TOL || Math.abs(this.sweep) < 1e-4) return null
    const seg = Math.max(2, Math.round((this.segments * Math.abs(this.sweep)) / (Math.PI / 2)))
    return arcPoints(this.center, this.normal(), this.radius, 0, this.sweep, Math.min(seg, 360), this.startDir)
  }

  protected commit(): void {
    const points = this.previewPoints()
    if (!points || !this.center) {
      this.reset()
      return
    }
    if (this.closeToCenter) {
      const ring = [V.clone(this.center), ...points]
      this.modify('Tortenstück zeichnen', (state) => state.addFace(ring))
    } else {
      this.modify('Bogen zeichnen', (state) => state.addPolyline(points, false))
    }
    this.reset()
    this.status(this.hint)
  }

  protected reset(): void {
    this.center = null
    this.plane = null
    this.startDir = null
    this.radius = 0
    this.sweep = 0
    this.vcb('', '', '')
  }
}
