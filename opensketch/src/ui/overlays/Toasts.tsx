/** Kurzmeldungen aus `ui.toasts`, unten mittig ueber dem Viewport. */

import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { Id } from '@/shared/types'
import type { UiState } from '@/shared/store-api'
import { useSkin } from '@/ui/lib/theme'
import { act, useAppSelector } from '@/ui/state/store'

type Toast = UiState['toasts'][number]

const ICONS: Record<Toast['kind'], typeof Info> = {
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
}

const ACCENTS: Record<Toast['kind'], string> = {
  info: 'text-accent-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  success: 'text-emerald-400',
}

/** Anzeigedauer in Millisekunden - Fehler bleiben laenger stehen. */
export const TOAST_DURATIONS: Record<Toast['kind'], number> = {
  info: 4000,
  success: 3500,
  warn: 6000,
  error: 9000,
}

export function Toasts() {
  const skin = useSkin()
  const toasts = useAppSelector(
    (state) => state.ui?.toasts ?? [],
    (a, b) => a.length === b.length && a.every((entry, index) => entry.id === b[index]?.id),
  )
  const timers = useRef(new Map<Id, number>())

  useEffect(() => {
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue
      const handle = window.setTimeout(() => {
        timers.current.delete(toast.id)
        act((s) => s.dismissToast(toast.id))
      }, TOAST_DURATIONS[toast.kind] ?? 4000)
      timers.current.set(toast.id, handle)
    }
    const alive = new Set(toasts.map((toast) => toast.id))
    for (const [id, handle] of Array.from(timers.current.entries())) {
      if (!alive.has(id)) {
        window.clearTimeout(handle)
        timers.current.delete(id)
      }
    }
  }, [toasts])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const handle of map.values()) window.clearTimeout(handle)
      map.clear()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-1/2 z-40 flex w-[min(420px,86%)] -translate-x-1/2 flex-col gap-1.5"
      role="log"
      aria-live="polite"
    >
      {toasts.slice(-4).map((toast) => {
        const Icon = ICONS[toast.kind] ?? Info
        return (
          <div
            key={toast.id}
            className={clsx('pointer-events-auto flex items-start gap-2 rounded border px-2.5 py-1.5', skin.floating, skin.shadow)}
          >
            <Icon size={14} strokeWidth={1.9} className={clsx('mt-[1px] shrink-0', ACCENTS[toast.kind])} aria-hidden />
            <span className={clsx('min-w-0 flex-1 text-[11px] leading-relaxed', skin.text)}>{toast.text}</span>
            <button
              type="button"
              aria-label="Meldung schließen"
              onClick={() => act((s) => s.dismissToast(toast.id))}
              className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded', skin.iconBtn, skin.ring)}
            >
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
