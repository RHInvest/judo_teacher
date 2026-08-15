/**
 * Freihandwerkzeug: gedrueckt halten und ziehen.
 * Der Zug wird auf der Zeichenebene abgetastet, beim Loslassen vereinfacht und
 * als Kantenzug eingefuegt. Endet der Zug am Startpunkt, wird er geschlossen
 * (und erzeugt damit eine Flaeche).
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PlaneLike, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { V, POINT_TOL } from '@/core/math'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { simplifyPolyline } from './geom'
import { rayPlanePoint } from './helpers'

export class FreehandTool extends BaseTool {
  readonly id: ToolId = 'freehand'
  readonly name: string = 'Freihand'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Freihand: gedrückt halten und ziehen'

  private drawing = false
  private plane: PlaneLike | null = null
  private points: Vec3Like[] = []
  private lastX = 0
  private lastY = 0

  protected onActivate(): void {
    this.reset()
  }

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    const inf = this.infer(e, { from: null })
    this.plane = inf.plane ?? this.workPlane(inf.point)
    this.points = [V.clone(inf.point)]
    this.drawing = true
    this.lastX = e.x
    this.lastY = e.y
    this.status('Freihand: zeichnen, loslassen beendet den Zug', 'Esc = Abbrechen')
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.drawing || !this.plane) {
      this.infer(e, { from: null })
      return
    }
    if (Math.hypot(e.x - this.lastX, e.y - this.lastY) < 3) return
    this.lastX = e.x
    this.lastY = e.y
    if (!this.ctx) return
    const point = rayPlanePoint(this.ctx.viewport, e.x, e.y, this.plane)
    if (this.points.length === 0 || V.distance(this.points[this.points.length - 1], point) > POINT_TOL) {
      this.points.push(point)
    }
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (!this.drawing) return
    this.drawing = false
    this.commit()
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      if (this.points.length > 1) {
        overlay.polyline(this.points, false, { color: COLORS.preview, width: 2, onTop: true })
      }
    } catch (err) {
      console.warn('[tools] Freihand: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  private commit(): void {
    if (this.points.length < 2) {
      this.reset()
      this.abortDegenerate('Freihandlinie zu kurz - der Zug hat keine Länge')
      return
    }
    const tolerance = this.strokeTolerance()
    const simplified = simplifyPolyline(this.points, tolerance)
    const closed = simplified.length > 3 && V.distance(simplified[0], simplified[simplified.length - 1]) < tolerance * 4
    const points = closed ? simplified.slice(0, -1) : simplified
    if (points.length < 2) {
      this.reset()
      this.abortDegenerate('Freihandlinie zu kurz - nach dem Glätten bleibt kein Zug übrig')
      return
    }
    this.modify('Freihandlinie zeichnen', (state) => state.addPolyline(points, closed))
    this.reset()
    this.status(this.hint)
  }

  /** Vereinfachungstoleranz: rund 2 Bildschirmpixel am Startpunkt. */
  private strokeTolerance(): number {
    if (!this.ctx || this.points.length === 0) return 0.01
    let ppu = 100
    try {
      const value = this.ctx.viewport.pixelsPerUnit(this.points[0])
      if (Number.isFinite(value) && value > 1e-6) ppu = value
    } catch {
      /* Renderer nicht bereit */
    }
    return 2 / ppu
  }

  private reset(): void {
    this.drawing = false
    this.points = []
    this.plane = null
    this.vcb('', '', '')
  }
}
