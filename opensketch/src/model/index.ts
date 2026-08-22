/**
 * Oeffentliche Fassade der Modellschicht.
 *
 * `@/app/bootstrap`, `@/ui`, `@/tools`, `@/render` und `@/io` importieren
 * ausschliesslich von hier. Die acht Persistenzfunktionen unten sind ein vom
 * Lead festgelegter Contract - Namen und Signaturen bleiben stabil, egal wie
 * `./persistence.ts` intern arbeitet.
 *
 * OWNERSHIP: Model.
 */

import type { SketchDocument } from '@/shared/types'
import * as persistence from './persistence'

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export { store, useStore } from './store'

/* ------------------------------------------------------------------ */
/* Persistenz - Contract fuer bootstrap und UI                         */
/* ------------------------------------------------------------------ */

/** Speichert den Autosave-Slot in IndexedDB. */
export async function saveAutosave(doc: SketchDocument): Promise<void> {
  await persistence.saveAutosave(doc)
}

/** Laedt den Autosave-Slot. `null`, wenn keiner existiert oder IndexedDB fehlt. */
export async function loadAutosave(): Promise<SketchDocument | null> {
  try {
    return await persistence.loadAutosave()
  } catch (err) {
    console.warn('[model] Autosave konnte nicht geladen werden', err)
    return null
  }
}

/** Liste der gespeicherten Dokumente fuer den Oeffnen-Dialog, neueste zuerst. */
export async function listSavedDocuments(): Promise<{ id: string; name: string; modifiedAt: string }[]> {
  try {
    const slots = await persistence.listSlots()
    return slots.map((slot) => ({ id: slot.id, name: slot.name, modifiedAt: slot.modifiedAt }))
  } catch (err) {
    console.warn('[model] Dokumentliste konnte nicht gelesen werden', err)
    return []
  }
}

export async function loadSavedDocument(id: string): Promise<SketchDocument | null> {
  try {
    const doc = await persistence.loadSlot(id)
    if (doc) persistence.rememberRecent({ id, name: doc.meta.name, at: new Date().toISOString() })
    return doc
  } catch (err) {
    console.warn(`[model] Dokument "${id}" konnte nicht geladen werden`, err)
    return null
  }
}

/** Legt einen benannten Slot an (oder ueberschreibt den gleichnamigen). */
export async function saveNamedDocument(doc: SketchDocument): Promise<string> {
  return persistence.saveNamedSlot(doc)
}

export async function deleteSavedDocument(id: string): Promise<void> {
  await persistence.deleteSlot(id)
}

/** Loest den Datei-Download des nativen .osk-Formats aus. */
export function downloadDocument(doc: SketchDocument): void {
  persistence.saveToFile(doc)
}

/** Liest eine .osk-Datei ein. */
export async function readDocumentFile(file: File): Promise<SketchDocument> {
  return persistence.loadFromFile(file)
}

/* ------------------------------------------------------------------ */
/* Dokument                                                            */
/* ------------------------------------------------------------------ */

export {
  DEFAULT_TAG_NAME,
  DOCUMENT_VERSION,
  activeSectionPlaneOf,
  cloneCamera,
  cloneDocument,
  cloneEntity,
  cloneScene,
  createDefaultCamera,
  createDefaultFog,
  createDefaultStyle,
  createDefaultSun,
  createDefaultTag,
  createEmptyDocument,
  createSceneFromDocument,
  defaultTagId,
  definitionBounds,
  definitionContains,
  definitionPathOf,
  definitionUsage,
  documentStats,
  entityBounds,
  geometryOf,
  instanceCount,
  instancesOf,
  isDefaultTag,
  isTagVisible,
  modelBounds,
  ownerDefinitionOf,
  reachableDefinitionIds,
  syncIdCounter,
  uniqueDefinitionName,
  uniqueTagName,
  worldTransformOf,
} from './document'
export type { DocumentStats, DocumentTemplate, DefinitionUsage } from './document'

/* ------------------------------------------------------------------ */
/* Materialbibliothek                                                  */
/* ------------------------------------------------------------------ */

export { DEFAULT_MATERIAL_SPECS, MATERIAL_CATEGORIES, createDefaultMaterials, normalizeMaterial } from './materials'
export type { MaterialCategory } from './materials'

/* ------------------------------------------------------------------ */
/* Serialisierung                                                      */
/* ------------------------------------------------------------------ */

export {
  OSK_EXTENSION,
  OSK_FORMAT,
  OSK_VERSION,
  deserializeDocument,
  documentFromRaw,
  documentRepairOf,
  normalizeDocument,
  normalizeGeometry,
  repairGeometryReferences,
  serializeDocument,
} from './serialize'
export type { DocumentRepair, OskFile } from './serialize'

/* ------------------------------------------------------------------ */
/* Persistenz - erweiterte API (Slots, Autosave, Verlauf)              */
/* ------------------------------------------------------------------ */

export {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_ID,
  DB_NAME,
  STORE_NAME,
  cancelAutosave,
  clearAutosave,
  clearRecentDocuments,
  deleteSlot,
  documentBlob,
  documentFilename,
  flushAutosave,
  getRecentDocuments,
  listSlots,
  loadFromFile,
  loadSlot,
  rememberRecent,
  saveSlot,
  saveToFile,
  scheduleAutosave,
  setSlotThumbnail,
} from './persistence'
export type { DocumentSlotInfo, RecentEntry, StoredDocument } from './persistence'

/* ------------------------------------------------------------------ */
/* Historie (fuer Diagnose / Tests)                                    */
/* ------------------------------------------------------------------ */

export { HISTORY_LIMIT, touchDefinition } from './history'
export type { HistorySnapshot } from './history'
