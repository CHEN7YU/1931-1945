import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { sihangRiverBounds } from '../src/sihang-layout.js';
import { circleBlocked } from '../src/core.js';

const fixture = () => {
  const scene = new THREE.Scene();
  return { scene, world: makeSihangBattlefield(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color })) };
};

test('diagonal river envelopes do not block the visibly dry quay, while real rails and water still block', () => {
  const { world } = fixture();
  for (const x of [-95, -85, 52, 60, 68, 99, 105]) {
    const banks = sihangRiverBounds(x), next = sihangRiverBounds(x + .01);
    const slope = (next.northZ - banks.northZ) / .01, offset = 1.1 * Math.hypot(1, slope);
    for (const [bank, sign] of [['northZ', -1], ['southZ', 1]]) {
      const z = banks[bank] + sign * offset;
      assert.equal(circleBlocked(x, z, .42, world.obstacles.filter(o => o.water || o.bankRail)), false,
        `Dry quay at ${x},${z}`);
      assert.equal(circleBlocked(x, banks[bank], .42, world.obstacles.filter(o => o.bankRail)), true);
    }
  }
  const feet = new THREE.Vector3(68, 0, sihangRiverBounds(68).northZ - 2.3);
  world.moveInfantry(feet, 1, sihangRiverBounds(69).northZ - sihangRiverBounds(68).northZ, .42);
  assert.ok(feet.x > 68.99, 'actual player capsule advances along the east quay instead of hitting a water AABB');
  assert.equal(world.isDeepWater(feet.x, feet.z), false);
});

test('every road triangle stays on a dry bank rather than roofing the river', () => {
  const { scene, world } = fixture(), road = scene.getObjectByName('sihang-bank-clipped-streets');
  assert.ok(road);
  const p = road.geometry.attributes.position, indices = road.geometry.index;
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    const x = ids.reduce((sum, id) => sum + p.getX(id), 0) / 3;
    const z = ids.reduce((sum, id) => sum + p.getZ(id), 0) / 3;
    const bank = sihangRiverBounds(x);
    assert.ok(z <= bank.northZ + .025 || z >= bank.southZ - .025, `Paving above water: ${x},${z}`);
  }
  assert.ok(world.staticRendering.triangles < 29000, 'clipped paving is included in the existing static budget');
});

test('city doors are inward-folding paired leaves and an open leaf remains focusable and closable', () => {
  const { scene, world } = fixture();
  const doors = world.doorSystem.doors.filter(d => d.groupId === 'warehouse-neighbor-6-front-door');
  assert.equal(doors.length, 2);
  assert.ok(doors.every(d => d.width === 1.4 && d.height === 2.65 && d.state === 'open'));
  const door = doors[0], camera = new THREE.PerspectiveCamera();
  camera.position.set(door.x + .2, 1.5, door.z + .7);
  const leafX = door.x - door.hingeDirection * door.width / 2;
  camera.lookAt(leafX, 1.5, door.z + .7);
  camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
  assert.equal(world.doorSystem.focus(camera)?.groupId, door.groupId, 'focus targets the visible swung leaf, not an empty doorway plane');
  world.doorSystem.interact(world.doorSystem.focus(camera), { x: camera.position.x, z: camera.position.z });
  world.doorSystem.update(1, []);
  assert.ok(doors.every(d => d.state === 'closed'));
  world.doorSystem.interact(door, { x: door.x, z: door.z - 2 });
  world.doorSystem.update(1, []);
  assert.ok(doors.every(d => d.state === 'open'));
  const feet = new THREE.Vector3(door.x, 0, door.z - 1.4);
  world.moveInfantry(feet, 1.5, 0, .42);
  assert.ok(feet.x > door.x + 1.49, 'short inward leaves leave the exterior alley open');
});

test('opening unrelated city doors refreshes cached floor grids instead of rebuilding the entire map', () => {
  const { world } = fixture(), start = { x: 18, y: 8.4, z: -31 }, goal = { x: 92, y: 0, z: 4 };
  assert.ok(world.elevatedPath(start, goal).length);
  const builds = world.navigationStats.builds;
  for (let i = 0; i < 4; i++) {
    const door = world.doorSystem.doors.find(d => d.id.startsWith('north-quay'));
    world.doorSystem.interact(door, { x: door.x, z: door.z - 2 }); world.doorSystem.update(1, []);
    assert.ok(world.elevatedPath(start, goal).length);
    assert.equal(world.navigationStats.builds, builds);
  }
  assert.ok(world.navigationStats.refreshes >= 4);
});
