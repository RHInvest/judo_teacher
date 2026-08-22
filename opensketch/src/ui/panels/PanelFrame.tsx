/** Rahmen eines Panels im Tray: Kopfzeile, Einklappen, Schliessen, Ziehgriff. */

import clsx from 'clsx'
import { ChevronDown, ChevronRight, GripVertical, X } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import type { PanelMeta } from './meta'

export function PanelFrame({
  meta,
  collapsed,
  active,
  onToggle,
  onClose,
  onActivate,
  dragHandlers,
  dropIndicator,
  children,
}: {
  meta: PanelMeta
  collapsed: boolean
  active: boolean
  onToggle: () => void
  onClose: () => void
  onActivate: () => void
  dragHandlers?: {
    draggable: boolean
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
    onDragEnd: (event: React.DragEvent) => void
  }
  dropIndicator?: boolean
  children: React.ReactNode
}) {
  const skin = useSkin()
  const Icon = meta.icon

  return (
    <section
      className={clsx('border-b', skin.border, dropIndicator && 'border-t-2 border-t-accent-500')}
      aria-label={meta.title}
      {...(dragHandlers
        ? {
            onDragOver: dragHandlers.onDragOver,
            onDrop: dragHandlers.onDrop,
          }
        : {})}
    >
      <header
        draggable={dragHandlers?.draggable}
        onDragStart={dragHandlers?.onDragStart}
        onDragEnd={dragHandlers?.onDragEnd}
        onClick={onActivate}
        className={clsx(
          'group flex h-8 select-none items-center gap-1.5 px-1.5',
          active ? skin.surface : skin.panel,
          skin.hover,
        )}
      >
        <GripVertical size={13} className={clsx('shrink-0 cursor-grab opacity-40 group-hover:opacity-80', skin.dim)} aria-hidden />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          aria-label={collapsed ? `${meta.title} ausklappen` : `${meta.title} einklappen`}
          aria-expanded={!collapsed}
          className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded', skin.iconBtn, skin.ring)}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <Icon size={13} strokeWidth={1.8} className={clsx('shrink-0', active ? 'text-accent-400' : skin.muted)} />
        <span className={clsx('min-w-0 flex-1 truncate text-[12px] font-medium', skin.text)}>{meta.title}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          aria-label={`${meta.title} schließen`}
          className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100', skin.iconBtn, skin.ring)}
        >
          <X size={13} />
        </button>
      </header>
      {collapsed ? null : <div className={clsx('pb-1.5', skin.panel)}>{children}</div>}
    </section>
  )
}
