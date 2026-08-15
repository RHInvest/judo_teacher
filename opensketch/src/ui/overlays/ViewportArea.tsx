/**
 * Der 3D-Bereich: Szenen-Tabs, `<ViewportHost />` (Eigentum des Leads) sowie
 * alle Ueberlagerungen - ViewCube, Kontextmenue, Ladeindikator, Toasts und
 * Drag & Drop von Dateien.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { Upload } from 'lucide-react'
import { ViewportHost } from '@/app/ViewportHost'
import { useSkin } from '@/ui/lib/theme'
import { importFiles } from '@/ui/lib/commands'
import { BusyOverlay } from './BusyOverlay'
import { SceneTabs } from './SceneTabs'
import { Toasts } from './Toasts'
import { ViewCube } from './ViewCube'
import { ViewportContextMenu } from './ContextMenu'
import type { ContextMenuState } from './ContextMenu'

export function ViewportArea() {
  const skin = useSkin()
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [dropping, setDropping] = useState(false)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SceneTabs />

      <div
        className="relative min-h-0 flex-1"
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types ?? []).includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files ?? [])
          if (files.length === 0) return
          event.preventDefault()
          setDropping(false)
          importFiles(files)
        }}
      >
        <ViewportHost />

        <div className="pointer-events-none absolute right-2 top-2 z-30">
          <ViewCube />
        </div>

        {dropping ? (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent-500 bg-accent-500/10">
            <span className={clsx('flex items-center gap-2 rounded px-3 py-2 text-[13px]', skin.floating, skin.shadow)}>
              <Upload size={16} className="text-accent-400" aria-hidden />
              Dateien zum Importieren ablegen
            </span>
          </div>
        ) : null}

        <BusyOverlay />
        <Toasts />
      </div>

      {menu ? <ViewportContextMenu state={menu} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}
