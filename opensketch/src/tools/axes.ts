/**
 * Achsen - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class AxesTool extends PlaceholderTool {
  constructor() {
    super('axes' as ToolId, 'Achsen')
  }
}
