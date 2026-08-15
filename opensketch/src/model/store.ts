/**
 * STUB - wird vom Model-Entwickler ersetzt.
 *
 * Zielimplementierung:
 *   export const useStore = create<AppState>()((set, get) => ({ ...alle Felder und Aktionen aus AppState... }))
 *   export const store: StoreHandle = { getState: useStore.getState, setState: useStore.setState, subscribe: useStore.subscribe }
 *
 * Die Signaturen unten sind Contract - Namen und Typen duerfen sich nicht aendern.
 */

import type { AppState, StoreHandle } from '@/shared/store-api'

function notReady(): never {
  throw new Error('model/store.ts ist noch nicht implementiert')
}

export const store: StoreHandle = {
  getState: () => notReady(),
  setState: () => notReady(),
  subscribe: () => notReady(),
}

export function useStore<T>(selector: (state: AppState) => T): T {
  return notReady()
}
