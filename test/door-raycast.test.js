import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeTownLayout } from '../src/town-layout.js';
import { createDoorWorld } from '../src/door-world.js';

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
