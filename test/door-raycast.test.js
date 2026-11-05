import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeTownLayout } from '../src/town-layout.js';
import { createDoorWorld } from '../src/door-world.js';

test('simultaneous door changes refresh navigation once with individual regions and stationary steps do not rescan bounds', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial();
  const world = createDoorWorld(scene, makeTownLayout(), [], [], material, material);
  const changes = [];
  world.onNavigationChanged = (bounds, regions) => changes.push({ bounds, regions });
  const before = world.updateStats.sphereUpdates;
  for (let index = 0; index < 100; index++) world.update(.05, []);
  assert.equal(world.updateStats.sphereUpdates, before);
  for (const door of world.doors) world.interact(door, { x: door.x + 2, z: door.z + 2 });
  world.update(2, []);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].regions.length, world.doors.length);
  assert.equal(world.updateStats.navigationBatches, 1);
  assert.equal(world.updateStats.sphereUpdates, before + 1);
  world.reset();
  assert.equal(changes.length, 2);
  assert.equal(world.doors.every(door => door.angle === door.initialAngle), true);
  material.dispose();
});

test('door broad phase preserves nearest hits, material faces and instance IDs throughout opening and transformed views', t => {
  const scene = new THREE.Scene(), solids = [], material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const world = createDoorWorld(scene, makeTownLayout(), [], solids, material, material), leaf = solids[0];
  const instance = new THREE.Matrix4(), center = new THREE.Vector3();
  for (const translated of [false, true]) {
    leaf.position.set(translated ? 3 : 0, 0, translated ? -2 : 0); leaf.updateMatrixWorld(true);
    for (const step of [0, .15, .35, 1]) {
      for (const door of world.doors.filter((_, index) => index % 7 === 0)) world.interact(door, { x: door.x + 2, z: door.z + 2 });
      world.update(step, []); leaf.computeBoundingSphere();
      for (let index = 0; index < leaf.count; index += 3) {
        leaf.getMatrixAt(index, instance); center.setFromMatrixPosition(instance).applyMatrix4(leaf.matrixWorld);
        for (const offset of [[2, .03, 1], [-1, -.02, 2], [.1, 3, .1]]) {
          const origin = center.clone().add(new THREE.Vector3(...offset)), direction = center.clone().sub(origin).normalize();
          for (const far of [.1, 5, 40]) {
            const ray = new THREE.Raycaster(origin, direction, 0, far), expected = [];
            THREE.InstancedMesh.prototype.raycast.call(leaf, ray, expected);
            expected.sort((a, b) => a.distance - b.distance);
            const actual = ray.intersectObject(leaf, false);
            assert.equal(actual.length, expected.length);
            assert.equal(actual[0]?.instanceId, expected[0]?.instanceId);
            if (actual.length) {
              assert.equal(actual[0].object, leaf);
              assert.ok(actual[0].point.distanceTo(expected[0].point) < 1e-8);
              assert.equal(actual[0].face.materialIndex, expected[0].face.materialIndex);
            }
          }
        }
      }
    }
  }
  assert.ok(world.raycastStats.meshTests < world.raycastStats.bounds * .15,
    JSON.stringify(world.raycastStats));
  t.diagnostic(JSON.stringify(world.raycastStats));
});
