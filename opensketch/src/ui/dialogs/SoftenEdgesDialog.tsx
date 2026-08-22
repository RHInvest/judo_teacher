/** Kanten weichzeichnen als eigenstaendiger Dialog. */

import { useState } from 'react'
import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, Row, Slider } from '@/ui/components/controls'
import { edit, useAppSelector } from '@/ui/state/store'
import { Dialog } from './Dialog'

export function SoftenEdgesDialog({ onClose }: { onClose: () => void }) {
  const skin = useSkin()
  const edgeIds = useAppSelector((state) => state.selection?.edgeIds ?? [], (a, b) => a.length === b.length && a[0] === b[0])
  const [angle, setAngle] = useState(20)
  const [softenCoplanar, setSoftenCoplanar] = useState(true)

  const apply = () => {
    if (edgeIds.length === 0) return
    const ids = [...edgeIds]
    edit('Kanten weichzeichnen', (s) => s.softenEdges(ids, angle, { softenCoplanar }))
    onClose()
  }

  return (
    <Dialog
      title="Kanten weichzeichnen"
      width={400}
      onClose={onClose}
      footerNote={`${edgeIds.length} Kante${edgeIds.length === 1 ? '' : 'n'} ausgewählt`}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        { label: 'Anwenden', variant: 'primary', onClick: apply, disabled: edgeIds.length === 0 },
      ]}
    >
      <Row label="Grenzwinkel">
        <Slider
          min={0}
          max={180}
          step={1}
          value={angle}
          ariaLabel="Grenzwinkel"
          display={`${angle}°`}
          onChange={setAngle}
        />
      </Row>
      <div className="px-2 pb-1">
        <Checkbox checked={softenCoplanar} label="Koplanare Kanten mit weichzeichnen" onChange={setSoftenCoplanar} />
      </div>
      <p className={clsx('px-3 pb-2 text-[11px] leading-relaxed', skin.dim)}>
        Kanten, deren Nachbarflächen einen kleineren Winkel als den Grenzwinkel einschließen, werden weich und
        geglättet.
      </p>
    </Dialog>
  )
}
