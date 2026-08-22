/** Vertikale Werkzeugleiste am linken Rand, in Gruppen getrennt. */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ToolId } from '@/shared/types'
import { TOOLBAR_GROUPS, TOOL_META } from '@/ui/lib/tools'
import type { ToolbarEntry } from '@/ui/lib/tools'
import { toolShortcut } from '@/ui/lib/shortcuts'
import { setTool } from '@/ui/lib/commands'
import { useSkin } from '@/ui/lib/theme'
import { Tooltip } from '@/ui/components/Tooltip'

function ToolButton({
  id,
  active,
  onSelect,
  corner,
  cornerOpen,
  cornerLabel,
  onCorner,
}: {
  id: ToolId
  active: boolean
  onSelect: () => void
  corner?: boolean
  cornerOpen?: boolean
  cornerLabel?: string
  onCorner?: () => void
}) {
  const skin = useSkin()
  const meta = TOOL_META[id]
  const Icon = meta.icon
  const shortcut = toolShortcut(id)

  return (
    <Tooltip label={meta.name} shortcut={shortcut} side="right">
      <div className="relative">
        <button
          type="button"
          aria-label={meta.name}
          aria-pressed={active}
          onClick={onSelect}
          className={clsx(
            'os-tool-btn h-8 w-8',
            active ? skin.iconBtnActive : skin.iconBtn,
            skin.ring,
          )}
        >
          <Icon size={17} strokeWidth={1.7} />
        </button>
        {corner ? (
          /*
           * Eigener Knopf, nicht nur eine angeklickte Ecke: die Werkzeuge
           * eines Flyouts waeren sonst mit der Tastatur ueberhaupt nicht
           * erreichbar. Er liegt bewusst in der Tab-Reihenfolge und traegt
           * `aria-expanded`, damit auch eine Vorlesehilfe merkt, dass sich
           * hier etwas aufklappt.
           */
          <button
            type="button"
            aria-label={cornerLabel ?? `${meta.name}: Varianten`}
            aria-haspopup="menu"
            aria-expanded={Boolean(cornerOpen)}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              onCorner?.()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onCorner?.()
              }
            }}
            className={clsx(
              'absolute bottom-0 right-0 flex h-3 w-3 cursor-pointer items-end justify-end rounded-sm',
              skin.ring,
            )}
          >
            <span
              aria-hidden
              className="h-0 w-0 border-b-[6px] border-l-[6px] border-b-current border-l-transparent opacity-70 transition-opacity hover:opacity-100"
            />
          </button>
        ) : null}
      </div>
    </Tooltip>
  )
}

function FlyoutEntry({
  entry,
  activeTool,
  open,
  onOpen,
  onClose,
}: {
  entry: Extract<ToolbarEntry, { kind: 'flyout' }>
  activeTool: ToolId
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const skin = useSkin()
  const [preferred, setPreferred] = useState<ToolId>(entry.tools[0])
  const containerRef = useRef<HTMLDivElement>(null)

  const groupActive = entry.tools.includes(activeTool)
  const shown = groupActive ? activeTool : preferred

  useEffect(() => {
    if (groupActive) setPreferred(activeTool)
  }, [groupActive, activeTool])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) onClose()
    }
    /* Escape schliesst das Flyout - ohne das bliebe es mit der Tastatur offen. */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  return (
    <div ref={containerRef} className="relative">
      <ToolButton
        id={shown}
        active={groupActive}
        onSelect={() => setTool(shown)}
        corner
        cornerOpen={open}
        cornerLabel={`${entry.label}: weitere Werkzeuge`}
        onCorner={() => (open ? onClose() : onOpen())}
      />
      {open ? (
        <div
          role="menu"
          aria-label={entry.label}
          className={clsx('absolute left-full top-0 z-40 ml-1 flex gap-0.5 rounded border p-1', skin.floating, skin.shadow)}
        >
          {entry.tools.map((toolId) => (
            <ToolButton
              key={toolId}
              id={toolId}
              active={toolId === activeTool}
              onSelect={() => {
                setPreferred(toolId)
                setTool(toolId)
                onClose()
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ToolPalette({ activeTool }: { activeTool: ToolId }) {
  const skin = useSkin()
  const [openFlyout, setOpenFlyout] = useState<string | null>(null)

  return (
    <nav
      aria-label="Werkzeuge"
      className={clsx('z-30 flex h-full w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto overflow-x-visible border-r py-1.5', skin.chrome, skin.border)}
    >
      {TOOLBAR_GROUPS.map((group, index) => (
        <div key={group.id} className="flex w-full flex-col items-center gap-0.5">
          {index > 0 ? <div className={clsx('my-1 h-px w-6', skin.divider)} role="separator" /> : null}
          {group.entries.map((entry) =>
            entry.kind === 'tool' ? (
              <ToolButton
                key={entry.id}
                id={entry.id}
                active={activeTool === entry.id}
                onSelect={() => setTool(entry.id)}
              />
            ) : (
              <FlyoutEntry
                key={entry.id}
                entry={entry}
                activeTool={activeTool}
                open={openFlyout === entry.id}
                onOpen={() => setOpenFlyout(entry.id)}
                onClose={() => setOpenFlyout(null)}
              />
            ),
          )}
        </div>
      ))}
    </nav>
  )
}
