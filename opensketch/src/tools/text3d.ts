/**
 * 3D-Text.
 *
 * Der Dialog (`src/ui/dialogs/Text3dDialog.tsx`) sammelt Text, Hoehe, Tiefe
 * und Schnitt und schickt sie als `text3d:create` ueber den Bus; dieses
 * Werkzeug baut daraus echte Geometrie und laesst den Nutzer sie platzieren.
 *
 * REIHENFOLGE: Der Dialog sendet das Ereignis, BEVOR er auf dieses Werkzeug
 * umschaltet. Ein Abonnement in `activate()` kaeme also zu spaet. Deshalb
 * haelt dieses Modul ein Abonnement auf Dateiebene, das den letzten Auftrag
 * aufbewahrt; das Werkzeug holt ihn beim Aktivieren ab.
 *
 * Die Buchstaben kommen aus dem eingebauten Strichzeichensatz
 * (`text3dFont.ts`): je Strich ein geschlossenes Rechteck, bei Tiefe > 0 zu
 * einem Quader hochgezogen. Das Ergebnis wird als GRUPPE eingefuegt - ein
 * Schriftzug ist ein Objekt, kein Haufen loser Flaechen.
 *
 * OWNERSHIP: Tools.
 */

import type { AppState } from '@/shared/store-api'
import type {
  Cursor,
  Definition,
  Geometry,
  OverlayApi,
  PlaneLike,
  PointerInfo,
  ToolId,
  Vec3Like,
} from '@/shared/types'
import { emptyGeometry } from '@/shared/types'
import { newId } from '@/shared/ids'
import { bus } from '@/shared/events'
import type { AppEvents } from '@/shared/events'
import { mapText3d, unsupportedText3dChars } from '@/shared/text3d'
import { formatLength } from '@/shared/units'
import { addFacePolygon, addPolyline } from '@/core'
import { M, P, V } from '@/core/math'
import { BaseTool } from './toolBase'
import { COLORS } from './colors'
import { layoutText3d } from './text3dFont'
import { parseLengthInput } from './vcbInput'
import type { Text3dLayout } from './text3dFont'

export interface Text3dRequest {
  text: string
  height: number
  extrude: number
  bold: boolean
  italic: boolean
  filled: boolean
  align: 'left' | 'center' | 'right'
}

/* ------------------------------------------------------------------ */
/* Auftragsannahme auf Dateiebene                                      */
/* ------------------------------------------------------------------ */

let pending: Text3dRequest | null = null

function normalizeRequest(payload: AppEvents['text3d:create']): Text3dRequest {
  const height = Number.isFinite(payload.height) && payload.height > 0 ? payload.height : 0.5
  const extrude = Number.isFinite(payload.extrude) && payload.extrude > 0 ? payload.extrude : 0
  return {
    text: typeof payload.text === 'string' ? payload.text : '',
    height,
    extrude,
    bold: payload.bold === true,
    italic: payload.italic === true,
    filled: payload.filled !== false,
    align: payload.align ?? 'left',
  }
}

bus.on('text3d:create', (payload) => {
  pending = normalizeRequest(payload)
})

/** Holt den zuletzt gemeldeten Auftrag ab (und leert die Ablage). */
export function takePendingText3d(): Text3dRequest | null {
  const request = pending
  pending = null
  return request
}

/* ------------------------------------------------------------------ */
/* Werkzeug                                                            */
/* ------------------------------------------------------------------ */

export class Text3dTool extends BaseTool {
  readonly id: ToolId = 'text3d'
  readonly name: string = '3D-Text'
  readonly cursor: Cursor = 'crosshair'
  readonly hint: string = '3D-Text: Einfügepunkt wählen'

  private request: Text3dRequest | null = null
  private layout: Text3dLayout | null = null
  private origin: Vec3Like | null = null
  private plane: PlaneLike | null = null
  private unsubscribe: (() => void) | null = null

  protected onActivate(): void {
    this.reset()
    // Sicherheitsnetz: nie zwei Abos auf denselben Auftrag.
    this.onDeactivate()
    this.take(takePendingText3d())
    // Wird der Dialog bei laufendem Werkzeug erneut benutzt, kommt der
    // Auftrag direkt hier an - die Ablage bleibt dann leer.
    this.unsubscribe = bus.on('text3d:create', (payload) => {
      takePendingText3d()
      this.take(normalizeRequest(payload))
      this.requestRender()
    })
    if (!this.request) {
      // Ohne Auftrag ist das Werkzeug nutzlos - also gleich den Dialog oeffnen,
      // statt den Nutzer auf einen Cursor starren zu lassen, der nichts tut.
      this.read((state) => state.openDialog({ kind: 'text3d' }))
      this.status('3D-Text: Text im Dialog eingeben')
    }
  }

  protected onDeactivate(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  /* ---------------- Zeiger ---------------- */

  onPointerMove(e: PointerInfo): void {
    this.pointer = e
    const inf = this.infer(e, { from: null })
    this.origin = V.clone(inf.point)
    this.plane = inf.plane ?? this.workPlane(this.origin)
  }

  onPointerUp(e: PointerInfo): void {
    this.pointer = e
    if (e.button !== 0) return
    const inf = this.infer(e, { from: null })
    this.origin = V.clone(inf.point)
    this.plane = inf.plane ?? this.workPlane(this.origin)
    this.commit()
  }

  /* ---------------- Massfeld ---------------- */

  /**
   * Die Versalhoehe laesst sich vor dem Absetzen noch aendern - dafuer muss
   * niemand zurueck in den Dialog. Der Satz wird sofort neu gerechnet, die
   * Vorschau zeigt die neue Groesse.
   */
  onValueEntry(text: string): boolean {
    const request = this.request
    if (!request) return false
    const height = parseLengthInput(text, this.units())
    if (height === null || !Number.isFinite(height) || height <= 0) {
      this.notify(`3D-Text: „${text.trim()}" ist keine Höhe - z. B. „0,5 m" oder „50 cm"`, 'warn')
      return false
    }
    this.take({ ...request, height })
    this.requestRender()
    return true
  }

  cancel(): void {
    this.reset()
    this.status(this.hint)
  }

  /* ---------------- Zeichnen ---------------- */

  draw(overlay: OverlayApi): void {
    try {
      const frame = this.frame()
      const layout = this.layout
      if (frame && layout) {
        for (const rect of layout.rects) {
          const points = rect.map((p) => frame.toWorld(p.x, p.y, 0))
          overlay.polyline(points, true, { color: COLORS.preview, width: 1.5, onTop: true })
          if (this.request?.filled) {
            overlay.polygonFill(points, { color: COLORS.previewFill, opacity: 0.25 })
          }
        }
      }
    } catch (err) {
      console.warn('[tools] 3D-Text: Vorschau fehlgeschlagen', err)
    }
    this.drawInference(overlay)
  }

  /* ---------------- Intern ---------------- */

  private take(request: Text3dRequest | null): void {
    if (!request) return
    this.request = request
    this.layout = layoutText3d(request.text, {
      height: request.height,
      bold: request.bold,
      italic: request.italic,
      align: request.align,
    })
    const missing = unsupportedText3dChars(request.text)
    if (missing.length > 0) {
      this.notify(`3D-Text: ohne Entsprechung im Zeichensatz und ausgelassen: ${missing.join(' ')}`, 'warn')
    }
    this.vcb('Höhe', formatLength(request.height, this.units(), { suffix: false }), 'Versalhöhe')
    this.status(this.hint, `„${mapText3d(request.text)}"`)
  }

  /** Achsenkreuz der Textebene am Einfuegepunkt. */
  private frame(): { origin: Vec3Like; u: Vec3Like; v: Vec3Like; n: Vec3Like; toWorld: (x: number, y: number, z: number) => Vec3Like } | null {
    const origin = this.origin
    if (!origin) return null
    const plane = this.plane ?? this.workPlane(origin)
    const { u, v } = P.basis(plane)
    const n = V.normalizeOr(plane.n, V.AXIS_Z)
    return {
      origin,
      u,
      v,
      n,
      toWorld: (x, y, z) =>
        V.add(origin, V.add(V.add(V.mul(u, x), V.mul(v, y)), V.mul(n, z))),
    }
  }

  private commit(): void {
    const request = this.request
    const layout = this.layout
    const frame = this.frame()
    if (!request || !layout || !frame) {
      this.abortDegenerate('3D-Text: kein Text vorbereitet - bitte den Dialog benutzen')
      this.read((state) => state.openDialog({ kind: 'text3d' }))
      return
    }
    if (layout.rects.length === 0) {
      const missing = unsupportedText3dChars(request.text)
      this.reset()
      this.abortDegenerate(
        missing.length > 0
          ? `3D-Text: keines der Zeichen ist darstellbar (${missing.join(' ')}) - es entsteht keine Geometrie`
          : '3D-Text: kein darstellbares Zeichen im Text - es entsteht keine Geometrie',
      )
      return
    }

    const geometry = buildTextGeometry(layout, request)
    if (Object.keys(geometry.faces).length === 0 && Object.keys(geometry.edges).length === 0) {
      this.reset()
      this.abortDegenerate('3D-Text: aus diesen Werten lässt sich keine Geometrie bilden')
      return
    }

    const label = mapText3d(request.text).trim()
    const definition: Definition = {
      id: newId('d'),
      name: label.length > 24 ? `3D-Text ${label.slice(0, 24)}…` : `3D-Text ${label}`,
      kind: 'group',
      geometry,
      children: [],
      instanceCount: 1,
    }
    const transform = M.fromBasis(frame.origin, frame.u, frame.v, frame.n)
    const placed = this.modify('3D-Text einfügen', (state: AppState) => {
      state.upsertDefinition(definition)
      return state.placeInstance(definition.id, transform, { name: definition.name })
    })
    if (!placed) {
      this.abortDegenerate('3D-Text: konnte nicht eingefügt werden')
      return
    }
    this.notify(`3D-Text „${label}" eingefügt`, 'success')
    this.reset()
    this.finishTool()
  }

  private reset(): void {
    this.request = null
    this.layout = null
    this.origin = null
    this.plane = null
    this.clearVcb()
  }
}

/* ------------------------------------------------------------------ */
/* Geometrie                                                           */
/* ------------------------------------------------------------------ */

/**
 * Baut die Buchstaben in einer EIGENEN Geometrie (spaeter die Gruppe).
 *
 * Bewusst nicht ueber `store.addFace`: die Rechtecke ueberlappen sich an den
 * Strichkreuzungen, und im aktiven Kontext wuerde jede Ueberlappung mit der
 * vorhandenen Zeichnung verschmelzen. In einer eigenen Definition bleibt der
 * Schriftzug ein abgeschlossenes Objekt.
 *
 * Lokales System: x nach rechts, y nach oben, z in Extrusionsrichtung.
 */
export function buildTextGeometry(layout: Text3dLayout, request: Text3dRequest): Geometry {
  const geometry = emptyGeometry()
  const depth = request.extrude > 0 ? request.extrude : 0

  for (const rect of layout.rects) {
    const bottom = rect.map((p) => ({ x: p.x, y: p.y, z: 0 }))
    if (!request.filled) {
      /*
       * Nur Umrisse: der Ring unten, bei Tiefe zusaetzlich oben und die vier
       * senkrechten Kanten. `autoFace: false` ist hier zwingend - der Kern
       * schliesst jede ebene Kantenschleife sonst automatisch zu einer
       * Flaeche, und genau die soll hier nicht entstehen.
       */
      addPolyline(geometry, bottom, true, { autoFace: false })
      if (depth > 0) {
        const top = rect.map((p) => ({ x: p.x, y: p.y, z: depth }))
        addPolyline(geometry, top, true, { autoFace: false })
        for (let i = 0; i < bottom.length; i++) {
          addPolyline(geometry, [bottom[i], top[i]], false, { autoFace: false })
        }
      }
      continue
    }
    if (depth <= 0) {
      addFacePolygon(geometry, bottom)
      continue
    }
    const top = rect.map((p) => ({ x: p.x, y: p.y, z: depth }))
    // Boden mit umgekehrtem Umlaufsinn, damit seine Normale nach unten zeigt.
    addFacePolygon(geometry, [...bottom].reverse())
    addFacePolygon(geometry, top)
    for (let i = 0; i < bottom.length; i++) {
      const j = (i + 1) % bottom.length
      addFacePolygon(geometry, [bottom[i], bottom[j], top[j], top[i]])
    }
  }
  return geometry
}
