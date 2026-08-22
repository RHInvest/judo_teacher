/**
 * Kantenmaterial fuer den SketchUp-Look.
 *
 * Basis ist `LineMaterial` aus den three.js-Beispielen (echte Linienbreite in
 * Pixeln ueber instanzierte Quads). Der Vertex-Shader wird um drei Effekte
 * erweitert, die der SketchUp-Kantendarstellung ihren Charakter geben:
 *
 *  - `osExtension`  Verlaengerung beider Enden um n Pixel (Skizzeneffekt)
 *  - `osDepthCue`   Linienbreite nimmt mit der Tiefe ab
 *  - `osJitter`     leichter, pro Segment stabiler Versatz (Handskizze)
 *
 * Der Shader wird pro Materialinstanz gepatcht - `LineMaterial` ist ein
 * `ShaderMaterial`, dessen `vertexShader` einfach eine Zeichenkette ist.
 * three.js vergibt fuer abweichende Shader-Strings automatisch ein eigenes
 * Programm, daher ist kein `customProgramCacheKey` noetig.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/* Die Ankertexte muessen exakt zum three.js-Shader passen - dort wird mit
 * Tabs eingerueckt, deshalb hier explizite \t statt Quelltext-Einrueckung. */
const T4 = '\t\t\t\t'
const T2 = '\t\t'

const ANCHOR = `${T4}// adjust for linewidth\n${T4}offset *= linewidth;`

const REPLACEMENT = [
  '// --- OpenSketch: Tiefenhinweis ---',
  'float osW = linewidth;',
  'if ( osDepthCue > 0.0001 ) {',
  '  float osDepth = - ( ( position.y < 0.5 ) ? start.z : end.z );',
  '  float osRange = max( osDepthRange.y - osDepthRange.x, 0.0001 );',
  '  float osT = clamp( ( osDepth - osDepthRange.x ) / osRange, 0.0, 1.0 );',
  '  osW = mix( linewidth, max( linewidth * ( 1.0 - osDepthCue ), 0.35 ), osT );',
  '}',
  'offset *= osW;',
  '// --- OpenSketch: Verlaengerung der Enden in Pixeln ---',
  'vec2 osAlong = ( position.y < 0.5 ) ? -dir : dir;',
  'offset += osAlong * osExtension;',
  '// --- OpenSketch: Jitter (pro Segment konstant) ---',
  'if ( osJitter > 0.0001 ) {',
  '  vec3 osSeed = instanceStart + instanceEnd;',
  '  float osH1 = fract( sin( dot( osSeed, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );',
  '  float osH2 = fract( sin( dot( osSeed, vec3( 93.9898, 11.233, 57.719 ) ) ) * 24634.6345 );',
  '  offset += vec2( osH1 - 0.5, osH2 - 0.5 ) * 2.0 * osJitter;',
  '  offset += osAlong * ( osH1 * osJitter );',
  '}',
].join('\n')

const UNIFORM_ANCHOR = `${T2}uniform float linewidth;\n${T2}uniform vec2 resolution;`

const UNIFORM_DECL = [
  'uniform float linewidth;',
  'uniform vec2 resolution;',
  'uniform float osExtension;',
  'uniform float osJitter;',
  'uniform float osDepthCue;',
  'uniform vec2 osDepthRange;',
].join('\n')

let patchWarned = false

export interface SketchLineOptions {
  color?: THREE.ColorRepresentation
  linewidth?: number
  dashed?: boolean
  dashSize?: number
  gapSize?: number
  vertexColors?: boolean
  transparent?: boolean
  opacity?: number
  depthTest?: boolean
  depthWrite?: boolean
  /** hebt die Linie leicht zur Kamera - fuer Auswahl-Highlights */
  polygonOffset?: boolean
}

/**
 * `LineMaterial` mit den drei Zusatzeffekten. Alle Zusatzuniforms sind
 * standardmaessig 0, dann verhaelt sich das Material exakt wie das Original.
 */
export class SketchLineMaterial extends LineMaterial {
  constructor(options: SketchLineOptions = {}) {
    super({
      /*
       * LineMaterial MULTIPLIZIERT die Vertex-Farbe mit dieser Grundfarbe.
       * Mit dem dunklen Kantenwert 0x222222 wird jede Vertex-Farbe auf ein
       * Achtel gedaempft - aus dem Achsenrot d33b3b wurde ein fast schwarzes
       * Braun. Wo Vertex-Farben im Spiel sind, muss die Grundfarbe deshalb
       * neutral weiss sein, damit sie unveraendert durchkommen.
       */
      color: options.color ?? (options.vertexColors ? 0xffffff : 0x222222),
      linewidth: options.linewidth ?? 1,
      dashed: options.dashed ?? false,
      dashSize: options.dashSize ?? 0.2,
      gapSize: options.gapSize ?? 0.12,
      vertexColors: options.vertexColors ?? false,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      alphaToCoverage: false,
      worldUnits: false,
    })

    this.depthTest = options.depthTest ?? true
    this.depthWrite = options.depthWrite ?? true
    if (options.polygonOffset) {
      this.polygonOffset = true
      this.polygonOffsetFactor = -4
      this.polygonOffsetUnits = -4
    }

    this.uniforms.osExtension = { value: 0 }
    this.uniforms.osJitter = { value: 0 }
    this.uniforms.osDepthCue = { value: 0 }
    this.uniforms.osDepthRange = { value: new THREE.Vector2(1, 100) }

    const src = this.vertexShader
    if (src.indexOf(ANCHOR) >= 0 && src.indexOf(UNIFORM_ANCHOR) >= 0) {
      this.vertexShader = src.replace(UNIFORM_ANCHOR, UNIFORM_DECL).replace(ANCHOR, REPLACEMENT)
    } else if (!patchWarned) {
      patchWarned = true
      console.warn('[render] LineMaterial-Shader konnte nicht gepatcht werden - Skizzeneffekte sind aus')
    }
    this.needsUpdate = true
  }

  /** Verlaengerung beider Enden in Pixeln (0 = aus). */
  setExtension(pixels: number): void {
    this.uniforms.osExtension.value = Math.max(0, pixels)
  }

  /** Staerke des Jitters in Pixeln (0 = aus). */
  setJitter(pixels: number): void {
    this.uniforms.osJitter.value = Math.max(0, pixels)
  }

  /**
   * Tiefenhinweis: `strength` 0..1 gibt an, um wie viel die Linienbreite am
   * fernen Ende des Bereichs schrumpft. `near`/`far` sind Kameradistanzen.
   */
  setDepthCue(strength: number, near: number, far: number): void {
    this.uniforms.osDepthCue.value = Math.max(0, Math.min(1, strength))
    const range = this.uniforms.osDepthRange.value as THREE.Vector2
    range.set(Math.max(near, 0.001), Math.max(far, near + 0.001))
  }
}

/** Setzt die Bildschirmaufloesung eines Kantenmaterials. */
export function setLineResolution(material: LineMaterial, width: number, height: number): void {
  material.resolution.set(Math.max(1, width), Math.max(1, height))
}
