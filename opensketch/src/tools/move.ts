/**
 * Verschieben.
 *
 *  - ohne Auswahl wird das Element unter dem Cursor bewegt
 *  - Strg beim Abschluss erzeugt eine Kopie
 *  - nach dem Abschluss erzeugt `x3` drei Kopien im Array,
 *    `/3` drei gleichmaessige Zwischenkopien
 *  - Massfeld: Laenge oder relativer Vektor `<2;3;1>`
 *
 * EINGESCHRAENKT: Auto-Fold (Flaechen beim Ziehen automatisch falten) und die
 * Zieh-Griffe auf Instanzen kommen erst mit dem fertigen Kernel.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, PointerInfo, Selection, ToolId, Vec3Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { B, M, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { cloneSelection, rubberStyle, selectionFromHit, selectionIsEmptySafe } from './helpers'
import { parseArrayInput, parseCoordinateInput, parseLengthInput } from './vcbInput'

export class MoveTool extends BaseTool {
  readonly id: ToolId = 'move'
  readonly name: string = 'Verschieben'
  readonly cursor: Cursor = 'move'
  readonly hint: string = 'Verschieben: Basispunkt wählen'

  private base: Vec3Like | null = null
  private target: Vec3Like | null = null
  private moving: Selection = emptySelection()
  private copyMode = false

  /** Kontext fuer nachtraegliche Array-Kopien (`x3`, `/3`). */
  private lastArray: { selection: Selection; delta: Vec3Like } | null = null

  protected onActivate(): void {
    this.reset()
  }

  protected referencePoint(): Vec3Like | null {
    return this.base
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    if (!this.base) {
      const selection = this.resolveSelection(e)
      if (selectionIsEmptySafe(selection)) {
        this.notify('Nichts zum Verschieben ausgewählt', 'warn')
        return
      }
      this.moving = selection
      const inf = this.infer(e, { from: null })
      this.base = V.clone(inf.point)
      this.target = V.clone(inf.point)
      this.status('Verschieben: Zielpunkt wählen', 'Strg = Kopie, Pfeiltasten = Achse sperren')
      this.vcb('Länge', '', 'Länge oder <x;y;z>')
      return
    }
    this.copyMode = e.ctrl
    const inf = this.infer(e, { from: this.base })
    this.target = V.clone(inf.point)
    this.commit()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.base) {
      this.infer(e, { from: null })
      return
    }
    this.copyMode = e.ctrl
    const inf = this.infer(e, { from: this.base })
    this.target = V.clone(inf.point)
    const delta = V.sub(this.target, this.base)
    this.vcb('Länge', formatLength(V.length(delta), this.units(), { suffix: false }), 'Länge oder <x;y;z>')
    this.status(
      this.copyMode ? 'Kopieren: Zielpunkt wählen' : 'Verschieben: Zielpunkt wählen',
      'Strg = Kopie, Pfeiltasten = Achse sperren',
    )
  }

  onValueEntry(text: string): boolean {
    const units = this.units()

    // Array-Kopien nach abgeschlossener Bewegung
    const array = parseArrayInput(text)
    if (array && this.lastArray) {
      this.createArray(array.mode, array.count)
      return true
    }

    if (!this.base) return false
    const coord = parseCoordinateInput(text, units)
    if (coord) {
      this.target = coord.kind === 'relative' ? V.add(this.base, coord.point) : V.clone(coord.point)
      this.commit()
      return true
    }
    const length = parseLengthInput(text, units)
    if (length === null || Math.abs(length) < POINT_TOL) return false
    const dir = this.currentDirection()
    if (!dir) return false
    this.target = V.addScaled(this.base, dir, length)
    this.commit()
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  draw(overlay: OverlayApi): void {
    try {
      if (this.base && this.target && V.distance(this.base, this.target) > POINT_TOL) {
        overlay.line(this.base, this.target, rubberStyle(this.inf))
        const delta = V.sub(this.target, this.base)
        overlay.text(V.midpoint(this.base, this.target), formatLength(V.length(delta), this.units()), {
          color: COLORS.neutral,
          size: 12,
          offsetY: -16,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
        const bounds = this.read((state) => state.getSelectionBounds())
        if (bounds && !B.isEmpty(bounds)) {
          overlay.box(bounds, M.translation(delta), {
            color: this.copyMode ? COLORS.endpoint : COLORS.selection,
            width: 1,
            dashed: true,
            onTop: true,
          })
        }
      }
    } catch (err) {
      console.warn('[tools] Verschieben: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private resolveSelection(e: PointerInfo): Selection {
    const current = this.selection()
    if (!selectionIsEmptySafe(current)) return current
    const hit = this.pick(e)
    const sel = selectionFromHit(hit)
    if (!selectionIsEmptySafe(sel)) {
      this.modify('Auswahl', (state) => state.setSelection(sel))
    }
    return sel
  }

  private currentDirection(): Vec3Like | null {
    if (this.inf?.direction && !V.isZero(this.inf.direction)) return V.normalize(this.inf.direction)
    if (this.base && this.target && V.distance(this.base, this.target) > POINT_TOL) {
      return V.normalize(V.sub(this.target, this.base))
    }
    return null
  }

  private commit(): void {
    if (!this.base || !this.target) {
      this.reset()
      return
    }
    const delta = V.sub(this.target, this.base)
    if (V.length(delta) < POINT_TOL) {
      // Grund vor dem Zuruecksetzen bestimmen - `reset()` loescht `copyMode`.
      const reason = this.copyMode
        ? 'Keine Kopie erzeugt - Zielpunkt und Basispunkt sind derselbe'
        : 'Nichts verschoben - Zielpunkt und Basispunkt sind derselbe'
      this.reset()
      this.abortDegenerate(reason)
      return
    }
    const selection = cloneSelection(this.moving)
    const copy = this.copyMode
    this.applyTranslation(selection, delta, copy, copy ? 'Kopieren' : 'Verschieben')
    this.lastArray = copy ? { selection, delta } : null
    this.base = null
    this.target = null
    this.moving = emptySelection()
    this.copyMode = false
    this.clearLock()
    this.status(this.hint, copy ? 'x3 = Array, /3 = Zwischenkopien' : undefined)
  }

  private applyTranslation(selection: Selection, delta: Vec3Like, copy: boolean, name: string): void {
    const matrix = M.translation(delta)
    this.modify(name, (state) => {
      const primitives: Selection = {
        edgeIds: selection.edgeIds,
        faceIds: selection.faceIds,
        vertexIds: selection.vertexIds,
        entityIds: [],
      }
      if (primitives.edgeIds.length || primitives.faceIds.length || primitives.vertexIds.length) {
        state.transformPrimitives(primitives, matrix, copy)
      }
      if (selection.entityIds.length) {
        state.transformEntities(selection.entityIds, matrix, copy)
      }
    })
  }

  private createArray(mode: 'external' | 'internal', count: number): void {
    const context = this.lastArray
    if (!context || count < 1) return
    const name = mode === 'external' ? 'Array-Kopien' : 'Zwischenkopien'
    this.op(name, () => {
      if (mode === 'external') {
        for (let k = 2; k <= count; k++) {
          this.applyTranslation(context.selection, V.mul(context.delta, k), true, name)
        }
      } else {
        for (let k = 1; k < count; k++) {
          this.applyTranslation(context.selection, V.mul(context.delta, k / count), true, name)
        }
      }
    })
    this.notify(
      mode === 'external' ? `${count} Kopien erzeugt` : `${count - 1} Zwischenkopien erzeugt`,
      'success',
    )
    this.lastArray = null
  }

  private reset(): void {
    this.base = null
    this.target = null
    this.moving = emptySelection()
    this.copyMode = false
    this.vcb('', '', '')
  }
}
