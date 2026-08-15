/**
 * Ein defensiver Lese-Schnappschuss des Stores.
 *
 * Der Store wird parallel entwickelt und wirft anfangs `not implemented`.
 * Jeder Zugriff laeuft deshalb durch `attempt(...)`; fehlt etwas, greifen die
 * Voreinstellungen aus `defaults.ts` und der Viewport bleibt bedienbar.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import type { AppState, StoreHandle } from '@/shared/store-api'
import type {
  EditContext,
  FogSettings,
  Id,
  Selection,
  SketchDocument,
  StyleSettings,
  SunSettings,
} from '@/shared/types'
import { emptySelection } from '@/shared/types'
import { DEFAULT_FOG, DEFAULT_STYLE, DEFAULT_SUN } from './defaults'
import { attempt } from './util'

export interface Revisions {
  geometry: number
  scene: number
  material: number
  style: number
  selection: number
}

export interface RenderSnapshot {
  doc: SketchDocument | null
  style: StyleSettings
  sun: SunSettings
  fog: FogSettings
  context: EditContext | null
  selection: Selection
  hover: { kind: string; id: Id | null; definitionId: Id | null } | null
  revisions: Revisions
  /** true, wenn der Tag (inkl. Ordner) sichtbar ist */
  isTagVisible(tagId: Id | null): boolean
}

export function zeroRevisions(): Revisions {
  return { geometry: -1, scene: -1, material: -1, style: -1, selection: -1 }
}

export function revisionsEqual(a: Revisions, b: Revisions): boolean {
  return (
    a.geometry === b.geometry &&
    a.scene === b.scene &&
    a.material === b.material &&
    a.style === b.style &&
    a.selection === b.selection
  )
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Liest den Store einmal komplett aus. Wirft nie. */
export function readSnapshot(store: StoreHandle): RenderSnapshot {
  const state = attempt<AppState | null>('store.getState', () => store.getState(), null)
  const doc = state && typeof state === 'object' && state.doc ? state.doc : null

  const style = attempt(
    'store.getStyle',
    () => {
      const s = state?.getStyle?.()
      return s && typeof s === 'object' ? s : docStyle(doc)
    },
    docStyle(doc),
  )

  const sun = doc?.sun && typeof doc.sun === 'object' ? doc.sun : DEFAULT_SUN
  const fog = doc?.fog && typeof doc.fog === 'object' ? doc.fog : DEFAULT_FOG

  const context = state?.context && typeof state.context === 'object' ? state.context : null
  const selection = state?.selection && typeof state.selection === 'object' ? state.selection : emptySelection()
  const hover = state?.hover ?? null

  const isTagVisible = (tagId: Id | null): boolean => {
    if (!tagId) return true
    if (state && typeof state.isTagVisible === 'function') {
      const result = attempt('store.isTagVisible', () => state.isTagVisible(tagId), null)
      if (typeof result === 'boolean') return result
    }
    if (!doc) return true
    const tag = doc.tags?.[tagId]
    if (!tag) return true
    if (!tag.visible) return false
    if (tag.folderId) {
      const folder = doc.tagFolders?.[tag.folderId]
      if (folder && !folder.visible) return false
    }
    return true
  }

  return {
    doc,
    style: mergeStyle(style),
    sun,
    fog,
    context,
    selection,
    hover,
    revisions: {
      geometry: num(state?.geometryRevision, 0),
      scene: num(state?.sceneRevision, 0),
      material: num(state?.materialRevision, 0),
      style: num(state?.styleRevision, 0),
      selection: num(state?.selectionRevision, 0),
    },
    isTagVisible,
  }
}

function docStyle(doc: SketchDocument | null): StyleSettings {
  if (!doc) return DEFAULT_STYLE
  const style = doc.styles?.[doc.activeStyleId]
  return style ?? DEFAULT_STYLE
}

/** Fuellt fehlende Felder mit den Voreinstellungen auf. */
export function mergeStyle(style: Partial<StyleSettings> | null | undefined): StyleSettings {
  if (!style) return DEFAULT_STYLE
  const out = { ...DEFAULT_STYLE } as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_STYLE) as (keyof StyleSettings)[]) {
    const value = style[key]
    if (value !== undefined && value !== null) out[key as string] = value
  }
  return out as unknown as StyleSettings
}
