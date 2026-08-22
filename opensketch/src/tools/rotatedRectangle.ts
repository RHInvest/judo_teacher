/**
 * Gedrehtes Rechteck: drei Klicks (Startpunkt, Grundkante, Breite).
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PlaneLike, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, POINT_TOL } from '@/core/math'
import { formatAngle, formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { rectanglePoints, usablePoints } from './geom'
import { parseLengthInput, parseLengthPair } from './vcbInput'

export class RotatedRectangleTool extends BaseTool {
  readonly id: ToolId = 'rotatedRectangle'
  readonly name = 'Gedrehtes Rechteck'
  readonly cursor: Cursor = 'crosshair'
  readonly hint = 'Gedrehtes Rechteck: Startpunkt wählen'

  private p0: Vec3Like | null = null
  private p1: Vec3Like | null = null
  private plane: PlaneLike | null = null
  private u: Vec3Like = V.AXIS_X
  private v: Vec3Like = V.AXIS_Y
  private height = 0

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.p1 ?? this.p0
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    if (!this.p0) {
      const inf = this.infer(e, { from: null })
      this.p0 = V.clone(inf.point)
      this.plane = inf.plane ?? this.workPlane(this.p0)
      this.status('Gedrehtes Rechteck: Ende der Grundkante wählen', 'Maßfeld: Länge')
      this.vcb('Länge', '', 'Kantenlänge')
      return
    }
    if (!this.p1) {
      const inf = this.infer(e, { from: this.p0 })
      if (V.distance(inf.point, this.p0) < POINT_TOL) return
      this.p1 = V.clone(inf.point)
      this.setupBasis()
      this.status('Gedrehtes Rechteck: Breite wählen', 'Maßfeld: Breite')
      this.vcb('Breite', '', 'Breite')
      return
    }
    this.updateHeight(e)
    this.commit()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.p0) {
      this.infer(e, { from: null })
      return
    }
    if (!this.p1) {
      const inf = this.infer(e, { from: this.p0, plane: this.plane })
      this.vcb('Länge', formatLength(V.distance(this.p0, inf.point), this.units(), { suffix: false }), 'Kantenlänge')
      return
    }
    this.updateHeight(e)
    this.vcb('Breite', formatLength(Math.abs(this.height), this.units(), { suffix: false }), 'Breite')
  }

  onValueEntry(text: string): boolean {
    const units = this.units()
    if (this.p0 && !this.p1) {
      const pair = parseLengthPair(text, units)
      const length = pair && pair[0] !== null ? pair[0] : parseLengthInput(text, units)
      if (length === null || Math.abs(length) < POINT_TOL) return false
      const dir = this.inf?.point && V.distance(this.inf.point, this.p0) > POINT_TOL
        ? V.normalize(V.sub(this.inf.point, this.p0))
        : V.AXIS_X
      this.p1 = V.addScaled(this.p0, dir, length)
      this.setupBasis()
      if (pair && pair.length > 1 && pair[1] !== null) {
        this.height = pair[1]
        this.commit()
        return true
      }
      this.status('Gedrehtes Rechteck: Breite wählen', 'Maßfeld: Breite')
      return true
    }
    if (this.p0 && this.p1) {
      const width = parseLengthInput(text, units)
      if (width === null || Math.abs(width) < POINT_TOL) return false
      this.height = this.height < 0 ? -width : width
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
      if (this.p0 && this.p1 && !this.height) {
        overlay.line(this.p0, this.p1, { color: COLORS.preview, width: 2, onTop: true })
      }
      const points = this.previewPoints()
      if (points) {
        overlay.polyline(points, true, { color: COLORS.preview, width: 2, onTop: true })
        overlay.polygonFill(points, { color: COLORS.previewFill, opacity: 0.18 })
      }
      if (this.p0 && this.p1) {
        const angle = V.angleBetween(V.sub(this.p1, this.p0), V.AXIS_X)
        overlay.text(this.p1, formatAngle(angle, this.units()), {
          color: COLORS.neutral,
          size: 11,
          offsetY: -16,
          onTop: true,
        })
      }
    } catch (err) {
      console.warn('[tools] Gedrehtes Rechteck: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private setupBasis(): void {
    if (!this.p0 || !this.p1) return
    const dir = V.sub(this.p1, this.p0)
    this.u = V.normalizeOr(dir, V.AXIS_X)
    const normal = this.plane ? this.plane.n : V.AXIS_Z
    let v = V.cross(normal, this.u)
    if (V.isZero(v)) v = V.anyPerpendicular(this.u)
    this.v = V.normalize(v)
    this.plane = P.fromNormalAndPoint(V.cross(this.u, this.v), this.p0)
  }

  /**
   * Dritter Klick: die Breite.
   *
   * Richtungsinferenzen sind hier gesperrt. Sie laufen durch `p1`, und die
   * gefaehrlichste von ihnen war die Parallele zur Grundkante (`lastDirection:
   * u`) - rastet der Punkt darauf, ist `dot(rel, v)` exakt null und das
   * Rechteck verschwindet. Achsen durch `p1` machen dasselbe, sobald die
   * Grundkante achsenparallel liegt. Zu gewinnen ist nichts: die Breite wird
   * ohnehin auf `v` projiziert, eine Richtungsinferenz kann sie nur verkuerzen.
   */
  private updateHeight(e: PointerInfo): void {
    if (!this.p0 || !this.p1) return
    const inf = this.infer(e, { from: this.p1, plane: this.plane, allowDirections: false })
    this.height = V.dot(V.sub(inf.point, this.p1), this.v)
  }

  private previewPoints(): Vec3Like[] | null {
    if (!this.p0 || !this.p1 || Math.abs(this.height) < POINT_TOL) return null
    const width = V.distance(this.p0, this.p1)
    if (width < POINT_TOL) return null
    return usablePoints(rectanglePoints(this.p0, this.u, this.v, width, this.height), 4)
  }

  private commit(): void {
    const points = this.previewPoints()
    if (!points) {
      const reason =
        this.p0 && this.p1 && V.distance(this.p0, this.p1) < POINT_TOL
          ? 'Gedrehtes Rechteck: die Grundkante hat die Länge 0'
          : 'Gedrehtes Rechteck hat keine Fläche - die Breite ist 0'
      this.reset()
      this.abortDegenerate(reason)
      return
    }
    this.modify('Gedrehtes Rechteck zeichnen', (state) => state.addFace(points))
    this.reset()
    this.status(this.hint)
  }

  private reset(): void {
    this.p0 = null
    this.p1 = null
    this.plane = null
    this.height = 0
    this.vcb('', '', '')
  }
}
