/** Szenen-Tabs ueber dem Viewport, dazu der Pfad des aktiven Kontexts. */

import clsx from 'clsx'
import { ChevronRight, Home, Plus, X } from 'lucide-react'
import type { Id } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { Tooltip } from '@/ui/components/Tooltip'
import { act, edit, useApp } from '@/ui/state/store'

export function SceneTabs() {
  const skin = useSkin()
  const state = useApp()

  const scenes = state.doc?.scenes ?? []
  const path = state.context?.instancePath ?? []
  const nested = path.length > 0

  if (scenes.length === 0 && !nested) return null

  return (
    <div className={clsx('flex h-7 shrink-0 items-center gap-1 border-b px-1.5', skin.chrome, skin.border)}>
      {nested ? (
        <div className="flex min-w-0 shrink-0 items-center gap-0.5">
          <Tooltip label="Zurueck zum Modell" side="bottom">
            <button
              type="button"
              aria-label="Zurueck zum Modell"
              onClick={() => act((s) => s.exitAllContexts())}
              className={clsx('flex h-5 w-5 items-center justify-center rounded', skin.iconBtn, skin.ring)}
            >
              <Home size={12} />
            </button>
          </Tooltip>
          {path.map((instanceId: Id, index) => {
            const entity = state.doc?.entities?.[instanceId]
            const definition =
              entity && entity.type === 'instance' ? state.doc?.definitions?.[entity.definitionId] : undefined
            const label = entity?.name || definition?.name || 'Gruppe'
            const last = index === path.length - 1
            return (
              <span key={instanceId} className="flex min-w-0 items-center">
                <ChevronRight size={11} className={clsx('shrink-0', skin.dim)} aria-hidden />
                <button
                  type="button"
                  onClick={() => act((s) => s.enterContext(instanceId))}
                  className={clsx(
                    'max-w-[130px] truncate rounded px-1 text-[11px]',
                    last ? clsx(skin.text, 'font-medium') : skin.muted,
                    skin.hover,
                    skin.ring,
                  )}
                >
                  {label}
                </button>
              </span>
            )
          })}
          <button
            type="button"
            aria-label="Kontext verlassen"
            onClick={() => act((s) => s.exitContext())}
            className={clsx('ml-1 flex h-5 w-5 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <X size={12} />
          </button>
          {scenes.length > 0 ? <div className={clsx('mx-1.5 h-4 w-px', skin.divider)} /> : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {scenes.map((scene, index) => (
          <button
            key={scene.id}
            type="button"
            onClick={() => act((s) => s.activateScene(scene.id))}
            title={scene.description || scene.name}
            className={clsx(
              'h-5 max-w-[160px] shrink-0 truncate rounded px-2 text-[11px] transition-colors',
              skin.muted,
              skin.hover,
              skin.ring,
            )}
          >
            {scene.name || `Szene ${index + 1}`}
          </button>
        ))}
        <Tooltip label="Szene aus aktueller Ansicht" side="bottom">
          <button
            type="button"
            aria-label="Szene hinzufuegen"
            onClick={() => edit('Szene hinzufuegen', (s) => s.addScene())}
            className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded', skin.iconBtn, skin.ring)}
          >
            <Plus size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
