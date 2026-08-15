/**
 * Basisklasse aller Werkzeuge.
 *
 * Sie implementiert das komplette `Tool`-Interface mit unschaedlichen
 * Standardimplementierungen, damit jedes Werkzeug nur das ueberschreibt, was
 * es wirklich braucht - und faengt jeden Zugriff auf Store, Viewport und
 * Inferenz defensiv ab.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState, StoreHandle, Tool, ToolContext, ViewportApi } from '@/shared/store-api'
import type {
  Cursor,
  InferenceResult,
  Mat4Like,
  KeyInfo,
  OverlayApi,
  PickHit,
  PlaneLike,
  PointerInfo,
  Selection,
  ToolId,
  UnitSettings,
  Vec3Like,
} from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { DEFAULT_UNITS } from '@/shared/units'
import { V } from '@/core/math'
import { COLORS } from './colors'
import {
  cloneSelection,
  defaultWorkPlane,
  rayPlanePoint,
  runOperation,
  safeOrNull,
  stateOf,
  toast,
  unitsOf,
} from './helpers'
import type { InferOptions } from './inference'

export abstract class BaseTool implements Tool {
  abstract readonly id: ToolId
  abstract readonly name: string
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = ''

  protected ctx: ToolContext | null = null
  protected pointer: PointerInfo | null = null
  protected inf: InferenceResult | null = null

  /* ---------------- Lebenszyklus ---------------- */

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.inf = null
    try {
      this.onActivate()
    } catch (err) {
      console.warn(`[tools] ${this.id}: activate fehlgeschlagen`, err)
    }
    this.showStatus()
  }

  deactivate(): void {
    try {
      this.cancel()
    } catch (err) {
      console.warn(`[tools] ${this.id}: cancel beim Deaktivieren fehlgeschlagen`, err)
    }
    try {
      this.onDeactivate()
    } catch (err) {
      console.warn(`[tools] ${this.id}: deactivate fehlgeschlagen`, err)
    }
    this.clearLock()
    this.ctx = null
    this.inf = null
    this.pointer = null
  }

  protected onActivate(): void {}
  protected onDeactivate(): void {}

  /* ---------------- Standardereignisse ---------------- */

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
  }

  onDoubleClick(_e: PointerInfo): void {}

  onWheel(_e: PointerInfo): void {}

  onKeyDown(e: KeyInfo): boolean {
    return this.ctxInferenceKey(e, true)
  }

  onKeyUp(e: KeyInfo): boolean {
    return this.ctxInferenceKey(e, false)
  }

  onValueEntry(_text: string): boolean {
    return false
  }

  draw(overlay: OverlayApi): void {
    this.drawInference(overlay)
  }

  cancel(): void {}

  /* ---------------- Zugriffshelfer ---------------- */

  protected get store(): StoreHandle | null {
    return this.ctx ? this.ctx.store : null
  }

  protected get viewport(): ViewportApi | null {
    return this.ctx ? this.ctx.viewport : null
  }

  protected units(): UnitSettings {
    return this.ctx ? unitsOf(this.ctx.store) : DEFAULT_UNITS
  }

  protected op<T>(name: string, fn: () => T): T | null {
    if (!this.ctx) return null
    return runOperation(this.ctx.store, name, fn)
  }

  /** Modelloperation mit direktem Zugriff auf den Store-Zustand. */
  protected modify<T>(name: string, fn: (state: AppState) => T): T | null {
    if (!this.ctx) return null
    const ctx = this.ctx
    return runOperation(ctx.store, name, () => fn(ctx.store.getState()))
  }

  /** Lesender Zugriff auf den Store, null wenn er noch nicht bereit ist. */
  protected read<T>(fn: (state: AppState) => T): T | null {
    if (!this.ctx) return null
    const state = stateOf(this.ctx.store)
    if (!state) return null
    return safeOrNull(() => fn(state))
  }

  protected notify(text: string, kind: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    if (this.ctx) toast(this.ctx.store, text, kind)
  }

  /**
   * Wendet eine Matrix auf eine Auswahl an - der gemeinsame Kern von
   * Verschieben, Drehen und Skalieren. Primitive und Entities werden getrennt
   * behandelt, laufen aber in EINER Operation, damit ein Undo alles zurueck-
   * nimmt.
   */
  protected applyMatrix(name: string, sel: Selection, matrix: Mat4Like, copy: boolean): void {
    const hasPrimitives = sel.edgeIds.length > 0 || sel.faceIds.length > 0 || sel.vertexIds.length > 0
    if (!hasPrimitives && sel.entityIds.length === 0) return
    this.modify(name, (state) => {
      if (hasPrimitives) {
        state.transformPrimitives(
          { edgeIds: sel.edgeIds, faceIds: sel.faceIds, vertexIds: sel.vertexIds, entityIds: [] },
          matrix,
          copy,
        )
      }
      if (sel.entityIds.length > 0) {
        state.transformEntities(sel.entityIds, matrix, copy)
      }
    })
  }

  protected selection(): Selection {
    if (!this.ctx) return emptySelection()
    const state = stateOf(this.ctx.store)
    const sel = state?.selection
    return sel ? cloneSelection(sel) : emptySelection()
  }

  protected status(hint: string, modifiers?: string): void {
    try {
      this.ctx?.setStatus(hint, modifiers)
    } catch {
      /* UI noch nicht bereit */
    }
  }

  protected showStatus(): void {
    this.status(this.hint)
  }

  protected vcb(label: string, value: string, placeholder?: string): void {
    try {
      this.ctx?.setVcb(label, value, placeholder)
    } catch {
      /* UI noch nicht bereit */
    }
  }

  protected clearVcb(): void {
    this.vcb('', '')
  }

  protected setCursor(cursor: Cursor): void {
    try {
      this.ctx?.setCursor(cursor)
    } catch {
      /* Renderer noch nicht bereit */
    }
  }

  protected finishTool(): void {
    try {
      this.ctx?.finish()
    } catch {
      /* Manager nicht bereit */
    }
  }

  protected requestRender(): void {
    try {
      this.ctx?.viewport.requestRender()
    } catch {
      /* Renderer nicht bereit */
    }
  }

  /* ---------------- Inferenz ---------------- */

  protected infer(e: PointerInfo, opts?: InferOptions): InferenceResult {
    if (this.ctx) {
      const result = safeOrNull(() => this.ctx!.inference.infer(e.x, e.y, opts))
      if (result) {
        this.inf = result
        return result
      }
    }
    const point = this.ctx
      ? rayPlanePoint(this.ctx.viewport, e.x, e.y, opts?.plane ?? defaultWorkPlane(this.ctx.viewport, opts?.from ?? null))
      : V.v3()
    const fallback: InferenceResult = {
      point,
      type: 'none',
      label: '',
      color: COLORS.preview,
      marker: 'none',
      locked: false,
      direction: null,
      plane: null,
      onGeometry: false,
      hit: null,
    }
    this.inf = fallback
    return fallback
  }

  protected drawInference(overlay: OverlayApi): void {
    if (!this.ctx || !this.inf) return
    try {
      this.ctx.inference.draw(overlay, this.inf)
    } catch (err) {
      console.warn(`[tools] ${this.id}: Inferenz-Overlay fehlgeschlagen`, err)
    }
  }

  protected clearLock(): void {
    try {
      this.ctx?.inference.clearLock()
      this.ctx?.inference.clearReferencePoints()
    } catch {
      /* Inferenz nicht bereit */
    }
  }

  private ctxInferenceKey(e: KeyInfo, down: boolean): boolean {
    if (!this.ctx) return false
    return safeOrNull(() => this.ctx!.inference.handleKey(e, down, this.referencePoint())) ?? false
  }

  /** Referenzpunkt fuer die Richtungsinferenz - Werkzeuge ueberschreiben das. */
  protected referencePoint(): Vec3Like | null {
    return null
  }

  /* ---------------- Picken ---------------- */

  protected pick(e: PointerInfo, tolerance = 10): PickHit | null {
    if (!this.ctx) return null
    return safeOrNull(() => this.ctx!.viewport.pick(e.x, e.y, { tolerance }))
  }

  protected workPlane(from: Vec3Like | null): PlaneLike {
    if (!this.ctx) return { n: { x: 0, y: 0, z: 1 }, d: 0 }
    return defaultWorkPlane(this.ctx.viewport, from)
  }
}
