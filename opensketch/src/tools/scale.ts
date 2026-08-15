/**
 * Skalieren.
 *
 *  - an der Begrenzungsbox der Auswahl haengen 26 Griffe: 8 Ecken,
 *    12 Kantenmitten, 6 Flaechenmitten
 *  - ein Eckgriff skaliert uniform, ein Kantengriff zwei Achsen, ein
 *    Flaechengriff eine Achse; Umschalt kehrt das jeweils um
 *  - Strg skaliert um den Mittelpunkt statt um den gegenueberliegenden Griff
 *  - negative Faktoren spiegeln
 *  - Massfeld: Faktor (`2`), Faktorliste (`2;1;0,5`) oder Ziellaenge (`2m`)
 *
 * OWNERSHIP: Tools.
 */

import type { BBox3Like, Cursor, OverlayApi, PointerInfo, Selection, ToolId, Vec3Like } from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { B, M, V, POINT_TOL } from '@/core/math'
import { formatLength } from '@/shared/units'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { cloneSelection, closestPointOnLineToPointer, screenDistance, selectionIsEmptySafe } from './helpers'
import { parseScaleInput, parseScaleList } from './vcbInput'

/** Ein Griff wird durch seine Richtung in Boxkoordinaten beschrieben. */
interface Handle {
  /** je Achse -1, 0 oder +1 */
  dir: [number, number, number]
  point: Vec3Like
  anchor: Vec3Like
  /** Zahl der Achsen, die dieser Griff bewegt */
  degrees: number
}

const HANDLE_PX = 12

function lerpAxis(min: number, max: number, dir: number): number {
  return dir < 0 ? min : dir > 0 ? max : (min + max) / 2
}

export function buildHandles(box: BBox3Like): Handle[] {
  const out: Handle[] = []
  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      for (let iz = -1; iz <= 1; iz++) {
        if (ix === 0 && iy === 0 && iz === 0) continue
        const dir: [number, number, number] = [ix, iy, iz]
        out.push({
          dir,
          point: {
            x: lerpAxis(box.min.x, box.max.x, ix),
            y: lerpAxis(box.min.y, box.max.y, iy),
            z: lerpAxis(box.min.z, box.max.z, iz),
          },
          anchor: {
            x: lerpAxis(box.min.x, box.max.x, -ix),
            y: lerpAxis(box.min.y, box.max.y, -iy),
            z: lerpAxis(box.min.z, box.max.z, -iz),
          },
          degrees: Math.abs(ix) + Math.abs(iy) + Math.abs(iz),
        })
      }
    }
  }
  return out
}

/**
 * Skalierungsfaktoren aus der Zeigerbewegung.
 * `uniform` erzwingt denselben Faktor auf allen Achsen des Griffs.
 */
export function scaleFactors(
  handle: Handle,
  anchor: Vec3Like,
  start: Vec3Like,
  current: Vec3Like,
  uniform: boolean,
): Vec3Like {
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
  const factors: number[] = [1, 1, 1]
  let dominant = 1
  let dominantSpan = 0

  for (let i = 0; i < 3; i++) {
    if (handle.dir[i] === 0) continue
    const span = start[axes[i]] - anchor[axes[i]]
    if (Math.abs(span) < POINT_TOL) continue
    const factor = (current[axes[i]] - anchor[axes[i]]) / span
    factors[i] = factor
    if (Math.abs(span) > dominantSpan) {
      dominantSpan = Math.abs(span)
      dominant = factor
    }
  }
  if (uniform) return { x: dominant, y: dominant, z: dominant }
  return { x: factors[0], y: factors[1], z: factors[2] }
}

export class ScaleTool extends BaseTool {
  readonly id: ToolId = 'scale'
  readonly name: string = 'Skalieren'
  readonly cursor: Cursor = 'nwse-resize'
  readonly hint: string = 'Skalieren: Griff ziehen'

  private box: BBox3Like | null = null
  private handles: Handle[] = []
  private active: Handle | null = null
  private hovered: Handle | null = null
  private anchor: Vec3Like = V.v3()
  private start: Vec3Like = V.v3()
  private factors: Vec3Like = { x: 1, y: 1, z: 1 }
  private scaling: Selection = emptySelection()
  private aboutCenter = false
  private uniform = true

  protected onActivate(): void {
    this.reset()
    this.refreshBox()
  }

  /* ---------------- Zeiger ---------------- */

  onPointerDown(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    if (this.active) return
    this.refreshBox()
    const handle = this.handleAt(e)
    if (!handle) return
    const selection = this.selection()
    if (selectionIsEmptySafe(selection)) {
      this.notify('Nichts zum Skalieren ausgewählt', 'warn')
      return
    }
    this.scaling = selection
    this.active = handle
    this.aboutCenter = e.ctrl || e.meta
    this.uniform = this.uniformFor(handle, e)
    this.anchor = this.aboutCenter && this.box ? B.center(this.box) : handle.anchor
    this.start = V.clone(handle.point)
    this.factors = { x: 1, y: 1, z: 1 }
    this.status('Skalieren: ziehen oder Faktor eintippen', 'Strg = um den Mittelpunkt, Umschalt = uniform')
    this.updateVcb()
  }

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    if (!this.active) {
      this.refreshBox()
      this.hovered = this.handleAt(e)
      this.setCursor(this.hovered ? 'nwse-resize' : 'default')
      return
    }
    this.aboutCenter = e.ctrl || e.meta
    this.uniform = this.uniformFor(this.active, e)
    this.anchor = this.aboutCenter && this.box ? B.center(this.box) : this.active.anchor
    this.updateFactors(e)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0 || !this.active) return
    this.updateFactors(e)
    this.commit()
  }

  /* ---------------- Massfeld ---------------- */

  onValueEntry(text: string): boolean {
    if (!this.active) return false
    const list = parseScaleList(text)
    if (list && list.length >= 2) {
      const axes = this.movedAxes()
      const next = { x: 1, y: 1, z: 1 }
      const keys: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
      for (let i = 0; i < axes.length && i < list.length; i++) next[keys[axes[i]]] = list[i]
      this.factors = next
      this.commit()
      return true
    }
    const parsed = parseScaleInput(text, this.units())
    if (!parsed) return false
    if (parsed.kind === 'factor') {
      if (Math.abs(parsed.value) < 1e-9) return false
      this.factors = this.spread(parsed.value)
      this.commit()
      return true
    }
    // Ziellaenge: der Faktor ergibt sich aus der aktuellen Ausdehnung.
    const span = this.currentSpan()
    if (span < POINT_TOL) return false
    this.factors = this.spread(parsed.value / span)
    this.commit()
    return true
  }

  cancel(): void {
    this.active = null
    this.factors = { x: 1, y: 1, z: 1 }
    this.scaling = emptySelection()
    this.clearVcb()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      if (!this.box) return
      const preview = this.active ? this.previewBox() : this.box
      overlay.box(preview, undefined, { color: COLORS.selection, width: 1, dashed: !this.active, onTop: true })
      for (const handle of this.handles) {
        const isActive = this.active === handle
        const isHovered = this.hovered === handle
        overlay.point(handle.point, 'square', {
          color: isActive || isHovered ? COLORS.highlight : COLORS.selection,
          size: isActive || isHovered ? 8 : 6,
          onTop: true,
        })
      }
      if (this.active) {
        overlay.point(this.anchor, 'x', { color: COLORS.erase, size: 8, onTop: true })
        overlay.text(this.active.point, this.factorText(), {
          color: COLORS.neutral,
          size: 12,
          offsetX: 12,
          offsetY: -12,
          onTop: true,
          background: 'rgba(20,20,22,0.72)',
        })
      }
    } catch (err) {
      console.warn('[tools] Skalieren: Vorschau fehlgeschlagen', err)
    }
  }

  /* ---------------- Intern ---------------- */

  private refreshBox(): void {
    if (this.active) return
    const box = this.read((state) => state.getSelectionBounds())
    if (!box || B.isEmpty(box)) {
      this.box = null
      this.handles = []
      return
    }
    this.box = box
    this.handles = buildHandles(box)
  }

  private handleAt(e: PointerInfo): Handle | null {
    if (!this.ctx || this.handles.length === 0) return null
    let best: Handle | null = null
    let bestDist = HANDLE_PX
    for (const handle of this.handles) {
      const dist = screenDistance(this.ctx.viewport, handle.point, e.x, e.y)
      if (dist < bestDist) {
        bestDist = dist
        best = handle
      }
    }
    return best
  }

  /** Ecken skalieren uniform, Umschalt kehrt das um. */
  private uniformFor(handle: Handle, e: PointerInfo): boolean {
    return handle.degrees === 3 ? !e.shift : e.shift
  }

  private movedAxes(): number[] {
    if (!this.active) return []
    const out: number[] = []
    for (let i = 0; i < 3; i++) if (this.active.dir[i] !== 0) out.push(i)
    return out
  }

  private spread(factor: number): Vec3Like {
    if (!this.active) return { x: factor, y: factor, z: factor }
    if (this.uniform) return { x: factor, y: factor, z: factor }
    const out = { x: 1, y: 1, z: 1 }
    const keys: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
    for (const axis of this.movedAxes()) out[keys[axis]] = factor
    return out
  }

  private updateFactors(e: PointerInfo): void {
    if (!this.active || !this.ctx) return
    const direction = V.sub(this.active.point, this.anchor)
    if (V.isZero(direction)) return
    const current = closestPointOnLineToPointer(
      this.ctx.viewport,
      this.anchor,
      V.normalize(direction),
      e.x,
      e.y,
      this.active.point,
    )
    this.factors = scaleFactors(this.active, this.anchor, this.start, current, this.uniform)
    this.updateVcb()
  }

  private previewBox(): BBox3Like {
    const box = this.box
    if (!box) return B.empty()
    const scale = (p: Vec3Like): Vec3Like => ({
      x: this.anchor.x + (p.x - this.anchor.x) * this.factors.x,
      y: this.anchor.y + (p.y - this.anchor.y) * this.factors.y,
      z: this.anchor.z + (p.z - this.anchor.z) * this.factors.z,
    })
    return B.fromPoints([scale(box.min), scale(box.max)])
  }

  /** Ausdehnung entlang der dominanten Griffachse (fuer Ziellaengen). */
  private currentSpan(): number {
    if (!this.active || !this.box) return 0
    const size = B.size(this.box)
    const axes = this.movedAxes()
    let span = 0
    const keys: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
    for (const axis of axes) span = Math.max(span, size[keys[axis]])
    return span
  }

  private commit(): void {
    const f = this.factors
    const degenerate = Math.abs(f.x) < 1e-6 || Math.abs(f.y) < 1e-6 || Math.abs(f.z) < 1e-6
    const unchanged = Math.abs(f.x - 1) < 1e-6 && Math.abs(f.y - 1) < 1e-6 && Math.abs(f.z - 1) < 1e-6
    if (!degenerate && !unchanged) {
      const selection = cloneSelection(this.scaling)
      this.applyMatrix('Skalieren', selection, M.scalingAbout(this.anchor, f), false)
    }
    this.active = null
    this.factors = { x: 1, y: 1, z: 1 }
    this.scaling = emptySelection()
    this.refreshBox()
    this.clearVcb()
    // Der Grund muss als Letztes stehen, sonst ueberschreibt ihn der Hinweistext.
    if (degenerate) this.abortDegenerate('Nicht skaliert - der Faktor 0 würde die Auswahl flach drücken')
    else this.status(this.hint)
  }

  private factorText(): string {
    const f = this.factors
    const fmt = (v: number) => v.toFixed(2).replace('.', ',')
    if (this.uniform) return fmt(f.x)
    return `${fmt(f.x)};${fmt(f.y)};${fmt(f.z)}`
  }

  private updateVcb(): void {
    const span = this.currentSpan()
    const placeholder = span > POINT_TOL ? `Faktor oder ${formatLength(span, this.units())}` : 'Faktor'
    this.vcb('Skalierung', this.factorText(), placeholder)
  }

  private reset(): void {
    this.box = null
    this.handles = []
    this.active = null
    this.hovered = null
    this.factors = { x: 1, y: 1, z: 1 }
    this.scaling = emptySelection()
    this.clearVcb()
  }
}
