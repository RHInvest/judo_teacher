/** Modellinfo: Statistik, Metadaten, Einheiten und Aufraeumen. */

import clsx from 'clsx'
import { Info, Trash2 } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { Button, Divider, GroupTitle } from '@/ui/components/controls'
import { MetaEditor, StatsTable, UnitsEditor } from '@/ui/components/modelInfo'
import { act, edit, toast, useApp } from '@/ui/state/store'

export function ModelInfoPanel() {
  const skin = useSkin()
  const state = useApp()

  return (
    <div className="flex flex-col">
      <GroupTitle>Dokument</GroupTitle>
      <MetaEditor />

      <Divider />
      <GroupTitle>Statistik</GroupTitle>
      <StatsTable />

      <Divider />
      <GroupTitle>Einheiten</GroupTitle>
      <UnitsEditor />

      <Divider />
      <div className="flex flex-wrap gap-1 px-2 pb-1">
        <Button
          onClick={() =>
            edit('Unbenutztes entfernen', (s) => {
              const purged = s.purgeUnused()
              if (purged) {
                toast(
                  `Entfernt: ${purged.definitions} Definitionen, ${purged.materials} Materialien, ${purged.tags} Tags, ${purged.textures} Texturen.`,
                  'success',
                )
              }
            })
          }
        >
          <Trash2 size={13} />
          Unbenutztes entfernen
        </Button>
        <Button variant="ghost" onClick={() => act((s) => s.openDialog({ kind: 'modelInfo', tab: 'units' }))}>
          <Info size={13} />
          Als Dialog öffnen
        </Button>
      </div>

      <div className={clsx('px-2 pb-1 text-[10px]', skin.dim)}>
        {state.dirty ? 'Ungespeicherte Änderungen' : 'Alle Änderungen gespeichert'}
      </div>
    </div>
  )
}
