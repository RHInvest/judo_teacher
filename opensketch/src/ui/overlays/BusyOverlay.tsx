/** Ladeindikator: erscheint, solange `ui.busy` gesetzt ist. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { bus } from '@/shared/events'
import { useSkin } from '@/ui/lib/theme'
import { useAppSelector } from '@/ui/state/store'

export function BusyOverlay() {
  const skin = useSkin()
  const busy = useAppSelector((state) => state.ui?.busy ?? null)
  const [progress, setProgress] = useState<{ label: string; value: number | null } | null>(null)

  useEffect(() => {
    const off = bus.on('progress', (payload) => {
      setProgress(payload.value === null || payload.value >= 1 ? null : payload)
    })
    return off
  }, [])

  useEffect(() => {
    if (!busy) setProgress(null)
  }, [busy])

  if (!busy && !progress) return null

  const label = progress?.label ?? busy ?? 'Bitte warten ...'
  const percent = progress?.value === null || progress?.value === undefined ? null : Math.round(progress.value * 100)

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center" role="status" aria-live="polite">
      <div className={clsx('flex min-w-[220px] flex-col gap-2 rounded border px-4 py-3', skin.floating, skin.shadow)}>
        <div className="flex items-center gap-2">
          <Loader2 size={15} className="animate-spin text-accent-400" aria-hidden />
          <span className={clsx('min-w-0 flex-1 truncate text-[12px]', skin.text)}>{label}</span>
          {percent !== null ? <span className={clsx('shrink-0 text-[11px] tabular-nums', skin.dim)}>{percent} %</span> : null}
        </div>
        <div className={clsx('h-1 overflow-hidden rounded-full', skin.well)}>
          <div
            className={clsx('h-full rounded-full bg-accent-500', percent === null && 'animate-pulse')}
            style={{ width: percent === null ? '100%' : `${percent}%` }}
          />
        </div>
      </div>
    </div>
  )
}
