/**
 * Globale Befehlskuerzel der Oberflaeche.
 *
 * ABGRENZUNG zum Werkzeugmanager (`@/tools`): der Manager besitzt Escape, die
 * Leertaste, Entf, die Werkzeugbuchstaben sowie Strg+Z / Strg+Y / Strg+G. Diese
 * Ebene fasst sie deshalb NICHT an und kuemmert sich ausschliesslich um die
 * Dateibefehle, die Zwischenablage, Auswahl, Ansicht und die Funktionstasten.
 */

import { useEffect, useRef } from 'react'
import type { PanelId } from '@/shared/store-api'
import { act } from '@/ui/state/store'
import * as cmd from './commands'
import { MENU_SHORTCUTS, matchesCombo, parseCombo } from './shortcuts'
import type { MenuShortcutId } from './shortcuts'

/** Kuerzel, die dem Werkzeugmanager gehoeren und hier ignoriert werden. */
const OWNED_BY_TOOLS: MenuShortcutId[] = ['undo', 'redo', 'delete', 'group']

export interface ShortcutHandlers {
  onSaveAs: () => void
  onShowShortcuts: () => void
  openPanel: (panel: PanelId) => void
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const actions: Partial<Record<MenuShortcutId, () => void>> = {
      newDocument: () => cmd.cmdNew('metric'),
      open: () => act((s) => s.openDialog({ kind: 'openFile' })),
      save: () => void cmd.cmdSave(),
      saveAs: () => handlersRef.current.onSaveAs(),
      importFile: () => act((s) => s.openDialog({ kind: 'importModel' })),
      exportModel: () => act((s) => s.openDialog({ kind: 'exportModel' })),
      cut: cmd.cmdCut,
      copy: cmd.cmdCopy,
      paste: () => cmd.cmdPaste(false),
      pasteInPlace: () => cmd.cmdPaste(true),
      selectAll: cmd.cmdSelectAll,
      deselect: cmd.cmdDeselect,
      makeComponent: () => act((s) => s.openDialog({ kind: 'makeComponent', defaults: { name: 'Komponente' } })),
      explode: cmd.cmdExplode,
      hide: cmd.cmdHide,
      unhide: cmd.cmdUnhide,
      lock: () => cmd.cmdLock(true),
      unlock: () => cmd.cmdLock(false),
      zoomExtents: cmd.cmdZoomExtents,
      zoomSelection: cmd.cmdZoomSelection,
      toggleProjection: cmd.cmdToggleProjection,
      shortcutHelp: () => handlersRef.current.onShowShortcuts(),
      toggleTray: () => act((s) => s.setTrayVisible(!(s.ui?.trayVisible !== false))),
    }

    const bindings = (Object.keys(actions) as MenuShortcutId[])
      .filter((id) => !OWNED_BY_TOOLS.includes(id))
      .map((id) => ({ id, combo: parseCombo(MENU_SHORTCUTS[id]), run: actions[id] }))
      .filter((entry): entry is { id: MenuShortcutId; combo: NonNullable<ReturnType<typeof parseCombo>>; run: () => void } =>
        entry.combo !== null && entry.run !== undefined,
      )

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextTarget(event.target)) return
      for (const binding of bindings) {
        if (!matchesCombo(event, binding.combo)) continue
        event.preventDefault()
        event.stopPropagation()
        try {
          binding.run()
        } catch (err) {
          console.warn(`[ui] Kürzel "${binding.id}" fehlgeschlagen`, err)
        }
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
