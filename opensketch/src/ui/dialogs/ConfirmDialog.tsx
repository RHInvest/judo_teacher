/** Rueckfrage mit Bestaetigen/Abbrechen. */

import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { Dialog } from './Dialog'

export function ConfirmDialog({
  title,
  message,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  onConfirm: () => void
  onClose: () => void
}) {
  const skin = useSkin()
  return (
    <Dialog
      title={title}
      width={400}
      onClose={onClose}
      actions={[
        { label: 'Abbrechen', onClick: onClose },
        {
          label: 'Bestaetigen',
          variant: 'primary',
          onClick: () => {
            try {
              onConfirm()
            } catch (err) {
              console.warn('[ui] Bestaetigte Aktion fehlgeschlagen', err)
            }
            onClose()
          },
        },
      ]}
    >
      <p className={clsx('px-3 py-2 text-[12px] leading-relaxed', skin.text)}>{message}</p>
    </Dialog>
  )
}
