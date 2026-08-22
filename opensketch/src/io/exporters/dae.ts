/**
 * COLLADA-Export (.dae, Schema 1.4.1).
 *
 * Aufbau: `library_effects` -> `library_materials` -> `library_geometries`
 * -> `library_visual_scenes`. `up_axis` ist `Z_UP`, damit die Datei ohne
 * Achsentausch in SketchUp und Blender landet.
 *
 * COLLADA-Matrizen sind ZEILENweise notiert, unsere `Mat4Like` ist
 * spaltenweise - die Transponierung passiert in `matrixText()`.
 */

import type { Id, Material, Mat4Like, SketchDocument } from '@/shared/types'
import type { ExportOptions, ExportResult } from '../api-types'
import { buildDefinitionMesh, buildSceneTree, definitionList, type MeshPrimitive, type SceneNode } from '../common/scene'
import { escapeXml, hexToRgb01, num, sanitizeFilename, textBlob } from '../common/util'
import { M } from '@/core/math'

export function exportDae(doc: SketchDocument, opts: ExportOptions = {}): ExportResult {
  const scale = opts.unitScale ?? 1
  const root = buildSceneTree(doc, {
    onlyEntityIds: opts.selectionOnly ? opts.selectedEntityIds : undefined,
  })
  const definitions = definitionList(doc, root)

  /* ---- Materialien ---- */
  const materialIds = new Set<Id>()
  for (const definition of definitions) {
    for (const face of Object.values(definition.geometry.faces)) {
      if (face.frontMaterialId) materialIds.add(face.frontMaterialId)
    }
  }
  const materials = [...materialIds]
    .map((id) => doc.materials[id])
    .filter((m): m is Material => !!m)
  const materialSid = new Map<Id, string>()
  materials.forEach((m, i) => materialSid.set(m.id, `material_${i}`))

  /* ---- Geometrien ---- */
  const geometryOf = new Map<Id, { id: string; primitives: MeshPrimitive[] }>()
  definitions.forEach((definition, i) => {
    const primitives = buildDefinitionMesh(doc, definition.id, { unitScale: scale })
    if (primitives.length === 0) return
    geometryOf.set(definition.id, { id: `geometry_${i}`, primitives })
  })

  const xml: string[] = []
  xml.push('<?xml version="1.0" encoding="utf-8"?>')
  xml.push('<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">')
  xml.push(assetBlock(doc, scale))
  xml.push(effectsBlock(materials, materialSid))
  xml.push(materialsBlock(materials, materialSid))
  xml.push(geometriesBlock(doc, geometryOf, materialSid))
  xml.push(sceneBlock(root, geometryOf, materialSid, scale))
  xml.push('  <scene>')
  xml.push('    <instance_visual_scene url="#Szene"/>')
  xml.push('  </scene>')
  xml.push('</COLLADA>')
  xml.push('')

  return {
    blob: textBlob(xml.join('\n'), 'model/vnd.collada+xml'),
    filename: `${sanitizeFilename(opts.filename ?? doc.meta.name)}.dae`,
  }
}

/* ------------------------------------------------------------------ */
/* Bloecke                                                             */
/* ------------------------------------------------------------------ */

function assetBlock(doc: SketchDocument, scale: number): string {
  const created = doc.meta.createdAt || '1970-01-01T00:00:00Z'
  const modified = doc.meta.modifiedAt || created
  return [
    '  <asset>',
    '    <contributor>',
    '      <authoring_tool>OpenSketch Studio</authoring_tool>',
    `      <author>${escapeXml(doc.meta.author || 'OpenSketch')}</author>`,
    '    </contributor>',
    `    <created>${escapeXml(created)}</created>`,
    `    <modified>${escapeXml(modified)}</modified>`,
    `    <unit meter="${num(1 / (scale || 1))}" name="meter"/>`,
    '    <up_axis>Z_UP</up_axis>',
    '  </asset>',
  ].join('\n')
}

function effectsBlock(materials: Material[], sid: Map<Id, string>): string {
  const out: string[] = ['  <library_effects>']
  for (const material of materials) {
    const name = sid.get(material.id) ?? 'material'
    const [r, g, b] = hexToRgb01(material.color)
    const shininess = Math.max(1, Math.round((1 - material.roughness) * 100))
    const spec = 0.04 + material.metalness * 0.5
    out.push(`    <effect id="${name}_effect">`)
    out.push('      <profile_COMMON>')
    out.push('        <technique sid="common">')
    out.push('          <phong>')
    out.push(`            <emission><color>0 0 0 1</color></emission>`)
    out.push(`            <ambient><color>0 0 0 1</color></ambient>`)
    out.push(
      `            <diffuse><color>${num(r, 4)} ${num(g, 4)} ${num(b, 4)} ${num(material.opacity, 4)}</color></diffuse>`,
    )
    out.push(`            <specular><color>${num(spec, 4)} ${num(spec, 4)} ${num(spec, 4)} 1</color></specular>`)
    out.push(`            <shininess><float>${shininess}</float></shininess>`)
    out.push(`            <transparency><float>${num(material.opacity, 4)}</float></transparency>`)
    out.push('          </phong>')
    out.push('        </technique>')
    out.push('      </profile_COMMON>')
    out.push('    </effect>')
  }
  out.push('  </library_effects>')
  return out.join('\n')
}

function materialsBlock(materials: Material[], sid: Map<Id, string>): string {
  const out: string[] = ['  <library_materials>']
  for (const material of materials) {
    const name = sid.get(material.id) ?? 'material'
    out.push(`    <material id="${name}" name="${escapeXml(material.name || name)}">`)
    out.push(`      <instance_effect url="#${name}_effect"/>`)
    out.push('    </material>')
  }
  out.push('  </library_materials>')
  return out.join('\n')
}

function geometriesBlock(
  doc: SketchDocument,
  geometryOf: Map<Id, { id: string; primitives: MeshPrimitive[] }>,
  materialSid: Map<Id, string>,
): string {
  const out: string[] = ['  <library_geometries>']
  for (const [definitionId, geometry] of geometryOf) {
    const definition = doc.definitions[definitionId]
    // Alle Primitive teilen sich einen Vertexpuffer, die Materialgrenzen
    // liegen dann in getrennten <triangles>-Bloecken.
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const batches: { material: Id | null; indices: number[] }[] = []
    for (const prim of geometry.primitives) {
      const base = positions.length / 3
      positions.push(...prim.positions)
      normals.push(...prim.normals)
      uvs.push(...prim.uvs)
      batches.push({ material: prim.materialId, indices: prim.indices.map((i) => i + base) })
    }

    const gid = geometry.id
    out.push(`    <geometry id="${gid}" name="${escapeXml(definition?.name || gid)}">`)
    out.push('      <mesh>')
    out.push(sourceBlock(`${gid}-positions`, positions, ['X', 'Y', 'Z']))
    out.push(sourceBlock(`${gid}-normals`, normals, ['X', 'Y', 'Z']))
    if (uvs.length > 0) out.push(sourceBlock(`${gid}-uv`, uvs, ['S', 'T']))
    out.push(`        <vertices id="${gid}-vertices">`)
    out.push(`          <input semantic="POSITION" source="#${gid}-positions"/>`)
    out.push('        </vertices>')

    for (const batch of batches) {
      if (batch.indices.length < 3) continue
      // Ohne Material kein `material`-Attribut - ein Symbol, das keine
      // <instance_material> bindet, laesst Importer ins Leere greifen.
      const symbol = batch.material ? materialSid.get(batch.material) : undefined
      const bind = symbol ? ` material="${symbol}"` : ''
      out.push(`        <triangles count="${Math.floor(batch.indices.length / 3)}"${bind}>`)
      out.push(`          <input semantic="VERTEX" source="#${gid}-vertices" offset="0"/>`)
      out.push(`          <input semantic="NORMAL" source="#${gid}-normals" offset="1"/>`)
      if (uvs.length > 0) out.push(`          <input semantic="TEXCOORD" source="#${gid}-uv" offset="2" set="0"/>`)
      const stride = uvs.length > 0 ? 3 : 2
      const p: number[] = []
      for (const index of batch.indices) for (let k = 0; k < stride; k++) p.push(index)
      out.push(`          <p>${p.join(' ')}</p>`)
      out.push('        </triangles>')
    }
    out.push('      </mesh>')
    out.push('    </geometry>')
  }
  out.push('  </library_geometries>')
  return out.join('\n')
}

function sourceBlock(id: string, values: number[], params: string[]): string {
  const stride = params.length
  return [
    `        <source id="${id}">`,
    `          <float_array id="${id}-array" count="${values.length}">${values.map((v) => num(v)).join(' ')}</float_array>`,
    '          <technique_common>',
    `            <accessor source="#${id}-array" count="${Math.floor(values.length / stride)}" stride="${stride}">`,
    ...params.map((p) => `              <param name="${p}" type="float"/>`),
    '            </accessor>',
    '          </technique_common>',
    '        </source>',
  ].join('\n')
}

function sceneBlock(
  root: SceneNode,
  geometryOf: Map<Id, { id: string; primitives: MeshPrimitive[] }>,
  materialSid: Map<Id, string>,
  scale: number,
): string {
  const out: string[] = ['  <library_visual_scenes>', '    <visual_scene id="Szene" name="Szene">']
  let counter = 0

  const walk = (node: SceneNode, indent: string, isRoot: boolean): void => {
    const nodeId = `node_${counter++}`
    out.push(`${indent}<node id="${nodeId}" name="${escapeXml(node.name || nodeId)}" type="NODE">`)
    if (!isRoot && !M.isIdentity(node.transform)) {
      out.push(`${indent}  <matrix sid="transform">${matrixText(node.transform, scale)}</matrix>`)
    }
    const geometry = geometryOf.get(node.definitionId)
    if (geometry) {
      const symbols = new Set<string>()
      for (const prim of geometry.primitives) {
        const symbol = prim.materialId ? materialSid.get(prim.materialId) : undefined
        if (symbol) symbols.add(symbol)
      }
      if (symbols.size === 0) {
        // Ohne Material kein <bind_material>: das Schema verlangt in
        // <technique_common> mindestens ein <instance_material>, ein leerer
        // Block macht die Datei ungueltig.
        out.push(`${indent}  <instance_geometry url="#${geometry.id}"/>`)
      } else {
        out.push(`${indent}  <instance_geometry url="#${geometry.id}">`)
        out.push(`${indent}    <bind_material>`)
        out.push(`${indent}      <technique_common>`)
        for (const symbol of symbols) {
          out.push(`${indent}        <instance_material symbol="${symbol}" target="#${symbol}"/>`)
        }
        out.push(`${indent}      </technique_common>`)
        out.push(`${indent}    </bind_material>`)
        out.push(`${indent}  </instance_geometry>`)
      }
    }
    for (const child of node.children) walk(child, `${indent}  `, false)
    out.push(`${indent}</node>`)
  }

  walk(root, '      ', true)
  out.push('    </visual_scene>')
  out.push('  </library_visual_scenes>')
  return out.join('\n')
}

/** Spalten- nach Zeilenreihenfolge, Translation mitskaliert. */
function matrixText(m: Mat4Like, scale: number): string {
  const t = [
    m[0], m[4], m[8], m[12] * scale,
    m[1], m[5], m[9], m[13] * scale,
    m[2], m[6], m[10], m[14] * scale,
    m[3], m[7], m[11], m[15],
  ]
  return t.map((v) => num(v)).join(' ')
}
