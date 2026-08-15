/**
 * Kleine Helfer fuer den Renderer.
 *
 * OWNERSHIP: Render-Entwickler. Nur `src/render/**` darf hier schreiben.
 */

import * as THREE from 'three'
import { M } from '@/core/math'
import type { BBox3Like, Mat4Like, Vec3Like } from '@/shared/types'

/* ------------------------------------------------------------------ */
/* Vektoren / Matrizen                                                 */
/* ------------------------------------------------------------------ */

export function toVector3(v: Vec3Like, out?: THREE.Vector3): THREE.Vector3 {
  return (out ?? new THREE.Vector3()).set(v.x, v.y, v.z)
}

export function fromVector3(v: THREE.Vector3): Vec3Like {
  return { x: v.x, y: v.y, z: v.z }
}

export function toMatrix4(m: Mat4Like, out?: THREE.Matrix4): THREE.Matrix4 {
  return (out ?? new THREE.Matrix4()).fromArray(m as unknown as number[])
}

export function fromMatrix4(m: THREE.Matrix4): Mat4Like {
  return M.fromArray(m.elements)
}

export function toBox3(b: BBox3Like, out?: THREE.Box3): THREE.Box3 {
  const box = out ?? new THREE.Box3()
  box.min.set(b.min.x, b.min.y, b.min.z)
  box.max.set(b.max.x, b.max.y, b.max.z)
  return box
}

/* ------------------------------------------------------------------ */
/* Farben                                                              */
/* ------------------------------------------------------------------ */

const HEX_RE = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/
const colorCache = new Map<string, THREE.Color>()

/** Robuste Farbkonvertierung - ungueltige Werte fallen auf `fallback` zurueck. */
export function parseColor(value: string | null | undefined, fallback = '#ffffff'): THREE.Color {
  const raw = typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback
  let cached = colorCache.get(raw)
  if (!cached) {
    cached = new THREE.Color(raw.startsWith('#') ? raw : `#${raw}`)
    colorCache.set(raw, cached)
  }
  return cached
}

/** Kopie, damit Aufrufer die Cache-Instanz nicht mutieren. */
export function color(value: string | null | undefined, fallback = '#ffffff'): THREE.Color {
  return parseColor(value, fallback).clone()
}

export function mixColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, t)
}

/** '#rrggbb' -> [r,g,b] in 0..1, ohne Allokation einer THREE.Color pro Aufruf. */
export function colorRgb(value: string | null | undefined, fallback = '#ffffff'): [number, number, number] {
  const c = parseColor(value, fallback)
  return [c.r, c.g, c.b]
}

/* ------------------------------------------------------------------ */
/* Zahlen                                                              */
/* ------------------------------------------------------------------ */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function finiteOr(v: number | undefined | null, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Klassisches ease-in-out (smoothstep), fuer Kamerafahrten. */
export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/* ------------------------------------------------------------------ */
/* Fehlerbehandlung                                                    */
/* ------------------------------------------------------------------ */

const warned = new Set<string>()

/**
 * Der Kernel und der Store werden parallel entwickelt. Alle Zugriffe darauf
 * laufen defensiv ueber diese Helfer, damit der Viewport nicht abstuerzt.
 */
export function warnOnce(key: string, err: unknown): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[render] ${key}:`, err)
}

export function attempt<T>(key: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    warnOnce(key, err)
    return fallback
  }
}

/* ------------------------------------------------------------------ */
/* three.js Aufraeumen                                                 */
/* ------------------------------------------------------------------ */

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const m of material) m.dispose()
  } else {
    material.dispose()
  }
}

/** Entfernt ein Objekt aus seinem Elternteil und gibt eigene Ressourcen frei. */
export function disposeObject(obj: THREE.Object3D, opts?: { geometries?: boolean; materials?: boolean }): void {
  const dropGeometry = opts?.geometries ?? false
  const dropMaterials = opts?.materials ?? false
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (dropGeometry && mesh.geometry) mesh.geometry.dispose()
    if (dropMaterials && mesh.material) disposeMaterial(mesh.material)
  })
  obj.removeFromParent()
}

/** Loescht alle Kinder einer Gruppe. */
export function clearGroup(group: THREE.Object3D, opts?: { geometries?: boolean; materials?: boolean }): void {
  for (const child of group.children.slice()) disposeObject(child, opts)
  group.clear()
}

/* ------------------------------------------------------------------ */
/* Wachsende Buffer                                                    */
/* ------------------------------------------------------------------ */

/** Verdoppelt einen Float32Array, wenn `needed` nicht mehr hineinpasst. */
export function growFloat32(buffer: Float32Array, needed: number): Float32Array {
  if (buffer.length >= needed) return buffer
  let size = Math.max(buffer.length || 64, 64)
  while (size < needed) size *= 2
  const next = new Float32Array(size)
  next.set(buffer)
  return next
}

export function growUint32(buffer: Uint32Array, needed: number): Uint32Array {
  if (buffer.length >= needed) return buffer
  let size = Math.max(buffer.length || 64, 64)
  while (size < needed) size *= 2
  const next = new Uint32Array(size)
  next.set(buffer)
  return next
}

/* ------------------------------------------------------------------ */
/* Pfade                                                               */
/* ------------------------------------------------------------------ */

/** true, wenn `prefix` ein Praefix von `path` ist (oder gleich). */
export function isPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length > path.length) return false
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false
  return true
}

export function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && isPathPrefix(a, b)
}
