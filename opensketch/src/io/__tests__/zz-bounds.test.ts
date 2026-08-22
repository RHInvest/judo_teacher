import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { getLibraryComponents } from '@/io/library'
import { geometryBounds } from '@/io/common/geom'

const cm = (m: number): string => {
  const v = Math.round(m * 1000) / 10
  const r = Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1)
  return r.replace('.', ',')
}

it('dump', () => {
  const lines: string[] = []
  for (const e of getLibraryComponents()) {
    const b = geometryBounds(e.build().definitions[0].geometry)
    const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z
    const round = (e.size ?? '').includes('Ø') && Math.abs(dx - dy) < 0.005
    const target = round ? `Ø ${cm(dx)} × ${cm(dz)} cm` : `${cm(dx)} × ${cm(dy)} × ${cm(dz)} cm`
    if ((e.size ?? '').includes('Öffnung')) continue
    if (e.size === target) continue
    lines.push(`${e.id}\t${e.size}\t${target}`)
  }
  writeFileSync('/tmp/claude-0/-home-user-judo-teacher/bb6b2040-e0d0-5f76-b1d5-f29c15a1a5e9/scratchpad/sizes.txt', lines.join('\n'))
})
