/**
 * Bausteine rund um Modellinfo und Einheiten.
 * Werden vom Panel "Modellinfo" und vom gleichnamigen Dialog gemeinsam genutzt.
 */

import clsx from 'clsx'
import type { AreaUnit, LengthUnit, UnitSettings, VolumeUnit } from '@/shared/types'
import { documentStats } from '@/model'
import { useSkin } from '@/ui/lib/theme'
import { fmtCount, fmtLength, fmtTimestamp, useUnits } from '@/ui/lib/format'
import { Checkbox, GroupTitle, NumberInput, Row, Select, TextInput } from './controls'
import { act, read, useApp } from '@/ui/state/store'

/* ------------------------------------------------------------------ */
/* Einheiten                                                           */
/* ------------------------------------------------------------------ */

const FORMATS: { value: UnitSettings['format']; label: string }[] = [
  { value: 'decimal', label: 'Dezimal' },
  { value: 'architectural', label: 'Architektonisch' },
  { value: 'engineering', label: 'Technisch' },
  { value: 'fractional', label: 'Bruch' },
]

const LENGTH_UNITS: { value: LengthUnit; label: string }[] = [
  { value: 'm', label: 'Meter' },
  { value: 'cm', label: 'Zentimeter' },
  { value: 'mm', label: 'Millimeter' },
  { value: 'in', label: 'Zoll' },
  { value: 'ft', label: 'Fuß' },
  { value: 'ftin', label: 'Fuß und Zoll' },
  { value: 'yd', label: 'Yard' },
]

const AREA_UNITS: { value: AreaUnit; label: string }[] = [
  { value: 'm2', label: 'm²' },
  { value: 'cm2', label: 'cm²' },
  { value: 'mm2', label: 'mm²' },
  { value: 'ft2', label: 'ft²' },
  { value: 'in2', label: 'in²' },
]

const VOLUME_UNITS: { value: VolumeUnit; label: string }[] = [
  { value: 'm3', label: 'm³' },
  { value: 'cm3', label: 'cm³' },
  { value: 'l', label: 'Liter' },
  { value: 'ft3', label: 'ft³' },
]

const DENOMINATORS: { value: string; label: string }[] = [2, 4, 8, 16, 32, 64].map((value) => ({
  value: String(value),
  label: `1/${value}`,
}))

export function UnitsEditor() {
  const units = useUnits()
  const patch = (next: Partial<UnitSettings>) => act((s) => s.setUnits(next))

  return (
    <div className="flex flex-col">
      <Row label="Format">
        <Select ariaLabel="Zahlenformat" value={units.format} options={FORMATS} onChange={(value) => patch({ format: value })} />
      </Row>
      <Row label="Länge">
        <Select
          ariaLabel="Längeneinheit"
          value={units.lengthUnit}
          options={LENGTH_UNITS}
          onChange={(value) => patch({ lengthUnit: value })}
        />
      </Row>
      <Row label="Fläche">
        <Select
          ariaLabel="Flächeneinheit"
          value={units.areaUnit}
          options={AREA_UNITS}
          onChange={(value) => patch({ areaUnit: value })}
        />
      </Row>
      <Row label="Volumen">
        <Select
          ariaLabel="Volumeneinheit"
          value={units.volumeUnit}
          options={VOLUME_UNITS}
          onChange={(value) => patch({ volumeUnit: value })}
        />
      </Row>
      <Row label="Winkel">
        <Select
          ariaLabel="Winkeleinheit"
          value={units.angleUnit}
          options={[
            { value: 'deg', label: 'Grad' },
            { value: 'rad', label: 'Radiant' },
          ]}
          onChange={(value) => patch({ angleUnit: value })}
        />
      </Row>
      <Row label="Genauigkeit">
        <NumberInput
          value={units.precision}
          min={0}
          max={6}
          step={1}
          ariaLabel="Nachkommastellen"
          onChange={(value) => patch({ precision: Math.round(value) })}
        />
      </Row>
      <Row label="Bruchnenner">
        <Select
          ariaLabel="Kleinster Bruchnenner"
          value={String(units.fractionDenominator)}
          options={DENOMINATORS}
          onChange={(value) => patch({ fractionDenominator: Number(value) as UnitSettings['fractionDenominator'] })}
        />
      </Row>

      <GroupTitle>Fang</GroupTitle>
      <div className="px-2">
        <Checkbox
          checked={units.displayUnitSuffix}
          label="Einheit anzeigen"
          onChange={(checked) => patch({ displayUnitSuffix: checked })}
        />
        <Checkbox
          checked={units.enableLengthSnap}
          label="Längenfang"
          onChange={(checked) => patch({ enableLengthSnap: checked })}
        />
        <Checkbox
          checked={units.enableAngleSnap}
          label="Winkelfang"
          onChange={(checked) => patch({ enableAngleSnap: checked })}
        />
      </div>
      <Row label="Längenschritt">
        <NumberInput
          value={units.lengthSnap}
          min={0}
          step={0.001}
          suffix="m"
          ariaLabel="Längenfang in Metern"
          disabled={!units.enableLengthSnap}
          onChange={(value) => patch({ lengthSnap: value })}
        />
      </Row>
      <Row label="Winkelschritt">
        <NumberInput
          value={units.angleSnap}
          min={0}
          max={90}
          step={1}
          suffix="°"
          ariaLabel="Winkelfang in Grad"
          disabled={!units.enableAngleSnap}
          onChange={(value) => patch({ angleSnap: value })}
        />
      </Row>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Statistik                                                           */
/* ------------------------------------------------------------------ */

export function StatsTable() {
  const skin = useSkin()
  const state = useApp()
  const units = useUnits()
  const doc = state.doc

  const stats = (() => {
    try {
      return doc ? documentStats(doc) : null
    } catch {
      return null
    }
  })()

  const bounds = read((s) => s.getModelBounds(), null)
  const size = bounds
    ? {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
      }
    : null

  const rows: { label: string; value: string }[] = [
    { label: 'Kanten', value: fmtCount(stats?.edges ?? 0) },
    { label: 'Flächen', value: fmtCount(stats?.faces ?? 0) },
    { label: 'Punkte', value: fmtCount(stats?.vertices ?? 0) },
    { label: 'Instanzen', value: fmtCount(stats?.instances ?? 0) },
    { label: 'Gruppen', value: fmtCount(stats?.groups ?? 0) },
    { label: 'Komponenten', value: fmtCount(stats?.components ?? 0) },
    { label: 'Definitionen', value: fmtCount(stats?.definitions ?? 0) },
    { label: 'Materialien', value: fmtCount(Object.keys(doc?.materials ?? {}).length) },
    { label: 'Texturen', value: fmtCount(Object.keys(doc?.textures ?? {}).length) },
    { label: 'Tags', value: fmtCount(Object.keys(doc?.tags ?? {}).length) },
    { label: 'Szenen', value: fmtCount(doc?.scenes?.length ?? 0) },
  ]

  if (size) {
    rows.push({
      label: 'Abmessungen',
      value: `${fmtLength(size.x, units)} × ${fmtLength(size.y, units)} × ${fmtLength(size.z, units)}`,
    })
  }

  return (
    <dl className="px-2 pb-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-2 py-[2px]">
          <dt className={clsx('truncate text-[11px]', skin.muted)}>{row.label}</dt>
          <dd className={clsx('shrink-0 text-[12px] tabular-nums', skin.text)}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------ */
/* Metadaten                                                           */
/* ------------------------------------------------------------------ */

export function MetaEditor() {
  const skin = useSkin()
  const state = useApp()
  const meta = state.doc?.meta

  return (
    <div className="flex flex-col">
      <Row label="Name">
        <TextInput
          value={meta?.name ?? ''}
          ariaLabel="Modellname"
          onChange={() => undefined}
          onCommit={(next) => act((s) => s.setDocumentName(next))}
        />
      </Row>
      <Row label="Erstellt">
        <span className={clsx('truncate text-[11px] tabular-nums', skin.muted)}>
          {meta?.createdAt ? fmtTimestamp(meta.createdAt) : '-'}
        </span>
      </Row>
      <Row label="Geändert">
        <span className={clsx('truncate text-[11px] tabular-nums', skin.muted)}>
          {meta?.modifiedAt ? fmtTimestamp(meta.modifiedAt) : '-'}
        </span>
      </Row>
      <Row label="Version">
        <span className={clsx('text-[11px] tabular-nums', skin.muted)}>{meta?.version ?? 1}</span>
      </Row>
    </div>
  )
}
