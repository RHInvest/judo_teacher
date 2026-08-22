/** Grundgeruest aller Dialoge: Verdunkelung, Kopf, Inhalt, Fusszeile. */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { Button } from '@/ui/components/controls'

export interface DialogAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
}

export function Dialog({
  title,
  onClose,
  children,
  actions,
  width = 460,
  footerNote,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  actions?: DialogAction[]
  width?: number
  footerNote?: React.ReactNode
}) {
  const skin = useSkin()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      focusable?.focus()
    }, 0)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(timer)
    }
  }, [onClose])

  return createPortal(
    <div
      className={clsx('fixed inset-0 z-[200] flex items-center justify-center p-6', skin.scrim)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('flex max-h-[86vh] w-full flex-col overflow-hidden rounded-lg border', skin.floating, skin.shadow)}
        style={{ maxWidth: width }}
      >
        <header className={clsx('flex h-9 shrink-0 items-center gap-2 border-b px-3', skin.border)}>
          <h2 className={clsx('min-w-0 flex-1 truncate text-[13px] font-medium', skin.text)}>{title}</h2>
          <button
            type="button"
            aria-label="Dialog schließen"
            onClick={onClose}
            className={clsx('flex h-6 w-6 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">{children}</div>

        {actions && actions.length > 0 ? (
          <footer className={clsx('flex shrink-0 items-center gap-2 border-t px-3 py-2', skin.border)}>
            <div className={clsx('min-w-0 flex-1 truncate text-[11px]', skin.dim)}>{footerNote}</div>
            {actions.map((action) => (
              <Button key={action.label} variant={action.variant ?? 'secondary'} disabled={action.disabled} onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/** Zwei Spalten fuer Reiter links und Inhalt rechts. */
export function DialogTabs<T extends string>({
  tabs,
  active,
  onChange,
  children,
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  children: React.ReactNode
}) {
  const skin = useSkin()
  return (
    <div className="flex min-h-[260px] gap-0">
      <nav className={clsx('w-[132px] shrink-0 border-r py-1', skin.border)} aria-label="Bereiche">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active === tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'flex h-7 w-full items-center px-3 text-left text-[12px] transition-colors',
              active === tab.id ? skin.selected : clsx(skin.muted, skin.hover),
              skin.ring,
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
