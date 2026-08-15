/**
 * STUB - wird vom Render-Entwickler ersetzt.
 * Die Signatur von `createViewport` ist Contract.
 */

import type { StoreHandle, ViewportApi } from '@/shared/store-api'

export interface ViewportDeps {
  store: StoreHandle
}

/**
 * Erzeugt den WebGL-Viewport auf dem uebergebenen Canvas.
 * Der Viewport kuemmert sich um Szenengraph-Sync, Kamera, Picking, Overlay,
 * Stile, Schatten und Schnittebenen. Er registriert KEINE DOM-Eventhandler
 * fuer Werkzeuge - das macht `@/app/ViewportHost`.
 */
export function createViewport(canvas: HTMLCanvasElement, deps: ViewportDeps): ViewportApi {
  throw new Error('render/index.ts ist noch nicht implementiert')
}
