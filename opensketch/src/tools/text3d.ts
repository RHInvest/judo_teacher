/**
 * 3D-Text - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class Text3dTool extends PlaceholderTool {
  constructor() {
    super('text3d' as ToolId, '3D-Text')
  }
}
