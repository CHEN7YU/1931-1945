import { Vector3 } from 'three';
import { bakeSurfaceGeometry } from './surface-uv.js';

export const STATIC_BATCH_CELL_SIZE = 32;

export function staticGeometryBatches(objects) {
  const batches = new Map(), center = new Vector3();
  for (const object of objects) {
    const baked = bakeSurfaceGeometry(object);
    baked.computeBoundingBox();
    baked.boundingBox.getCenter(center);
    // Only opt-in geometry can change submission order; preserve coplanar and transparent batches.
    const cell = object.material.transparent ? 'transparent'
      : object.material.userData.spatialBatch
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
