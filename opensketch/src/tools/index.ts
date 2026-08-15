/**
 * STUB - wird vom Tools-Entwickler ersetzt.
 * Die Signaturen von `createInferenceEngine` und `createToolManager` sind Contract.
 */

import type { InferenceApi, StoreHandle, ToolManagerApi, ViewportApi } from '@/shared/store-api'

export interface ToolDeps {
  store: StoreHandle
  viewport: ViewportApi
}

export function createInferenceEngine(deps: ToolDeps): InferenceApi {
  throw new Error('tools/inference ist noch nicht implementiert')
}

export function createToolManager(deps: ToolDeps & { inference: InferenceApi }): ToolManagerApi {
  throw new Error('tools/index.ts ist noch nicht implementiert')
}

/** Tastaturkuerzel -> Werkzeug, wird von der UI fuer die Hilfe genutzt. */
export const TOOL_SHORTCUTS: Record<string, string> = {}
