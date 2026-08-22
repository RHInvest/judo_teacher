/** Einstellungen: Darstellung, Vorgaben, Kuerzeluebersicht. */

import { useState } from 'react'
import clsx from 'clsx'
import { useSkin } from '@/ui/lib/theme'
import { Checkbox, GroupTitle, Row, Select } from '@/ui/components/controls'
import { UnitsEditor } from '@/ui/components/modelInfo'
import { allToolShortcuts, MENU_SHORTCUTS } from '@/ui/lib/shortcuts'
import { act, useApp } from '@/ui/state/store'
import { Dialog, DialogTabs } from './Dialog'

type Tab = 'general' | 'units' | 'shortcuts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'Allgemein' },
  { id: 'units', label: 'Einheiten' },
  { id: 'shortcuts', label: 'Kürzel' },
]

export function PreferencesDialog({ tab, onClose }: { tab: string; onClose: () => void }) {
  const skin = useSkin()
  const state = useApp()
  const [active, setActive] = useState<Tab>(TABS.some((entry) => entry.id === tab) ? (tab as Tab) : 'general')

  const style = state.doc?.styles?.[state.doc?.activeStyleId ?? '']

  return (
    <Dialog
      title="Einstellungen"
      width={580}
      onClose={onClose}
      actions={[{ label: 'Schließen', variant: 'primary', onClick: onClose }]}
    >
      <DialogTabs tabs={TABS} active={active} onChange={setActive}>
        {active === 'general' ? (
          <>
            <GroupTitle>Darstellung</GroupTitle>
            <Row label="Theme">
              <Select
                ariaLabel="Farbschema"
                value={state.ui?.theme ?? 'dark'}
                options={[
                  { value: 'dark', label: 'Dunkel' },
                  { value: 'light', label: 'Hell' },
                ]}
                onChange={(value) => act((s) => s.setTheme(value))}
              />
            </Row>
            <div className="px-2">
              <Checkbox
                checked={state.ui?.trayVisible !== false}
                label="Tray anzeigen"
                onChange={(checked) => act((s) => s.setTrayVisible(checked))}
              />
              <Checkbox
                checked={Boolean(style?.showAxes)}
                label="Zeichenachsen anzeigen"
                onChange={(checked) => act((s) => s.updateStyle({ showAxes: checked }))}
              />
              <Checkbox
                checked={Boolean(style?.showGrid)}
                label="Raster anzeigen"
                onChange={(checked) => act((s) => s.updateStyle({ showGrid: checked }))}
              />
            </div>
            <p className={clsx('px-2 pb-2 pt-1 text-[11px] leading-relaxed', skin.dim)}>
              Einstellungen wirken sofort und werden mit dem Modell gespeichert.
            </p>
          </>
        ) : null}

        {active === 'units' ? <UnitsEditor /> : null}

        {active === 'shortcuts' ? (
          <div className="px-2 py-1">
            <GroupTitle>Werkzeuge</GroupTitle>
            <dl className="pb-2">
              {allToolShortcuts().map((entry) => (
                <div key={entry.id} className="flex items-baseline justify-between gap-3 py-[2px]">
                  <dt className={clsx('min-w-0 truncate text-[11px]', skin.muted)}>{entry.name}</dt>
                  <dd className={clsx('shrink-0 font-mono text-[11px]', skin.text)}>{entry.combo}</dd>
                </div>
              ))}
            </dl>
            <GroupTitle>Befehle</GroupTitle>
            <dl className="pb-2">
              {Object.entries(MENU_SHORTCUTS).map(([id, combo]) => (
                <div key={id} className="flex items-baseline justify-between gap-3 py-[2px]">
                  <dt className={clsx('min-w-0 truncate text-[11px]', skin.muted)}>{id}</dt>
                  <dd className={clsx('shrink-0 font-mono text-[11px]', skin.text)}>{combo}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </DialogTabs>
    </Dialog>
  )
}
