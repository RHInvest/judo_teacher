/** Ueber OpenSketch Studio. */

import clsx from 'clsx'
import { Boxes } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { Dialog } from './Dialog'

const FEATURES = [
  'Zeichnen, Ändern und Organisieren wie in einem klassischen 3D-Skizzierer',
  'Gruppen, Komponenten, Tags, Szenen und Stile',
  'Inferenzmaschine mit Achsensperre und Maßeingabe',
  'Sonnenstand, Schatten, Nebel und Schnittebenen',
  'Import und Export über OBJ, STL, glTF, SVG und Bilddateien',
]

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  return (
    <Dialog
      title="Über OpenSketch Studio"
      width={430}
      onClose={onClose}
      actions={[{ label: 'Schließen', variant: 'primary', onClick: onClose }]}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg', skin.well)}>
          <Boxes size={26} strokeWidth={1.6} className="text-accent-400" />
        </span>
        <div className="min-w-0">
          <div className={clsx('text-[14px] font-semibold', skin.text)}>OpenSketch Studio</div>
          <div className={clsx('text-[11px]', skin.dim)}>Version 1.0 · läuft vollständig im Browser</div>
        </div>
      </div>

      <ul className="px-3 pb-2">
        {FEATURES.map((feature) => (
          <li key={feature} className={clsx('flex gap-2 py-[3px] text-[11px] leading-relaxed', skin.muted)}>
            <span className="text-accent-400">·</span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <p className={clsx('px-3 pb-2 text-[11px] leading-relaxed', skin.dim)}>
        Arbeitseinheit ist ein Meter, die blaue Achse zeigt nach oben. Alle Daten bleiben lokal im Browser.
      </p>
    </Dialog>
  )
}
