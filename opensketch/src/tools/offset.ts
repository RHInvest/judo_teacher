/**
 * Versatz - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class OffsetTool extends PlaceholderTool {
  constructor() {
    super('offset' as ToolId, 'Versatz')
  }
}
