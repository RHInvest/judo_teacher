/** Zuordnung PanelId -> Komponente. Ein Panel pro Datei, hier zusammengefuehrt. */

import type { PanelId } from '@/shared/store-api'
import { ComponentsPanel } from './ComponentsPanel'
import { EntityInfoPanel } from './EntityInfoPanel'
import { FogPanel } from './FogPanel'
import { InstructorPanel } from './InstructorPanel'
import { MaterialsPanel } from './MaterialsPanel'
import { ModelInfoPanel } from './ModelInfoPanel'
import { OutlinerPanel } from './OutlinerPanel'
import { ScenesPanel } from './ScenesPanel'
import { ShadowsPanel } from './ShadowsPanel'
import { SoftenEdgesPanel } from './SoftenEdgesPanel'
import { StylesPanel } from './StylesPanel'
import { TagsPanel } from './TagsPanel'

export const PANEL_COMPONENTS: Record<PanelId, React.ComponentType> = {
  entityInfo: EntityInfoPanel,
  materials: MaterialsPanel,
  components: ComponentsPanel,
  tags: TagsPanel,
  outliner: OutlinerPanel,
  styles: StylesPanel,
  scenes: ScenesPanel,
  shadows: ShadowsPanel,
  fog: FogPanel,
  softenEdges: SoftenEdgesPanel,
  instructor: InstructorPanel,
  modelInfo: ModelInfoPanel,
}
