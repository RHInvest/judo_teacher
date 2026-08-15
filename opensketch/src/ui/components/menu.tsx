/**
 * Menue-Primitive fuer Menueleiste, Flyouts und Kontextmenue.
 * Unterstuetzt Untermenues, Kuerzelanzeige, Trennlinien, Haken und
 * deaktivierte Eintraege.
 */

import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronRight, Dot } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'

export type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'title'; label: string }
  | {
      kind?: 'item'
      label: string
      shortcut?: string
      icon?: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>
      disabled?: boolean
      checked?: boolean
      radio?: boolean
      run?: () => void
      items?: MenuEntry[]
    }

export function menuSep(): MenuEntry {
  return { kind: 'separator' }
}

function isItem(entry: MenuEntry): entry is Extract<MenuEntry, { label: string }> {
  return !('kind' in entry) || entry.kind === undefined || entry.kind === 'item'
}

export function MenuList({
  entries,
  onClose,
  className,
  minWidth = 216,
  autoFocus,
}: {
  entries: MenuEntry[]
  onClose: () => void
  className?: string
  minWidth?: number
  autoFocus?: boolean
}) {
  const skin = useSkin()
  const [openSub, setOpenSub] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const focusSibling = (delta: number) => {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
    if (nodes.length === 0) return
    const index = nodes.findIndex((node) => node === document.activeElement)
    const next = index < 0 ? (delta > 0 ? 0 : nodes.length - 1) : (index + delta + nodes.length) % nodes.length
    nodes[next]?.focus()
  }

  return (
    <div
      ref={listRef}
      role="menu"
      className={clsx('overflow-hidden rounded border py-1', skin.floating, skin.shadow, className)}
      style={{ minWidth }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          focusSibling(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          focusSibling(-1)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {entries.map((entry, index) => {
        if ('kind' in entry && entry.kind === 'separator') {
          return <div key={`sep-${index}`} className={clsx('my-1 h-px', skin.divider)} role="separator" />
        }
        if ('kind' in entry && entry.kind === 'title') {
          return (
            <div key={`title-${index}`} className={clsx('px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide', skin.dim)}>
              {entry.label}
            </div>
          )
        }
        if (!isItem(entry)) return null

        const hasSub = Boolean(entry.items && entry.items.length > 0)
        const Icon = entry.icon
        return (
          <div
            key={`${entry.label}-${index}`}
            className="relative"
            onMouseEnter={() => setOpenSub(hasSub ? index : null)}
          >
            <button
              type="button"
              role="menuitem"
              autoFocus={autoFocus && index === 0}
              disabled={entry.disabled}
              aria-haspopup={hasSub || undefined}
              aria-expanded={hasSub ? openSub === index : undefined}
              onClick={() => {
                if (entry.disabled) return
                if (hasSub) {
                  setOpenSub(openSub === index ? null : index)
                  return
                }
                entry.run?.()
                onClose()
              }}
              onKeyDown={(event) => {
                if (hasSub && event.key === 'ArrowRight') {
                  event.preventDefault()
                  setOpenSub(index)
                }
                if (event.key === 'ArrowLeft') setOpenSub(null)
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-[5px] text-left text-[12px] transition-colors',
                'disabled:cursor-default disabled:opacity-40',
                !entry.disabled && skin.hover,
                'focus-visible:outline-none focus-visible:bg-accent-500/25',
              )}
            >
              <span className="flex w-[14px] shrink-0 justify-center">
                {entry.checked ? (
                  entry.radio ? <Dot size={16} strokeWidth={5} /> : <Check size={13} strokeWidth={2.5} />
                ) : Icon ? (
                  <Icon size={13} strokeWidth={1.8} />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.shortcut ? <span className={clsx('shrink-0 text-[11px]', skin.dim)}>{entry.shortcut}</span> : null}
              {hasSub ? <ChevronRight size={13} className="shrink-0" /> : null}
            </button>

            {hasSub && openSub === index ? (
              <div className="absolute left-full top-0 z-50 -mt-1 pl-0.5">
                <MenuList entries={entry.items ?? []} onClose={onClose} />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
