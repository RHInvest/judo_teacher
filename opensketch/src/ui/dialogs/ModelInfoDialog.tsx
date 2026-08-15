/** Modellinfo als Dialog: Einheiten, Statistik, Datei. */

import { useState } from 'react'
import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { GroupTitle } from '@/ui/components/controls'
import { MetaEditor, StatsTable, UnitsEditor } from '@/ui/components/modelInfo'
import { act, edit, toast } from '@/ui/state/store'
import { Dialog, DialogTabs } from './Dialog'

type Tab = 'units' | 'stats' | 'file'

const TABS: { id: Tab; label: string }[] = [
  { id: 'units', label: 'Einheiten' },
  { id: 'stats', label: 'Statistik' },
  { id: 'file', label: 'Datei' },
]

export function ModelInfoDialog({ tab, onClose }: { tab: string; onClose: () => void }) {
  const skin = useSkin()
  const [active, setActive] = useState<Tab>(TABS.some((entry) => entry.id === tab) ? (tab as Tab) : 'units')

  return (
    <Dialog
      title="Modellinfo"
      width={560}
      onClose={onClose}
      actions={[{ label: 'Schliessen', variant: 'primary', onClick: onClose }]}
    >
      <DialogTabs tabs={TABS} active={active} onChange={setActive}>
        {active === 'units' ? (
          <>
            <GroupTitle>Anzeige und Fang</GroupTitle>
            <UnitsEditor />
            <p className={clsx('px-2 pb-2 pt-1 text-[11px] leading-relaxed', skin.dim)}>
              Intern rechnet OpenSketch immer in Metern. Die Einheiten wirken nur auf Anzeige und Eingabe.
            </p>
          </>
        ) : null}

        {active === 'stats' ? (
          <>
            <GroupTitle>Modellinhalt</GroupTitle>
            <StatsTable />
          </>
        ) : null}

        {active === 'file' ? (
          <>
            <GroupTitle>Dokument</GroupTitle>
            <MetaEditor />
            <div className="flex flex-wrap gap-1 px-2 pb-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  edit('Unbenutztes entfernen', (s) => {
                    const purged = s.purgeUnused()
                    if (purged) toast(`${purged.definitions} Definitionen und ${purged.materials} Materialien entfernt.`, 'success')
                  })
                }
                className={clsx('h-7 rounded border px-2.5 text-[12px]', skin.button, skin.ring)}
              >
                Unbenutztes entfernen
              </button>
              <button
                type="button"
                onClick={() => act((s) => s.clearHistory())}
                className={clsx('h-7 rounded border px-2.5 text-[12px]', skin.button, skin.ring)}
              >
                Verlauf leeren
              </button>
            </div>
          </>
        ) : null}
      </DialogTabs>
    </Dialog>
  )
}
