/**
 * Stile und Umgebung: Hintergrund, Himmelsverlauf, Boden, Achsenkreuz,
 * unendliches Raster und Nebel.
 *
 * Der Himmel ist eine Kugel mit Verlaufsshader, die der Kamera folgt und ohne
 * Tiefentest ganz zuerst gezeichnet wird. Unterhalb des Horizonts blendet sie
 * zur Bodenfarbe, abgeschwaecht durch `groundTransparency` - genau wie
 * SketchUps Himmel/Boden.
 *
 * Das Raster ist ein grosses, kamerazentriertes Quad mit einem Shader, der die
 * Linien aus den Ableitungen der Weltkoordinaten erzeugt (echtes "unendliches"
 * Raster ohne Moire) und in der Ferne ausblendet.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { FogSettings, StyleSettings, Vec3Like } from '@/shared/types'
import { AXIS_X_COLOR, AXIS_Y_COLOR, AXIS_Z_COLOR } from './defaults'
import { SketchLineMaterial } from './lineMaterial'
import { colorRgb, parseColor } from './util'

/* ------------------------------------------------------------------ */
/* Himmel                                                              */
/* ------------------------------------------------------------------ */

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uGroundMix;
varying vec3 vDir;
void main() {
  float up = clamp( vDir.z, -1.0, 1.0 );
  vec3 rgb;
  if ( up >= 0.0 ) {
    rgb = mix( uHorizon, uSky, pow( up, 0.65 ) );
  } else {
    vec3 ground = mix( uHorizon, uGround, uGroundMix );
    rgb = mix( uHorizon, ground, pow( -up, 0.35 ) );
  }
  gl_FragColor = vec4( rgb, 1.0 );
  #include <colorspace_fragment>
}
`

class SkyDome {
  readonly mesh: THREE.Mesh
  private material: THREE.ShaderMaterial

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSky: { value: new THREE.Color('#9fc4e8') },
        uHorizon: { value: new THREE.Color('#ffffff') },
        uGround: { value: new THREE.Color('#c9bfae') },
        uGroundMix: { value: 0.6 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1000
    this.mesh.name = 'sky'
  }

  apply(style: StyleSettings): void {
    const sky = this.material.uniforms.uSky.value as THREE.Color
    const horizon = this.material.uniforms.uHorizon.value as THREE.Color
    const ground = this.material.uniforms.uGround.value as THREE.Color
    sky.copy(parseColor(style.skyColor, '#9fc4e8'))
    horizon.copy(parseColor(style.backgroundColor, '#ffffff'))
    ground.copy(parseColor(style.groundColor, '#c9bfae'))
    this.material.uniforms.uGroundMix.value = style.displayGround
      ? 1 - clamp01(style.groundTransparency, 0.4)
      : 0
    this.mesh.visible = style.displaySky === true || style.displayGround === true
  }

  follow(cameraPosition: THREE.Vector3, radius: number): void {
    this.mesh.position.copy(cameraPosition)
    this.mesh.scale.setScalar(Math.max(radius, 1))
    this.mesh.updateMatrix()
    this.mesh.updateMatrixWorld(true)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

/* ------------------------------------------------------------------ */
/* Raster                                                              */
/* ------------------------------------------------------------------ */

const GRID_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const GRID_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uMajorColor;
uniform float uSpacing;
uniform float uFadeNear;
uniform float uFadeFar;
uniform vec3 uCamera;
varying vec3 vWorld;

float gridLine( vec2 coord ) {
  vec2 grid = abs( fract( coord - 0.5 ) - 0.5 ) / max( fwidth( coord ), 1e-6 );
  return 1.0 - min( min( grid.x, grid.y ), 1.0 );
}

void main() {
  float spacing = max( uSpacing, 1e-4 );
  float minor = gridLine( vWorld.xy / spacing );
  float major = gridLine( vWorld.xy / ( spacing * 10.0 ) );

  float dist = length( vWorld.xy - uCamera.xy );
  float fade = 1.0 - smoothstep( uFadeNear, uFadeFar, dist );

  float alpha = max( minor * 0.45, major * 0.8 ) * fade;
  if ( alpha < 0.002 ) discard;
  vec3 rgb = mix( uColor, uMajorColor, step( 0.5, major ) );
  gl_FragColor = vec4( rgb, alpha );
  #include <colorspace_fragment>
}
`

class InfiniteGrid {
  readonly mesh: THREE.Mesh
  private material: THREE.ShaderMaterial

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#9ca3af') },
        uMajorColor: { value: new THREE.Color('#6b7280') },
        uSpacing: { value: 1 },
        uFadeNear: { value: 20 },
        uFadeFar: { value: 120 },
        uCamera: { value: new THREE.Vector3() },
      },
      vertexShader: GRID_VERTEX,
      fragmentShader: GRID_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -900
    this.mesh.name = 'grid'
  }

  apply(style: StyleSettings): void {
    this.mesh.visible = style.showGrid === true
    this.material.uniforms.uSpacing.value = Math.max(1e-4, style.gridSpacing || 1)
  }

  follow(cameraPosition: THREE.Vector3, viewRadius: number): void {
    const far = Math.max(viewRadius * 3, 10)
    this.material.uniforms.uFadeNear.value = far * 0.25
    this.material.uniforms.uFadeFar.value = far
    ;(this.material.uniforms.uCamera.value as THREE.Vector3).copy(cameraPosition)
    this.mesh.position.set(cameraPosition.x, cameraPosition.y, 0)
    this.mesh.scale.set(far * 2.5, far * 2.5, 1)
    this.mesh.updateMatrix()
    this.mesh.updateMatrixWorld(true)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

/* ------------------------------------------------------------------ */
/* Achsenkreuz                                                         */
/* ------------------------------------------------------------------ */

class AxesCross {
  readonly group = new THREE.Group()
  private solid: LineSegments2
  private dashed: LineSegments2
  private solidMaterial: SketchLineMaterial
  private dashedMaterial: SketchLineMaterial

  constructor() {
    this.group.name = 'axes'
    this.group.matrixAutoUpdate = false

    const positive: number[] = []
    const negative: number[] = []
    const positiveColors: number[] = []
    const negativeColors: number[] = []

    const axes: [Vec3Like, string][] = [
      [{ x: 1, y: 0, z: 0 }, AXIS_X_COLOR],
      [{ x: 0, y: 1, z: 0 }, AXIS_Y_COLOR],
      [{ x: 0, y: 0, z: 1 }, AXIS_Z_COLOR],
    ]
    for (const [dir, hex] of axes) {
      const rgb = colorRgb(hex)
      positive.push(0, 0, 0, dir.x, dir.y, dir.z)
      positiveColors.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2])
      negative.push(0, 0, 0, -dir.x, -dir.y, -dir.z)
      negativeColors.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2])
    }

    const solidGeometry = new LineSegmentsGeometry()
    solidGeometry.setPositions(positive)
    solidGeometry.setColors(positiveColors)
    solidGeometry.computeBoundingSphere()

    const dashedGeometry = new LineSegmentsGeometry()
    dashedGeometry.setPositions(negative)
    dashedGeometry.setColors(negativeColors)
    dashedGeometry.computeBoundingSphere()

    this.solidMaterial = new SketchLineMaterial({ linewidth: 1.6, vertexColors: true })
    this.dashedMaterial = new SketchLineMaterial({
      linewidth: 1.2,
      vertexColors: true,
      dashed: true,
      transparent: true,
      opacity: 0.75,
    })
    this.dashedMaterial.dashSize = 0.02
    this.dashedMaterial.gapSize = 0.02

    this.solid = new LineSegments2(solidGeometry, this.solidMaterial)
    this.dashed = new LineSegments2(dashedGeometry, this.dashedMaterial)
    this.dashed.computeLineDistances()
    this.solid.frustumCulled = false
    this.dashed.frustumCulled = false
    this.solid.renderOrder = 1
    this.dashed.renderOrder = 1
    this.group.add(this.solid, this.dashed)
  }

  apply(style: StyleSettings): void {
    this.group.visible = style.showAxes === true
  }

  follow(length: number): void {
    const scale = Math.max(length, 0.001)
    this.group.matrix.makeScale(scale, scale, scale)
    this.group.matrixWorldNeedsUpdate = true
  }

  setResolution(width: number, height: number): void {
    this.solidMaterial.resolution.set(Math.max(1, width), Math.max(1, height))
    this.dashedMaterial.resolution.set(Math.max(1, width), Math.max(1, height))
  }

  dispose(): void {
    this.solid.geometry.dispose()
    this.dashed.geometry.dispose()
    this.solidMaterial.dispose()
    this.dashedMaterial.dispose()
  }
}

/* ------------------------------------------------------------------ */
/* Umgebung insgesamt                                                  */
/* ------------------------------------------------------------------ */

export class Environment {
  readonly group = new THREE.Group()
  private sky = new SkyDome()
  private grid = new InfiniteGrid()
  private axes = new AxesCross()
  /** faengt die Schatten auf der Bodenebene auf */
  private shadowPlane: THREE.Mesh
  private shadowMaterial: THREE.ShadowMaterial

  constructor() {
    this.group.name = 'environment'
    this.shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.28, transparent: true })
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMaterial)
    this.shadowPlane.receiveShadow = true
    this.shadowPlane.frustumCulled = false
    this.shadowPlane.renderOrder = -800
    this.shadowPlane.name = 'groundShadow'
    this.group.add(this.sky.mesh, this.grid.mesh, this.shadowPlane, this.axes.group)
  }

  apply(scene: THREE.Scene, style: StyleSettings, fog: FogSettings, groundShadows: boolean): void {
    this.sky.apply(style)
    this.grid.apply(style)
    this.axes.apply(style)
    this.shadowPlane.visible = groundShadows

    scene.background = parseColor(style.backgroundColor, '#ffffff').clone()

    if (fog && fog.enabled) {
      const fogColor = fog.useBackgroundColor ? style.backgroundColor : fog.color
      const near = Number.isFinite(fog.near) ? fog.near : 10
      const far = Number.isFinite(fog.far) ? Math.max(fog.far, near + 0.01) : near + 100
      scene.fog = new THREE.Fog(parseColor(fogColor, '#ffffff').getHex(), near, far)
    } else {
      scene.fog = null
    }
  }

  /** Pro Frame: Himmel, Raster und Achsen an die Kamera anpassen. */
  follow(cameraPosition: THREE.Vector3, viewRadius: number): void {
    this.sky.follow(cameraPosition, Math.max(viewRadius * 4, 20))
    this.grid.follow(cameraPosition, viewRadius)
    this.axes.follow(Math.max(viewRadius * 1.2, 1))
    const size = Math.max(viewRadius * 6, 40)
    this.shadowPlane.position.set(cameraPosition.x, cameraPosition.y, 0)
    this.shadowPlane.scale.set(size, size, 1)
    this.shadowPlane.updateMatrix()
    this.shadowPlane.updateMatrixWorld(true)
  }

  setResolution(width: number, height: number): void {
    this.axes.setResolution(width, height)
  }

  setShadowOpacity(opacity: number): void {
    this.shadowMaterial.opacity = clamp01(opacity, 0.28)
  }

  dispose(): void {
    this.sky.dispose()
    this.grid.dispose()
    this.axes.dispose()
    this.shadowPlane.geometry.dispose()
    this.shadowMaterial.dispose()
    this.group.removeFromParent()
  }
}

function clamp01(v: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return v < 0 ? 0 : v > 1 ? 1 : v
}
