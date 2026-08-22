/**
 * 3D-Text einfuegen.
 *
 * Der Dialog sammelt nur die Parameter und schickt sie als `text3d:create`
 * ueber den Bus; die Geometrie baut das Werkzeug `text3d` aus einem
 * eingebauten Strichzeichensatz. Dessen Vorrat ist begrenzt (A-Z, 0-9,
 * gaengige Satzzeichen), Kleinbuchstaben und Umlaute werden darauf
 * abgebildet. Der Dialog weist darauf hin und markiert Zeichen, die
 * gar nicht dargestellt werden koennen.
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { bus } from '@/shared/events'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, IconRow, NumberInput, Row, TextInput } from '@/ui/components/controls'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { setTool } from '@/ui/lib/commands'
import { mapText3d, text3dChanges, unsupportedText3dChars } from '@/ui/lib/text3d'
import { Dialog } from './Dialog'

type Align = 'left' | 'center' | 'right'

const ALIGN_OPTIONS: { value: Align; label: string; icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Linksbündig', icon: AlignLeft },
  { value: 'center', label: 'Zentriert', icon: AlignCenter },
  { value: 'right', label: 'Rechtsbündig', icon: AlignRight },
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

  const content = text.trim()
  const preview = useMemo(() => mapText3d(content), [content])
  const missing = useMemo(() => unsupportedText3dChars(content), [content])
  const changed = useMemo(() => text3dChanges(content), [content])

  /*
   * Der Dialog schickt die Rohfassung; die Abbildung auf den Zeichensatz macht
   * das Werkzeug. Was hier steht, ist nur die Vorschau darauf - der Nutzer soll
   * vorher sehen, was aus seiner Eingabe wird, statt es hinterher im Modell zu
   * entdecken.
   */
  const insert = () => {
    if (content === '' || preview.trim() === '') return
    bus.emit('text3d:create', { text: content, height, extrude, bold, italic, filled, align })
    setTool('text3d')
    onClose()
  }

  return (
    <Dialog
      title="3D-Text"
      width={440}
      onClose={onClose}
      footerNote={extrude > 0 ? 'Extrudierte Buchstaben' : 'Flache Buchstabenflächen'}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: 'Einfügen', variant: 'primary', onClick: insert, disabled: preview.trim() === '' },
      ]}
    >
      <Row label="Text">
        <TextInput value={text} onChange={setText} ariaLabel="Textinhalt" autoFocus />
      </Row>
      <Row label="Höhe">
        <NumberInput
          value={height}
          min={0.01}
          max={100}
          step={0.05}
          suffix="m"
          ariaLabel="Versalhöhe in Metern"
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
        <Checkbox checked={filled} label="Gefüllte Flächen (sonst nur Umrisse)" onChange={setFilled} />
      </div>

      <div className="px-3 pb-2 pt-1">
        <p className={clsx('text-[11px] leading-relaxed', skin.dim)}>
          Der 3D-Text nutzt einen eingebauten Strichzeichensatz mit begrenztem Zeichenvorrat: Grossbuchstaben A-Z,
          Ziffern 0-9 und gaengige Satzzeichen. Kleinbuchstaben werden zu Grossbuchstaben, Umlaute zu AE/OE/UE,
          das Eszett zu SS. Fett und Kursiv sind Naeherungen dieses Zeichensatzes, keine echten Schriftschnitte.
        </p>
        {changed && preview.trim() !== '' ? (
          <p className={clsx('mt-1.5 text-[11px] leading-relaxed', skin.muted)}>
            Wird gebaut als: <span className="font-mono">{preview}</span>
          </p>
        ) : null}
        {missing.length > 0 ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-500" role="alert">
            Ohne Entsprechung im Zeichensatz und deshalb ausgelassen:{' '}
            <span className="font-mono">{missing.join(' ')}</span>
          </p>
        ) : null}
        {content !== '' && preview.trim() === '' ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-red-500" role="alert">
            Kein einziges Zeichen lässt sich darstellen - bitte den Text ändern.
          </p>
        ) : null}
        <p className={clsx('mt-1.5 text-[11px] leading-relaxed', skin.dim)}>
          Nach dem Bestätigen den Einfügepunkt im Modell anklicken.
        </p>
      </div>
    </Dialog>
  )
}
