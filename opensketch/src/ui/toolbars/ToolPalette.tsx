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
  onCorner,
}: {
  id: ToolId
  active: boolean
  onSelect: () => void
  corner?: boolean
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
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400',
          )}
        >
          <Icon size={17} strokeWidth={1.7} />
        </button>
        {corner ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`${meta.name}: Varianten`}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              onCorner?.()
            }}
            className="absolute bottom-0 right-0 h-0 w-0 cursor-pointer border-b-[6px] border-l-[6px] border-b-current border-l-transparent opacity-70 hover:opacity-100"
          />
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
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  return (
    <div ref={containerRef} className="relative">
      <ToolButton
        id={shown}
        active={groupActive}
        onSelect={() => setTool(shown)}
        corner
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
