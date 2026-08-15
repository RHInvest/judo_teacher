/** Materialkachel - Farbe oder Texturvorschau. */

import clsx from 'clsx'
import { Ban } from 'lucide-react'
import type { Material, Texture } from '@/shared/types'
import { useSkin } from '@/ui/lib/theme'

export function Swatch({
  material,
  texture,
  size = 34,
  selected,
  onClick,
  onContextMenu,
  label,
}: {
  material: Material | null
  texture?: Texture | null
  size?: number
  selected?: boolean
  onClick?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  label?: string
}) {
  const skin = useSkin()
  const title = label ?? material?.name ?? 'Standardmaterial'
  const background = material?.color ?? '#b9c0cc'
  const opacity = material?.opacity ?? 1

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={title}
      aria-pressed={selected}
      title={title}
      className={clsx(
        'relative shrink-0 overflow-hidden rounded border transition-all',
        selected ? 'border-accent-400 ring-1 ring-accent-400' : clsx(skin.border, 'hover:border-accent-500'),
        skin.ring,
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0"
        style={{
          background: texture?.dataUrl ? `url(${texture.dataUrl}) center/cover` : background,
          opacity,
        }}
      />
      {!material ? (
        <span className={clsx('absolute inset-0 flex items-center justify-center', skin.dim)}>
          <Ban size={Math.round(size * 0.45)} strokeWidth={1.6} />
        </span>
      ) : null}
    </button>
  )
}
