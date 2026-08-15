/** Kontextmenue des Viewports - Eintraege richten sich nach der Auswahl. */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { selectionCount } from '@/shared/types'
import type { Selection } from '@/shared/types'
import { MenuList, menuSep } from '@/ui/components/menu'
import type { MenuEntry } from '@/ui/components/menu'
import { MENU_SHORTCUTS } from '@/ui/lib/shortcuts'
import * as cmd from '@/ui/lib/commands'
import { act, appState } from '@/ui/state/store'

export interface ContextMenuState {
  x: number
  y: number
}

/**
 * Baut die Eintraege zur aktuellen Auswahl. Ausgelagert und exportiert, damit
 * die Logik ohne DOM testbar bleibt.
 */
export function contextMenuEntries(selection: Selection, opts: { nested: boolean; clipboard: boolean }): MenuEntry[] {
  const entities = selection.entityIds.length
  const faces = selection.faceIds.length
  const edges = selection.edgeIds.length
  const any = selectionCount(selection) > 0

  const entries: MenuEntry[] = []

  if (entities > 0) {
    entries.push({ label: 'Bearbeiten', run: () => cmd.cmdEnterContext() })
    entries.push({ label: 'Aufloesen', shortcut: MENU_SHORTCUTS.explode, run: cmd.cmdExplode })
    entries.push({ label: 'Eindeutig machen', run: () => cmd.cmdMakeUnique() })
    entries.push(menuSep())
  }

  if (any) {
    entries.push({ label: 'Ausschneiden', shortcut: MENU_SHORTCUTS.cut, run: cmd.cmdCut })
    entries.push({ label: 'Kopieren', shortcut: MENU_SHORTCUTS.copy, run: cmd.cmdCopy })
  }
  if (opts.clipboard) {
    entries.push({ label: 'Einfuegen', shortcut: MENU_SHORTCUTS.paste, run: () => cmd.cmdPaste(false) })
    entries.push({ label: 'An Ort einfuegen', run: () => cmd.cmdPaste(true) })
  }
  if (any || opts.clipboard) entries.push(menuSep())

  if (any) {
    entries.push({ label: 'Loeschen', shortcut: MENU_SHORTCUTS.delete, run: cmd.cmdDelete })
    entries.push({ label: 'Verstecken', shortcut: MENU_SHORTCUTS.hide, run: cmd.cmdHide })
  }
  if (entities > 0) {
    entries.push({ label: 'Sperren', run: () => cmd.cmdLock(true) })
    entries.push({ label: 'Entsperren', run: () => cmd.cmdLock(false) })
  }
  if (any) {
    entries.push(menuSep())
    entries.push({ label: 'Gruppe erstellen', shortcut: MENU_SHORTCUTS.group, run: cmd.cmdGroup })
    entries.push({
      label: 'Komponente erstellen ...',
      shortcut: MENU_SHORTCUTS.makeComponent,
      run: () => act((s) => s.openDialog({ kind: 'makeComponent', defaults: { name: 'Komponente' } })),
    })
  }

  if (faces > 0) {
    entries.push(menuSep())
    entries.push({ label: 'Flaechen umkehren', run: cmd.cmdReverseFaces })
    entries.push({ label: 'Flaechen ausrichten', run: cmd.cmdOrientFaces })
    entries.push({ label: 'Schnittflaechen erzeugen', run: () => cmd.cmdIntersect('selection') })
  }

  if (edges > 0) {
    entries.push(menuSep())
    entries.push({ label: 'Kanten weichzeichnen ...', run: () => act((s) => s.openDialog({ kind: 'softenEdges' })) })
  }

  entries.push(menuSep())
  entries.push({ label: 'Alles auswaehlen', shortcut: MENU_SHORTCUTS.selectAll, run: cmd.cmdSelectAll })
  entries.push({ label: 'Abwaehlen', shortcut: MENU_SHORTCUTS.deselect, disabled: !any, run: cmd.cmdDeselect })
  entries.push({
    label: 'Auswahl einpassen',
    shortcut: MENU_SHORTCUTS.zoomSelection,
    disabled: !any,
    run: cmd.cmdZoomSelection,
  })
  entries.push({ label: 'Alles einpassen', shortcut: MENU_SHORTCUTS.zoomExtents, run: cmd.cmdZoomExtents })

  if (opts.nested) {
    entries.push(menuSep())
    entries.push({ label: 'Kontext verlassen', run: cmd.cmdExitContext })
  }

  return entries
}

export function ViewportContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const selection = cmd.currentSelection()
  const entries = contextMenuEntries(selection, {
    nested: cmd.inNestedContext(),
    clipboard: cmd.clipboardFilled(),
  })

  /* Menue am Rand einklappen, damit es nie aus dem Fenster laeuft. */
  const width = 236
  const estimatedHeight = Math.min(entries.length * 24 + 12, window.innerHeight - 20)
  const left = Math.min(state.x, window.innerWidth - width - 8)
  const top = Math.min(state.y, Math.max(8, window.innerHeight - estimatedHeight - 8))

  return createPortal(
    <div className="fixed inset-0 z-[150]" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="absolute" style={{ left, top }} onMouseDown={(event) => event.stopPropagation()}>
        <MenuList entries={entries} onClose={onClose} minWidth={width} autoFocus />
      </div>
    </div>,
    document.body,
  )
}

/** Nur fuer Tests: aktuelle Auswahl aus dem Store. */
export function currentContextEntries(): MenuEntry[] {
  const state = appState()
  return contextMenuEntries(state.selection, {
    nested: (state.context?.instancePath?.length ?? 0) > 0,
    clipboard: cmd.clipboardFilled(),
  })
}
