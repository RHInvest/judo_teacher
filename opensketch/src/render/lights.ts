/**
 * Beleuchtung und Schatten.
 *
 * Zwei Betriebsarten:
 *
 *  - SONNE AN: eine `DirectionalLight` aus der NOAA-Sonnenstandsberechnung
 *    (`sun.ts`) mit weicher PCF-Schattenkarte. Die Schattenkamera wird bei jeder
 *    Aenderung automatisch an die Modell-Huelle angepasst, damit die
 *    Aufloesung der Schattenkarte nicht verschwendet wird.
 *  - SONNE AUS: neutrale Drei-Punkt-Beleuchtung (Fuehrungs-, Aufhell- und
 *    Gegenlicht), die der Kamera folgt. Damit bleiben Volumen ablesbar, ohne
 *    dass eine Tageszeit suggeriert wird.
 *
 * `light` und `dark` aus `SunSettings` steuern in beiden Faellen die Helligkeit
 * der beschienenen bzw. der abgeschatteten Bereiche.
 *
 * OWNERSHIP: Render-Entwickler.
 */

import * as THREE from 'three'
import { B, V } from '@/core/math'
import type { BBox3Like, SunSettings, Vec3Like } from '@/shared/types'
import { DEFAULT_SUN } from './defaults'
import { clamp } from './util'
import { solarPosition, sunVector, type SolarPosition } from './sun'

const SHADOW_MAP_SIZE = 2048

export interface LightState {
  /** Einheitsvektor vom Modell zur Sonne */
  sunDirection: Vec3Like
  position: SolarPosition
  /** true, wenn tatsaechlich Schatten geworfen werden */
  shadowsActive: boolean
  /** true, wenn die Bodenebene Schatten auffangen soll */
  groundShadows: boolean
}

export class LightRig {
  readonly group = new THREE.Group()

  private readonly sun = new THREE.DirectionalLight(0xfff4e0, 2.4)
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.6)
  private readonly hemisphere = new THREE.HemisphereLight(0xdfeaf5, 0x9d9384, 0.5)
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.5)
  private readonly fill = new THREE.DirectionalLight(0xffffff, 0.7)
  private readonly back = new THREE.DirectionalLight(0xffffff, 0.5)

  private state: LightState = {
    sunDirection: { x: 0, y: 0, z: 1 },
    position: solarPosition(DEFAULT_SUN),
    shadowsActive: false,
    groundShadows: false,
  }

  constructor() {
    this.group.name = 'lights'

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.camera.near = 0.05
    this.sun.shadow.camera.far = 200
    this.sun.target.position.set(0, 0, 0)

    for (const light of [this.key, this.fill, this.back]) light.castShadow = false

    this.group.add(
      this.sun,
      this.sun.target,
      this.ambient,
      this.hemisphere,
      this.key,
      this.key.target,
      this.fill,
      this.fill.target,
      this.back,
      this.back.target,
    )
  }

  get current(): LightState {
    return this.state
  }

  /**
   * Uebernimmt die Sonneneinstellungen.
   * `bounds` ist die Huelle des Modells, `viewDirection` die Blickrichtung der
   * Kamera (nur fuer die neutrale Beleuchtung noetig).
   */
  apply(sun: SunSettings, bounds: BBox3Like, viewDirection: Vec3Like): LightState {
    const position = solarPosition(sun)
    const direction = sunVector(position, sun.northAngle)
    const enabled = sun.enabled === true && position.elevation > 0.5

    const light = clamp(Number.isFinite(sun.light) ? sun.light : 0.8, 0, 1)
    const dark = clamp(Number.isFinite(sun.dark) ? sun.dark : 0.35, 0, 1)

    this.sun.visible = enabled
    this.key.visible = !enabled
    this.fill.visible = !enabled
    this.back.visible = !enabled

    if (enabled) {
      // Weiche Daemmerungsfarbe: je flacher die Sonne steht, desto waermer
      const warmth = clamp(1 - position.elevation / 35, 0, 1)
      this.sun.color.setRGB(1, 1 - warmth * 0.18, 1 - warmth * 0.38)
      this.sun.intensity = 0.6 + light * 2.6
      this.ambient.intensity = 0.15 + dark * 0.85
      this.hemisphere.intensity = 0.15 + dark * 0.6
      this.fitShadowCamera(bounds, direction)
    } else {
      const base = 0.35 + light * 0.9
      const forward = V.normalizeOr(viewDirection, { x: 0, y: 1, z: 0 })
      const right = V.normalizeOr(V.cross(forward, { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 })

      setDirection(this.key, V.normalizeOr(V.add(V.mul(forward, -1), V.add(V.mul(right, 0.6), { x: 0, y: 0, z: 0.75 })), {
        x: 0,
        y: 0,
        z: 1,
      }))
      setDirection(this.fill, V.normalizeOr(V.add(V.mul(forward, -0.4), V.mul(right, -1)), { x: 1, y: 0, z: 0 }))
      setDirection(this.back, V.normalizeOr(V.add(forward, { x: 0, y: 0, z: 0.35 }), { x: 0, y: 0, z: 1 }))

      this.key.intensity = base * 1.6
      this.fill.intensity = base * 0.7
      this.back.intensity = base * 0.55
      this.ambient.intensity = 0.45 + dark * 0.7
      this.hemisphere.intensity = 0.3 + dark * 0.5
    }

    this.state = {
      sunDirection: direction,
      position,
      shadowsActive: enabled && sun.onFaces !== false,
      groundShadows: enabled && sun.onGround !== false,
    }
    this.sun.castShadow = this.state.shadowsActive
    return this.state
  }

  /** Schattenkamera exakt auf die Modell-Huelle spannen. */
  private fitShadowCamera(bounds: BBox3Like, direction: Vec3Like): void {
    const box = B.isEmpty(bounds) ? { min: { x: -5, y: -5, z: 0 }, max: { x: 5, y: 5, z: 5 } } : bounds
    const center = B.center(box)
    const radius = Math.max(B.diagonal(box) * 0.5, 1)
    const distance = radius * 3

    const eye = V.addScaled(center, direction, distance)
    this.sun.position.set(eye.x, eye.y, eye.z)
    this.sun.target.position.set(center.x, center.y, center.z)
    this.sun.target.updateMatrixWorld(true)

    const cam = this.sun.shadow.camera
    const extent = radius * 1.25
    cam.left = -extent
    cam.right = extent
    cam.top = extent
    cam.bottom = -extent
    cam.near = Math.max(distance - radius * 2.5, 0.05)
    cam.far = distance + radius * 3
    cam.updateProjectionMatrix()
  }

  dispose(): void {
    this.sun.dispose()
    this.ambient.dispose()
    this.hemisphere.dispose()
    this.key.dispose()
    this.fill.dispose()
    this.back.dispose()
    this.sun.shadow.dispose()
    this.group.removeFromParent()
  }
}

/** Richtet ein Licht so aus, dass es AUS Richtung `direction` scheint. */
function setDirection(light: THREE.DirectionalLight, direction: Vec3Like): void {
  const d = V.normalizeOr(direction, { x: 0, y: 0, z: 1 })
  light.position.set(d.x * 50, d.y * 50, d.z * 50)
  light.target.position.set(0, 0, 0)
  light.target.updateMatrixWorld(true)
}
