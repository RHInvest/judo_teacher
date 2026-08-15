/**
 * Material - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class PaintTool extends PlaceholderTool {
  constructor() {
    super('paint' as ToolId, 'Material')
  }
}
