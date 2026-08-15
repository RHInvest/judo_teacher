/**
 * Dialogverwaltung.
 *
 * `DialogHost` rendert genau die Variante, die in `ui.dialog` steht. Die drei
 * rein oberflaechlichen Dialoge (Speichern unter, Kuerzel, Kurzanleitung)
 * gehoeren nicht ins Dokument und werden deshalb von `App.tsx` ueber
 * `localDialog` gesteuert.
 */

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

export function DialogHost() {
  const dialog = useAppSelector((state) => state.ui?.dialog ?? null)
  if (!dialog) return null
  const close = () => act((s) => s.closeDialog())

  switch (dialog.kind) {
    case 'modelInfo':
      return <ModelInfoDialog tab={dialog.tab} onClose={close} />
    case 'preferences':
      return <PreferencesDialog tab={dialog.tab} onClose={close} />
    case 'makeComponent':
      return <MakeComponentDialog defaultName={dialog.defaults?.name ?? 'Komponente'} onClose={close} />
    case 'exportModel':
      return <ExportModelDialog onClose={close} />
    case 'importModel':
      return <ImportModelDialog onClose={close} />
    case 'exportImage':
      return <ExportImageDialog onClose={close} />
    case 'text3d':
      return <Text3dDialog onClose={close} />
    case 'softenEdges':
      return <SoftenEdgesDialog onClose={close} />
    case 'about':
      return <AboutDialog onClose={close} />
    case 'openFile':
      return <OpenFileDialog onClose={close} />
    case 'confirm':
      return (
        <ConfirmDialog title={dialog.title} message={dialog.message} onConfirm={dialog.onConfirm} onClose={close} />
      )
    default:
      return null
  }
}

export function LocalDialogHost({ dialog, onClose }: { dialog: LocalDialog; onClose: () => void }) {
  switch (dialog) {
    case 'saveAs':
      return <SaveAsDialog onClose={onClose} />
    case 'shortcuts':
      return <ShortcutsDialog onClose={onClose} />
    case 'quickstart':
      return <QuickstartDialog onClose={onClose} />
    default:
      return null
  }
}

export { Dialog, DialogTabs } from './Dialog'
