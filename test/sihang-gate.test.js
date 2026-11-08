import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { circleBlocked } from '../src/core.js';

function fixture() {
  const scene = new THREE.Scene();
  const world = makeSihangBattlefield(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  const gates = world.doorSystem.doors.filter(door => door.groupId === 'sihang-warehouse-north-gate');
  return { scene, world, gates };
}
function ray(world, x, reverse = false) {
  const origin = new THREE.Vector3(x, 1.5, reverse ? -39 : -45), direction = new THREE.Vector3(0, 0, reverse ? -1 : 1);
  const hits = new THREE.Raycaster(origin, direction, 0, 6).intersectObjects(world.solids, false);
  return hits.filter(hit => hit.object.userData.doorIds?.[hit.instanceId]?.startsWith('sihang-warehouse-north-gate'));
}

test('warehouse twin doors start closed and actually stop rays and people across the whole doorway, including the meeting seam', () => {
  const { scene, world, gates } = fixture();
  assert.equal(gates.length, 2);
  assert.ok(gates.every(door => door.state === 'closed' && door.height === 3.38 && door.thickness === .12));
  scene.updateMatrixWorld(true);
  for (const x of [-23, -21, -20, -19, -17]) {
    assert.ok(ray(world, x).length > 0, `Incoming shell ray is blocked at x=${x}`);
    assert.ok(ray(world, x, true).length > 0, 'The same gate blocks from the interior');
  }
  const feet = new THREE.Vector3(-20, 0, -44);
  world.moveInfantry(feet, 0, 5, .42);
  assert.ok(feet.z < -42.4, 'a closed gate cannot be walked through');
  assert.ok(world.elevatedPath({ x: -20, y: 0, z: -44 }, { x: -20, y: 0, z: -35 }).length,
    'AI can plan through a door portal but must actually open it before moving');
});

test('one interaction opens or closes both leaves, restores real sight lines and capsule passage, and resets to closed', () => {
  const { scene, world, gates } = fixture();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-20, 1.65, -44); camera.lookAt(-20, 1.4, -42); camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const focused = world.doorSystem.focus(camera);
  assert.equal(focused.groupId, 'sihang-warehouse-north-gate');
  assert.equal(world.doorSystem.interact(focused, { x: -20, z: -44 }), true);
  for (let frame = 0; frame < 60; frame++) world.doorSystem.update(1 / 60, []);
  assert.ok(gates.every(door => door.state === 'open'));
  assert.equal(Math.sign(gates[0].angle), -Math.sign(gates[1].angle));
  scene.updateMatrixWorld(true);
  assert.equal(ray(world, -20).length, 0);
  const feet = new THREE.Vector3(-20, 0, -44);
  world.moveInfantry(feet, 0, 7, .42);
  assert.ok(feet.z > -38 && !circleBlocked(feet.x, feet.z, .42, world.obstacles, 0));
  assert.equal(world.doorSystem.interact(gates[1], { x: -20, z: -37 }), true);
  for (let frame = 0; frame < 60; frame++) world.doorSystem.update(1 / 60, []);
  assert.ok(gates.every(door => door.state === 'closed'));
  world.doorSystem.interact(gates[0], { x: -20, z: -44 });
  world.doorSystem.update(.1, []);
  const paused = gates.map(door => door.angle); world.doorSystem.update(0, []);
  assert.deepEqual(gates.map(door => door.angle), paused);
  world.resetCampaign();
  assert.ok(gates.every(door => door.state === 'closed'));
});
