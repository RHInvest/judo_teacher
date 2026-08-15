/** Schatten: Sonnenstand ueber Datum, Uhrzeit, Ort und Nordrichtung. */

import { useRef } from 'react'
import clsx from 'clsx'
import { Sun } from 'lucide-react'
import type { SunSettings } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { fmtClock, fmtDate } from '@/ui/lib/format'
import { CITY_PRESETS, findCity } from '@/ui/lib/cities'
import { Checkbox, Divider, GroupTitle, NumberInput, Row, Select, Slider, Toggle } from '@/ui/components/controls'
import { act, useApp } from '@/ui/state/store'
import { DEFAULT_SUN } from '@/ui/state/fallback'

/* ------------------------------------------------------------------ */
/* Datum <-> Tag im Jahr                                               */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86400000

export function dayOfYear(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!match) return 172
  const year = Number(match[1])
  const start = Date.UTC(year, 0, 1)
  const current = Date.UTC(year, Number(match[2]) - 1, Number(match[3]))
  return Math.round((current - start) / MS_PER_DAY) + 1
}

export function isoFromDayOfYear(iso: string, day: number): string {
  const match = /^(\d{4})/.exec(iso ?? '')
  const year = match ? Number(match[1]) : new Date().getFullYear()
  const clamped = Math.min(366, Math.max(1, Math.round(day)))
  const date = new Date(Date.UTC(year, 0, clamped))
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dayPart = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${dayPart}`
}

/* ------------------------------------------------------------------ */
/* Nordwinkel-Rad                                                      */
/* ------------------------------------------------------------------ */

function NorthDial({ angle, onChange }: { angle: number; onChange: (degrees: number) => void }) {
  const skin = useSkin()
  const ref = useRef<HTMLDivElement>(null)
  const size = 74
  const radius = size / 2 - 8

  const apply = (clientX: number, clientY: number) => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    /* 0 Grad zeigt nach oben (+Y), im Uhrzeigersinn positiv */
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI
    onChange(Math.round(((degrees % 360) + 360) % 360))
  }

  const radians = ((angle - 90) * Math.PI) / 180
  const tipX = size / 2 + Math.cos(radians) * radius
  const tipY = size / 2 + Math.sin(radians) * radius

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Nordrichtung"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(angle)}
      aria-valuetext={`${Math.round(angle)} Grad`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        apply(event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) apply(event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange((angle + 359) % 360)
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange((angle + 1) % 360)
      }}
      className={clsx('shrink-0 cursor-pointer touch-none rounded-full border', skin.border, skin.well, skin.ring)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.25} />
        <text x={size / 2} y={11} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
          N
        </text>
        <line
          x1={size / 2}
          y1={size / 2}
          x2={tipX}
          y2={tipY}
          stroke="#d93b3b"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={size / 2} cy={size / 2} r={2.5} fill="currentColor" fillOpacity={0.7} />
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function ShadowsPanel() {
  const skin = useSkin()
  const state = useApp()
  const sun: SunSettings = state.doc?.sun ?? DEFAULT_SUN

  const patch = (next: Partial<SunSettings>) => act((s) => s.updateSun(next))

  const selectCity = (name: string) => {
    if (name === '__manual') {
      patch({ locationName: 'Eigener Ort' })
      return
    }
    const city = findCity(name)
    if (!city) return
    patch({
      locationName: city.name,
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    })
  }

  const cityValue = findCity(sun.locationName)?.name ?? '__manual'

  return (
    <div className="flex flex-col">
      <Row label="Schatten">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Toggle checked={sun.enabled} ariaLabel="Schatten anzeigen" onChange={(checked) => patch({ enabled: checked })} />
          <span className={clsx('text-[11px]', skin.muted)}>{sun.enabled ? 'aktiv' : 'aus'}</span>
          <div className="flex-1" />
          <Sun size={15} className={sun.enabled ? 'text-accent-400' : skin.dim} aria-hidden />
        </div>
      </Row>

      <Divider />
      <GroupTitle>Zeit</GroupTitle>

      <Row label="Datum" hint={fmtDate(sun.date)}>
        <Slider
          min={1}
          max={365}
          step={1}
          value={dayOfYear(sun.date)}
          ariaLabel="Datum als Tag im Jahr"
          display={fmtDate(sun.date)}
          onChange={(value) => patch({ date: isoFromDayOfYear(sun.date, value) })}
        />
      </Row>
      <Row label="">
        <input
          type="date"
          value={sun.date}
          aria-label="Datum genau waehlen"
          onChange={(event) => event.target.value && patch({ date: event.target.value })}
          onKeyDown={(event) => event.stopPropagation()}
          className={clsx('h-7 min-w-0 flex-1 rounded border px-2 text-[12px] outline-none focus:border-accent-500', skin.input)}
        />
      </Row>
      <Row label="Uhrzeit">
        <Slider
          min={0}
          max={1439}
          step={5}
          value={sun.time}
          ariaLabel="Uhrzeit"
          display={fmtClock(sun.time)}
          onChange={(value) => patch({ time: value })}
        />
      </Row>

      <Divider />
      <GroupTitle>Ort</GroupTitle>

      <Row label="Stadt">
        <Select
          ariaLabel="Ort waehlen"
          value={cityValue}
          options={[
            ...CITY_PRESETS.map((city) => ({ value: city.name, label: `${city.name} (${city.country})` })),
            { value: '__manual', label: 'Eigener Ort ...' },
          ]}
          onChange={selectCity}
        />
      </Row>

      <div className="flex items-start gap-2 px-2 py-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className={clsx('w-[52px] shrink-0 text-[11px]', skin.muted)}>Breite</span>
            <NumberInput
              value={sun.latitude}
              min={-90}
              max={90}
              step={0.01}
              suffix="°"
              ariaLabel="Geografische Breite"
              onChange={(value) => patch({ latitude: value, locationName: 'Eigener Ort' })}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={clsx('w-[52px] shrink-0 text-[11px]', skin.muted)}>Laenge</span>
            <NumberInput
              value={sun.longitude}
              min={-180}
              max={180}
              step={0.01}
              suffix="°"
              ariaLabel="Geografische Laenge"
              onChange={(value) => patch({ longitude: value, locationName: 'Eigener Ort' })}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={clsx('w-[52px] shrink-0 text-[11px]', skin.muted)}>Zeitzone</span>
            <NumberInput
              value={sun.timezone}
              min={-12}
              max={14}
              step={0.5}
              suffix="h"
              ariaLabel="Zeitzone gegenueber UTC"
              onChange={(value) => patch({ timezone: value })}
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <NorthDial angle={sun.northAngle} onChange={(degrees) => patch({ northAngle: degrees })} />
          <span className={clsx('text-[10px] tabular-nums', skin.dim)}>Norden {Math.round(sun.northAngle)}°</span>
        </div>
      </div>

      <Divider />
      <GroupTitle>Intensitaet</GroupTitle>

      <Row label="Licht">
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={sun.light}
          ariaLabel="Helligkeit beleuchteter Flaechen"
          display={`${Math.round(sun.light * 100)} %`}
          onChange={(value) => patch({ light: value })}
        />
      </Row>
      <Row label="Dunkel">
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={sun.dark}
          ariaLabel="Helligkeit verschatteter Flaechen"
          display={`${Math.round(sun.dark * 100)} %`}
          onChange={(value) => patch({ dark: value })}
        />
      </Row>

      <div className="px-2 pb-1">
        <Checkbox checked={sun.onFaces} label="Auf Flaechen" onChange={(checked) => patch({ onFaces: checked })} />
        <Checkbox checked={sun.onGround} label="Auf dem Boden" onChange={(checked) => patch({ onGround: checked })} />
        <Checkbox checked={sun.fromEdges} label="Von Kanten" onChange={(checked) => patch({ fromEdges: checked })} />
      </div>
    </div>
  )
}
