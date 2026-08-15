/**
 * Defensiver Zugriff auf den Anwendungsstore.
 *
 * Der Store (`@/model`) wird parallel entwickelt. Bis er fertig ist, wirft
 * jeder Zugriff. Alle UI-Komponenten gehen deshalb ausschliesslich ueber die
 * Helfer aus dieser Datei - sie fangen Fehler ab und liefern den
 * `FALLBACK_STATE`, damit die Oberflaeche immer rendert.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react'
import { store } from '@/model'
import type { AppState } from '@/shared/store-api'
import { FALLBACK_STATE } from './fallback'

let announced = false

function announce(err: unknown): void {
  if (announced) return
  announced = true
  console.info('[ui] Store noch nicht verfuegbar - Oberflaeche laeuft im Fallback-Modus.', err)
}

/** Aktueller Zustand, niemals werfend. */
export function appState(): AppState {
  try {
    const state = store.getState()
    return state ?? FALLBACK_STATE
  } catch (err) {
    announce(err)
    return FALLBACK_STATE
  }
}

/** true, wenn der echte Store antwortet. */
export function storeReady(): boolean {
  try {
    return Boolean(store.getState())
  } catch {
    return false
  }
}

function subscribe(onChange: () => void): () => void {
  try {
    const unsubscribe = store.subscribe(onChange)
    return typeof unsubscribe === 'function' ? unsubscribe : () => undefined
  } catch {
    return () => undefined
  }
}

/** Der komplette Zustand als React-Hook. */
export function useApp(): AppState {
  return useSyncExternalStore(subscribe, appState, appState)
}

/** Selektiver Zugriff mit eigener Gleichheitsfunktion. */
export function useAppSelector<T>(selector: (state: AppState) => T, equals: (a: T, b: T) => boolean = Object.is): T {
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const equalsRef = useRef(equals)
  equalsRef.current = equals
  const cache = useRef<{ filled: boolean; value: T }>({ filled: false, value: undefined as unknown as T })

  const getSnapshot = useCallback(() => {
    let next: T
    try {
      next = selectorRef.current(appState())
    } catch {
      next = cache.current.value
    }
    if (!cache.current.filled || !equalsRef.current(cache.current.value, next)) {
      cache.current = { filled: true, value: next }
    }
    return cache.current.value
  }, [])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function shallowEqualArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
  return true
}

/** Fuehrt eine Aktion auf dem Store aus und schluckt Fehler. */
export function act<T>(fn: (state: AppState) => T): T | undefined {
  try {
    return fn(appState())
  } catch (err) {
    console.warn('[ui] Store-Aktion fehlgeschlagen', err)
    return undefined
  }
}

/** Liest einen Wert aus dem Store, mit Rueckfallwert bei Fehlern. */
export function read<T>(fn: (state: AppState) => T, fallback: T): T {
  try {
    const value = fn(appState())
    return value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

/** Fuehrt Mutationen gebuendelt in einer Undo-Operation aus. */
export function edit(name: string, fn: (state: AppState) => void): void {
  const state = appState()
  let started = false
  const run = () => {
    started = true
    fn(state)
  }
  try {
    state.operation(name, run)
  } catch (err) {
    if (!started) {
      try {
        run()
      } catch (inner) {
        console.warn(`[ui] "${name}" fehlgeschlagen`, inner)
      }
    } else {
      console.warn(`[ui] "${name}" fehlgeschlagen`, err)
    }
  }
}

/** Kurzmeldung in der Toast-Leiste. */
export function toast(text: string, kind: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
  act((s) => s.toast(text, kind))
}
