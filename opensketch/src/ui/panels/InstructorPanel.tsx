/** Instructor: kontextsensitive Hilfe zum aktiven Werkzeug. */

import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { TOOL_META } from '@/ui/lib/tools'
import { toolShortcut } from '@/ui/lib/shortcuts'
import { instructionFor } from '@/ui/lib/instructor'
import { Divider, GroupTitle } from '@/ui/components/controls'
import { useAppSelector } from '@/ui/state/store'

export function InstructorPanel() {
  const skin = useSkin()
  const activeTool = useAppSelector((state) => state.activeTool ?? 'select')
  const meta = TOOL_META[activeTool]
  const instruction = instructionFor(activeTool)
  const Icon = meta.icon
  const shortcut = toolShortcut(activeTool)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-2 pb-1 pt-2">
        <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded', skin.well)}>
          <Icon size={18} strokeWidth={1.7} className="text-accent-400" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={clsx('truncate text-[13px] font-medium', skin.text)}>{meta.name}</div>
          {shortcut ? <div className={clsx('text-[10px]', skin.dim)}>Kuerzel: {shortcut}</div> : null}
        </div>
      </div>

      <p className={clsx('px-2 pb-1 text-[11px] leading-relaxed', skin.muted)}>{meta.hint}</p>

      {instruction.steps.length > 0 ? (
        <>
          <Divider />
          <GroupTitle>Vorgehen</GroupTitle>
          <ol className="px-2 pb-1">
            {instruction.steps.map((step, index) => (
              <li key={step} className="flex gap-2 py-[3px]">
                <span
                  className={clsx(
                    'mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums',
                    skin.well,
                    skin.dim,
                  )}
                >
                  {index + 1}
                </span>
                <span className={clsx('min-w-0 text-[11px] leading-relaxed', skin.text)}>{step}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {instruction.modifiers.length > 0 ? (
        <>
          <Divider />
          <GroupTitle>Sondertasten</GroupTitle>
          <dl className="px-2 pb-1">
            {instruction.modifiers.map((modifier) => (
              <div key={modifier.key} className="flex gap-2 py-[3px]">
                <dt
                  className={clsx(
                    'shrink-0 rounded border px-1.5 py-[1px] font-mono text-[10px]',
                    skin.border,
                    skin.muted,
                  )}
                >
                  {modifier.key}
                </dt>
                <dd className={clsx('min-w-0 text-[11px] leading-relaxed', skin.muted)}>{modifier.effect}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {instruction.vcb ? (
        <>
          <Divider />
          <GroupTitle>Maßfeld</GroupTitle>
          <p className={clsx('px-2 pb-1.5 text-[11px] leading-relaxed', skin.muted)}>{instruction.vcb}</p>
        </>
      ) : null}
    </div>
  )
}
