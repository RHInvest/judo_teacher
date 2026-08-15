/**
 * Schnittebene - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class SectionPlaneTool extends PlaceholderTool {
  constructor() {
    super('sectionPlane' as ToolId, 'Schnittebene')
  }
}
