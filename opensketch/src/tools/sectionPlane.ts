/**
 * Schnittebene.
 *
 *  - ein Klick auf eine Flaeche legt die Schnittebene in deren Ebene
 *  - die Pfeiltasten sperren stattdessen auf eine Achsenebene
 *    (rechts = senkrecht zur roten, links = zur gruenen, oben = zur blauen
 *    Achse); die Ebene liegt dann durch den Punkt unter dem Cursor
 *  - erzeugt eine `SectionPlaneEntity` und AKTIVIERT sie; eine zuvor aktive
 *    Schnittebene wird dabei stillgelegt, wie in SketchUp
 *
 * Symbol, Fuellung und Clipping macht der Renderer (`src/render/sections.ts`).
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type {
  Cursor,
  Id,
  KeyInfo,
  OverlayApi,
  PlaneLike,
  PointerInfo,
  SectionPlaneEntity,
  ToolId,
  Vec3Like,
} from '@/shared/types'
import { newId } from '@/shared/ids'
import { B, P, V } from '@/core/math'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { faceWorldPlane, pixelsPerUnitAt } from './helpers'

const SYMBOL_COLOR = '#f2a33d'

export class SectionPlaneTool extends BaseTool {
  readonly id: ToolId = 'sectionPlane'
  readonly name: string = 'Schnittebene'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Schnittebene: Fläche anklicken'

  private plane: PlaneLike | null = null
  /** Punkt, um den das Symbol gezeichnet wird */
  private center: Vec3Like | null = null
  private axisLocked: 0 | 1 | 2 | null = null

  protected onActivate(): void {
    this.reset()
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    this.updatePlane(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    this.updatePlane(e)
    this.commit()
  }

  /* ---------------- Tastatur ---------------- */

  onKeyDown(e: KeyInfo): boolean {
    const index = e.key === 'ArrowRight' ? 0 : e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowUp' ? 2 : null
    if (index !== null) {
      this.axisLocked = this.axisLocked === index ? null : (index as 0 | 1 | 2)
      this.notify(
        this.axisLocked === null
          ? 'Schnittebene folgt wieder der Fläche unter dem Cursor'
          : `Schnittebene senkrecht zur ${['roten', 'grünen', 'blauen'][this.axisLocked]} Achse`,
      )
      if (this.pointer) this.updatePlane(this.pointer)
      this.requestRender()
      return true
    }
    return super.onKeyDown(e)
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      const plane = this.plane
      const center = this.center
      if (plane && center) {
        const size = this.symbolSize()
        const { u, v } = P.basis(plane)
        const corners = [
          V.add(center, V.add(V.mul(u, size), V.mul(v, size))),
          V.add(center, V.add(V.mul(u, -size), V.mul(v, size))),
          V.add(center, V.add(V.mul(u, -size), V.mul(v, -size))),
          V.add(center, V.add(V.mul(u, size), V.mul(v, -size))),
        ]
        overlay.polyline(corners, true, { color: SYMBOL_COLOR, width: 2, onTop: true })
        overlay.polygonFill(corners, { color: SYMBOL_COLOR, opacity: 0.12 })
        overlay.line(center, V.addScaled(center, plane.n, size * 0.4), {
          color: SYMBOL_COLOR,
          width: 2,
          onTop: true,
        })
      }
    } catch (err) {
      console.warn('[tools] Schnittebene: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private updatePlane(e: PointerInfo): void {
    const hit = this.pick(e, 6)
    const inf = this.infer(e, { from: null })
    this.center = V.clone(inf.point)

    if (this.axisLocked !== null) {
      const n = this.axisLocked === 0 ? V.AXIS_X : this.axisLocked === 1 ? V.AXIS_Y : V.AXIS_Z
      this.plane = P.fromNormalAndPoint(n, this.center)
      return
    }
    if (hit && hit.kind === 'face' && hit.id) {
      const plane = this.read((state) =>
        faceWorldPlane(state, hit.id as Id, hit.definitionId, hit.worldTransform),
      )
      if (plane) {
        this.plane = plane
        if (hit.point && V.isFinite3(hit.point)) this.center = V.clone(hit.point)
        return
      }
    }
    this.plane = null
  }

  /** Halbe Kantenlaenge des Symbols - am Modell orientiert, nie null. */
  private symbolSize(): number {
    const bounds = this.read((state) => state.getModelBounds())
    if (bounds && V.isFinite3(bounds.min) && V.isFinite3(bounds.max)) {
      const size = B.size(bounds)
      const largest = Math.max(size.x, size.y, size.z)
      if (Number.isFinite(largest) && largest > 0) return largest * 0.6
    }
    if (this.center && this.ctx) return 120 / pixelsPerUnitAt(this.ctx.viewport, this.center)
    return 2
  }

  private commit(): void {
    const plane = this.plane
    if (!plane) {
      this.reset()
      this.abortDegenerate(
        'Schnittebene: keine Bezugsfläche unter dem Cursor - Fläche anklicken oder mit den Pfeiltasten auf eine Achsenebene sperren',
      )
      return
    }
    const size = this.symbolSize()
    const entity: SectionPlaneEntity = {
      id: newId('p'),
      type: 'sectionPlane',
      name: 'Schnittebene',
      tagId: this.read((state) => state.doc?.activeTagId ?? null) ?? null,
      hidden: false,
      locked: false,
      plane: { n: V.clone(plane.n), d: plane.d },
      active: true,
      symbolSize: size,
      color: SYMBOL_COLOR,
    }
    this.modify('Schnittebene setzen', (state) => {
      deactivateOthers(state)
      return state.addEntity(entity)
    })
    this.reset()
    this.notify('Schnittebene gesetzt und aktiviert', 'success')
    this.status(this.hint)
    this.requestRender()
  }

  private reset(): void {
    this.plane = null
    this.center = null
    this.clearVcb()
  }
}

/**
 * Legt alle bisher aktiven Schnittebenen still.
 *
 * Aktiv sein darf immer nur eine: der Renderer fuellt ohnehin nur die erste
 * (`src/render/sections.ts`), und zwei aktive Ebenen schneiden das Modell aus
 * zwei Richtungen weg - fuer den Nutzer sieht das aus, als sei das Modell
 * verschwunden.
 */
function deactivateOthers(state: AppState): void {
  const entities = state.doc?.entities
  if (!entities) return
  for (const id of Object.keys(entities)) {
    const entity = entities[id]
    if (entity && entity.type === 'sectionPlane' && entity.active) {
      state.updateEntity(id, { active: false } as Partial<SectionPlaneEntity>)
    }
  }
}
