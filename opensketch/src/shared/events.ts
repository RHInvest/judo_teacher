/**
 * Tiny typed event bus used for cross module signals that do not belong into
 * the store (they are transient and must not participate in undo).
 *
 * OWNERSHIP: lead developer. Add new events here, never emit untyped strings.
 */

import type { CameraState, Id, Scene, StandardView, Vec3Like } from './types'

export interface AppEvents {
  /** the renderer should redraw on the next animation frame */
  'render:request': void
  /** the renderer finished a frame, payload = frame stats */
  'render:frame': { fps: number; drawCalls: number; triangles: number }
  /** camera changed (emitted by the viewport, consumed by UI/scenes) */
  'camera:changed': CameraState
  /** UI asks the viewport to run a camera command */
  'camera:command': { command: 'zoomExtents' | 'zoomSelection' | 'standardView' | 'toggleProjection'; view?: StandardView }
  /** a scene was activated and the camera should animate */
  'scene:activate': Scene
  /** the active tool changed */
  'tool:changed': { id: string }
  /** the measurement box wants focus (user started typing a number) */
  'vcb:focus': { initial?: string }
  /** the user submitted a value in the measurement box */
  'vcb:submit': { text: string }
  /** a modal asks the tool manager to cancel the running operation */
  'tool:cancel': void
  /** geometry of a definition changed - renderer rebuilds that definition */
  'geometry:changed': { definitionId: Id; full: boolean }
  /** entity list changed - renderer rebuilds the scene graph */
  'scene:changed': void
  /** materials or textures changed */
  'material:changed': { materialId?: Id }
  /** style, sun, fog or tag visibility changed */
  'style:changed': void
  /** selection changed */
  'selection:changed': void
  /** the editing context changed (entered/left a group) */
  'context:changed': { definitionId: Id; depth: number }
  /** the document was replaced (new/open) */
  'document:loaded': void
  /** request to place a component instance with the move tool */
  'component:place': { definitionId: Id }
  /**
   * Die Oberflaeche hat 3D-Text konfiguriert; das Werkzeug `text3d` erzeugt
   * daraus extrudierte Geometrie und laesst den Nutzer sie platzieren.
   * `height` ist die Versalhoehe in Metern, `extrude` die Tiefe in Metern
   * (0 = flache Buchstabenflaechen ohne Seitenwaende).
   */
  'text3d:create': {
    text: string
    height: number
    extrude: number
    /** Schriftschnitt, vom Werkzeug auf die eingebaute Schrift abgebildet */
    bold?: boolean
    italic?: boolean
    /** true = gefuellte Flaechen, false = nur Umrisskanten */
    filled?: boolean
    /** Ausrichtung des Textblocks relativ zum Einfuegepunkt */
    align?: 'left' | 'center' | 'right'
  }
  /** request to start an import from a file the user picked */
  'file:import': { file: File }
  /** a long running task reports progress */
  'progress': { label: string; value: number | null }
  /** a point of interest the user should look at, e.g. after an error */
  'highlight': { point: Vec3Like; label?: string }
}

type Handler<K extends keyof AppEvents> = AppEvents[K] extends void
  ? () => void
  : (payload: AppEvents[K]) => void

class EventBus {
  private handlers = new Map<string, Set<(payload?: unknown) => void>>()

  on<K extends keyof AppEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event as string)
    if (!set) {
      set = new Set()
      this.handlers.set(event as string, set)
    }
    set.add(handler as (payload?: unknown) => void)
    return () => this.off(event, handler)
  }

  once<K extends keyof AppEvents>(event: K, handler: Handler<K>): () => void {
    const off = this.on(event, ((payload: never) => {
      off()
      ;(handler as (p: never) => void)(payload)
    }) as Handler<K>)
    return off
  }

  off<K extends keyof AppEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event as string)?.delete(handler as (payload?: unknown) => void)
  }

  emit<K extends keyof AppEvents>(
    event: K,
    ...args: AppEvents[K] extends void ? [] : [AppEvents[K]]
  ): void {
    const set = this.handlers.get(event as string)
    if (!set) return
    for (const handler of Array.from(set)) {
      try {
        handler(args[0])
      } catch (err) {
        console.error(`[bus] handler for "${String(event)}" failed`, err)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}

export const bus = new EventBus()
