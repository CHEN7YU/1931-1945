import * as THREE from 'three';

export function createSolidIndex(solids, size = 8) {
  const cells = new Map(), global = [], dynamic = [], ray = new THREE.Ray(), point = new THREE.Vector3();
  for (const object of solids) {
    if (object.isInstancedMesh) { dynamic.push(object); continue; }
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    const entry = { object, bounds };
    const minX = Math.floor(bounds.min.x / size), maxX = Math.floor(bounds.max.x / size);
    const minZ = Math.floor(bounds.min.z / size), maxZ = Math.floor(bounds.max.z / size);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 256) { global.push(entry); continue; }
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const key = `${x},${z}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(entry);
    }
  }
  return {
    candidates(origin, direction, distance) {
      if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Solid query requires a finite segment');
      ray.set(origin, direction);
      const endX = origin.x + direction.x * distance, endZ = origin.z + direction.z * distance;
      const minY = Math.min(origin.y, origin.y + direction.y * distance), maxY = Math.max(origin.y, origin.y + direction.y * distance);
      const entries = new Set(global), result = [...dynamic];
      let x = Math.floor(origin.x / size), z = Math.floor(origin.z / size);
      const tx = Math.floor(endX / size), tz = Math.floor(endZ / size);
      const dx = endX - origin.x, dz = endZ - origin.z, sx = Math.sign(dx), sz = Math.sign(dz);
      let nextX = sx ? ((x + (sx > 0 ? 1 : 0)) * size - origin.x) / dx : Infinity;
      let nextZ = sz ? ((z + (sz > 0 ? 1 : 0)) * size - origin.z) / dz : Infinity;
      const stepX = sx ? size / Math.abs(dx) : Infinity, stepZ = sz ? size / Math.abs(dz) : Infinity;
      const collect = (x, z) => { for (const entry of cells.get(`${x},${z}`) || []) entries.add(entry); };
      while (true) {
        collect(x, z);
        if (x === tx && z === tz) break;
        if (Math.abs(nextX - nextZ) < 1e-10) {
          collect(x + sx, z); collect(x, z + sz);
          x += sx; z += sz; nextX += stepX; nextZ += stepZ;
        } else if (nextX < nextZ) { x += sx; nextX += stepX; }
        else { z += sz; nextZ += stepZ; }
      }
      for (const { object, bounds } of entries) {
        if (bounds.max.y < minY || bounds.min.y > maxY) continue;
        if (bounds.containsPoint(origin) || (ray.intersectBox(bounds, point) && point.distanceToSquared(origin) <= distance * distance + .001)) result.push(object);
      }
      return result;
    },
  };
}
// ---模块结束---
