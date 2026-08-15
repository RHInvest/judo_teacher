/**
 * Tastaturkuerzel.
 *
 * Verbindlich ist `TOOL_SHORTCUTS` aus `@/tools` (Kuerzel -> Werkzeug).
 * Solange die Werkzeugschicht diese Tabelle noch nicht fuellt, greifen die
 * hier hinterlegten Standardbelegungen, damit Tooltips und Menues nicht leer
 * bleiben.
 */

import { TOOL_SHORTCUTS } from '@/tools'
import type { ToolId } from '@/shared/types'
import { TOOL_META } from './tools'

export const DEFAULT_TOOL_SHORTCUTS: Record<ToolId, string> = {
  select: 'Leertaste',
  lasso: 'Umschalt+Leertaste',
  eraser: 'E',
  paint: 'B',

  line: 'L',
  freehand: 'Umschalt+F',
  rectangle: 'R',
  rotatedRectangle: 'Umschalt+R',
  circle: 'C',
  polygon: 'Umschalt+C',
  arc2: 'A',
  arc3: 'Umschalt+A',
  arc: 'Alt+A',
  pie: 'Alt+Umschalt+A',
  bezier: 'Umschalt+B',

  move: 'M',
  rotate: 'Q',
  scale: 'S',
  pushpull: 'P',
  followme: 'U',
  offset: 'F',

  tape: 'T',
  protractor: 'D',
  axes: 'Y',
  dimension: 'Umschalt+D',
  text: 'X',
  text3d: 'Umschalt+X',
  sectionPlane: 'Umschalt+S',

  orbit: 'O',
  pan: 'H',
  zoom: 'Z',
  zoomWindow: 'Umschalt+Z',
  position: 'Umschalt+P',
  walk: 'W',
  lookaround: 'Umschalt+L',
}

/** Kuerzel eines Werkzeugs, bevorzugt aus der Werkzeugschicht. */
export function toolShortcut(id: ToolId): string | undefined {
  try {
    for (const [combo, tool] of Object.entries(TOOL_SHORTCUTS ?? {})) {
      if (tool === id) return combo
    }
  } catch {
    /* Werkzeugschicht noch nicht bereit */
  }
  return DEFAULT_TOOL_SHORTCUTS[id]
}

/** Vollstaendige Liste fuer die Kuerzeluebersicht. */
export function allToolShortcuts(): { id: ToolId; name: string; combo: string }[] {
  return (Object.keys(TOOL_META) as ToolId[])
    .map((id) => ({ id, name: TOOL_META[id].name, combo: toolShortcut(id) ?? '' }))
    .filter((entry) => entry.combo !== '')
}

/* ------------------------------------------------------------------ */
/* Vergleich mit echten Tastaturereignissen                            */
/* ------------------------------------------------------------------ */

export interface Combo {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

const KEY_ALIASES: Record<string, string> = {
  LEERTASTE: ' ',
  ENTF: 'DELETE',
  ENTFERNEN: 'DELETE',
  EINGABE: 'ENTER',
  ESC: 'ESCAPE',
  POS1: 'HOME',
  TAB: 'TAB',
}

export function parseCombo(display: string): Combo | null {
  if (!display) return null
  const parts = display.split('+').map((part) => part.trim())
  const combo: Combo = { key: '', ctrl: false, shift: false, alt: false }
  for (const part of parts) {
    const upper = part.toUpperCase()
    if (upper === 'STRG' || upper === 'CTRL') combo.ctrl = true
    else if (upper === 'UMSCHALT' || upper === 'SHIFT') combo.shift = true
    else if (upper === 'ALT') combo.alt = true
    else combo.key = KEY_ALIASES[upper] ?? upper
  }
  return combo.key ? combo : null
}

function eventKey(event: KeyboardEvent): string {
  if (event.key === ' ' || event.code === 'Space') return ' '
  return event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase()
}

export function matchesCombo(event: KeyboardEvent, combo: Combo): boolean {
  if (combo.ctrl !== (event.ctrlKey || event.metaKey)) return false
  if (combo.alt !== event.altKey) return false
  if (combo.shift !== event.shiftKey) return false
  return eventKey(event) === combo.key
}

/** Findet das Werkzeug zu einem Tastendruck (nur einfache Buchstabenkuerzel). */
export function findToolForEvent(event: KeyboardEvent): ToolId | null {
  try {
    for (const [display, tool] of Object.entries(TOOL_SHORTCUTS ?? {})) {
      const combo = parseCombo(display)
      if (combo && matchesCombo(event, combo)) return tool as ToolId
    }
  } catch {
    /* ignorieren */
  }
  for (const id of Object.keys(DEFAULT_TOOL_SHORTCUTS) as ToolId[]) {
    const combo = parseCombo(DEFAULT_TOOL_SHORTCUTS[id])
    if (combo && !combo.ctrl && matchesCombo(event, combo)) return id
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Menuekuerzel                                                        */
/* ------------------------------------------------------------------ */

export const MENU_SHORTCUTS = {
  newDocument: 'Strg+N',
  open: 'Strg+O',
  save: 'Strg+S',
  saveAs: 'Strg+Umschalt+S',
  importFile: 'Strg+I',
  exportModel: 'Strg+Umschalt+E',
  undo: 'Strg+Z',
  redo: 'Strg+Y',
  cut: 'Strg+X',
  copy: 'Strg+C',
  paste: 'Strg+V',
  pasteInPlace: 'Strg+Umschalt+V',
  delete: 'Entf',
  selectAll: 'Strg+A',
  deselect: 'Strg+Umschalt+A',
  group: 'Strg+G',
  makeComponent: 'Strg+Umschalt+G',
  explode: 'Strg+Umschalt+U',
  hide: 'Strg+Umschalt+H',
  unhide: 'Strg+Umschalt+J',
  lock: 'Strg+Umschalt+K',
  unlock: 'Strg+Umschalt+O',
  zoomExtents: 'Strg+Umschalt+F',
  zoomSelection: 'Strg+Umschalt+Z',
  toggleProjection: 'Strg+Umschalt+P',
  shortcutHelp: 'F1',
  toggleTray: 'F2',
} as const

export type MenuShortcutId = keyof typeof MENU_SHORTCUTS
