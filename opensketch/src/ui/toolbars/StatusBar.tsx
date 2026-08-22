/** Statusleiste: Werkzeughinweis links, Massfeld mittig, Modellstatistik rechts. */

import clsx from 'clsx'
import { Activity, Box, Minus, Square, Triangle } from 'lucide-react'
import type { UiState } from '@/shared/store-api'
import { useSkin } from '@/ui/lib/theme'
import { fmtCount } from '@/ui/lib/format'
import { useAppSelector } from '@/ui/state/store'
import { TOOL_META } from '@/ui/lib/tools'
import { MeasurementBox } from './MeasurementBox'

const EMPTY_STATS: UiState['stats'] = { faces: 0, edges: 0, instances: 0, triangles: 0, fps: 0 }

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
    <span
      className={clsx('flex items-center gap-1 tabular-nums', skin.muted)}
      title={title}
      aria-label={`${title}: ${value}`}
    >
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
    (state) => state.ui?.stats ?? EMPTY_STATS,
    (a, b) =>
      a.faces === b.faces &&
      a.edges === b.edges &&
      a.instances === b.instances &&
      a.triangles === b.triangles &&
      a.fps === b.fps,
  )

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

      {/*
        Beschriftungen benennen genau das, was sie zeigen: `faces`/`edges`/`instances`
        sind Modellwerte, `triangles` ist die Dreieckszahl der Triangulierung aus dem
        letzten Frame - niemals unter "Flaechen" fuehren.
      */}
      <div className={clsx('flex shrink-0 items-center gap-2.5 border-l pl-3', skin.border)}>
        <Stat icon={Square} value={fmtCount(stats.faces)} title="Flaechen" />
        <Stat icon={Minus} value={fmtCount(stats.edges)} title="Kanten" />
        <Stat icon={Box} value={fmtCount(stats.instances)} title="Instanzen" />
        <Stat icon={Triangle} value={fmtCount(stats.triangles)} title="Dreiecke" />
        <Stat icon={Activity} value={`${Math.round(stats.fps)} fps`} title="Bildrate" />
      </div>
    </footer>
  )
}
