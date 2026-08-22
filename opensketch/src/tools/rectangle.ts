/**
 * Rechteckwerkzeug: zwei gegenueberliegende Ecken.
 * Massfeld: „Maße" mit `2;3`.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PlaneLike, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { rectanglePoints, usablePoints } from './geom'
import { parseLengthPair } from './vcbInput'

export class RectangleTool extends BaseTool {
  readonly id: ToolId = 'rectangle'
  readonly name = 'Rechteck'
  readonly cursor: Cursor = 'crosshair'
  readonly hint = 'Rechteck: erste Ecke wählen'

  protected origin: Vec3Like | null = null
  protected plane: PlaneLike | null = null
  protected u: Vec3Like = V.AXIS_X
  protected v: Vec3Like = V.AXIS_Y
  protected corner: Vec3Like | null = null
  private downX = 0
  private downY = 0
  private started = false

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.origin
  }

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.downX = e.x
    this.downY = e.y
    if (this.origin) return
    const inf = this.infer(e, { from: null })
    this.origin = V.clone(inf.point)
    this.plane = inf.plane ?? this.workPlane(this.origin)
    const basis = P.basis(this.plane)
    this.u = basis.u
    this.v = basis.v
    this.started = true
    this.status('Rechteck: gegenüberliegende Ecke wählen', 'Maßfeld: Breite;Höhe')
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.origin || !this.plane) {
      this.infer(e, { from: null })
      return
    }
    const inf = this.infer(e, this.cornerOptions())
    this.corner = P.projectPoint(this.plane, inf.point)
    this.updateVcb()
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0 || !this.origin || !this.plane) return
    const dragged = Math.hypot(e.x - this.downX, e.y - this.downY) > 6
    if (this.started && !dragged) {
      this.started = false
      return
    }
    const inf = this.infer(e, this.cornerOptions())
    this.corner = P.projectPoint(this.plane, inf.point)
    this.commit()
  }

  onValueEntry(text: string): boolean {
    if (!this.origin || !this.plane) return false
    const values = parseLengthPair(text, this.units())
    if (!values || values.length < 2) return false
    const width = values[0]
    const height = values[1]
    if (width === null || height === null) return false
    const sign = this.currentSize()
    const sx = sign.width < 0 ? -1 : 1
    const sy = sign.height < 0 ? -1 : 1
    this.corner = V.add(this.origin, V.add(V.mul(this.u, width * sx), V.mul(this.v, height * sy)))
    this.commit()
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      const points = this.previewPoints()
      if (points) {
        overlay.polyline(points, true, { color: COLORS.preview, width: 2, onTop: true })
        overlay.polygonFill(points, { color: COLORS.previewFill, opacity: 0.18 })
        const size = this.currentSize()
        if (Math.abs(Math.abs(size.width) - Math.abs(size.height)) < Math.abs(size.width) * 0.02) {
          overlay.guide(points[0], points[2], { color: COLORS.highlight, dashed: true, width: 1, onTop: true })
          overlay.text(points[2], 'Quadrat', {
            color: COLORS.highlight,
            size: 12,
            offsetX: 12,
            offsetY: 12,
            onTop: true,
            background: 'rgba(20,20,22,0.72)',
          })
        }
      }
    } catch (err) {
      console.warn('[tools] Rechteck: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /**
   * Inferenzoptionen fuer den zweiten Eckpunkt.
   *
   * `allowDirections: false` ist hier kein Geschmack, sondern Notwehr: die
   * Achsen-, Parallel- und Senkrecht-Inferenzen laufen alle durch die erste
   * Ecke, und jede von ihnen liegt in Richtung `u` oder `v`. Rastet der zweite
   * Punkt darauf, ist Breite oder Hoehe exakt null und das Rechteck
   * verschwindet. SketchUp bietet an dieser Stelle Proportionen (Quadrat,
   * Goldener Schnitt) und echte Geometrie an - beides bleibt erhalten.
   *
   * Eine per Pfeiltaste gesetzte Sperre wertet die Maschine vorher aus und
   * bleibt gueltig: wer die Achse ausdruecklich verlangt, bekommt sie.
   */
  private cornerOptions() {
    return { from: this.origin, plane: this.plane, allowDirections: false }
  }

  protected reset(): void {
    this.origin = null
    this.plane = null
    this.corner = null
    this.started = false
    this.vcb('Maße', '', 'Breite;Höhe')
  }

  protected currentSize(): { width: number; height: number } {
    if (!this.origin || !this.corner) return { width: 0, height: 0 }
    const rel = V.sub(this.corner, this.origin)
    return { width: V.dot(rel, this.u), height: V.dot(rel, this.v) }
  }

  protected previewPoints(): Vec3Like[] | null {
    if (!this.origin || !this.corner) return null
    const { width, height } = this.currentSize()
    if (Math.abs(width) < POINT_TOL || Math.abs(height) < POINT_TOL) return null
    return usablePoints(rectanglePoints(this.origin, this.u, this.v, width, height), 4)
  }

  protected commit(): void {
    const points = this.previewPoints()
    if (!points) {
      const reason = this.degenerateReason()
      this.reset()
      this.abortDegenerate(reason)
      return
    }
    this.modify('Rechteck zeichnen', (state) => state.addFace(points))
    this.reset()
    this.status(this.hint)
  }

  /** Sagt dem Nutzer, WARUM kein Rechteck entstanden ist. */
  protected degenerateReason(): string {
    if (!this.origin || !this.corner) return 'Rechteck abgebrochen - es fehlt eine Ecke'
    const { width, height } = this.currentSize()
    const flatWidth = Math.abs(width) < POINT_TOL
    const flatHeight = Math.abs(height) < POINT_TOL
    if (flatWidth && flatHeight) {
      return 'Rechteck hat keine Fläche - beide Ecken liegen aufeinander'
    }
    if (flatWidth) {
      return 'Rechteck hat keine Fläche - Breite 0, die Ecke liegt auf einer Geraden durch den Startpunkt'
    }
    if (flatHeight) {
      return 'Rechteck hat keine Fläche - Höhe 0, die Ecke liegt auf einer Geraden durch den Startpunkt'
    }
    // Der Kern hat die Form abgelehnt, obwohl Breite und Höhe stehen.
    return 'Rechteck abgebrochen - aus diesen Ecken lässt sich kein Rechteck bilden'
  }

  private updateVcb(): void {
    const { width, height } = this.currentSize()
    const units = this.units()
    const text =
      Math.abs(width) > POINT_TOL
        ? `${formatLength(Math.abs(width), units, { suffix: false })};${formatLength(Math.abs(height), units, { suffix: false })}`
        : ''
    this.vcb('Maße', text, 'Breite;Höhe')
  }
}
