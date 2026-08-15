/**
 * Folge mir - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class FollowMeTool extends PlaceholderTool {
  constructor() {
    super('followme' as ToolId, 'Folge mir')
  }
}
