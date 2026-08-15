/**
 * Drehen - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class RotateTool extends PlaceholderTool {
  constructor() {
    super('rotate' as ToolId, 'Drehen')
  }
}
