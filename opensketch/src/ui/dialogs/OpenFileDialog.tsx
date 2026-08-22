/** Gespeicherte Modelle aus dem Browserspeicher oeffnen. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { FileText, HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { fmtTimestamp } from '@/ui/lib/format'
import { Button, EmptyHint, IconButton, TextInput } from '@/ui/components/controls'
import { cmdDeleteSaved, cmdListSaved, cmdOpenFromDisk, cmdOpenSaved } from '@/ui/lib/commands'
import { Dialog } from './Dialog'

interface SavedEntry {
  id: string
  name: string
  modifiedAt: string
}

export function OpenFileDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const [entries, setEntries] = useState<SavedEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    void cmdListSaved().then((list) => {
      setEntries(list)
      setLoading(false)
    })
  }

  useEffect(refresh, [])

  const query = search.trim().toLowerCase()
  const visible = entries.filter((entry) => query === '' || entry.name.toLowerCase().includes(query))

  const open = (id: string) => {
    void cmdOpenSaved(id).then((ok) => {
      if (ok) onClose()
    })
  }

  return (
    <Dialog
      title="Modell öffnen"
      width={520}
      onClose={onClose}
      footerNote={`${entries.length} gespeicherte${entries.length === 1 ? 's Modell' : ' Modelle'}`}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        {
          label: 'Aus Datei ...',
          onClick: () => {
            void cmdOpenFromDisk().then(onClose)
          },
        },
        { label: 'Öffnen', variant: 'primary', disabled: !selected, onClick: () => selected && open(selected) },
      ]}
    >
      <div className="flex items-center gap-1 px-2 pb-1">
        <div className="min-w-0 flex-1">
          <TextInput value={search} onChange={setSearch} ariaLabel="Modelle durchsuchen" placeholder="Suchen ..." />
        </div>
        <IconButton icon={RefreshCw} ariaLabel="Liste aktualisieren" onClick={refresh} />
      </div>

      <div className="max-h-[320px] overflow-y-auto px-1">
        {loading ? (
          <EmptyHint>Liste wird geladen ...</EmptyHint>
        ) : visible.length === 0 ? (
          <EmptyHint>
            {entries.length === 0
              ? 'Im Browserspeicher liegt noch kein Modell. Speichere zuerst eines oder öffne eine .osk-Datei.'
              : 'Kein Modell passt zur Suche.'}
          </EmptyHint>
        ) : (
          visible.map((entry) => (
            <div
              key={entry.id}
              onClick={() => setSelected(entry.id)}
              onDoubleClick={() => open(entry.id)}
              className={clsx(
                'group flex h-8 cursor-default items-center gap-2 rounded px-2',
                selected === entry.id ? skin.selected : skin.hover,
              )}
            >
              <FileText size={14} className={clsx('shrink-0', skin.muted)} aria-hidden />
              <span className={clsx('min-w-0 flex-1 truncate text-[12px]', skin.text)}>{entry.name || 'Unbenannt'}</span>
              <span className={clsx('shrink-0 text-[10px] tabular-nums', skin.dim)}>{fmtTimestamp(entry.modifiedAt)}</span>
              <IconButton
                icon={Trash2}
                size={13}
                ariaLabel={`${entry.name} löschen`}
                className="opacity-0 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  void cmdDeleteSaved(entry.id).then(refresh)
                }}
              />
            </div>
          ))
        )}
      </div>

      <div className={clsx('flex items-center gap-1.5 px-3 pt-2 text-[11px]', skin.dim)}>
        <HardDrive size={12} aria-hidden />
        Modelle liegen in der IndexedDB dieses Browsers.
      </div>
    </Dialog>
  )
}
