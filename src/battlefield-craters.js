import * as THREE from 'three';
import { CRATER_EDGE, craterHeight } from './war-damage-layout.js';
import { craterGeometry } from './war-damage.js';

const distanceToRect = (x, z, rect) => Math.hypot(
  Math.max(rect.minX - x, 0, x - rect.maxX), Math.max(rect.minZ - z, 0, z - rect.maxZ));

export function selectBattlefieldCraters({ bounds, obstacles, reserved = [], spawns = [], dry }) {
  const candidates = [];
  for (let x = bounds.minX + 6; x < bounds.maxX - 6; x += 7)
    for (let z = bounds.minZ + 6; z < bounds.maxZ - 6; z += 7)
      candidates.push({ x: x + Math.sin(z * 7) * 1.4, z: z + Math.sin(x * 3) * 1.4,
        priority: Math.sin(x * 127.1 + z * 311.7) });
  candidates.sort((a, b) => a.priority - b.priority);
  const craters = [];
  for (const [radius, depth, rim] of [[2.15, .5, .13], [1.25, .3, .09], [.65, .15, .045]]) {
    let count = 0;
    for (const point of candidates) {
      const edge = radius * CRATER_EDGE;
      if (obstacles.some(rect => (rect.minY ?? rect.baseY ?? 0) < .6 && rect.height > .05 &&
        distanceToRect(point.x, point.z, rect) < edge + .8) ||
        reserved.some(rect => distanceToRect(point.x, point.z, rect) < edge + 1.5) ||
        spawns.some(spawn => Math.hypot(spawn.x - point.x, spawn.z - point.z) < edge + 9) ||
        craters.some(crater => Math.hypot(crater.x - point.x, crater.z - point.z) <
          edge + crater.radius * CRATER_EDGE + 6)) continue;
      if (![[-edge, -edge], [edge, -edge], [-edge, edge], [edge, edge], [0, 0]]
        .every(([dx, dz]) => dry(point.x + dx, point.z + dz))) continue;
      craters.push({ id: `battlefield-crater-${craters.length}`, x: point.x, z: point.z, radius, depth, rim });
      if (++count === 2) break;
    }
    if (count < 2) throw new Error(`Not enough safe dry ground for ${radius}m shell craters`);
  }
  return craters;
}

// Subtract a convex 32-sided opening from each affected triangle, including overlapping road layers.
export function cutCraterSurfaces(surfaces, craters) {
  for (const mesh of surfaces) {
    mesh.updateWorldMatrix(true, false);
    const original = mesh.geometry, geometry = original.index ? original.toNonIndexed() : original.clone();
    const points = geometry.attributes.position, uv = geometry.attributes.uv;
    const vertices = [], coordinates = [];
    const interpolate = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);
    for (let index = 0; index < points.count; index += 3) {
      let polygons = [[0, 1, 2].map(offset => {
        const n = index + offset, local = new THREE.Vector3().fromBufferAttribute(points, n);
        const world = local.clone().applyMatrix4(mesh.matrixWorld);
        return [local.x, local.y, local.z, world.x, world.z, uv?.getX(n) ?? 0, uv?.getY(n) ?? 0];
      })];
      for (const crater of craters) {
        const radius = crater.radius * CRATER_EDGE;
        polygons = polygons.flatMap(polygon => {
          if (polygon.every(vertex => vertex[3] < crater.x - radius) ||
            polygon.every(vertex => vertex[3] > crater.x + radius) ||
            polygon.every(vertex => vertex[4] < crater.z - radius) ||
            polygon.every(vertex => vertex[4] > crater.z + radius)) return [polygon];
          const outside = [];
          let inside = polygon;
          for (let side = 0; side < 32 && inside.length >= 3; side++) {
            const angle = (side + .5) / 32 * Math.PI * 2, nx = Math.cos(angle), nz = Math.sin(angle);
            const limit = radius * Math.cos(Math.PI / 32);
            const kept = [], removed = [];
            for (let i = 0; i < inside.length; i++) {
              const a = inside[i], b = inside[(i + 1) % inside.length];
              const da = (a[3] - crater.x) * nx + (a[4] - crater.z) * nz - limit;
              const db = (b[3] - crater.x) * nx + (b[4] - crater.z) * nz - limit;
              (da > 0 ? removed : kept).push(a);
              if ((da > 0) !== (db > 0)) {
                const intersection = interpolate(a, b, da / (da - db));
                kept.push(intersection); removed.push(intersection);
              }
            }
            if (removed.length >= 3) outside.push(removed);
            inside = kept;
          }
          return outside;
        });
      }
      for (const polygon of polygons) for (let n = 1; n < polygon.length - 1; n++)
        for (const vertex of [polygon[0], polygon[n], polygon[n + 1]]) {
          vertices.push(...vertex.slice(0, 3)); coordinates.push(...vertex.slice(5, 7));
        }
    }
    geometry.dispose();
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    result.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
    result.computeVertexNormals(); result.computeBoundingSphere(); result.computeBoundingBox();
    mesh.geometry = result; original.dispose();
  }
}

export function addBattlefieldCraters(scene, surfaces, solids, craters, material) {
  cutCraterSurfaces(surfaces, craters);
  const earth = material.clone(); earth.vertexColors = true;
  for (const crater of craters) {
    const mesh = new THREE.Mesh(craterGeometry(crater, 0, craters, 32, 12), earth);
    mesh.name = crater.id; mesh.receiveShadow = true; scene.add(mesh); solids.push(mesh);
  }
  return (x, z) => craterHeight(x, z, craters);
}
