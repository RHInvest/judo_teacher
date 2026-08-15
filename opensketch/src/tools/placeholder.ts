/**
 * Platzhalterwerkzeug.
 *
 * Registriert eine `ToolId`, die noch keine eigene Umsetzung hat, damit der
 * Werkzeugmanager niemals `null` liefert und die Anwendung beim Umschalten
 * nicht stehen bleibt. Es zeichnet nichts und aendert nichts.
 *
 * OWNERSHIP: Tools.
 */

import type { Cursor, OverlayApi, ToolId } from '@/shared/types'
import { BaseTool } from './toolBase'

export class PlaceholderTool extends BaseTool {
  readonly id: ToolId
  readonly name: string
  readonly cursor: Cursor = 'not-allowed'
  readonly hint: string

  constructor(id: ToolId, name: string) {
    super()
    this.id = id
    this.name = name
    this.hint = `${name}: noch nicht verfügbar`
  }

  protected onActivate(): void {
    this.clearVcb()
    this.status(this.hint, 'Leertaste = zurück zur Auswahl')
  }

  draw(_overlay: OverlayApi): void {}
}
