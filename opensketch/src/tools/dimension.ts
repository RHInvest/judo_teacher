/**
 * Bemaßung - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class DimensionTool extends PlaceholderTool {
  constructor() {
    super('dimension' as ToolId, 'Bemaßung')
  }
}
