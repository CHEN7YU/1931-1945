import { Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeSurfaceGeometry } from './surface-uv.js';

export const STATIC_BATCH_CELL_SIZE = 32;

export function staticGeometryBatches(objects, { spatial = false, preserveUV = false } = {}) {
  const batches = new Map(), center = new Vector3();
  for (const object of objects) {
    const baked = bakeSurfaceGeometry(object, { preserveUV });
    baked.computeBoundingBox();
    baked.boundingBox.getCenter(center);
    // Only opt-in geometry can change submission order; preserve coplanar and transparent batches.
    const cell = object.material.transparent ? 'transparent'
      : spatial || object.material.userData.spatialBatch
        ? `${Math.floor(center.x / STATIC_BATCH_CELL_SIZE)},${Math.floor(center.z / STATIC_BATCH_CELL_SIZE)}` : 'global';
    if (!batches.has(object.material)) batches.set(object.material, new Map());
    const material = batches.get(object.material);
    if (!material.has(cell)) material.set(cell, []);
    material.get(cell).push(baked.index ? baked.toNonIndexed() : baked);
    if (baked.index) baked.dispose();
    object.removeFromParent();
  }
  return batches;
}

export function batchStaticScene(scene, objects) {
  const groups = new Map(), meshes = [];
  let triangles = 0;
  for (const object of objects) {
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh || !object.visible ||
      Array.isArray(object.material) || object.material.transparent) throw new Error('Static scene batching requires visible opaque non-animated meshes');
    const attributes = Object.entries(object.geometry.attributes).map(([name, attribute]) =>
      `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).sort().join(',');
    const key = `${object.castShadow}:${object.receiveShadow}:${object.renderOrder}:${attributes}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  }
  scene.updateMatrixWorld(true);
  for (const group of groups.values()) {
    const source = group[0];
    for (const [material, cells] of staticGeometryBatches(group, { spatial: true, preserveUV: true })) {
      for (const [cell, geometries] of cells) {
        const geometry = mergeGeometries(geometries);
        if (!geometry) throw new Error('Compatible static scene geometry failed to merge');
        const mesh = new Mesh(geometry, material);
        mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
        mesh.renderOrder = source.renderOrder;
        mesh.userData.staticSceneBatch = true; mesh.userData.staticCell = cell;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        scene.add(mesh); meshes.push(mesh);
        for (const baked of geometries) baked.dispose();
      }
    }
  }
  return { sources: objects.length, batches: meshes.length, triangles, cellSize: STATIC_BATCH_CELL_SIZE };
}
