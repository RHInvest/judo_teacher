/**
 * Diashow-Steuerung.
 *
 * Wird sowohl vom Menue ("Ansicht > Animation") als auch vom Szenen-Panel
 * benutzt, deshalb liegt der Zustand hier als Modul-Singleton statt in einer
 * Komponente. Die eigentliche Kameraanimation macht der Viewport, sobald
 * `activateScene` das `scene:activate`-Ereignis ausloest.
 */

import { act, appState } from '@/ui/state/store'

type Listener = (running: boolean) => void

let timer: number | null = null
let index = 0
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of Array.from(listeners)) listener(timer !== null)
}

export function isSlideshowRunning(): boolean {
  return timer !== null
}

export function onSlideshowChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Alle Szenen, die in der Diashow enthalten sind. */
function includedScenes() {
  const scenes = appState().doc?.scenes ?? []
  const included = scenes.filter((scene) => scene.included !== false)
  return included.length > 0 ? included : scenes
}

function step(): void {
  const scenes = includedScenes()
  if (scenes.length === 0) {
    stopSlideshow()
    return
  }
  index = (index + 1) % scenes.length
  const scene = scenes[index]
  act((state) => state.activateScene(scene.id))
  schedule(scene.delayTime, scene.transitionTime)
}

function schedule(delayTime: number, transitionTime: number): void {
  if (timer !== null) window.clearTimeout(timer)
  const seconds = Math.max(0.5, (Number.isFinite(delayTime) ? delayTime : 2) + (Number.isFinite(transitionTime) ? transitionTime : 1))
  timer = window.setTimeout(step, seconds * 1000)
}

export function startSlideshow(): void {
  const scenes = includedScenes()
  if (scenes.length < 2) return
  index = 0
  act((state) => state.activateScene(scenes[0].id))
  schedule(scenes[0].delayTime, scenes[0].transitionTime)
  notify()
}

export function stopSlideshow(): void {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  notify()
}

export function toggleSlideshow(): void {
  if (isSlideshowRunning()) stopSlideshow()
  else startSlideshow()
}
