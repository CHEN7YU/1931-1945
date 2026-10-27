import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function createNraAtlas(root) {
  const materials = new Map(), keys = new Map();
  root.traverseVisible(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const key = `${material.map?.uuid ?? 'solid'}:${material.color.getHex()}`;
      keys.set(material, key);
      if (!materials.has(key)) materials.set(key, material);
    }
  });
  if (materials.size === 1) return { material: [...materials.values()][0], mapGeometry() {} };
  const canvas = document.createElement('canvas'), tile = 512, padding = 8;
  const columns = Math.ceil(Math.sqrt(materials.size)), size = columns * tile;
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Distant uniform atlas requires a 2D canvas');
  const placements = new Map();
  let index = 0;
  for (const [key, material] of materials) {
    const x = index % columns * tile, y = Math.floor(index / columns) * tile;
    context.fillStyle = material.color.getStyle(); context.fillRect(x, y, tile, tile);
    if (material.map) {
      if (!material.map.image) throw new Error('Distant uniform atlas texture was not loaded');
      context.drawImage(material.map.image, x + padding, y + padding, tile - 2 * padding, tile - 2 * padding);
      context.globalCompositeOperation = 'multiply';
      context.fillStyle = material.color.getStyle(); context.fillRect(x + padding, y + padding, tile - 2 * padding, tile - 2 * padding);
      context.globalCompositeOperation = 'source-over';
      const inner = tile - 2 * padding;
      context.drawImage(canvas, x + padding, y + padding, 1, inner, x, y + padding, padding, inner);
      context.drawImage(canvas, x + tile - padding - 1, y + padding, 1, inner, x + tile - padding, y + padding, padding, inner);
      context.drawImage(canvas, x, y + padding, tile, 1, x, y, tile, padding);
      context.drawImage(canvas, x, y + tile - padding - 1, tile, 1, x, y + tile - padding, tile, padding);
      material.map.updateMatrix();
    }
    placements.set(key, { x, y }); index++;
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .9, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute vec3 nraSkinTint;\nattribute float nraSkinRegion;\nvarying vec3 vNraSkinTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNraSkinTint = mix(vec3(1.0), nraSkinTint, nraSkinRegion);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vNraSkinTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vNraSkinTint;');
  };
  material.customProgramCacheKey = () => 'nra-atlas-skin-v1';
  const point = new THREE.Vector2();
  return {
    material,
    mapGeometry(geometry, sourceMaterials) {
      const list = Array.isArray(sourceMaterials) ? sourceMaterials : [sourceMaterials];
      const groups = Array.isArray(sourceMaterials) ? geometry.groups : [{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }];
      const originalUv = geometry.attributes.uv.clone();
      for (const group of groups) {
        const source = list[group.materialIndex], placement = placements.get(keys.get(source)), uv = geometry.attributes.uv;
        if (!placement || !uv) throw new Error('Distant uniform atlas material/UV mapping is incomplete');
        for (let vertex = group.start; vertex < group.start + group.count; vertex++) {
          point.fromBufferAttribute(originalUv, vertex);
          if (source.map) source.map.transformUv(point);
          else point.set(.5, .5);
          uv.setXY(vertex, (placement.x + padding + .5 + point.x * (tile - 2 * padding - 1)) / size,
            1 - (placement.y + padding + .5 + point.y * (tile - 2 * padding - 1)) / size);
        }
      }
    },
  };
}

export function mergeNraPose(parts, atlas) {
  const geometries = [];
  for (const { geometry, material, skin = false } of parts) {
    const expanded = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    atlas.mapGeometry(expanded, material);
    expanded.setAttribute('nraSkinRegion', new THREE.Float32BufferAttribute(
      new Float32Array(expanded.attributes.position.count).fill(skin ? 1 : 0), 1));
    expanded.clearGroups();
    for (const name of Object.keys(expanded.attributes)) if (!['position', 'normal', 'uv', 'nraSkinRegion'].includes(name)) expanded.deleteAttribute(name);
    geometries.push(expanded);
  }
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Distant uniform pose could not be merged');
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}
