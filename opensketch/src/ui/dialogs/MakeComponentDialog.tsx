/** Komponente aus der Auswahl erstellen. */

import { useState } from 'react'
import type { ComponentBehavior } from '@/shared/types'
import { Checkbox, GroupTitle, Row, Select, TextInput } from '@/ui/components/controls'
import { edit, toast } from '@/ui/state/store'
import { Dialog } from './Dialog'

const GLUE_OPTIONS: { value: ComponentBehavior['glueTo']; label: string }[] = [
  { value: 'none', label: 'Nicht kleben' },
  { value: 'any', label: 'An jeder Flaeche' },
  { value: 'horizontal', label: 'Waagerecht (Boden)' },
  { value: 'vertical', label: 'Senkrecht (Wand)' },
  { value: 'sloped', label: 'Geneigt (Dach)' },
]

export function MakeComponentDialog({ defaultName, onClose }: { defaultName: string; onClose: () => void }) {
  const [name, setName] = useState(defaultName || 'Komponente')
  const [description, setDescription] = useState('')
  const [glueTo, setGlueTo] = useState<ComponentBehavior['glueTo']>('none')
  const [cutsOpening, setCutsOpening] = useState(false)
  const [alwaysFaceCamera, setAlwaysFaceCamera] = useState(false)
  const [shadowsFaceSun, setShadowsFaceSun] = useState(false)

  const create = () => {
    const trimmed = name.trim() || 'Komponente'
    edit('Komponente erstellen', (s) => {
      const id = s.makeComponent({
        name: trimmed,
        description: description.trim(),
        behavior: { glueTo, cutsOpening, alwaysFaceCamera, shadowsFaceSun },
      })
      if (!id) toast('Die Auswahl liess sich nicht in eine Komponente umwandeln.', 'warn')
      else toast(`Komponente "${trimmed}" erstellt.`, 'success')
    })
    onClose()
  }

  return (
    <Dialog
      title="Komponente erstellen"
      width={440}
      onClose={onClose}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: 'Erstellen', variant: 'primary', onClick: create, disabled: name.trim() === '' },
      ]}
    >
      <Row label="Name">
        <TextInput value={name} onChange={setName} ariaLabel="Name der Komponente" autoFocus />
      </Row>
      <Row label="Beschreibung">
        <TextInput value={description} onChange={setDescription} ariaLabel="Beschreibung" placeholder="Optional" />
      </Row>

      <GroupTitle>Verhalten</GroupTitle>
      <Row label="Kleben an">
        <Select ariaLabel="Klebeverhalten" value={glueTo} options={GLUE_OPTIONS} onChange={setGlueTo} />
      </Row>
      <div className="px-2 pb-1">
        <Checkbox
          checked={cutsOpening}
          label="Oeffnung schneiden (Tueren, Fenster)"
          disabled={glueTo === 'none'}
          onChange={setCutsOpening}
        />
        <Checkbox checked={alwaysFaceCamera} label="Immer zur Kamera ausrichten" onChange={setAlwaysFaceCamera} />
        <Checkbox
          checked={shadowsFaceSun}
          label="Schatten aus der Bounding-Box"
          disabled={!alwaysFaceCamera}
          onChange={setShadowsFaceSun}
        />
      </div>
    </Dialog>
  )
}
