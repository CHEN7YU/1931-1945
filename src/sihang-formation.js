import * as THREE from 'three';
import { soldierModel } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointSegmentDistance } from './tactics.js';
import { SIHANG_BATTLE_AREA, SIHANG_WAREHOUSE } from './sihang-layout.js';
import { SIHANG_RULES } from './sihang-campaign.js';

export const SIHANG_ASSEMBLY_ARRIVAL = .015;
const ASSEMBLY_CENTERS = [-28, -22.8, -17.6, -12.4, -7.2, -2, 3.2, 8.4, 28, 33.2, 17];
export const SIHANG_ASSEMBLY_APPROACH_MAX_X = Math.max(...ASSEMBLY_CENTERS) + 2.4;
const assemblyCenter = slot => ASSEMBLY_CENTERS[slot];

export function sihangAssemblyPosition(slot, index) {
  if (!Number.isInteger(slot) || slot < 0 || slot > SIHANG_RULES.retreatSquads ||
    !Number.isInteger(index) || index < 0 || index > 10)
    throw new RangeError('Invalid Sihang assembly position');
  const center = assemblyCenter(slot);
  if (index === 2) return { x: center + 1.6, y: 0, z: -4,
    transit: true, assembly: true, assemblyRank: 'officer' };
  const rank = index < 2 ? index : index - 1;
  return { x: center - Math.floor(rank / 5) * 1.6, y: 0,
    z: -5.5 + rank % 5 * .75, transit: true, assembly: true,
    assemblyRank: rank < 5 ? 'front' : 'rear' };
}

export function sihangRetreatFollowPosition(actor, player, desired) {
  const { x, y, z } = player.position;
  const blend = Math.max(0, Math.min(1, (x + 35) / 8, (34 - x) / 8,
    z + 8, .5 - z, (.6 - Math.abs(y)) / .3));
  if (!blend) return desired;
  const rank = actor.index - Number(actor.index > player.index);
  const row = { x: x + (rank % 2 ? -1 : 1) * (Math.floor(rank / 2) + 1) * 1.8,
    z: -6.7 };
  return { x: desired.x + (row.x - desired.x) * blend,
    z: desired.z + (row.z - desired.z) * blend };
}

export function sihangRetreatBlockedWaypoint(actor, waypoint, neighbors) {
  return Math.hypot(actor.position.x - waypoint.x, actor.position.z - waypoint.z) < 1.2 &&
    neighbors.some(other => other !== actor && other.health > 0 && !other.vehicleId &&
      Math.abs(other.position.y - actor.position.y) < 1.5 &&
      Math.hypot(other.position.x - waypoint.x, other.position.z - waypoint.z) < .9);
}

export function sihangRetreatYieldPosition(actor, waiting, clear) {
  const direction = waiting.tactics.traffic?.direction;
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.z) ||
    Math.hypot(direction.x, direction.z) < .9) return null;
  const start = waiting.position;
  const end = { x: start.x + direction.x * 2.5, z: start.z + direction.z * 2.5 };
  const previous = pointSegmentDistance(actor.position, start, end).distance;
  let best = null, bestScore = 0;
  for (const radius of [1.2, 1.8]) {
    for (let index = 0; index < 16; index++) {
      const angle = index * Math.PI / 8;
      const goal = { x: actor.position.x + Math.cos(angle) * radius, y: actor.position.y,
        z: actor.position.z + Math.sin(angle) * radius, transit: true };
      const clearance = pointSegmentDistance(goal, start, end).distance;
      if (clearance < 1.15 || clearance < previous + .25 || !clear(goal)) continue;
      const score = clearance - radius * .3;
      if (score > bestScore) { best = goal; bestScore = score; }
    }
  }
  return best;
}

export function sihangAssemblyApproach(position, goal, blockers = []) {
  const aisleZ = -1.1;
  const approachX = goal.x + (goal.assemblyRank === 'rear' ? -.8 : .8);
  if (position.x < SIHANG_WAREHOUSE.minX)
    return [{ ...goal, x: position.x, z: aisleZ }, { ...goal, x: approachX, z: aisleZ },
      { ...goal, x: approachX, z: goal.z }, goal];
  const entryColumns = Array.from({ length: SIHANG_RULES.retreatSquads + 1 }, (_, slot) => {
    const center = assemblyCenter(slot);
    return [center - 2.4, center - .8, center + .8, center + 2.4];
  }).flat().sort((a, b) => Math.abs(a - position.x) - Math.abs(b - position.x));
  const routes = entryColumns.map(entryColumn => {
    const entry = Math.abs(position.z - aisleZ) > .3
      ? [{ ...goal, x: entryColumn, z: position.z }, { ...goal, x: entryColumn, z: aisleZ }] : [];
    return [...entry, { ...goal, x: approachX, z: aisleZ },
      { ...goal, x: approachX, z: goal.z }, goal];
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
