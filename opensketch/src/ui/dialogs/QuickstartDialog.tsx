/** Kurzanleitung: der schnellste Weg vom leeren Modell zum Haus. */

import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { Dialog } from './Dialog'

const STEPS: { title: string; body: string }[] = [
  {
    title: '1 · Grundriss zeichnen',
    body: 'Rechteck (R) waehlen, zwei Ecken klicken. Direkt danach "8;5" ins Massfeld tippen und Eingabe druecken - das Rechteck bekommt exakt diese Masse in Metern.',
  },
  {
    title: '2 · Waende hochziehen',
    body: 'Druecken/Ziehen (P) waehlen, auf die Flaeche klicken, nach oben ziehen, "2,8" tippen und bestaetigen.',
  },
  {
    title: '3 · Oeffnungen setzen',
    body: 'Auf einer Wandflaeche ein Rechteck zeichnen und mit Druecken/Ziehen nach innen schieben, bis es durchbricht.',
  },
  {
    title: '4 · Ordnung halten',
    body: 'Alles auswaehlen und mit Strg+G gruppieren. Gruppen verschmelzen nicht mit fremder Geometrie. Doppelklick betritt eine Gruppe, Esc verlaesst sie.',
  },
  {
    title: '5 · Ansicht steuern',
    body: 'Mittlere Maustaste dreht die Ansicht, mit Umschalt schwenkt sie, das Mausrad zoomt. Strg+Umschalt+F passt alles ins Bild.',
  },
  {
    title: '6 · Material und Schatten',
    body: 'Im Materialbrowser eine Farbe waehlen - die Oberflaeche wechselt automatisch zum Farbeimer. Das Schatten-Panel setzt Ort, Datum und Uhrzeit.',
  },
]

const TIPS = [
  'Zahlen tippen springt immer ins Massfeld - erst zeichnen, dann das Mass eingeben.',
  'Die Pfeiltasten sperren auf die rote, gruene oder blaue Achse.',
  'Esc bricht die laufende Operation ab, ohne das Werkzeug zu wechseln.',
  'Der Instructor im Tray zeigt jederzeit die Schritte des aktiven Werkzeugs.',
]

export function QuickstartDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  return (
    <Dialog
      title="Kurzanleitung"
      width={620}
      onClose={onClose}
      actions={[{ label: 'Los gehts', variant: 'primary', onClick: onClose }]}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2">
        {STEPS.map((step) => (
          <section key={step.title} className={clsx('rounded border p-2', skin.border)}>
            <h3 className={clsx('pb-1 text-[12px] font-medium', skin.text)}>{step.title}</h3>
            <p className={clsx('text-[11px] leading-relaxed', skin.muted)}>{step.body}</p>
          </section>
        ))}
      </div>

      <h3 className={clsx('px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide', skin.dim)}>Merkhilfen</h3>
      <ul className="px-3 pb-2">
        {TIPS.map((tip) => (
          <li key={tip} className={clsx('flex gap-2 py-[3px] text-[11px] leading-relaxed', skin.muted)}>
            <span className="text-accent-400">·</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
