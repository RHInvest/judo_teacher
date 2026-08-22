/**
 * Integrationsnaht zwischen React, Renderer und Werkzeugen.
 * OWNERSHIP: Lead. Andere Entwickler aendern diese Datei nicht.
 *
 * Aufgaben:
 *  - Canvas anlegen, Groesse an den Container koppeln
 *  - Viewport, Inferenzmaschine und Werkzeugmanager erzeugen und verdrahten
 *  - DOM-Events in `PointerInfo` / `KeyInfo` uebersetzen und weiterreichen
 *  - Overlay vor jedem Frame neu zeichnen lassen
 */

import { useEffect, useRef } from 'react'
import { createViewport } from '@/render'
import { createInferenceEngine, createToolManager } from '@/tools'
import { store } from '@/model/store'
import { bus } from '@/shared/events'
import type { KeyInfo, PointerInfo } from '@/shared/types'
import type { InferenceApi, ToolManagerApi, ViewportApi } from '@/shared/store-api'

/** Singletons, damit UI-Komponenten ohne Prop-Drilling an den Viewport kommen. */
export let viewport: ViewportApi | null = null
export let toolManager: ToolManagerApi | null = null
export let inference: InferenceApi | null = null

export function getViewport(): ViewportApi | null {
  return viewport
}

export function getToolManager(): ToolManagerApi | null {
  return toolManager
}

const DOUBLE_CLICK_MS = 350
const DOUBLE_CLICK_PX = 5

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function ViewportHost({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let vp: ViewportApi
    try {
      vp = createViewport(canvas, { store })
    } catch (err) {
      console.error('[app] Viewport konnte nicht erzeugt werden', err)
      return
    }
    const inf = createInferenceEngine({ store, viewport: vp })
    const tm = createToolManager({ store, viewport: vp, inference: inf })
    viewport = vp
    inference = inf
    toolManager = tm

    /* ---------------- Groesse ---------------- */
    const resize = new ResizeObserver(() => vp.requestRender())
    resize.observe(container)

    /* ---------------- Zeichnen ---------------- */
    const redraw = () => {
      vp.overlay.clear()
      try {
        tm.draw()
      } catch (err) {
        console.error('[app] Werkzeug-Overlay fehlgeschlagen', err)
      }
      vp.requestRender()
    }

    /* ---------------- Zeiger ---------------- */
    let lastDownTime = 0
    let lastDownX = 0
    let lastDownY = 0
    let clickCount = 0

    const toPointer = (e: PointerEvent | WheelEvent | MouseEvent, extra?: Partial<PointerInfo>): PointerInfo => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        button: 'button' in e ? e.button : 0,
        buttons: 'buttons' in e ? e.buttons : 0,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        meta: e.metaKey,
        ...extra,
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button > 2) return
      canvas.setPointerCapture?.(e.pointerId)
      const now = performance.now()
      const moved = Math.hypot(e.clientX - lastDownX, e.clientY - lastDownY)
      clickCount = now - lastDownTime < DOUBLE_CLICK_MS && moved < DOUBLE_CLICK_PX ? clickCount + 1 : 1
      lastDownTime = now
      lastDownX = e.clientX
      lastDownY = e.clientY
      tm.handlePointerDown(toPointer(e, { clickCount }))
      redraw()
    }

    const onPointerMove = (e: PointerEvent) => {
      tm.handlePointerMove(toPointer(e))
      redraw()
    }

    const onPointerUp = (e: PointerEvent) => {
      canvas.releasePointerCapture?.(e.pointerId)
      tm.handlePointerUp(toPointer(e, { clickCount }))
      redraw()
    }

    const onDoubleClick = (e: MouseEvent) => {
      tm.handleDoubleClick(toPointer(e, { clickCount: 2 }))
      redraw()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      tm.handleWheel(toPointer(e, { delta: e.deltaY }))
      redraw()
    }

    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    /* ---------------- Tastatur ---------------- */
    const toKey = (e: KeyboardEvent): KeyInfo => ({
      key: e.key,
      code: e.code,
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
      repeat: e.repeat,
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return
      /*
       * Ziffern und Komma starten die Eingabe im Massfeld - so tippt man nach
       * einem Klick einfach "2,5". Werkzeuge, die ROHEN TEXT erwarten, sind
       * davon ausgenommen: sonst zerreisst die Umleitung die Eingabe, aus
       * "Raum 12" wuerde "Raum " im Werkzeug und "12" im Massfeld.
       */
      if (!e.ctrlKey && !e.metaKey && !tm.wantsTextInput() && /^[0-9.,'"-]$/.test(e.key)) {
        bus.emit('vcb:focus', { initial: e.key })
        e.preventDefault()
        return
      }
      if (tm.handleKeyDown(toKey(e))) {
        e.preventDefault()
        redraw()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return
      if (tm.handleKeyUp(toKey(e))) {
        e.preventDefault()
        redraw()
      }
    }

    const offSubmit = bus.on('vcb:submit', ({ text }) => {
      try {
        tm.handleValueEntry(text)
      } catch (err) {
        console.error('[app] Werteingabe fehlgeschlagen', err)
      }
      redraw()
    })

    const offCancel = bus.on('tool:cancel', () => {
      tm.getTool()?.cancel()
      redraw()
    })

    const offRender = bus.on('render:request', () => vp.requestRender())

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('dblclick', onDoubleClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    vp.requestRender()

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      offSubmit()
      offCancel()
      offRender()
      resize.disconnect()
      tm.dispose()
      vp.dispose()
      viewport = null
      toolManager = null
      inference = null
    }
  }, [])

  return (
    <div ref={containerRef} className={className ?? 'relative h-full w-full overflow-hidden'}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none outline-none" tabIndex={0} />
    </div>
  )
}
