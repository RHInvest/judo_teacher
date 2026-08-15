/**
 * Radiergummi - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class EraserTool extends PlaceholderTool {
  constructor() {
    super('eraser' as ToolId, 'Radiergummi')
  }
}
