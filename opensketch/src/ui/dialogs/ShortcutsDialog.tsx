/** Kuerzeluebersicht ueber Werkzeuge und Befehle. */

import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { allToolShortcuts, MENU_SHORTCUTS } from '@/ui/lib/shortcuts'
import { Dialog } from './Dialog'

const COMMAND_LABELS: Record<keyof typeof MENU_SHORTCUTS, string> = {
  newDocument: 'Neues Modell',
  open: 'Oeffnen',
  save: 'Speichern',
  saveAs: 'Speichern unter',
  importFile: 'Importieren',
  exportModel: 'Exportieren',
  undo: 'Rueckgaengig',
  redo: 'Wiederholen',
  cut: 'Ausschneiden',
  copy: 'Kopieren',
  paste: 'Einfuegen',
  pasteInPlace: 'An Ort einfuegen',
  delete: 'Loeschen',
  selectAll: 'Alles auswaehlen',
  deselect: 'Abwaehlen',
  group: 'Gruppe erstellen',
  makeComponent: 'Komponente erstellen',
  explode: 'Aufloesen',
  hide: 'Verstecken',
  unhide: 'Alles einblenden',
  lock: 'Sperren',
  unlock: 'Entsperren',
  zoomExtents: 'Alles einpassen',
  zoomSelection: 'Auswahl einpassen',
  toggleProjection: 'Projektion umschalten',
  shortcutHelp: 'Diese Uebersicht',
  toggleTray: 'Tray umschalten',
}

const NAVIGATION: { combo: string; label: string }[] = [
  { combo: 'Mittlere Maustaste', label: 'Orbit aus jedem Werkzeug heraus' },
  { combo: 'Mittlere Maustaste + Umschalt', label: 'Schwenken' },
  { combo: 'Mausrad', label: 'Zoomen auf den Zeiger' },
  { combo: 'Esc', label: 'Laufende Operation abbrechen' },
  { combo: 'Pfeiltasten', label: 'Auf rote, gruene oder blaue Achse sperren' },
  { combo: 'Ziffern tippen', label: 'Springt direkt ins Massfeld' },
]

function Table({ title, rows }: { title: string; rows: { combo: string; label: string }[] }) {
  const skin = useSkin()
  return (
    <section className="min-w-0 flex-1">
      <h3 className={clsx('px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide', skin.dim)}>{title}</h3>
      <dl className="px-3 pb-1">
        {rows.map((row) => (
          <div key={`${title}-${row.combo}-${row.label}`} className="flex items-baseline justify-between gap-3 py-[2px]">
            <dt className={clsx('min-w-0 truncate text-[11px]', skin.muted)}>{row.label}</dt>
            <dd className={clsx('shrink-0 font-mono text-[11px]', skin.text)}>{row.combo}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const tools = allToolShortcuts().map((entry) => ({ combo: entry.combo, label: entry.name }))
  const commands = (Object.keys(MENU_SHORTCUTS) as (keyof typeof MENU_SHORTCUTS)[]).map((id) => ({
    combo: MENU_SHORTCUTS[id],
    label: COMMAND_LABELS[id],
  }))

  return (
    <Dialog
      title="Tastaturkuerzel"
      width={720}
      onClose={onClose}
      actions={[{ label: 'Schliessen', variant: 'primary', onClick: onClose }]}
    >
      <div className="flex flex-wrap gap-2">
        <Table title="Werkzeuge" rows={tools} />
        <div className="min-w-0 flex-1">
          <Table title="Befehle" rows={commands} />
          <Table title="Navigation" rows={NAVIGATION} />
        </div>
      </div>
    </Dialog>
  )
}
