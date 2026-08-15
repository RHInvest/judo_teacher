/** Szenen: gespeicherte Ansichten, Reihenfolge, gespeicherte Aspekte, Diashow. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, Film, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { Id, Scene } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, Divider, EmptyHint, GroupTitle, IconButton, NumberInput, Row, TextInput } from '@/ui/components/controls'
import { isSlideshowRunning, onSlideshowChange, startSlideshow, stopSlideshow } from '@/ui/lib/slideshow'
import { act, edit, useApp } from '@/ui/state/store'

const SAVE_FLAGS: { key: keyof Scene['saves']; label: string }[] = [
  { key: 'camera', label: 'Kamerastandpunkt' },
  { key: 'tagVisibility', label: 'Tag-Sichtbarkeit' },
  { key: 'style', label: 'Stil' },
  { key: 'shadows', label: 'Schatten' },
  { key: 'hiddenGeometry', label: 'Versteckte Geometrie' },
  { key: 'sectionPlanes', label: 'Schnittebenen' },
]

export function ScenesPanel() {
  const skin = useSkin()
  const state = useApp()
  const [selected, setSelected] = useState<Id | null>(null)
  const [running, setRunning] = useState(isSlideshowRunning())

  useEffect(() => onSlideshowChange(setRunning), [])

  const scenes: Scene[] = state.doc?.scenes ?? []
  const current = scenes.find((scene) => scene.id === selected) ?? scenes[0] ?? null

  const patch = (id: Id, next: Partial<Scene>) => edit('Szene aendern', (s) => s.updateScene(id, next))

  const move = (id: Id, delta: number) => {
    const index = scenes.findIndex((scene) => scene.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= scenes.length) return
    edit('Szene umordnen', (s) => s.reorderScene(id, target))
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 pb-1 pt-1.5">
        <IconButton
          icon={Plus}
          ariaLabel="Szene hinzufuegen"
          onClick={() =>
            edit('Szene hinzufuegen', (s) => {
              const id = s.addScene(`Szene ${scenes.length + 1}`)
              if (id) setSelected(id)
            })
          }
        />
        <IconButton
          icon={RefreshCw}
          ariaLabel="Szene aktualisieren"
          disabled={!current}
          onClick={() => current && edit('Szene aktualisieren', (s) => s.updateSceneFromView(current.id))}
        />
        <IconButton
          icon={Trash2}
          ariaLabel="Szene loeschen"
          disabled={!current}
          onClick={() => current && edit('Szene loeschen', (s) => s.removeScene(current.id))}
        />
        <div className={clsx('mx-1 h-4 w-px', skin.divider)} />
        <IconButton
          icon={ChevronUp}
          ariaLabel="Szene nach oben"
          disabled={!current}
          onClick={() => current && move(current.id, -1)}
        />
        <IconButton
          icon={ChevronDown}
          ariaLabel="Szene nach unten"
          disabled={!current}
          onClick={() => current && move(current.id, 1)}
        />
        <div className="flex-1" />
        <IconButton
          icon={running ? Pause : Play}
          active={running}
          ariaLabel={running ? 'Diashow anhalten' : 'Diashow abspielen'}
          disabled={scenes.length < 2}
          onClick={() => (running ? stopSlideshow() : startSlideshow())}
        />
      </div>

      <div className="max-h-[190px] overflow-y-auto px-1 pb-1">
        {scenes.length === 0 ? (
          <EmptyHint>
            Noch keine Szenen. Stelle eine Ansicht ein und lege sie mit dem Pluszeichen als Szene ab.
          </EmptyHint>
        ) : (
          scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={clsx(
                'group flex h-7 items-center gap-1.5 rounded px-1.5',
                current?.id === scene.id ? skin.selected : skin.hover,
              )}
              onClick={() => setSelected(scene.id)}
              onDoubleClick={() => act((s) => s.activateScene(scene.id))}
            >
              <Film size={13} className={clsx('shrink-0', skin.muted)} aria-hidden />
              <span className={clsx('w-[18px] shrink-0 text-right text-[10px] tabular-nums', skin.dim)}>{index + 1}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setSelected(scene.id)
                  act((s) => s.activateScene(scene.id))
                }}
                aria-label={`Szene ${scene.name} aktivieren`}
                className={clsx('min-w-0 flex-1 truncate text-left text-[12px]', skin.text, skin.ring)}
              >
                {scene.name || `Szene ${index + 1}`}
              </button>
              {scene.included === false ? (
                <span className={clsx('shrink-0 text-[10px]', skin.dim)}>aus</span>
              ) : null}
            </div>
          ))
        )}
      </div>

      {current ? (
        <>
          <Divider />
          <GroupTitle>Eigenschaften</GroupTitle>
          <Row label="Name">
            <TextInput
              value={current.name}
              ariaLabel="Szenenname"
              onChange={() => undefined}
              onCommit={(next) => patch(current.id, { name: next })}
            />
          </Row>
          <Row label="Beschreibung">
            <TextInput
              value={current.description ?? ''}
              ariaLabel="Szenenbeschreibung"
              onChange={() => undefined}
              onCommit={(next) => patch(current.id, { description: next })}
            />
          </Row>
          <Row label="Uebergang">
            <NumberInput
              value={current.transitionTime}
              min={0}
              max={30}
              step={0.5}
              suffix="s"
              ariaLabel="Uebergangszeit in Sekunden"
              onChange={(value) => patch(current.id, { transitionTime: value })}
            />
          </Row>
          <Row label="Standzeit">
            <NumberInput
              value={current.delayTime}
              min={0}
              max={60}
              step={0.5}
              suffix="s"
              ariaLabel="Standzeit in Sekunden"
              onChange={(value) => patch(current.id, { delayTime: value })}
            />
          </Row>

          <GroupTitle>Speichert</GroupTitle>
          <div className="px-2 pb-1">
            {SAVE_FLAGS.map((flag) => (
              <Checkbox
                key={flag.key}
                checked={Boolean(current.saves?.[flag.key])}
                label={flag.label}
                onChange={(checked) => patch(current.id, { saves: { ...current.saves, [flag.key]: checked } })}
              />
            ))}
            <Checkbox
              checked={current.included !== false}
              label="In Diashow enthalten"
              onChange={(checked) => patch(current.id, { included: checked })}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
