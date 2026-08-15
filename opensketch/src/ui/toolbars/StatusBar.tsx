/** Statusleiste: Werkzeughinweis links, Massfeld mittig, Modellstatistik rechts. */

import { useEffect } from 'react'
import clsx from 'clsx'
import { Activity, Box, Minus, Square } from 'lucide-react'
import { bus } from '@/shared/events'
import { useSkin } from '@/ui/lib/theme'
import { fmtCount } from '@/ui/lib/format'
import { act, useAppSelector } from '@/ui/state/store'
import { TOOL_META } from '@/ui/lib/tools'
import { MeasurementBox } from './MeasurementBox'

function Stat({
  icon: Icon,
  value,
  title,
}: {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>
  value: string
  title: string
}) {
  const skin = useSkin()
  return (
    <span className={clsx('flex items-center gap-1 tabular-nums', skin.muted)} title={title}>
      <Icon size={12} strokeWidth={1.8} />
      {value}
    </span>
  )
}

export function StatusBar() {
  const skin = useSkin()
  const hint = useAppSelector((state) => state.ui?.statusHint ?? '')
  const modifiers = useAppSelector((state) => state.ui?.statusModifiers ?? '')
  const activeTool = useAppSelector((state) => state.activeTool ?? 'select')
  const stats = useAppSelector(
    (state) => state.ui?.stats ?? { faces: 0, edges: 0, instances: 0, fps: 0 },
    (a, b) => a.faces === b.faces && a.edges === b.edges && a.instances === b.instances && a.fps === b.fps,
  )

  /* Der Renderer meldet Frame-Statistiken - die Anzeige der Bildrate uebernimmt die UI. */
  useEffect(() => {
    let last = 0
    const off = bus.on('render:frame', (frame) => {
      const now = performance.now()
      if (now - last < 500) return
      last = now
      act((state) => state.setStats({ fps: Math.round(frame.fps) }))
    })
    return off
  }, [])

  const fallbackHint = TOOL_META[activeTool as keyof typeof TOOL_META]?.hint ?? ''

  return (
    <footer
      className={clsx('flex h-7 shrink-0 items-center gap-3 border-t px-2 text-[11px]', skin.chrome, skin.border)}
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={clsx('min-w-0 truncate', skin.text)}>{hint || fallbackHint}</span>
        {modifiers ? <span className={clsx('shrink-0 truncate', skin.dim)}>{modifiers}</span> : null}
      </div>

      <MeasurementBox />

      <div className={clsx('flex shrink-0 items-center gap-3 border-l pl-3', skin.border)}>
        <Stat icon={Square} value={fmtCount(stats.faces)} title="Flaechen" />
        <Stat icon={Minus} value={fmtCount(stats.edges)} title="Kanten" />
        <Stat icon={Box} value={fmtCount(stats.instances)} title="Instanzen" />
        <Stat icon={Activity} value={`${Math.round(stats.fps)} fps`} title="Bildrate" />
      </div>
    </footer>
  )
}
