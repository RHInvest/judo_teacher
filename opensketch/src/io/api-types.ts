/**
 * Gemeinsame Typen der IO-Schicht.
 *
 * Eigene Datei, damit Exporter und Importer sie benutzen koennen, ohne einen
 * Ringschluss mit `@/io/index.ts` zu erzeugen. `index.ts` re-exportiert alles
 * von hier - der Contract bleibt also unveraendert.
 */

import type { Definition, Entity, Id, Material, Vec3Like } from '@/shared/types'

export type ExportFormat = 'osk' | 'obj' | 'stl' | 'stl-ascii' | 'gltf' | 'glb' | 'dae' | 'svg' | 'png'
export type ImportFormat = 'osk' | 'obj' | 'stl' | 'gltf' | 'glb' | 'svg' | 'image'

/** Projektionsrichtung des SVG-Exports. */
export type ExportView = 'top' | 'front' | 'right' | 'iso' | 'current'

export interface ExportOptions {
  /** nur die aktuelle Auswahl exportieren */
  selectionOnly?: boolean
  /** Einheit der Zieldatei (Standard: Meter) */
  unitScale?: number
  /** Kanten mitexportieren (OBJ/SVG) */
  includeEdges?: boolean
  /** Texturen einbetten */
  embedTextures?: boolean
  /** Dreiecke statt N-Gons */
  triangulate?: boolean
  /** Projektion fuer SVG-Export */
  view?: ExportView
  /** Ids der zu exportierenden Instanzen, wenn `selectionOnly` gesetzt ist */
  selectedEntityIds?: Id[]
  /** PNG: das vom Viewport gerenderte Bild */
  image?: Blob | null
  /** SVG: Kantenstaerke in Millimetern der Zeichnung */
  strokeWidth?: number
  /** SVG: Blickrichtung fuer `view: 'current'` (Kamera -> Modell) */
  cameraDirection?: Vec3Like
  /** glTF/DAE: Knotenhierarchie erhalten (Standard: true) */
  keepHierarchy?: boolean
  /** Dateiname ohne Endung; Standard ist der Dokumentname */
  filename?: string
}

export interface ImportResult {
  /** neue Definitionen, die in das Dokument uebernommen werden */
  definitions: Definition[]
  /** Wurzeldefinition des Imports (wird als Instanz platziert) */
  rootDefinitionId: Id
  materials: Material[]
  textures: { id: Id; name: string; dataUrl: string; width: number; height: number }[]
  warnings: string[]
  /**
   * Instanzen, die die Verschachtelung zwischen den Definitionen herstellen
   * (`Definition.children` verweist auf Entity-Ids, nicht auf Definitionen).
   * Der Store uebernimmt sie unveraendert in `doc.entities`. Formate ohne
   * Hierarchie lassen die Liste leer.
   */
  entities: Entity[]
}

export interface ImportOptions {
  /** Faktor von der Quelleinheit auf Meter */
  unitScale?: number
  /** Name des Imports (Standard: Dateiname) */
  name?: string
  /**
   * Beidateien, die der Aufrufer mitgeladen hat - Schluessel ist der in der
   * Hauptdatei referenzierte Name (`mtllib`, `map_Kd`, glTF-`uri`).
   */
  companions?: Record<string, Uint8Array>
}

export interface ExportResult {
  blob: Blob
  filename: string
  /**
   * Beidateien, die zusammen mit `blob` gespeichert werden sollten -
   * z.B. die `.mtl` eines OBJ-Exports oder dessen Texturen. Formate mit
   * eigenem Container (GLB, DAE, SVG) lassen das Feld leer.
   */
  files?: { blob: Blob; filename: string }[]
}
