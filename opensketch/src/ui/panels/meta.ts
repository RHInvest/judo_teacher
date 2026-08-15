/** Beschreibung aller Panels - Titel und Symbol, ohne die Komponenten selbst. */

import {
  CloudFog,
  Component,
  GraduationCap,
  Info,
  ListTree,
  Palette,
  Film,
  Sun,
  SwatchBook,
  Tags,
  Waves,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PanelId } from '@/shared/store-api'

export interface PanelMeta {
  id: PanelId
  title: string
  icon: LucideIcon
  /** Kurzbeschreibung fuer Tooltips im eingeklappten Tray */
  description: string
}

export const PANEL_META: Record<PanelId, PanelMeta> = {
  entityInfo: { id: 'entityInfo', title: 'Entitaetsinfo', icon: Info, description: 'Masse und Eigenschaften der Auswahl' },
  materials: { id: 'materials', title: 'Materialien', icon: Palette, description: 'Farben, Texturen und Bibliothek' },
  components: { id: 'components', title: 'Komponenten', icon: Component, description: 'Bibliothek und Definitionen im Modell' },
  tags: { id: 'tags', title: 'Tags', icon: Tags, description: 'Ebenen, Sichtbarkeit und Ordner' },
  outliner: { id: 'outliner', title: 'Outliner', icon: ListTree, description: 'Baum aller Gruppen und Komponenten' },
  styles: { id: 'styles', title: 'Stile', icon: SwatchBook, description: 'Flaechen, Kanten, Hintergrund' },
  scenes: { id: 'scenes', title: 'Szenen', icon: Film, description: 'Gespeicherte Ansichten und Diashow' },
  shadows: { id: 'shadows', title: 'Schatten', icon: Sun, description: 'Sonnenstand, Datum, Uhrzeit, Ort' },
  fog: { id: 'fog', title: 'Nebel', icon: CloudFog, description: 'Tiefenverblassung der Ansicht' },
  softenEdges: { id: 'softenEdges', title: 'Kanten weichzeichnen', icon: Waves, description: 'Glaettungswinkel der Auswahl' },
  instructor: { id: 'instructor', title: 'Instructor', icon: GraduationCap, description: 'Hilfe zum aktiven Werkzeug' },
  modelInfo: { id: 'modelInfo', title: 'Modellinfo', icon: Info, description: 'Statistik und Metadaten' },
}

export const PANEL_ORDER: PanelId[] = [
  'entityInfo',
  'materials',
  'components',
  'tags',
  'outliner',
  'styles',
  'scenes',
  'shadows',
  'fog',
  'softenEdges',
  'instructor',
  'modelInfo',
]
