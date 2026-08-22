/**
 * Achsenwerkzeug.
 *
 * Drei Schritte: Ursprung, Richtung der ROTEN, dann der GRUENEN Achse. Die
 * blaue Achse ergibt sich daraus (Rechtssystem, `setModelAxes`
 * orthonormalisiert). Ein Doppelklick stellt die Voreinstellung wieder her -
 * er ersetzt das Kontextmenue "Zuruecksetzen".
 *
 * Die Achsen sind Sitzungszustand der Werkzeugschicht (`modelAxes.ts`), kein
 * Dokumentinhalt: das Schema kennt sie nicht. Deshalb laeuft hier auch keine
 * `operation(...)` - es gibt nichts rueckgaengig zu machen.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, ToolId, Vec3Like } from '@/shared/types'
import { V, POINT_TOL } from '@/core/math'
import { BaseTool } from './toolBase'
import { AXIS_COLORS, COLORS } from './colors'
import { pixelsPerUnitAt } from './helpers'
import { getModelAxes, resetModelAxes, setModelAxes } from './modelAxes'

type Phase = 'origin' | 'red' | 'green'

export class AxesTool extends BaseTool {
  readonly id: ToolId = 'axes'
  readonly name: string = 'Achsen'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Achsen: neuen Ursprung wählen'

  private phase: Phase = 'origin'
  private origin: Vec3Like | null = null
  private xDir: Vec3Like | null = null
  /** Vorschau der noch offenen Richtung */
  private preview: Vec3Like | null = null

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.origin
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (this.phase === 'origin') {
      this.infer(e, { from: null })
      return
    }
    this.preview = this.directionAt(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return

    if (this.phase === 'origin') {
      const inf = this.infer(e, { from: null })
      this.origin = V.clone(inf.point)
      this.phase = 'red'
      this.status('Achsen: Richtung der roten Achse wählen', 'Doppelklick = Voreinstellung')
      return
    }

    const dir = this.directionAt(e)
    if (!dir) {
      this.abortDegenerate(
        this.phase === 'red'
          ? 'Achsen: die rote Richtung hat keine Länge - der Punkt liegt auf dem Ursprung'
          : 'Achsen: die grüne Richtung liegt auf der roten - so entsteht kein Achsensystem',
      )
      return
    }

    if (this.phase === 'red') {
      this.xDir = dir
      this.phase = 'green'
      this.preview = null
      this.status('Achsen: Richtung der grünen Achse wählen', 'Doppelklick = Voreinstellung')
      return
    }

    this.applyAxes(dir)
  }

  onDoubleClick(e: PointerInfo): void {
    this.pointer = e
    resetModelAxes()
    this.reset()
    this.notify('Achsen auf die Voreinstellung zurückgesetzt', 'success')
    this.status(this.hint)
    this.requestRender()
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      const origin = this.origin
      if (origin) {
        const length = this.gizmoLength()
        overlay.point(origin, 'cross', { color: COLORS.neutral, size: 8, onTop: true })
        if (this.xDir) {
          overlay.line(origin, V.addScaled(origin, this.xDir, length), {
            color: AXIS_COLORS.x,
            width: 3,
            onTop: true,
          })
        }
        const pending = this.preview
        if (pending) {
          overlay.line(origin, V.addScaled(origin, pending, length), {
            color: this.phase === 'red' ? AXIS_COLORS.x : AXIS_COLORS.y,
            width: 3,
            onTop: true,
          })
          if (this.phase === 'green' && this.xDir) {
            const z = V.cross(this.xDir, pending)
            if (!V.isZero(z)) {
              overlay.line(origin, V.addScaled(origin, V.normalize(z), length), {
                color: AXIS_COLORS.z,
                width: 2,
                dashed: true,
                onTop: true,
              })
            }
          }
        }
      } else {
        this.drawCurrentAxes(overlay)
      }
    } catch (err) {
      console.warn('[tools] Achsen: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  /** Die geltenden Achsen, damit sichtbar ist, was gerade ersetzt wird. */
  private drawCurrentAxes(overlay: OverlayApi): void {
    const axes = getModelAxes()
    const length = this.gizmoLength(axes.origin)
    overlay.line(axes.origin, V.addScaled(axes.origin, axes.x, length), {
      color: AXIS_COLORS.x,
      width: 2,
      dashed: !axes.custom,
      onTop: true,
    })
    overlay.line(axes.origin, V.addScaled(axes.origin, axes.y, length), {
      color: AXIS_COLORS.y,
      width: 2,
      dashed: !axes.custom,
      onTop: true,
    })
    overlay.line(axes.origin, V.addScaled(axes.origin, axes.z, length), {
      color: AXIS_COLORS.z,
      width: 2,
      dashed: !axes.custom,
      onTop: true,
    })
  }

  /**
   * Richtung vom Ursprung zum Cursor. In der gruenen Phase wird der Anteil
   * entlang der roten Achse abgezogen - die gruene Achse steht senkrecht auf
   * der roten, sonst waere das System entartet.
   */
  private directionAt(e: PointerInfo): Vec3Like | null {
    const origin = this.origin
    if (!origin) return null
    const inf = this.infer(e, { from: origin })
    let rel = V.sub(inf.point, origin)
    if (this.phase === 'green' && this.xDir) rel = V.projectOnPlaneNormal(rel, this.xDir)
    if (V.length(rel) < POINT_TOL) return null
    return V.normalize(rel)
  }

  private applyAxes(yDir: Vec3Like): void {
    const origin = this.origin
    const xDir = this.xDir
    if (!origin || !xDir) {
      this.reset()
      this.status(this.hint)
      return
    }
    setModelAxes(origin, xDir, yDir)
    this.reset()
    this.notify('Modellachsen gesetzt', 'success')
    this.status(this.hint, 'Doppelklick = Voreinstellung')
    this.requestRender()
  }

  private gizmoLength(at?: Vec3Like): number {
    const point = at ?? this.origin
    if (!point || !this.ctx) return 1
    return 140 / pixelsPerUnitAt(this.ctx.viewport, point)
  }

  private reset(): void {
    this.phase = 'origin'
    this.origin = null
    this.xDir = null
    this.preview = null
    this.clearVcb()
  }
}
