/**
 * Skalieren - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class ScaleTool extends PlaceholderTool {
  constructor() {
    super('scale' as ToolId, 'Skalieren')
  }
}
