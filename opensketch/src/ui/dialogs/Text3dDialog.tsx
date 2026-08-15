/**
 * 3D-Text einfuegen.
 *
 * ANNAHME (an den Lead gemeldet): es gibt bislang keinen Contract, ueber den die
 * Oberflaeche einen Textinhalt an das Werkzeug `text3d` uebergeben koennte
 * (weder ein Bus-Ereignis noch eine Store-Aktion). Damit der Dialog trotzdem
 * etwas Echtes tut, legt er eine Text-Entitaet im Weltraum an - platziert im
 * Kamerafokus - und aktiviert anschliessend das Werkzeug, sobald es echte
 * extrudierte Geometrie erzeugt.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { newId } from '@/shared/ids'
import type { TextEntity, Vec3Like } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'
import { ColorField, NumberInput, Row, TextInput } from '@/ui/components/controls'
import { getViewportSafe, setTool } from '@/ui/lib/commands'
import { edit, read, toast } from '@/ui/state/store'
import { Dialog } from './Dialog'

function placementPoint(): Vec3Like {
  const camera = getViewportSafe()?.getCamera()
  if (camera?.target) return { x: camera.target.x, y: camera.target.y, z: camera.target.z }
  const bounds = read((s) => s.getModelBounds(), null)
  if (bounds) {
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    }
  }
  return { x: 0, y: 0, z: 0 }
}

export function Text3dDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const [text, setText] = useState('OpenSketch')
  const [height, setHeight] = useState(0.5)
  const [color, setColor] = useState('#dfe4ec')

  const insert = () => {
    const content = text.trim()
    if (content === '') return
    const position = placementPoint()
    const entity: TextEntity = {
      id: newId('n'),
      type: 'text',
      name: content.slice(0, 32),
      tagId: null,
      hidden: false,
      locked: false,
      anchor: position,
      position,
      text: content,
      fontSize: height,
      color,
      screenSpace: false,
      leader: 'none',
    }
    edit('3D-Text einfuegen', (s) => s.addEntity(entity))
    toast('Text im Kamerafokus abgelegt - mit Verschieben positionieren.', 'success')
    setTool('text3d')
    onClose()
  }

  return (
    <Dialog
      title="3D-Text"
      width={430}
      onClose={onClose}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: 'Einfuegen', variant: 'primary', onClick: insert, disabled: text.trim() === '' },
      ]}
    >
      <Row label="Text">
        <TextInput value={text} onChange={setText} ariaLabel="Textinhalt" autoFocus />
      </Row>
      <Row label="Hoehe">
        <NumberInput
          value={height}
          min={0.01}
          step={0.05}
          suffix="m"
          ariaLabel="Schrifthoehe in Metern"
          onChange={setHeight}
        />
      </Row>
      <Row label="Farbe">
        <ColorField value={color} ariaLabel="Textfarbe" onChange={setColor} />
      </Row>
      <p className={clsx('px-3 pb-2 pt-1 text-[11px] leading-relaxed', skin.dim)}>
        Der Text wird im Kamerafokus abgelegt. Extrudierte Buchstabengeometrie liefert das Werkzeug, sobald es
        fertiggestellt ist.
      </p>
    </Dialog>
  )
}
