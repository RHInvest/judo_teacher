/** Willkommensbildschirm: Vorlage waehlen oder zuletzt geoeffnetes Modell laden. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Boxes, Clock, FileText, FolderOpen, Ruler } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { fmtTimestamp } from '@/ui/lib/format'
import { cmdListSaved, cmdNew, cmdOpenFromDisk, cmdOpenSaved, readRecent } from '@/ui/lib/commands'
import { Dialog } from '@/ui/dialogs/Dialog'

const TEMPLATES: { id: 'metric' | 'imperial' | 'empty'; title: string; hint: string; icon: typeof Ruler }[] = [
  { id: 'metric', title: 'Metrisch', hint: 'Millimeter, Meter als Arbeitseinheit', icon: Ruler },
  { id: 'imperial', title: 'Architektonisch', hint: 'Fuß und Zoll, Bruchdarstellung', icon: Ruler },
  { id: 'empty', title: 'Leer', hint: 'Ohne Materialien und Vorgaben', icon: Boxes },
]

export function Welcome({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const [saved, setSaved] = useState<{ id: string; name: string; modifiedAt: string }[]>([])
  const recent = readRecent()

  useEffect(() => {
    void cmdListSaved().then(setSaved)
  }, [])

  const recentIds = new Set(recent.map((entry) => entry.id))
  const list = [
    ...recent.map((entry) => ({ id: entry.id, name: entry.name, at: new Date(entry.openedAt).toISOString() })),
    ...saved.filter((entry) => !recentIds.has(entry.id)).map((entry) => ({ id: entry.id, name: entry.name, at: entry.modifiedAt })),
  ].slice(0, 8)

  return (
    <Dialog
      title="Willkommen bei OpenSketch Studio"
      width={640}
      onClose={onClose}
      actions={[
        {
          label: 'Datei öffnen ...',
          onClick: () => {
            void cmdOpenFromDisk().then(onClose)
          },
        },
        {
          label: 'Loslegen',
          variant: 'primary',
          onClick: () => {
            cmdNew('metric')
            onClose()
          },
        },
      ]}
      footerNote="Alle Modelle bleiben lokal im Browser."
    >
      <div className="flex gap-3 px-3 py-2">
        <section className="min-w-0 flex-1">
          <h3 className={clsx('pb-1.5 text-[10px] font-semibold uppercase tracking-wide', skin.dim)}>Neues Modell</h3>
          <div className="flex flex-col gap-1">
            {TEMPLATES.map((template) => {
              const Icon = template.icon
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    cmdNew(template.id)
                    onClose()
                  }}
                  className={clsx(
                    'flex items-center gap-2 rounded border px-2 py-2 text-left transition-colors',
                    skin.border,
                    skin.hover,
                    skin.ring,
                  )}
                >
                  <Icon size={16} className={clsx('shrink-0', skin.muted)} aria-hidden />
                  <span className="min-w-0">
                    <span className={clsx('block truncate text-[12px] font-medium', skin.text)}>{template.title}</span>
                    <span className={clsx('block truncate text-[10px]', skin.dim)}>{template.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="min-w-0 flex-1">
          <h3 className={clsx('flex items-center gap-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wide', skin.dim)}>
            <Clock size={11} aria-hidden />
            Zuletzt geöffnet
          </h3>
          {list.length === 0 ? (
            <div className={clsx('rounded border border-dashed px-3 py-6 text-center text-[11px] leading-relaxed', skin.border, skin.dim)}>
              Noch keine Modelle vorhanden. Wähle links eine Vorlage oder öffne eine .osk-Datei.
            </div>
          ) : (
            <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
              {list.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    void cmdOpenSaved(entry.id).then((ok) => {
                      if (ok) onClose()
                    })
                  }}
                  className={clsx('flex items-center gap-2 rounded px-2 py-1.5 text-left', skin.hover, skin.ring)}
                >
                  <FileText size={13} className={clsx('shrink-0', skin.muted)} aria-hidden />
                  <span className={clsx('min-w-0 flex-1 truncate text-[12px]', skin.text)}>{entry.name || 'Unbenannt'}</span>
                  <span className={clsx('shrink-0 text-[10px] tabular-nums', skin.dim)}>{fmtTimestamp(entry.at)}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              void cmdOpenFromDisk().then(onClose)
            }}
            className={clsx('mt-1 flex w-full items-center justify-center gap-1.5 rounded border border-dashed px-2 py-1.5 text-[11px]', skin.border, skin.muted, skin.hover, skin.ring)}
          >
            <FolderOpen size={13} />
            Datei vom Rechner öffnen
          </button>
        </section>
      </div>
    </Dialog>
  )
}
