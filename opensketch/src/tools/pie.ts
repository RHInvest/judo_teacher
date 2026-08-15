/**
 * Tortenstueck: wie der Bogen, erzeugt aber eine geschlossene Flaeche.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, ToolId } from '@/shared/types'
import { ArcTool } from './arc'

export class PieTool extends ArcTool {
  readonly id: ToolId = 'pie'
  readonly name: string = 'Tortenstück'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = 'Tortenstück: Mittelpunkt wählen'

  protected onActivate(): void {
    this.closeToCenter = true
    super.onActivate()
  }
}
