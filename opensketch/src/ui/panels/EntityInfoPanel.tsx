/** Entitaetsinfo: Kennwerte der Auswahl plus die gemeinsam editierbaren Attribute. */

import { useState } from 'react'
import clsx from 'clsx'
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import type { Id } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { Button, Checkbox, Divider, EmptyHint, GroupTitle, Row, Select, Slider, TextInput } from '@/ui/components/controls'
import { Swatch } from '@/ui/components/Swatch'
import { act, edit, read, useApp } from '@/ui/state/store'

export function EntityInfoPanel() {
  const skin = useSkin()
  const state = useApp()
  const info = read((s) => s.getEntityInfo(), null)
  const [softenAngle, setSoftenAngle] = useState(20)

  const doc = state.doc
  const selection = state.selection
  const tags = Object.values(doc?.tags ?? {})
  const materials = Object.values(doc?.materials ?? {})
  const entityIds = selection?.entityIds ?? []
  const edgeIds = selection?.edgeIds ?? []
  const faceIds = selection?.faceIds ?? []

  if (!info) {
    return <EmptyHint>Keine Auswahl. Wähle Kanten, Flächen, Gruppen oder Komponenten aus, um ihre Kennwerte zu sehen.</EmptyHint>
  }

  const setTag = (tagId: Id | null) => {
    if (entityIds.length === 0) return
    edit('Tag zuweisen', (s) => s.setEntityTag(entityIds, tagId))
  }

  const setMaterial = (materialId: Id | null) => {
    edit('Material zuweisen', (s) => s.applyMaterial(selection, materialId, 'front'))
  }

  return (
    <div className="flex flex-col">
      <div className={clsx('flex items-baseline gap-2 px-2 pb-1 pt-2')}>
        <span className={clsx('text-[13px] font-medium', skin.text)}>{info.kind || 'Auswahl'}</span>
        <span className={clsx('text-[11px]', skin.dim)}>{info.count} Element{info.count === 1 ? '' : 'e'}</span>
      </div>

      {info.name !== undefined ? (
        <Row label="Name">
          <TextInput
            value={info.name ?? ''}
            ariaLabel="Name der Auswahl"
            onChange={() => undefined}
            onCommit={(next) => {
              const id = entityIds[0]
              if (!id) return
              edit('Umbenennen', (s) => s.setEntityName(id, next))
            }}
          />
        </Row>
      ) : null}

      {info.rows.length > 0 ? (
        <>
          <GroupTitle>Kennwerte</GroupTitle>
          <dl className="px-2 pb-1">
            {info.rows.map((row, index) => (
              <div key={`${row.label}-${index}`} className="flex items-baseline justify-between gap-2 py-[2px]">
                <dt className={clsx('truncate text-[11px]', skin.muted)}>{row.label}</dt>
                <dd className={clsx('shrink-0 text-[12px] tabular-nums', skin.text)}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <Divider />
      <GroupTitle>Zuordnung</GroupTitle>

      <Row label="Tag">
        <Select
          ariaLabel="Tag der Auswahl"
          value={info.tagId ?? ''}
          options={[{ value: '', label: 'Ohne Tag' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          onChange={(value) => setTag(value === '' ? null : value)}
        />
      </Row>

      <Row label="Material">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Swatch material={null} size={22} selected={!info.materialId} onClick={() => setMaterial(null)} label="Standardmaterial" />
          {materials.slice(0, 14).map((material) => (
            <Swatch
              key={material.id}
              material={material}
              texture={doc?.textures?.[material.textureId ?? '']}
              size={22}
              selected={info.materialId === material.id}
              onClick={() => setMaterial(material.id)}
            />
          ))}
          {materials.length === 0 ? <span className={clsx('text-[11px]', skin.dim)}>Noch keine Materialien im Modell</span> : null}
        </div>
      </Row>

      <Divider />
      <GroupTitle>Status</GroupTitle>

      <div className="flex flex-wrap gap-1 px-2 pb-1">
        <Button
          variant={info.hidden ? 'primary' : 'secondary'}
          disabled={entityIds.length === 0}
          onClick={() => edit(info.hidden ? 'Einblenden' : 'Verstecken', (s) => s.setEntityHidden(entityIds, !info.hidden))}
        >
          {info.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          {info.hidden ? 'Versteckt' : 'Sichtbar'}
        </Button>
        <Button
          variant={info.locked ? 'primary' : 'secondary'}
          disabled={entityIds.length === 0}
          onClick={() => edit(info.locked ? 'Entsperren' : 'Sperren', (s) => s.setEntityLocked(entityIds, !info.locked))}
        >
          {info.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          {info.locked ? 'Gesperrt' : 'Frei'}
        </Button>
      </div>

      {edgeIds.length > 0 || info.softEdges !== undefined ? (
        <>
          <Divider />
          <GroupTitle>Kanten</GroupTitle>
          <div className="px-2">
            <Checkbox
              checked={Boolean(info.softEdges)}
              label="Weich (unsichtbar)"
              onChange={(checked) => edit('Kanten weich', (s) => s.setEdgeFlags(edgeIds, { soft: checked }))}
            />
            <Checkbox
              checked={Boolean(info.smoothEdges)}
              label="Geglättet (Schattierung)"
              onChange={(checked) => edit('Kanten glätten', (s) => s.setEdgeFlags(edgeIds, { smooth: checked }))}
            />
          </div>
          <Row label="Winkel">
            <Slider
              min={0}
              max={180}
              step={1}
              value={softenAngle}
              ariaLabel="Glättungswinkel"
              display={`${softenAngle}°`}
              onChange={setSoftenAngle}
            />
          </Row>
          <div className="px-2 pb-1">
            <Button
              disabled={edgeIds.length === 0}
              onClick={() => edit('Kanten weichzeichnen', (s) => s.softenEdges(edgeIds, softenAngle, { softenCoplanar: true }))}
            >
              Weichzeichnen anwenden
            </Button>
          </div>
        </>
      ) : null}

      {faceIds.length > 0 ? (
        <>
          <Divider />
          <div className="flex flex-wrap gap-1 px-2 pb-1">
            <Button onClick={() => edit('Flächen umkehren', (s) => s.reverseFaces(faceIds))}>Flächen umkehren</Button>
            <Button onClick={() => edit('Flächen ausrichten', (s) => s.orientFaces(faceIds[0]))}>Ausrichten</Button>
          </div>
        </>
      ) : null}

      <div className="px-2 pb-1 pt-1">
        <Button variant="ghost" onClick={() => act((s) => s.clearSelection())}>
          Auswahl aufheben
        </Button>
      </div>
    </div>
  )
}
