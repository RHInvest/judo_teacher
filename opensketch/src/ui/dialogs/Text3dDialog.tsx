/**
 * 3D-Text einfuegen.
 *
 * Der Dialog sammelt nur die Parameter und schickt sie als `text3d:create`
 * ueber den Bus; die Geometrie baut das Werkzeug `text3d`.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { bus } from '@/shared/events'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, IconRow, NumberInput, Row, TextInput } from '@/ui/components/controls'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { setTool } from '@/ui/lib/commands'
import { Dialog } from './Dialog'

type Align = 'left' | 'center' | 'right'

const ALIGN_OPTIONS: { value: Align; label: string; icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Linksbuendig', icon: AlignLeft },
  { value: 'center', label: 'Zentriert', icon: AlignCenter },
  { value: 'right', label: 'Rechtsbuendig', icon: AlignRight },
]

export function Text3dDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const [text, setText] = useState('OpenSketch')
  const [height, setHeight] = useState(0.5)
  const [extrude, setExtrude] = useState(0.05)
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [filled, setFilled] = useState(true)
  const [align, setAlign] = useState<Align>('left')

  const insert = () => {
    const content = text.trim()
    if (content === '') return
    bus.emit('text3d:create', { text: content, height, extrude, bold, italic, filled, align })
    setTool('text3d')
    onClose()
  }

  return (
    <Dialog
      title="3D-Text"
      width={440}
      onClose={onClose}
      footerNote={extrude > 0 ? 'Extrudierte Buchstaben' : 'Flache Buchstabenflaechen'}
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
          max={100}
          step={0.05}
          suffix="m"
          ariaLabel="Versalhoehe in Metern"
          onChange={setHeight}
        />
      </Row>
      <Row label="Tiefe">
        <NumberInput
          value={extrude}
          min={0}
          max={100}
          step={0.01}
          suffix="m"
          ariaLabel="Extrusionstiefe in Metern"
          onChange={setExtrude}
        />
      </Row>
      <Row label="Ausrichtung">
        <IconRow ariaLabel="Textausrichtung" value={align} options={ALIGN_OPTIONS} onChange={setAlign} />
      </Row>

      <div className="px-2 pb-1 pt-1">
        <Checkbox checked={bold} label="Fett" onChange={setBold} />
        <Checkbox checked={italic} label="Kursiv" onChange={setItalic} />
        <Checkbox checked={filled} label="Gefuellte Flaechen (sonst nur Umrisse)" onChange={setFilled} />
      </div>

      <p className={clsx('px-3 pb-2 text-[11px] leading-relaxed', skin.dim)}>
        Nach dem Bestaetigen den Einfuegepunkt im Modell anklicken.
      </p>
    </Dialog>
  )
}
