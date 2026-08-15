/**
 * Winkelmesser - Platzhalter, wird in diesem Arbeitsschritt ersetzt.
 *
 * OWNERSHIP: Tools.
 */

import type { ToolId } from '@/shared/types'
import { PlaceholderTool } from './placeholder'

export class ProtractorTool extends PlaceholderTool {
  constructor() {
    super('protractor' as ToolId, 'Winkelmesser')
  }
}
