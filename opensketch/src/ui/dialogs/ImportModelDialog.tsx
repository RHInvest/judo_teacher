/**
 * Import: Datei waehlen oder ablegen.
 *
 * Die eigentliche Arbeit macht die Integrationsschicht - die Oberflaeche
 * schickt nur `file:import` ueber den Bus.
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { FileUp, Upload } from 'lucide-react'
import { importableExtensions } from '@/io'
import { useSkin } from '@/ui/lib/theme'
import { fmtBytes } from '@/ui/lib/format'
import { pickFiles } from '@/ui/lib/hooks'
import { importFiles } from '@/ui/lib/commands'
import { Dialog } from './Dialog'

function extensions(): string[] {
  try {
    return importableExtensions() ?? []
  } catch {
    return ['.osk', '.obj', '.stl', '.gltf', '.glb', '.svg', '.png', '.jpg']
  }
}

export function ImportModelDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const accepted = useMemo(extensions, [])
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)

  const choose = async () => {
    const picked = await pickFiles(accepted.join(','), true)
    if (picked.length > 0) setFiles(picked)
  }

  const start = () => {
    importFiles(files)
    onClose()
  }

  return (
    <Dialog
      title="Importieren"
      width={460}
      onClose={onClose}
      footerNote={accepted.join(' ')}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: 'Datei waehlen ...', onClick: () => void choose() },
        { label: 'Importieren', variant: 'primary', disabled: files.length === 0, onClick: start },
      ]}
    >
      <div className="px-3 py-2">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const dropped = Array.from(event.dataTransfer.files ?? [])
            if (dropped.length > 0) setFiles(dropped)
          }}
          className={clsx(
            'flex h-28 flex-col items-center justify-center gap-1.5 rounded border border-dashed text-center transition-colors',
            dragging ? 'border-accent-500 bg-accent-500/10' : skin.border,
          )}
        >
          <Upload size={22} strokeWidth={1.5} className={skin.dim} aria-hidden />
          <span className={clsx('text-[12px]', skin.text)}>Dateien hierher ziehen</span>
          <span className={clsx('text-[10px]', skin.dim)}>oder unten eine Datei auswaehlen</span>
        </div>

        {files.length > 0 ? (
          <ul className="pt-2">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 py-[3px]">
                <FileUp size={13} className={clsx('shrink-0', skin.muted)} aria-hidden />
                <span className={clsx('min-w-0 flex-1 truncate text-[12px]', skin.text)}>{file.name}</span>
                <span className={clsx('shrink-0 text-[10px] tabular-nums', skin.dim)}>{fmtBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  )
}
