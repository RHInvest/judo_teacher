/**
 * Drehen.
 *
 *  - drei Schritte: Drehmittelpunkt, Startschenkel, Winkel
 *  - die Drehebene kommt aus der Flaeche unter dem Cursor; mit den
 *    Pfeiltasten laesst sie sich auf eine Achse festnageln
 *    (rechts = rote, links = gruene, oben = blaue Achse)
 *  - Strg beim Abschluss erzeugt eine Kopie
 *  - der Winkel rastet auf `units.angleSnap`
 *  - Massfeld: Winkel; danach `x3` = drei Kopien im Array,
 *    `/3` = drei gleichmaessige Zwischenkopien
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, KeyInfo, OverlayApi, PointerInfo, Selection, ToolId, Vec3Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { M, P, V, POINT_TOL, radToDeg } from '@/core/math'
import { formatAngle, snapAngle } from '@/shared/units'
import { BaseTool } from './toolBase'
import { AXIS_COLORS, COLORS } from './colors'
import { arcPoints } from './geom'
import { cloneSelection, pixelsPerUnitAt, selectionFromHit, selectionIsEmptySafe } from './helpers'
import { parseAngleInput, parseArrayInput } from './vcbInput'

type Phase = 'center' | 'start' | 'angle'

export class RotateTool extends BaseTool {
  readonly id: ToolId = 'rotate'
  readonly name: string = 'Drehen'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Drehen: Drehmittelpunkt wählen'

  private phase: Phase = 'center'
  private center: Vec3Like | null = null
  private axis: Vec3Like = V.AXIS_Z
  private axisLocked: 0 | 1 | 2 | null = null
  private startDir: Vec3Like | null = null
  private angle = 0
  private copyMode = false
  private rotating: Selection = emptySelection()
  private lastArray: { selection: Selection; center: Vec3Like; axis: Vec3Like; angle: number } | null = null

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.center
  }

  /* ---------------- Zeiger ---------------- */

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return

    if (this.phase === 'center') {
      const selection = this.resolveSelection(e)
      if (selectionIsEmptySafe(selection)) {
        this.notify('Nichts zum Drehen ausgewählt', 'warn')
        return
      }
      this.rotating = selection
      const inf = this.infer(e, { from: null })
      this.center = V.clone(inf.point)
      if (this.axisLocked === null) this.axis = this.planeNormal(inf.plane?.n ?? null)
      this.phase = 'start'
      this.status('Drehen: Startschenkel wählen', 'Pfeiltasten = Drehachse festlegen')
      this.vcb('Winkel', '', 'Winkel')
      return
    }

    if (this.phase === 'start') {
      const dir = this.directionAt(e)
      if (!dir) return
      this.startDir = dir
      this.phase = 'angle'
      this.status('Drehen: Winkel wählen', 'Strg = Kopie, Massfeld: Winkel')
      return
    }

    this.copyMode = e.ctrl || e.meta
    this.updateAngle(e)
    this.commit()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (this.phase === 'center') {
      this.infer(e, { from: null })
      return
    }
    if (this.phase === 'start') {
      this.directionAt(e)
      return
    }
    this.copyMode = e.ctrl || e.meta
    this.updateAngle(e)
  }

  /* ---------------- Tastatur ---------------- */

  onKeyDown(e: KeyInfo): boolean {
    const index = e.key === 'ArrowRight' ? 0 : e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowUp' ? 2 : null
    if (index !== null) {
      // Die Pfeiltasten legen beim Drehen die Drehachse fest, nicht die
      // Richtungssperre der Inferenz.
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
          ? 'Drehachse frei'
          : `Drehachse: ${['rote', 'grüne', 'blaue'][this.axisLocked]} Achse`,
      )
      return true
    }
    return super.onKeyDown(e)
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    const array = parseArrayInput(text)
    if (array && this.lastArray) {
      this.createArray(array.mode, array.count)
      return true
    }
    if (this.phase !== 'angle' || !this.center || !this.startDir) return false
    const angle = parseAngleInput(text, this.units())
    if (angle === null || Math.abs(angle) < 1e-6) return false
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
      if (this.center) {
        const radius = this.gizmoRadius()
        overlay.circle(this.center, this.axis, radius, {
          color: this.axisColor(),
          width: 1,
          dashed: true,
          onTop: true,
        })
        overlay.point(this.center, 'cross', { color: this.axisColor(), size: 8, onTop: true })

        if (this.startDir) {
          const from = V.addScaled(this.center, this.startDir, radius)
          overlay.line(this.center, from, { color: COLORS.guide, width: 1, onTop: true })
          if (Math.abs(this.angle) > 1e-6) {
            const to = V.addScaled(this.center, V.rotateAround(this.startDir, this.axis, this.angle), radius)
            overlay.line(this.center, to, { color: COLORS.preview, width: 2, onTop: true })
            const sweep = arcPoints(this.center, this.axis, radius * 0.6, 0, this.angle, 32, this.startDir)
            overlay.polyline(sweep, false, { color: this.axisColor(), width: 2, onTop: true })
            overlay.text(to, formatAngle(this.angle, this.units()), {
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
      console.warn('[tools] Drehen: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private resolveSelection(e: PointerInfo): Selection {
    const current = this.selection()
    if (!selectionIsEmptySafe(current)) return current
    const picked = selectionFromHit(this.pick(e, 8))
    if (!selectionIsEmptySafe(picked)) {
      this.read((state) => {
        state.setSelection(picked)
        return true
      })
    }
    return picked
  }

  /** Drehebene: Flaeche unter dem Cursor, sonst Blickrichtungsebene. */
  private planeNormal(hint: Vec3Like | null): Vec3Like {
    if (this.axisLocked !== null) {
      return this.axisLocked === 0 ? V.AXIS_X : this.axisLocked === 1 ? V.AXIS_Y : V.AXIS_Z
    }
    if (hint && V.isFinite3(hint) && !V.isZero(hint)) return V.normalize(hint)
    if (!this.ctx) return V.AXIS_Z
    return this.workPlane(this.center).n
  }

  private plane() {
    return P.fromNormalAndPoint(this.axis, this.center ?? V.v3())
  }

  private directionAt(e: PointerInfo): Vec3Like | null {
    if (!this.center) return null
    const inf = this.infer(e, { from: this.center, plane: this.plane() })
    const rel = V.projectOnPlaneNormal(V.sub(inf.point, this.center), this.axis)
    if (V.length(rel) < POINT_TOL) return null
    return V.normalize(rel)
  }

  private updateAngle(e: PointerInfo): void {
    const dir = this.directionAt(e)
    if (!dir || !this.startDir) return
    const raw = V.signedAngle(this.startDir, dir, this.axis)
    this.angle = snapAngle(raw, this.units())
    this.vcb('Winkel', formatAngle(this.angle, this.units(), { suffix: false }), 'Winkel')
  }

  private gizmoRadius(): number {
    if (!this.center || !this.ctx) return 1
    const ppu = pixelsPerUnitAt(this.ctx.viewport, this.center)
    return 120 / ppu
  }

  private axisColor(): string {
    if (Math.abs(Math.abs(this.axis.x) - 1) < 1e-6) return AXIS_COLORS.x
    if (Math.abs(Math.abs(this.axis.y) - 1) < 1e-6) return AXIS_COLORS.y
    if (Math.abs(Math.abs(this.axis.z) - 1) < 1e-6) return AXIS_COLORS.z
    return COLORS.highlight
  }

  private commit(): void {
    const center = this.center
    if (!center || Math.abs(this.angle) < 1e-6) {
      const hadCenter = center !== null
      this.reset()
      if (hadCenter) this.abortDegenerate('Nichts gedreht - Winkel 0, der Endschenkel liegt auf dem Startschenkel')
      else this.status(this.hint)
      return
    }
    const selection = cloneSelection(this.rotating)
    const copy = this.copyMode
    const axis = V.clone(this.axis)
    const angle = this.angle
    this.applyMatrix(
      copy ? 'Drehen (Kopie)' : 'Drehen',
      selection,
      M.rotationAboutLine(center, axis, angle),
      copy,
    )
    this.lastArray = copy ? { selection, center: V.clone(center), axis, angle } : null
    this.reset()
    this.status(
      this.hint,
      copy ? 'x3 = Array, /3 = Zwischenkopien' : `zuletzt ${Math.round(radToDeg(angle))}°`,
    )
  }

  private createArray(mode: 'external' | 'internal', count: number): void {
    const context = this.lastArray
    if (!context || count < 1) return
    const name = mode === 'external' ? 'Array-Kopien (Drehen)' : 'Zwischenkopien (Drehen)'
    this.op(name, () => {
      if (mode === 'external') {
        for (let k = 2; k <= count; k++) {
          this.applyMatrix(name, context.selection, M.rotationAboutLine(context.center, context.axis, context.angle * k), true)
        }
      } else {
        for (let k = 1; k < count; k++) {
          this.applyMatrix(
            name,
            context.selection,
            M.rotationAboutLine(context.center, context.axis, (context.angle * k) / count),
            true,
          )
        }
      }
    })
    this.notify(mode === 'external' ? `${count} Kopien erzeugt` : `${count - 1} Zwischenkopien erzeugt`, 'success')
    this.lastArray = null
  }

  private reset(): void {
    this.phase = 'center'
    this.center = null
    this.startDir = null
    this.angle = 0
    this.copyMode = false
    this.rotating = emptySelection()
    this.vcb('', '', '')
  }
}
