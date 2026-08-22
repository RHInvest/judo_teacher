/**
 * Winkelmesser.
 *
 *  - drei Schritte: Scheitel, erster Schenkel, zweiter Schenkel
 *  - der Winkel steht im Massfeld und rastet auf `units.angleSnap`
 *  - der zweite Schenkel wird als Hilfslinie abgelegt; `Strg` misst nur
 *  - die Messebene ergibt sich aus der Flaeche unter dem Cursor und laesst
 *    sich mit den Pfeiltasten auf eine Achsenebene sperren
 *    (rechts = rote, links = gruene, oben = blaue Achse als Ebenennormale)
 *
 * Hilfslinien sind Kanten mit `guide: true` - siehe Kommentar in `tape.ts`.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, KeyInfo, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { P, V, POINT_TOL } from '@/core/math'
import { formatAngle, snapAngle } from '@/shared/units'
import { BaseTool } from './toolBase'
import { AXIS_COLORS, COLORS } from './colors'
import { arcPoints } from './geom'
import { pixelsPerUnitAt } from './helpers'
import { parseAngleInput } from './vcbInput'

type Phase = 'vertex' | 'base' | 'angle'

/** Unterhalb dieses Winkels ist die Messung entartet (rund 0,006 Grad). */
const MIN_ANGLE = 1e-4

export class ProtractorTool extends BaseTool {
  readonly id: ToolId = 'protractor'
  readonly name: string = 'Winkelmesser'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Winkelmesser: Scheitelpunkt wählen'

  private phase: Phase = 'vertex'
  private vertex: Vec3Like | null = null
  private axis: Vec3Like = V.AXIS_Z
  private axisLocked: 0 | 1 | 2 | null = null
  private baseDir: Vec3Like | null = null
  private legLength = 1
  private angle = 0
  private guideMode = true

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.vertex
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    this.guideMode = !(e.ctrl || e.meta)
    if (this.phase === 'vertex') {
      this.infer(e, { from: null })
      return
    }
    if (this.phase === 'base') {
      this.directionAt(e)
      return
    }
    this.updateAngle(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.guideMode = !(e.ctrl || e.meta)

    if (this.phase === 'vertex') {
      const inf = this.infer(e, { from: null })
      this.vertex = V.clone(inf.point)
      if (this.axisLocked === null) this.axis = this.planeNormal(inf.plane?.n ?? null)
      this.phase = 'base'
      this.status('Winkelmesser: ersten Schenkel wählen', 'Pfeiltasten = Messebene sperren')
      return
    }

    if (this.phase === 'base') {
      const dir = this.directionAt(e)
      if (!dir || !this.vertex) {
        this.abortDegenerate('Winkelmesser: der Schenkel hat keine Richtung - der Punkt liegt auf dem Scheitel')
        return
      }
      this.baseDir = dir
      this.phase = 'angle'
      this.status('Winkelmesser: zweiten Schenkel wählen', 'Strg = nur messen, Massfeld: Winkel')
      this.vcb('Winkel', '', 'Winkel')
      return
    }

    this.updateAngle(e)
    this.commit()
  }

  /* ---------------- Tastatur ---------------- */

  onKeyDown(e: KeyInfo): boolean {
    const index = e.key === 'ArrowRight' ? 0 : e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowUp' ? 2 : null
    if (index !== null) {
      // Wie beim Drehen legen die Pfeiltasten hier die MESSEBENE fest, nicht
      // die Richtungssperre der Inferenz.
      this.axisLocked = this.axisLocked === index ? null : (index as 0 | 1 | 2)
      this.axis =
        this.axisLocked === null
          ? this.planeNormal(null)
          : this.axisLocked === 0
            ? V.AXIS_X
            : this.axisLocked === 1
              ? V.AXIS_Y
              : V.AXIS_Z
      this.notify(
        this.axisLocked === null
          ? 'Messebene frei'
          : `Messebene senkrecht zur ${['roten', 'grünen', 'blauen'][this.axisLocked]} Achse`,
      )
      return true
    }
    return super.onKeyDown(e)
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    if (this.phase !== 'angle' || !this.vertex || !this.baseDir) return false
    const angle = parseAngleInput(text, this.units())
    if (angle === null) return false
    this.angle = angle
    this.commit()
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      const vertex = this.vertex
      if (vertex) {
        const radius = this.gizmoRadius()
        overlay.circle(vertex, this.axis, radius, {
          color: this.axisColor(),
          width: 1,
          dashed: true,
          onTop: true,
        })
        overlay.point(vertex, 'cross', { color: this.axisColor(), size: 8, onTop: true })
        if (this.baseDir) {
          overlay.line(vertex, V.addScaled(vertex, this.baseDir, radius), {
            color: COLORS.guide,
            width: 1,
            onTop: true,
          })
          if (Math.abs(this.angle) > MIN_ANGLE) {
            const dir = V.rotateAround(this.baseDir, this.axis, this.angle)
            const tip = V.addScaled(vertex, dir, radius)
            overlay.line(vertex, tip, { color: COLORS.preview, width: 2, onTop: true })
            const sweep = arcPoints(vertex, this.axis, radius * 0.55, 0, this.angle, 32, this.baseDir)
            if (sweep.length >= 2) {
              overlay.polyline(sweep, false, { color: this.axisColor(), width: 2, onTop: true })
            }
            overlay.text(tip, formatAngle(this.angle, this.units()), {
              color: COLORS.neutral,
              size: 12,
              offsetX: 12,
              offsetY: -12,
              onTop: true,
              background: 'rgba(20,20,22,0.72)',
            })
          }
        }
      }
    } catch (err) {
      console.warn('[tools] Winkelmesser: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /** Messebene: Flaeche unter dem Cursor, gesperrte Achse, sonst Blickebene. */
  private planeNormal(hint: Vec3Like | null): Vec3Like {
    if (this.axisLocked !== null) {
      return this.axisLocked === 0 ? V.AXIS_X : this.axisLocked === 1 ? V.AXIS_Y : V.AXIS_Z
    }
    if (hint && V.isFinite3(hint) && !V.isZero(hint)) return V.normalize(hint)
    return this.workPlane(this.vertex).n
  }

  private plane() {
    return P.fromNormalAndPoint(this.axis, this.vertex ?? V.v3())
  }

  private directionAt(e: PointerInfo): Vec3Like | null {
    const vertex = this.vertex
    if (!vertex) return null
    const inf = this.infer(e, { from: vertex, plane: this.plane() })
    const rel = V.projectOnPlaneNormal(V.sub(inf.point, vertex), this.axis)
    const length = V.length(rel)
    if (length < POINT_TOL) return null
    this.legLength = length
    return V.div(rel, length)
  }

  private updateAngle(e: PointerInfo): void {
    const dir = this.directionAt(e)
    if (!dir || !this.baseDir) return
    this.angle = snapAngle(V.signedAngle(this.baseDir, dir, this.axis), this.units())
    this.vcb('Winkel', formatAngle(this.angle, this.units(), { suffix: false }), 'Winkel')
  }

  private gizmoRadius(): number {
    if (!this.vertex || !this.ctx) return 1
    return 120 / pixelsPerUnitAt(this.ctx.viewport, this.vertex)
  }

  private axisColor(): string {
    if (Math.abs(Math.abs(this.axis.x) - 1) < 1e-6) return AXIS_COLORS.x
    if (Math.abs(Math.abs(this.axis.y) - 1) < 1e-6) return AXIS_COLORS.y
    if (Math.abs(Math.abs(this.axis.z) - 1) < 1e-6) return AXIS_COLORS.z
    return COLORS.highlight
  }

  private commit(): void {
    const vertex = this.vertex
    const baseDir = this.baseDir
    if (!vertex || !baseDir) {
      this.reset()
      this.status(this.hint)
      return
    }
    if (Math.abs(this.angle) < MIN_ANGLE) {
      this.reset()
      this.abortDegenerate('Winkelmesser: Winkel 0 - der zweite Schenkel liegt auf dem ersten')
      return
    }
    const angle = this.angle
    const length = Math.max(this.legLength, POINT_TOL * 10)
    if (this.guideMode) {
      const dir = V.rotateAround(baseDir, this.axis, angle)
      const end = V.addScaled(vertex, dir, length)
      this.modify('Hilfslinie (Winkelmesser)', (state) => state.addEdge(vertex, end, { guide: true }))
    }
    const units = this.units()
    this.reset()
    this.status(`Winkelmesser: ${formatAngle(angle, units)} gemessen`, this.hint)
  }

  private reset(): void {
    this.phase = 'vertex'
    this.vertex = null
    this.baseDir = null
    this.angle = 0
    this.legLength = 1
    this.guideMode = true
    this.vcb('Winkel', '', 'Winkel')
  }
}
