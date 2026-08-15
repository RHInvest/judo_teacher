/**
 * Drücken/Ziehen - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class PushPullTool extends PlaceholderTool {
  constructor() {
    super('pushpull' as ToolId, 'Drücken/Ziehen')
  }
}
