import * as THREE from 'three';
import { soldierModel } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointSegmentDistance } from './tactics.js';
import { SIHANG_BATTLE_AREA } from './sihang-layout.js';

export const SIHANG_ASSEMBLY_ARRIVAL = .06;

export function sihangAssemblyPosition(slot, index) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 5 || !Number.isInteger(index) || index < 0 || index > 10)
    throw new RangeError('Invalid Sihang assembly position');
  // Two squads per rank leave actual walking aisles on the shallow southern quay.
  return { x: -29 + ((slot % 2) * 11 + index) * 2.4, y: 0,
    z: -6.5 + Math.floor(slot / 2) * 2.4, transit: true, assembly: true };
}

export function sihangAssemblyApproach(position, goal, blockers = []) {
  const aisleZ = position.z < -4.1 ? -5.3 : -2.9;
  const rankAisle = Math.min(-2.9, goal.z + 1.2);
  const entryX = -27.8 + Math.round((position.x + 27.8) / 2.4) * 2.4;
  const entry = Math.abs(position.z - aisleZ) > .3 ? [{ ...goal, x: entryX, z: position.z }] : [];
  const routes = [1.2, -1.2].map(offset => {
    const column = goal.x + offset;
    return [...entry, { ...goal, x: entry.length ? entryX : position.x, z: aisleZ }, { ...goal, x: column, z: aisleZ },
      { ...goal, x: column, z: rankAisle }, { ...goal, z: rankAisle }, goal];
  });
  return routes.find(route => route.every((point, index) => blockers.every(blocker =>
    pointSegmentDistance(blocker, index ? route[index - 1] : position, point).distance >= .95))) ?? routes[0];
}

export function sihangParadePosition(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 40) throw new RangeError('Invalid evacuated formation position');
  // Fill the furthest rank first so newcomers do not walk through a completed front rank.
  return { x: 56 + index % 4 * 1.5, y: 0, z: 62 - Math.floor(index / 4) * 1.6, transit: true, parade: true };
}

export function sihangParadeExit(tail = false) {
  // Aim beyond the passage so route arrival cannot stop a soldier just short of crossing.
  return { x: 64, y: 0, z: tail ? 65.2 : 73.15,
    passageZ: tail ? 64.5 : SIHANG_BATTLE_AREA.maxZ, transit: true, parade: true, exit: !tail };
}

export function sihangParadePassage(position, goal) {
  if (![position?.x, position?.y, position?.z, goal?.x, goal?.z, goal?.passageZ].every(Number.isFinite) ||
    typeof goal.exit !== 'boolean') throw new RangeError('Parade passage requires a finite position and an exit route');
  return Math.abs(position.y) < .3 && (goal.exit ? position.z > goal.passageZ
    : position.z >= goal.passageZ && Math.abs(position.x - goal.x) <= 2.4);
}

export function createProceduralStaticFormation(scene, capacity = 40) {
  const template = soldierModel(true, 'far', 'rifle'), root = new THREE.Group();
  root.name = 'evacuated-static-formation'; scene.add(root);
  const materials = new Map();
  for (const source of template.children) {
    source.updateMatrix();
    const geometry = source.geometry.clone().applyMatrix4(source.matrix);
    if (!materials.has(source.material)) materials.set(source.material, []);
    materials.get(source.material).push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
  }
  const parts = [...materials].map(([material, geometries]) => {
    const geometry = mergeGeometries(geometries);
    for (const source of geometries) source.dispose();
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0; mesh.receiveShadow = true; root.add(mesh);
    return { mesh };
  });
  const matrix = new THREE.Matrix4(), body = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  let count = 0;
  return {
    root,
    add(actor, position, heading = 0) {
      if (count >= capacity) throw new RangeError('Static formation exceeds the original troop budget');
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      body.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      for (const { mesh } of parts) {
        mesh.setMatrixAt(count, matrix.copy(body)); mesh.count = count + 1;
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      }
      count++;
    },
    reset() { count = 0; for (const { mesh } of parts) mesh.count = 0; },
    get count() { return count; },
    get batches() { return count ? parts.length : 0; },
  };
}
