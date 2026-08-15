/**
 * Oeffentliche Fassade der Modellschicht.
 *
 * STUB - wird vom Model-Entwickler ersetzt. Die hier exportierten Namen sind
 * Contract: `@/app/bootstrap` und die UI importieren ausschliesslich von hier.
 */

import type { SketchDocument } from '@/shared/types'

export { store, useStore } from './store'

/** Speichert den Autosave-Slot in IndexedDB. */
export async function saveAutosave(doc: SketchDocument): Promise<void> {
  throw new Error('model/persistence ist noch nicht implementiert')
}

/** Laedt den Autosave-Slot, null wenn keiner existiert. */
export async function loadAutosave(): Promise<SketchDocument | null> {
  return null
}

/** Liste der gespeicherten Dokumente fuer den Oeffnen-Dialog. */
export async function listSavedDocuments(): Promise<{ id: string; name: string; modifiedAt: string }[]> {
  return []
}

export async function loadSavedDocument(id: string): Promise<SketchDocument | null> {
  return null
}

export async function saveNamedDocument(doc: SketchDocument): Promise<string> {
  throw new Error('model/persistence ist noch nicht implementiert')
}

export async function deleteSavedDocument(id: string): Promise<void> {
  throw new Error('model/persistence ist noch nicht implementiert')
}

/** Loest den Datei-Download des nativen .osk-Formats aus. */
export function downloadDocument(doc: SketchDocument): void {
  throw new Error('model/persistence ist noch nicht implementiert')
}

/** Liest eine .osk-Datei ein. */
export async function readDocumentFile(file: File): Promise<SketchDocument> {
  throw new Error('model/persistence ist noch nicht implementiert')
}
