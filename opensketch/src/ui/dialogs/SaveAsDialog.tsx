/** Speichern unter: Name vergeben und Ziel waehlen. */

import { useState } from 'react'
import clsx from 'clsx'
import { Download, HardDrive } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { Row, TextInput } from '@/ui/components/controls'
import { cmdSave, cmdSaveAs } from '@/ui/lib/commands'
import { act, read } from '@/ui/state/store'
import { Dialog } from './Dialog'

export function SaveAsDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const [name, setName] = useState(() => read((s) => s.doc?.meta?.name ?? 'Unbenannt', 'Unbenannt'))
  const [target, setTarget] = useState<'file' | 'browser'>('file')

  const save = () => {
    const trimmed = name.trim() || 'Unbenannt'
    if (target === 'file') {
      cmdSaveAs(trimmed)
    } else {
      act((s) => s.setDocumentName(trimmed))
      void cmdSave()
    }
    onClose()
  }

  const options: { value: 'file' | 'browser'; label: string; hint: string; icon: typeof Download }[] = [
    { value: 'file', label: 'Als Datei herunterladen', hint: 'Natives .osk-Format', icon: Download },
    { value: 'browser', label: 'Im Browser speichern', hint: 'IndexedDB dieses Rechners', icon: HardDrive },
  ]

  return (
    <Dialog
      title="Speichern unter"
      width={430}
      onClose={onClose}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: 'Speichern', variant: 'primary', onClick: save, disabled: name.trim() === '' },
      ]}
    >
      <Row label="Name">
        <TextInput value={name} onChange={setName} ariaLabel="Modellname" autoFocus />
      </Row>

      <div className="flex flex-col gap-1 px-2 pb-1 pt-1">
        {options.map((option) => {
          const Icon = option.icon
          const selected = target === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setTarget(option.value)}
              className={clsx(
                'flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors',
                selected ? 'border-accent-500 bg-accent-500/10' : clsx(skin.border, skin.hover),
                skin.ring,
              )}
            >
              <Icon size={15} className={clsx('shrink-0', selected ? 'text-accent-400' : skin.muted)} aria-hidden />
              <span className="min-w-0">
                <span className={clsx('block truncate text-[12px]', skin.text)}>{option.label}</span>
                <span className={clsx('block truncate text-[10px]', skin.dim)}>{option.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
