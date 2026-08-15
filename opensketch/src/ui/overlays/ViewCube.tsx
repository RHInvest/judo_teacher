/**
 * ViewCube oben rechts im Viewport.
 *
 * Bewusst als isometrische SVG-Zeichnung statt als CSS-3D-Wuerfel: die drei
 * sichtbaren Flaechen sind direkt anklickbar, die drei verdeckten liegen als
 * Knoepfe daneben. Ein Kompassring zeigt die Blickrichtung in der XY-Ebene.
 * Jeder Klick schickt `camera:command` mit der gewuenschten Standardansicht.
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Maximize2, Home } from 'lucide-react'
import { bus } from '@/shared/events'
import type { StandardView, Vec3Like } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { Tooltip } from '@/ui/components/Tooltip'
import { cmdStandardView, cmdZoomExtents, getViewportSafe } from '@/ui/lib/commands'

const VIEW_LABELS: Record<StandardView, string> = {
  iso: 'Isometrisch',
  top: 'Oben',
  bottom: 'Unten',
  front: 'Vorne',
  back: 'Hinten',
  left: 'Links',
  right: 'Rechts',
}

/** Blickrichtungen (Kamera -> Modell) der sechs Standardansichten. */
const VIEW_DIRECTIONS: { view: StandardView; dir: Vec3Like }[] = [
  { view: 'top', dir: { x: 0, y: 0, z: -1 } },
  { view: 'bottom', dir: { x: 0, y: 0, z: 1 } },
  { view: 'front', dir: { x: 0, y: 1, z: 0 } },
  { view: 'back', dir: { x: 0, y: -1, z: 0 } },
  { view: 'left', dir: { x: 1, y: 0, z: 0 } },
  { view: 'right', dir: { x: -1, y: 0, z: 0 } },
]

/** Welche Standardansicht die Kamera gerade zeigt - `null`, wenn keine passt. */
export function matchStandardView(eye: Vec3Like, target: Vec3Like, tolerance = 0.985): StandardView | null {
  const dx = target.x - eye.x
  const dy = target.y - eye.y
  const dz = target.z - eye.z
  const length = Math.hypot(dx, dy, dz)
  if (!Number.isFinite(length) || length < 1e-9) return null
  const dir = { x: dx / length, y: dy / length, z: dz / length }
  for (const entry of VIEW_DIRECTIONS) {
    const dot = dir.x * entry.dir.x + dir.y * entry.dir.y + dir.z * entry.dir.z
    if (dot >= tolerance) return entry.view
  }
  return null
}

/** Kompasswinkel der Kamera in Grad, im Uhrzeigersinn von Norden (+Y). */
export function compassAngle(eye: Vec3Like, target: Vec3Like): number {
  const dx = eye.x - target.x
  const dy = eye.y - target.y
  if (Math.hypot(dx, dy) < 1e-9) return 0
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI
  return ((degrees % 360) + 360) % 360
}

interface CameraSnapshot {
  view: StandardView | null
  angle: number
}

const IDLE: CameraSnapshot = { view: null, angle: 0 }

export function ViewCube() {
  const skin = useSkin()
  const [snapshot, setSnapshot] = useState<CameraSnapshot>(IDLE)

  useEffect(() => {
    const update = () => {
      const camera = getViewportSafe()?.getCamera()
      if (!camera?.eye || !camera?.target) {
        setSnapshot(IDLE)
        return
      }
      setSnapshot({
        view: matchStandardView(camera.eye, camera.target),
        angle: compassAngle(camera.eye, camera.target),
      })
    }
    update()
    const off = bus.on('camera:changed', update)
    return off
  }, [])

  const size = 78
  const half = size / 2
  /* Isometrische Projektion: 30 Grad nach links und rechts abfallend. */
  const w = 26
  const h = 15
  const top = [
    [half, half - h * 2],
    [half + w, half - h],
    [half, half],
    [half - w, half - h],
  ]
  const left = [
    [half - w, half - h],
    [half, half],
    [half, half + h * 2],
    [half - w, half + h],
  ]
  const right = [
    [half + w, half - h],
    [half, half],
    [half, half + h * 2],
    [half + w, half + h],
  ]

  const points = (list: number[][]) => list.map((p) => p.join(',')).join(' ')

  const face = (view: StandardView, list: number[][], label: string, labelAt: [number, number]) => {
    const active = snapshot.view === view
    return (
      <g key={view}>
        <polygon
          points={points(list)}
          role="button"
          tabIndex={0}
          aria-label={`Ansicht ${VIEW_LABELS[view]}`}
          onClick={() => cmdStandardView(view)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') cmdStandardView(view)
          }}
          className={clsx(
            'cursor-pointer transition-colors',
            active ? 'fill-accent-500/80 stroke-accent-400' : 'fill-panel-700/80 stroke-panel-500 hover:fill-accent-600/50',
          )}
          strokeWidth={1}
        />
        <text
          x={labelAt[0]}
          y={labelAt[1]}
          textAnchor="middle"
          fontSize={8}
          className="pointer-events-none select-none fill-white/85"
        >
          {label}
        </text>
      </g>
    )
  }

  return (
    <div className="pointer-events-auto flex select-none flex-col items-end gap-1">
      <div className={clsx('rounded border p-0.5', skin.floating, skin.shadow)}>
        <svg width={size} height={size} role="group" aria-label="Ansichtswuerfel">
          {face('top', top, 'OBEN', [half, half - h - 2])}
          {face('front', left, 'VORN', [half - w / 2, half + h + 4])}
          {face('right', right, 'RE', [half + w / 2, half + h + 4])}
        </svg>
      </div>

      <div className={clsx('flex items-center gap-0.5 rounded border p-0.5', skin.floating, skin.shadow)}>
        {(['back', 'left', 'bottom', 'iso'] as StandardView[]).map((view) => (
          <Tooltip key={view} label={VIEW_LABELS[view]} side="left">
            <button
              type="button"
              aria-label={`Ansicht ${VIEW_LABELS[view]}`}
              aria-pressed={snapshot.view === view}
              onClick={() => cmdStandardView(view)}
              className={clsx(
                'h-5 rounded px-1.5 text-[10px]',
                snapshot.view === view ? skin.iconBtnActive : skin.iconBtn,
                skin.ring,
              )}
            >
              {view === 'iso' ? 'ISO' : VIEW_LABELS[view].slice(0, 2).toUpperCase()}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className={clsx('flex items-center gap-1 rounded border px-1 py-0.5', skin.floating, skin.shadow)}>
        <svg width={20} height={20} aria-label={`Kompass, Blickrichtung ${Math.round(snapshot.angle)} Grad`}>
          <circle cx={10} cy={10} r={8} fill="none" stroke="currentColor" strokeOpacity={0.3} />
          <g transform={`rotate(${-snapshot.angle} 10 10)`}>
            <line x1={10} y1={10} x2={10} y2={3} stroke="#d93b3b" strokeWidth={1.6} strokeLinecap="round" />
            <line x1={10} y1={10} x2={10} y2={16} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.2} />
          </g>
        </svg>
        <Tooltip label="Alles einpassen" shortcut="Strg+Umschalt+F" side="left">
          <button
            type="button"
            aria-label="Alles einpassen"
            onClick={cmdZoomExtents}
            className={clsx('flex h-5 w-5 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <Maximize2 size={12} />
          </button>
        </Tooltip>
        <Tooltip label="Isometrische Ansicht" side="left">
          <button
            type="button"
            aria-label="Isometrische Ansicht"
            onClick={() => cmdStandardView('iso')}
            className={clsx('flex h-5 w-5 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <Home size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
