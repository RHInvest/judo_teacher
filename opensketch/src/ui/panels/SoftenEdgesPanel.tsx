/**
 * Kanten weichzeichnen.
 *
 * Der Winkelregler arbeitet mit Live-Vorschau: waehrend des Ziehens laufen alle
 * Zwischenschritte in EINER Undo-Operation (Klammer aus `beginOperation` /
 * `commitOperation`), damit im Verlauf am Ende genau ein Eintrag steht.
 */

import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Waves } from 'lucide-react'
import { useSkin } from '@/ui/lib/theme'
import { Button, Checkbox, Divider, EmptyHint, GroupTitle, Row, Slider } from '@/ui/components/controls'
import { act, appState, edit, useApp } from '@/ui/state/store'

const OPERATION_NAME = 'Kanten weichzeichnen'

export function SoftenEdgesPanel() {
  const skin = useSkin()
  const state = useApp()
  const [angle, setAngle] = useState(20)
  const [softenCoplanar, setSoftenCoplanar] = useState(true)
  const [livePreview, setLivePreview] = useState(true)
  const bracketOpen = useRef(false)

  const edgeIds = state.selection?.edgeIds ?? []
  const hasEdges = edgeIds.length > 0

  const applyAngle = (next: number, inBracket: boolean) => {
    if (!hasEdges) return
    const ids = [...edgeIds]
    if (inBracket) {
      act((s) => s.softenEdges(ids, next, { softenCoplanar }))
    } else {
      edit(OPERATION_NAME, (s) => s.softenEdges(ids, next, { softenCoplanar }))
    }
  }

  const openBracket = () => {
    if (bracketOpen.current || !hasEdges || !livePreview) return
    bracketOpen.current = true
    try {
      appState().beginOperation(OPERATION_NAME)
    } catch (err) {
      bracketOpen.current = false
      console.warn('[ui] Operation konnte nicht geöffnet werden', err)
    }
  }

  const closeBracket = () => {
    if (!bracketOpen.current) return
    bracketOpen.current = false
    try {
      appState().commitOperation()
    } catch (err) {
      console.warn('[ui] Operation konnte nicht abgeschlossen werden', err)
    }
  }

  return (
    <div className="flex flex-col">
      {!hasEdges ? (
        <EmptyHint>
          Wähle Kanten aus (oder eine ganze Gruppe), um die Glättung einzustellen. Weiche Kanten werden nicht
          gezeichnet, geglättete Kanten mitteln die Schattierung der Nachbarflächen.
        </EmptyHint>
      ) : null}

      <GroupTitle>Winkel zwischen Normalen</GroupTitle>
      <div onPointerDown={openBracket} onPointerUp={closeBracket} onPointerCancel={closeBracket}>
        <Row label="Grenzwinkel">
          <Slider
            min={0}
            max={180}
            step={1}
            value={angle}
            disabled={!hasEdges}
            ariaLabel="Grenzwinkel für das Weichzeichnen"
            display={`${angle}°`}
            onChange={(value) => {
              setAngle(value)
              if (livePreview) applyAngle(value, bracketOpen.current)
            }}
          />
        </Row>
      </div>

      <div className="px-2">
        <Checkbox
          checked={softenCoplanar}
          label="Koplanare Kanten mit weichzeichnen"
          onChange={setSoftenCoplanar}
          disabled={!hasEdges}
        />
        <Checkbox checked={livePreview} label="Live-Vorschau" onChange={setLivePreview} />
      </div>

      <Divider />

      <div className="flex flex-wrap gap-1 px-2 pb-1">
        <Button variant="primary" disabled={!hasEdges} onClick={() => applyAngle(angle, false)}>
          <Waves size={13} />
          Anwenden
        </Button>
        <Button
          disabled={!hasEdges}
          onClick={() => {
            const ids = [...edgeIds]
            edit('Glättung zurücksetzen', (s) => s.setEdgeFlags(ids, { soft: false, smooth: false }))
          }}
        >
          Zurücksetzen
        </Button>
      </div>

      <div className={clsx('px-2 pb-1 text-[10px]', skin.dim)}>
        {hasEdges ? `${edgeIds.length} Kante${edgeIds.length === 1 ? '' : 'n'} ausgewählt` : 'Keine Kanten ausgewählt'}
      </div>
    </div>
  )
}
