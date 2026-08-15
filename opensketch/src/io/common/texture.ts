/**
 * Prozedurale Texturen (256 x 256) als Data-URL.
 *
 * Damit bleibt die App ohne einen einzigen externen Asset-Download attraktiv.
 * Die Erzeugung laeuft ausschliesslich beim ersten Zugriff und faellt in
 * Node-Umgebungen (vitest) sauber auf `null` zurueck - der Aufrufer benutzt
 * dann nur die Grundfarbe.
 */

export type TextureKind =
  | 'wood'
  | 'plank'
  | 'brick'
  | 'tile'
  | 'grass'
  | 'concrete'
  | 'gravel'
  | 'fabric'
  | 'roof'
  | 'soil'
  | 'foliage'
  | 'brushed'
  | 'carpet'

export interface TextureRecipe {
  kind: TextureKind
  /** Grundfarbe '#rrggbb' */
  base: string
  /** Akzentfarbe (Maserung, Fuge, Sprenkel) */
  accent: string
  /** Feinjustierung je nach Art */
  scale?: number
  seed?: number
}

export const TEXTURE_SIZE = 256

export interface GeneratedTexture {
  dataUrl: string
  width: number
  height: number
}

/** true, wenn in dieser Umgebung ueberhaupt gezeichnet werden kann. */
export function canGenerateTextures(): boolean {
  if (typeof document === 'undefined') return false
  return typeof document.createElement === 'function'
}

/**
 * Erzeugt die Textur. Liefert `null`, wenn kein Canvas verfuegbar ist
 * (Node/Tests) - dann bleibt das Material eine reine Farbe.
 */
export function createTexture(recipe: TextureRecipe): GeneratedTexture | null {
  if (!canGenerateTextures()) return null
  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null
  try {
    canvas = document.createElement('canvas')
    canvas.width = TEXTURE_SIZE
    canvas.height = TEXTURE_SIZE
    ctx = canvas.getContext('2d')
  } catch {
    return null
  }
  if (!ctx) return null

  const rand = makeRandom(recipe.seed ?? 1337)
  ctx.fillStyle = recipe.base
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)

  switch (recipe.kind) {
    case 'wood':
      drawWood(ctx, recipe, rand)
      break
    case 'plank':
      drawPlank(ctx, recipe, rand)
      break
    case 'brick':
      drawBrick(ctx, recipe)
      break
    case 'tile':
      drawTile(ctx, recipe)
      break
    case 'grass':
      drawGrass(ctx, recipe, rand)
      break
    case 'concrete':
      drawNoise(ctx, recipe, rand, 0.1, 2)
      break
    case 'gravel':
      drawGravel(ctx, recipe, rand)
      break
    case 'fabric':
      drawFabric(ctx, recipe, rand)
      break
    case 'roof':
      drawRoof(ctx, recipe)
      break
    case 'soil':
      drawNoise(ctx, recipe, rand, 0.22, 3)
      break
    case 'foliage':
      drawFoliage(ctx, recipe, rand)
      break
    case 'brushed':
      drawBrushed(ctx, recipe, rand)
      break
    case 'carpet':
      drawNoise(ctx, recipe, rand, 0.14, 1)
      break
  }

  try {
    return { dataUrl: canvas.toDataURL('image/png'), width: TEXTURE_SIZE, height: TEXTURE_SIZE }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Zeichenroutinen                                                     */
/* ------------------------------------------------------------------ */

type Rand = () => number

function makeRandom(seed: number): Rand {
  let state = (seed >>> 0) || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

function drawWood(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  const rings = Math.round(18 * (recipe.scale ?? 1))
  ctx.save()
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = recipe.accent
  for (let i = 0; i < rings; i++) {
    const y = (i / rings) * size + rand() * 3
    ctx.lineWidth = 0.6 + rand() * 2.2
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += 8) {
      ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 3 + i) * 2.4 + (rand() - 0.5) * 1.2)
    }
    ctx.stroke()
  }
  // feine Faserung
  ctx.globalAlpha = 0.12
  ctx.lineWidth = 0.5
  for (let i = 0; i < 180; i++) {
    const y = rand() * size
    ctx.beginPath()
    ctx.moveTo(rand() * size, y)
    ctx.lineTo(rand() * size, y + (rand() - 0.5) * 4)
    ctx.stroke()
  }
  ctx.restore()
}

function drawPlank(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  const rows = Math.max(2, Math.round(4 * (recipe.scale ?? 1)))
  const h = size / rows
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (size / 4)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, r * h, size, h)
    ctx.clip()
    drawWood(ctx, { ...recipe, scale: 0.5 }, rand)
    ctx.restore()
    ctx.strokeStyle = recipe.accent
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, r * h + 0.5)
    ctx.lineTo(size, r * h + 0.5)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(offset + 0.5, r * h)
    ctx.lineTo(offset + 0.5, (r + 1) * h)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

function drawBrick(ctx: CanvasRenderingContext2D, recipe: TextureRecipe): void {
  const size = TEXTURE_SIZE
  const rows = 8
  const h = size / rows
  const w = size / 4
  ctx.fillStyle = recipe.accent
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = recipe.base
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (w / 2)
    for (let c = -1; c <= 4; c++) {
      const x = c * w + offset
      ctx.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3)
    }
  }
}

function drawTile(ctx: CanvasRenderingContext2D, recipe: TextureRecipe): void {
  const size = TEXTURE_SIZE
  const n = Math.max(1, Math.round(4 * (recipe.scale ?? 1)))
  const step = size / n
  ctx.fillStyle = recipe.accent
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = recipe.base
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      ctx.fillRect(c * step + 1.5, r * step + 1.5, step - 3, step - 3)
    }
  }
}

function drawGrass(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  ctx.strokeStyle = recipe.accent
  ctx.lineWidth = 1
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size
    const y = rand() * size
    const len = 2 + rand() * 5
    ctx.globalAlpha = 0.25 + rand() * 0.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 2, y - len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawNoise(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand, amount: number, dotSize: number): void {
  const size = TEXTURE_SIZE
  ctx.fillStyle = recipe.accent
  const count = Math.round(size * size * amount)
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.3
    ctx.fillRect(rand() * size, rand() * size, dotSize, dotSize)
  }
  ctx.globalAlpha = 1
}

function drawGravel(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  for (let i = 0; i < 900; i++) {
    const r = 1.5 + rand() * 4
    ctx.globalAlpha = 0.25 + rand() * 0.55
    ctx.fillStyle = rand() > 0.5 ? recipe.accent : recipe.base
    ctx.beginPath()
    ctx.ellipse(rand() * size, rand() * size, r, r * (0.6 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawFabric(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  ctx.strokeStyle = recipe.accent
  ctx.lineWidth = 1
  const step = 4
  for (let x = 0; x < size; x += step) {
    ctx.globalAlpha = 0.1 + rand() * 0.15
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, size)
    ctx.stroke()
  }
  for (let y = 0; y < size; y += step) {
    ctx.globalAlpha = 0.1 + rand() * 0.15
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(size, y + 0.5)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawRoof(ctx: CanvasRenderingContext2D, recipe: TextureRecipe): void {
  const size = TEXTURE_SIZE
  const rows = 6
  const cols = 8
  const h = size / rows
  const w = size / cols
  ctx.fillStyle = recipe.accent
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = recipe.base
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (w / 2)
    for (let c = -1; c <= cols; c++) {
      const x = c * w + offset
      ctx.beginPath()
      ctx.moveTo(x + 1, r * h + h)
      ctx.lineTo(x + 1, r * h + h * 0.35)
      ctx.quadraticCurveTo(x + w / 2, r * h - h * 0.15, x + w - 1, r * h + h * 0.35)
      ctx.lineTo(x + w - 1, r * h + h)
      ctx.closePath()
      ctx.fill()
    }
  }
}

function drawFoliage(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  for (let i = 0; i < 700; i++) {
    ctx.globalAlpha = 0.2 + rand() * 0.6
    ctx.fillStyle = rand() > 0.45 ? recipe.accent : recipe.base
    const cx = rand() * size
    const cy = rand() * size
    const r = 3 + rand() * 9
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 0.55, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawBrushed(ctx: CanvasRenderingContext2D, recipe: TextureRecipe, rand: Rand): void {
  const size = TEXTURE_SIZE
  ctx.strokeStyle = recipe.accent
  for (let i = 0; i < 1400; i++) {
    const y = rand() * size
    ctx.globalAlpha = 0.04 + rand() * 0.16
    ctx.lineWidth = 0.5 + rand()
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y + (rand() - 0.5) * 1.5)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
