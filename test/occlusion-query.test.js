import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcclusionQuery } from '../src/occlusion-query.js';
import { accelerateCollisionMesh, createSolidIndex } from '../src/solid-index.js';

test('boolean occlusion matches complete queries across dense meshes, sides, ranges and transforms', () => {
  const query = createOcclusionQuery();
  for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    const material = new THREE.MeshBasicMaterial({ side });
    const meshes = [new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material),
      new THREE.Mesh(new THREE.BoxGeometry(1, 3, .12), material)];
    meshes[0].position.set(1, .2, -3); meshes[0].scale.set(1.2, .8, 1.1);
    meshes[1].position.set(-1, .3, -2); meshes[1].rotation.y = .4;
    for (const mesh of meshes) { mesh.updateMatrixWorld(true); accelerateCollisionMesh(mesh); }
    for (let index = 0; index < 100; index++) {
      const start = new THREE.Vector3(Math.sin(index * 2.3) * 3, Math.cos(index * .7), .1);
      const end = new THREE.Vector3(Math.sin(index * 1.9) * 2, Math.cos(index * .9), -5);
      const ray = new THREE.Raycaster(start, end.sub(start).normalize(), index % 3 ? 0 : .3, index % 5 ? 8 : .1);
      assert.equal(query(ray, meshes), ray.intersectObjects(meshes, true).length > 0);
      assert.equal(Object.hasOwn(ray, 'firstHitOnly'), false, 'nearest-hit consumers must not inherit the flag');
      ray.firstHitOnly = false;
      assert.equal(query(ray, meshes), ray.intersectObjects(meshes, true).length > 0);
      assert.equal(ray.firstHitOnly, false);
    }
  }
});

test('a real blocker stops later work, without turning a missed or filtered object into an obstruction', () => {
  const query = createOcclusionQuery(), ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -1), 0, 4);
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshBasicMaterial());
  blocker.updateMatrixWorld(true);
  const later = new THREE.Mesh(); later.raycast = () => { throw new Error('unnecessary later query'); };
  assert.equal(query(ray, [blocker, later]), true);
  blocker.layers.set(1);
  assert.equal(query(ray, [blocker]), false);
  blocker.layers.set(0);
  const group = new THREE.Group(); group.add(blocker);
  assert.equal(query(ray, [group], false), false);
  assert.equal(query(ray, [group], true), true);
  const failure = new THREE.Mesh(); failure.raycast = () => { throw new Error('explicit collision failure'); };
  ray.firstHitOnly = false;
  assert.throws(() => query(ray, [failure]), /explicit collision failure/);
  assert.equal(ray.firstHitOnly, false);
  assert.equal(query(ray, []), false, 'scratch intersections cannot leak between calls');
});

test('short indexed support and muzzle rays retain nearest surfaces and moving door instances', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 20, 20), material);
  floor.rotation.x = -Math.PI / 2; floor.updateMatrixWorld(true);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, .1), material);
  wall.position.set(0, 1.5, -2); wall.updateMatrixWorld(true);
  const door = new THREE.InstancedMesh(new THREE.BoxGeometry(.8, 2, .1), material, 1);
  door.userData.doorIds = ['test-door']; door.updateMatrixWorld(true);
  const solids = [floor, wall, door], index = createSolidIndex(solids);
  for (const x of [-.8, 0, .8]) {
    door.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 1, -.5));
    door.computeBoundingSphere();
    for (const [origin, direction, far] of [
      [[0, 1, .1], [0, 0, -1], 1.2], [[.2, .5, -.5], [0, -1, 0], .7],
      [[.2, 1, -.3], [0, 0, -1], .1], [[0, 1, -.1], [0, 0, -1], 3],
    ]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, far);
      const raw = ray.intersectObjects(solids, false)[0];
      const selected = ray.intersectObjects(index.candidates(ray.ray.origin, ray.ray.direction, far), false)[0];
      assert.equal(selected?.object, raw?.object);
      assert.equal(selected?.instanceId, raw?.instanceId);
      if (raw) assert.ok(selected.point.distanceTo(raw.point) < 1e-8);
    }
  }
});
