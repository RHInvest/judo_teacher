/**
 * Materialverwaltung fuer Flaechen.
 *
 * Ein Dokument-`Material` wird je nach Stil, Seite (Vorder-/Rueckseite) und
 * Kontextabblendung in ein three.js-Material uebersetzt. Alles wird gecacht und
 * bei Stil-/Materialaenderungen komplett neu aufgebaut (Materialien sind billig
 * im Vergleich zur Geometrie).
 *
 * Vorder- und Rueckseite teilen sich dieselbe BufferGeometry: die Vorderseite
 * rendert mit `side: FrontSide`, die Rueckseite mit `side: BackSide`. three.js
 * dreht dabei die Normale im Shader, dadurch wird die Rueckseite korrekt
 * beleuchtet und ist durch die blaugraue Grundfarbe klar unterscheidbar.
 * Die Rueckseite liest ihre UV aus dem zweiten Kanal (`uv1`).
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import type { Id, Material, SketchDocument, StyleSettings, Texture } from '@/shared/types'
import { BACK_COLOR, FRONT_COLOR } from './defaults'
import { color, parseColor } from './util'

export type FaceSide = 'front' | 'back'

export interface FaceMaterialOptions {
  /** ausserhalb des aktiven Kontexts - ausgegraut und transparent */
  dim?: boolean
  /** Materialueberschreibung der Instanz (greift, wenn die Flaeche kein Material hat) */
  override?: Id | null
}

const DEFAULT_MATERIAL: Material = {
  id: '@default',
  name: 'Standard',
  color: FRONT_COLOR,
  opacity: 1,
  textureId: null,
  textureWidth: 1,
  textureHeight: 1,
  roughness: 0.85,
  metalness: 0,
  category: '',
  colorize: false,
}

export class MaterialCache {
  private doc: SketchDocument | null = null
  private style: StyleSettings
  private cache = new Map<string, THREE.Material>()
  private textures = new Map<string, THREE.Texture>()
  private loader = new THREE.TextureLoader()
  private onTextureLoad: () => void

  constructor(style: StyleSettings, onTextureLoad: () => void) {
    this.style = style
    this.onTextureLoad = onTextureLoad
  }

  /** Dokument/Stil aktualisieren. Gibt true zurueck, wenn der Cache verworfen wurde. */
  update(doc: SketchDocument | null, style: StyleSettings, materialsChanged: boolean): boolean {
    const styleChanged =
      style.faceStyle !== this.style.faceStyle ||
      style.xrayOpacity !== this.style.xrayOpacity ||
      style.frontColor !== this.style.frontColor ||
      style.backColor !== this.style.backColor ||
      style.backgroundColor !== this.style.backgroundColor
    this.doc = doc
    this.style = style
    if (styleChanged || materialsChanged) {
      this.clearMaterials()
      if (materialsChanged) this.clearTextures()
      return true
    }
    return false
  }

  /** true, wenn im aktuellen Stil ueberhaupt Flaechen gezeichnet werden. */
  get drawsFaces(): boolean {
    return this.style.faceStyle !== 'wireframe'
  }

  get transparentFaces(): boolean {
    return this.style.faceStyle === 'xray'
  }

  face(materialId: Id | null, side: FaceSide, opts: FaceMaterialOptions = {}): THREE.Material {
    const effectiveId = materialId ?? opts.override ?? null
    const key = `${effectiveId ?? '-'}|${side}|${opts.dim ? 'd' : 'n'}`
    let mat = this.cache.get(key)
    if (!mat) {
      mat = this.build(effectiveId, side, opts.dim === true)
      this.cache.set(key, mat)
    }
    return mat
  }

  getMaterial(id: Id | null): Material {
    if (!id || !this.doc) return DEFAULT_MATERIAL
    return this.doc.materials[id] ?? DEFAULT_MATERIAL
  }

  getTextureRecord(id: Id | null): Texture | null {
    if (!id || !this.doc) return null
    return this.doc.textures[id] ?? null
  }

  /* ---------------------------------------------------------------- */

  private build(materialId: Id | null, side: FaceSide, dim: boolean): THREE.Material {
    const style = this.style
    const threeSide = side === 'front' ? THREE.FrontSide : THREE.BackSide
    const doc = this.doc
    const docMaterial = materialId && doc ? doc.materials[materialId] : undefined

    const baseColor =
      side === 'front'
        ? parseColor(style.frontColor, FRONT_COLOR).clone()
        : parseColor(style.backColor, BACK_COLOR).clone()

    /* --- verdeckte Linien: rein weisse Flaechen, nur als Tiefenmaske --- */
    if (style.faceStyle === 'hiddenLine') {
      const mat = new THREE.MeshBasicMaterial({
        color: parseColor(style.backgroundColor, '#ffffff').clone(),
        side: threeSide,
      })
      this.applyCommon(mat, dim)
      return mat
    }

    /* --- monochrom: nur Stilfarben, kein Dokumentmaterial --------- */
    if (style.faceStyle === 'monochrome') {
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.9,
        metalness: 0,
        side: threeSide,
      })
      this.applyCommon(mat, dim)
      return mat
    }

    const useTextures = style.faceStyle === 'shadedWithTextures'
    const xray = style.faceStyle === 'xray'

    const mat = new THREE.MeshStandardMaterial({
      color: docMaterial ? color(docMaterial.color, FRONT_COLOR) : baseColor,
      roughness: clamp01(docMaterial?.roughness ?? 0.85, 0.85),
      metalness: clamp01(docMaterial?.metalness ?? 0, 0),
      side: threeSide,
    })

    if (docMaterial && useTextures && docMaterial.textureId) {
      const tex = this.texture(docMaterial.textureId, side === 'back' ? 1 : 0)
      if (tex) {
        mat.map = tex
        if (!docMaterial.colorize) mat.color.set(0xffffff)
      }
    }

    let opacity = docMaterial ? clamp01(docMaterial.opacity, 1) : 1
    if (xray) opacity = Math.min(opacity, clamp01(style.xrayOpacity, 0.35))
    if (opacity < 0.999) {
      mat.transparent = true
      mat.opacity = opacity
      mat.depthWrite = !xray
    }

    this.applyCommon(mat, dim)
    return mat
  }

  private applyCommon(mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial, dim: boolean): void {
    // Flaechen leicht nach hinten schieben, damit die Kanten sauber obenauf liegen
    mat.polygonOffset = true
    mat.polygonOffsetFactor = 1
    mat.polygonOffsetUnits = 1
    mat.shadowSide = THREE.DoubleSide

    if (dim) {
      const bg = parseColor(this.style.backgroundColor, '#ffffff')
      mat.color.lerp(bg, 0.55)
      mat.transparent = true
      mat.opacity = Math.min(mat.opacity, 0.5)
      mat.depthWrite = true
    }
  }

  private texture(textureId: Id, channel: 0 | 1): THREE.Texture | null {
    const record = this.getTextureRecord(textureId)
    if (!record || typeof record.dataUrl !== 'string' || record.dataUrl.length === 0) return null
    const key = `${textureId}|${channel}`
    const existing = this.textures.get(key)
    if (existing) return existing

    const tex = this.loader.load(
      record.dataUrl,
      () => this.onTextureLoad(),
      undefined,
      (err) => console.warn('[render] Textur konnte nicht geladen werden', textureId, err),
    )
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    tex.channel = channel
    this.textures.set(key, tex)
    return tex
  }

  private clearMaterials(): void {
    for (const mat of this.cache.values()) mat.dispose()
    this.cache.clear()
  }

  private clearTextures(): void {
    for (const tex of this.textures.values()) tex.dispose()
    this.textures.clear()
  }

  dispose(): void {
    this.clearMaterials()
    this.clearTextures()
  }
}

function clamp01(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return v < 0 ? 0 : v > 1 ? 1 : v
}
