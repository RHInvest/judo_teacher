/**
 * Dialogverwaltung.
 *
 * `DialogHost` rendert genau die Variante, die in `ui.dialog` steht. Die drei
 * rein oberflaechlichen Dialoge (Speichern unter, Kuerzel, Kurzanleitung)
 * gehoeren nicht ins Dokument und werden deshalb von `App.tsx` ueber
 * `localDialog` gesteuert.
 */

import type { DialogState } from '@/shared/store-api'
import { act, useAppSelector } from '@/ui/state/store'
import { AboutDialog } from './AboutDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportImageDialog } from './ExportImageDialog'
import { ExportModelDialog } from './ExportModelDialog'
import { ImportModelDialog } from './ImportModelDialog'
import { MakeComponentDialog } from './MakeComponentDialog'
import { ModelInfoDialog } from './ModelInfoDialog'
import { OpenFileDialog } from './OpenFileDialog'
import { PreferencesDialog } from './PreferencesDialog'
import { QuickstartDialog } from './QuickstartDialog'
import { SaveAsDialog } from './SaveAsDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { SoftenEdgesDialog } from './SoftenEdgesDialog'
import { Text3dDialog } from './Text3dDialog'

export type LocalDialog = 'saveAs' | 'shortcuts' | 'quickstart' | null

export type DialogKind = DialogState['kind']

/** Nur die Variante, die zu diesem `kind` gehoert. */
type DialogOf<K extends DialogKind> = Extract<DialogState, { kind: K }>

type DialogRenderers = {
  [K in DialogKind]: (dialog: DialogOf<K>, close: () => void) => React.ReactElement
}

/**
 * `DialogState` -> Komponente.
 *
 * Der `Record`-Typ ueber `DialogKind` ist Absicht: kommt im Contract eine
 * Dialogvariante dazu, schlaegt hier die Uebersetzung fehl, statt dass der
 * Nutzer spaeter auf einen Menuepunkt klickt und nichts passiert. Genau diese
 * Luecke entsteht sonst beim Bauen.
 */
export const DIALOG_RENDERERS: DialogRenderers = {
  modelInfo: (dialog, close) => <ModelInfoDialog tab={dialog.tab} onClose={close} />,
  preferences: (dialog, close) => <PreferencesDialog tab={dialog.tab} onClose={close} />,
  makeComponent: (dialog, close) => (
    <MakeComponentDialog defaultName={dialog.defaults?.name ?? 'Komponente'} onClose={close} />
  ),
  exportModel: (_dialog, close) => <ExportModelDialog onClose={close} />,
  importModel: (_dialog, close) => <ImportModelDialog onClose={close} />,
  exportImage: (_dialog, close) => <ExportImageDialog onClose={close} />,
  text3d: (_dialog, close) => <Text3dDialog onClose={close} />,
  softenEdges: (_dialog, close) => <SoftenEdgesDialog onClose={close} />,
  about: (_dialog, close) => <AboutDialog onClose={close} />,
  openFile: (_dialog, close) => <OpenFileDialog onClose={close} />,
  confirm: (dialog, close) => (
    <ConfirmDialog title={dialog.title} message={dialog.message} onConfirm={dialog.onConfirm} onClose={close} />
  ),
}

/** Reihenfolge nur fuer Tests und Uebersichten - nicht fuer die Darstellung. */
export const DIALOG_KINDS = Object.keys(DIALOG_RENDERERS) as DialogKind[]

export function DialogHost() {
  const dialog = useAppSelector((state) => state.ui?.dialog ?? null)
  if (!dialog) return null
  const close = () => act((s) => s.closeDialog())

  const render = DIALOG_RENDERERS[dialog.kind] as
    | ((dialog: DialogState, close: () => void) => React.ReactElement)
    | undefined
  if (!render) {
    console.warn(`[ui] Kein Dialog für "${dialog.kind}" hinterlegt.`)
    return null
  }
  return render(dialog, close)
}

/** Dieselbe Absicherung fuer die rein oberflaechlichen Dialoge. */
export const LOCAL_DIALOG_RENDERERS: Record<
  NonNullable<LocalDialog>,
  (close: () => void) => React.ReactElement
> = {
  saveAs: (close) => <SaveAsDialog onClose={close} />,
  shortcuts: (close) => <ShortcutsDialog onClose={close} />,
  quickstart: (close) => <QuickstartDialog onClose={close} />,
}

export const LOCAL_DIALOG_KINDS = Object.keys(LOCAL_DIALOG_RENDERERS) as NonNullable<LocalDialog>[]

export function LocalDialogHost({ dialog, onClose }: { dialog: LocalDialog; onClose: () => void }) {
  if (!dialog) return null
  const render = LOCAL_DIALOG_RENDERERS[dialog]
  return render ? render(onClose) : null
}

export { Dialog, DialogTabs } from './Dialog'
