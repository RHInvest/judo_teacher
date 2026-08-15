/**
 * Wurzelkomponente der Oberflaeche.
 *
 * Aufbau:
 *   Menueleiste
 *   ┌──────────┬──────────────────────────┬───────────┐
 *   │ Werkzeug │ Szenen-Tabs + Viewport   │ Tray      │
 *   └──────────┴──────────────────────────┴───────────┘
 *   Statusleiste (Hinweis · Massfeld · Statistik)
 *
 * `src/main.tsx` mountet den Export `App`.
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { bus } from '@/shared/events'
import type { PanelId } from '@/shared/store-api'
import { SkinContext, skinFor } from '@/ui/lib/theme'
import { useWindowWidth } from '@/ui/lib/hooks'
import { useGlobalShortcuts } from '@/ui/lib/useGlobalShortcuts'
import { startSlideshow, stopSlideshow } from '@/ui/lib/slideshow'
import { MenuBar } from '@/ui/toolbars/MenuBar'
import { StatusBar } from '@/ui/toolbars/StatusBar'
import { ToolPalette } from '@/ui/toolbars/ToolPalette'
import { Tray, TRAY_COLLAPSE_WIDTH } from '@/ui/panels/Tray'
import { ViewportArea } from '@/ui/overlays/ViewportArea'
import { Welcome } from '@/ui/overlays/Welcome'
import { DialogHost, LocalDialogHost } from '@/ui/dialogs'
import type { LocalDialog } from '@/ui/dialogs'
import { act, useAppSelector } from '@/ui/state/store'

const WELCOME_KEY = 'opensketch.welcomeSeen'

function welcomeSeen(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === '1'
  } catch {
    return true
  }
}

function rememberWelcome(): void {
  try {
    window.localStorage.setItem(WELCOME_KEY, '1')
  } catch {
    /* Speicher nicht verfuegbar */
  }
}

export function App() {
  const theme = useAppSelector((state) => state.ui?.theme ?? 'dark')
  const activeTool = useAppSelector((state) => state.activeTool ?? 'select')
  const width = useWindowWidth()
  const skin = skinFor(theme)

  const [localDialog, setLocalDialog] = useState<LocalDialog>(null)
  const [showWelcome, setShowWelcome] = useState(() => !welcomeSeen())

  /* Das Farbschema haengt am Wurzelelement, damit `color-scheme` mitzieht. */
  useEffect(() => {
    document.documentElement.style.colorScheme = theme
    document.documentElement.dataset.theme = theme
  }, [theme])

  /* Diashow beim Verlassen der Anwendung anhalten. */
  useEffect(() => stopSlideshow, [])

  /* Ein geladenes Dokument beendet den Willkommensbildschirm. */
  useEffect(() => {
    const off = bus.on('document:loaded', () => setShowWelcome(false))
    return off
  }, [])

  const openPanel = (panel: PanelId) => {
    act((state) => {
      if (!(state.ui?.openPanels ?? []).includes(panel)) state.togglePanel(panel)
      state.setActivePanel(panel)
      state.setTrayVisible(true)
    })
  }

  useGlobalShortcuts({
    onSaveAs: () => setLocalDialog('saveAs'),
    onShowShortcuts: () => setLocalDialog('shortcuts'),
    openPanel,
  })

  const closeWelcome = () => {
    rememberWelcome()
    setShowWelcome(false)
  }

  return (
    <SkinContext.Provider value={skin}>
      <div className={clsx('flex h-full w-full flex-col overflow-hidden font-ui', skin.app)}>
        <MenuBar
          openPanel={openPanel}
          onSaveAs={() => setLocalDialog('saveAs')}
          onShowShortcuts={() => setLocalDialog('shortcuts')}
          onShowQuickstart={() => setLocalDialog('quickstart')}
          onPlaySlideshow={startSlideshow}
        />

        <div className="flex min-h-0 flex-1">
          <ToolPalette activeTool={activeTool} />
          <ViewportArea />
          <Tray compact={width < TRAY_COLLAPSE_WIDTH} />
        </div>

        <StatusBar />

        <DialogHost />
        <LocalDialogHost dialog={localDialog} onClose={() => setLocalDialog(null)} />
        {showWelcome ? <Welcome onClose={closeWelcome} /> : null}
      </div>
    </SkinContext.Provider>
  )
}

export default App
