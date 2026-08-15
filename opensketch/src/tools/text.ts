/**
 * Text - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class TextTool extends PlaceholderTool {
  constructor() {
    super('text' as ToolId, 'Text')
  }
}
