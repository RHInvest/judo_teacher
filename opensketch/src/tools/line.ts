/**
 * Linienwerkzeug - das wichtigste Zeichenwerkzeug.
 *
 * Kettenzeichnen, Doppelklick beendet, Esc bricht ab, automatisches Schliessen
 * sobald der Startpunkt wieder erreicht wird. Das Massfeld akzeptiert eine
 * Laenge (`2,5`, `250cm`) sowie Koordinaten (`[2;3;1]` absolut,
 * `<2;3;1>` relativ).
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { rubberStyle } from './helpers'
import { parseCoordinateInput, parseLengthInput } from './vcbInput'

const DRAG_PX = 6

export class LineTool extends BaseTool {
  readonly id: ToolId = 'line'
  readonly name = 'Linie'
  readonly cursor: Cursor = 'crosshair'
  readonly hint = 'Linie: Startpunkt wählen'

  private points: Vec3Like[] = []
  private preview: Vec3Like | null = null
  private lastDirection: Vec3Like | null = null
  private downX = 0
  private downY = 0
  private justStarted = false

  protected onActivate(): void {
    this.points = []
    this.preview = null
    this.lastDirection = null
    this.updateVcb(0)
  }

  protected referencePoint(): Vec3Like | null {
    return this.points.length > 0 ? this.points[this.points.length - 1] : null
  }

  /* ---------------- Zeiger ---------------- */

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.downX = e.x
    this.downY = e.y
    this.justStarted = false
    if (this.points.length === 0) {
      const inf = this.inferPoint(e)
      this.points.push(V.clone(inf.point))
      this.preview = V.clone(inf.point)
      this.justStarted = true
      this.updateStatus()
    }
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    const inf = this.inferPoint(e)
    this.preview = V.clone(inf.point)
    this.updateVcb(this.currentLength())
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    if (this.points.length === 0) return
    const dragged = Math.hypot(e.x - this.downX, e.y - this.downY) > DRAG_PX
    if (this.justStarted && !dragged) return
    const inf = this.inferPoint(e)
    this.addPoint(inf.point)
  }

  onDoubleClick(_e: PointerInfo): void {
    this.endChain()
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    const units = this.units()
    const last = this.points.length > 0 ? this.points[this.points.length - 1] : null

    const coord = parseCoordinateInput(text, units)
    if (coord) {
      const target =
        coord.kind === 'absolute'
          ? coord.point
          : last
            ? V.add(last, coord.point)
            : coord.point
      if (!last) {
        this.points.push(V.clone(target))
        this.preview = V.clone(target)
      } else {
        this.addPoint(target)
      }
      return true
    }

    if (!last) return false
    const length = parseLengthInput(text, units)
    if (length === null || Math.abs(length) < POINT_TOL) return false
    const dir = this.currentDirection()
    if (!dir) return false
    this.addPoint(V.addScaled(last, dir, length))
    return true
  }

  /* ---------------- Tastatur ---------------- */

  cancel(): void {
    this.points = []
    this.preview = null
    this.lastDirection = null
    this.clearLock()
    this.updateVcb(0)
    this.updateStatus()
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      if (this.points.length > 1) {
        overlay.polyline(this.points, false, { color: COLORS.preview, width: 2, onTop: true })
      }
      const last = this.points.length > 0 ? this.points[this.points.length - 1] : null
      if (last && this.preview && V.distance(last, this.preview) > POINT_TOL) {
        overlay.line(last, this.preview, rubberStyle(this.inf))
        const mid = V.midpoint(last, this.preview)
        overlay.text(mid, formatLength(V.distance(last, this.preview), this.units()), {
          color: COLORS.neutral,
          size: 12,
          offsetY: -18,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
      }
    } catch (err) {
      console.warn('[tools] Linie: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private inferPoint(e: PointerInfo) {
    const from = this.referencePoint()
    return this.infer(e, { from, lastDirection: this.lastDirection })
  }

  private addPoint(point: Vec3Like): void {
    const last = this.points.length > 0 ? this.points[this.points.length - 1] : null
    if (!last) {
      this.points.push(V.clone(point))
      this.preview = V.clone(point)
      this.updateStatus()
      return
    }
    if (V.distance(last, point) < POINT_TOL) return

    this.modify('Linie zeichnen', (state) => state.addEdge(last, point))
    this.lastDirection = V.normalize(V.sub(point, last))
    this.points.push(V.clone(point))
    this.preview = V.clone(point)

    // automatisches Schliessen
    if (this.points.length > 2 && V.distance(point, this.points[0]) < POINT_TOL * 10) {
      this.endChain()
      return
    }
    this.updateStatus()
    this.updateVcb(0)
  }

  private endChain(): void {
    this.points = []
    this.preview = null
    this.lastDirection = null
    this.clearLock()
    this.updateVcb(0)
    this.updateStatus()
  }

  private currentDirection(): Vec3Like | null {
    const last = this.points.length > 0 ? this.points[this.points.length - 1] : null
    if (!last) return null
    if (this.inf?.direction && !V.isZero(this.inf.direction)) return V.normalize(this.inf.direction)
    if (this.preview && V.distance(last, this.preview) > POINT_TOL) {
      return V.normalize(V.sub(this.preview, last))
    }
    return this.lastDirection
  }

  private currentLength(): number {
    const last = this.points.length > 0 ? this.points[this.points.length - 1] : null
    if (!last || !this.preview) return 0
    return V.distance(last, this.preview)
  }

  private updateVcb(length: number): void {
    this.vcb('Länge', length > 0 ? formatLength(length, this.units(), { suffix: false }) : '', 'Länge oder [x;y;z]')
  }

  private updateStatus(): void {
    if (this.points.length === 0) {
      this.status('Linie: Startpunkt wählen', 'Esc = Abbrechen')
    } else {
      this.status(
        'Linie: nächsten Punkt wählen - Doppelklick beendet die Kette',
        'Pfeiltasten = Achse sperren, Shift = Inferenz halten, Esc = Abbrechen',
      )
    }
  }
}
