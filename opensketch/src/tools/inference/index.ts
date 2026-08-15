/**
 * Oeffentliche API der Inferenzmaschine.
 *
 * OWNERSHIP: Tools.
 */

import type { InferenceApi, StoreHandle, ViewportApi } from '@/shared/store-api'
import { InferenceEngine } from './engine'

export { InferenceEngine } from './engine'
export type { InferOptions } from './engine'
export * from './points'
export * from './directions'
export * from './labels'

export function createInferenceEngine(deps: { store: StoreHandle; viewport: ViewportApi }): InferenceApi {
  return new InferenceEngine(deps.store, deps.viewport)
}
