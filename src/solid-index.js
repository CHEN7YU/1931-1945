import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

export function accelerateCollisionMesh(object) {
  if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh ||
    object.morphTargetInfluences?.length || object.userData.doorId || object.userData.doorIds ||
    object.geometry?.attributes.position?.usage === THREE.DynamicDrawUsage ||
    ![THREE.Mesh.prototype.raycast, acceleratedRaycast].includes(object.raycast)) return false;
  const geometry = object.geometry;
  const triangles = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  if (triangles < 256) return false;
  if (!geometry.boundsTree) {
    // Keep original vertices, triangle order and material groups for impact attribution.
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true, targetLeafSize: 8 });
    geometry.addEventListener('dispose', () => { delete geometry.boundsTree; });
  }
  object.raycast = acceleratedRaycast;
  return true;
}

export function createSolidIndex(solids, size = 8) {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Solid index cell size must be positive and finite');
  const cells = new Map(), global = [], dynamic = [], ray = new THREE.Ray(), point = new THREE.Vector3();
  const acceleration = { meshes: 0, triangles: 0 };
  for (const object of solids) {
    if (object.isInstancedMesh) { dynamic.push(object); continue; }
    if (accelerateCollisionMesh(object)) {
      acceleration.meshes++;
      acceleration.triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    }
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
    acceleration: Object.freeze(acceleration),
    candidates(origin, direction, distance) {
      if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Solid query requires a finite segment');
      if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].every(Number.isFinite)) throw new RangeError('Solid query requires finite position and direction');
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
      const maximumCrossings = Math.abs(tx - x) + Math.abs(tz - z) + 4;
      if (!Number.isSafeInteger(maximumCrossings)) throw new RangeError('Solid query segment exceeds the grid traversal range');
      collect(x, z);
      // End by segment time, not exact endpoint-cell equality: a rounded corner can skip that cell.
      for (let crossed = 0; crossed < maximumCrossings && Math.min(nextX, nextZ) <= 1 + 1e-10; crossed++) {
        if (Math.abs(nextX - nextZ) < 1e-10) {
          collect(x + sx, z); collect(x, z + sz);
          x += sx; z += sz; nextX += stepX; nextZ += stepZ;
        } else if (nextX < nextZ) { x += sx; nextX += stepX; }
        else { z += sz; nextZ += stepZ; }
        collect(x, z);
      }
      collect(tx, tz);
      for (const { object, bounds } of entries) {
        if (bounds.max.y < minY || bounds.min.y > maxY) continue;
        if (bounds.containsPoint(origin) || (ray.intersectBox(bounds, point) && point.distanceToSquared(origin) <= distance * distance + .001)) result.push(object);
      }
      return result;
    },
  };
}
// ---模块结束---
