/** Nebel: Tiefenverblassung zwischen Nah- und Ferngrenze. */

import clsx from 'clsx'
import type { FogSettings } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { fmtLength, useUnits } from '@/ui/lib/format'
import { Checkbox, ColorField, Divider, GroupTitle, Row, Slider, Toggle } from '@/ui/components/controls'
import { act, useApp } from '@/ui/state/store'
import { DEFAULT_FOG, DEFAULT_STYLE } from '@/ui/state/fallback'

export function FogPanel() {
  const skin = useSkin()
  const state = useApp()
  const units = useUnits()

  const doc = state.doc
  const fog: FogSettings = doc?.fog ?? DEFAULT_FOG
  const style = doc?.styles?.[doc?.activeStyleId ?? ''] ?? DEFAULT_STYLE

  const patch = (next: Partial<FogSettings>) => act((s) => s.updateFog(next))

  /* Der Regler arbeitet in Metern; die Obergrenze waechst mit der Ferngrenze mit. */
  const maxDistance = Math.max(200, Math.ceil(fog.far * 1.5))
  const effectiveColor = fog.useBackgroundColor ? style.backgroundColor : fog.color

  return (
    <div className="flex flex-col">
      <Row label="Nebel">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Toggle checked={fog.enabled} ariaLabel="Nebel anzeigen" onChange={(checked) => patch({ enabled: checked })} />
          <span className={clsx('text-[11px]', skin.muted)}>{fog.enabled ? 'aktiv' : 'aus'}</span>
        </div>
      </Row>

      <Divider />
      <GroupTitle>Abstand</GroupTitle>

      <Row label="Beginn" hint="Ab hier setzt der Nebel ein">
        <Slider
          min={0}
          max={maxDistance}
          step={0.5}
          value={fog.near}
          ariaLabel="Beginn des Nebels"
          display={fmtLength(fog.near, units)}
          onChange={(value) => patch({ near: Math.min(value, fog.far - 0.5) })}
        />
      </Row>
      <Row label="Ende" hint="Ab hier ist alles vollständig verdeckt">
        <Slider
          min={1}
          max={maxDistance}
          step={0.5}
          value={fog.far}
          ariaLabel="Ende des Nebels"
          display={fmtLength(fog.far, units)}
          onChange={(value) => patch({ far: Math.max(value, fog.near + 0.5) })}
        />
      </Row>

      <Divider />
      <GroupTitle>Farbe</GroupTitle>

      <div className="px-2">
        <Checkbox
          checked={fog.useBackgroundColor}
          label="Hintergrundfarbe verwenden"
          onChange={(checked) => patch({ useBackgroundColor: checked })}
        />
      </div>
      <Row label="Nebelfarbe">
        <ColorField
          value={fog.color}
          ariaLabel="Nebelfarbe"
          disabled={fog.useBackgroundColor}
          onChange={(hex) => patch({ color: hex })}
        />
      </Row>

      <div className="px-2 pb-1.5 pt-1">
        <div
          className={clsx('h-6 w-full rounded border', skin.border)}
          aria-label="Vorschau des Nebelverlaufs"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${effectiveColor} 100%)` }}
        />
        <div className={clsx('pt-1 text-[10px]', skin.dim)}>
          {fmtLength(fog.near, units)} bis {fmtLength(fog.far, units)}
          {fog.useBackgroundColor ? ' · folgt der Hintergrundfarbe' : ''}
        </div>
      </div>
    </div>
  )
}
