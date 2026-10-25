import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSolidIndex } from '../src/solid-index.js';
import { SpatialGrid, obstacleLookup } from '../src/spatial.js';
import { circleBlocked } from '../src/core.js';

test('indexed ray queries agree with the original physical meshes, including diagonal cells', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const solids = Array.from({ length: 50 }, (_, index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3, 1.3), material);
    mesh.position.set((index % 10 - 5) * 4, 1.5, (Math.floor(index / 10) - 2) * 5);
    mesh.rotation.y = index * .3; mesh.updateMatrixWorld(true); return mesh;
  });
  const index = createSolidIndex(solids), ray = new THREE.Raycaster();
  for (let angle = 0; angle < Math.PI * 2; angle += .07) {
    const origin = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    ray.set(origin, direction); ray.far = 80;
    const raw = ray.intersectObjects(solids, false)[0];
    const indexed = ray.intersectObjects(index.candidates(origin, direction, 80), false)[0];
    assert.equal(indexed?.object, raw?.object);
    if (raw) assert.ok(Math.abs(raw.distance - indexed.distance) < 1e-8);
  }
});
test('nearby-actor grid includes edge neighbours and excludes unrelated distant cells', () => {
  const grid = new SpatialGrid(8), a = { health: 100, model: { position: { x: 7.9, z: 0 } } }, b = { health: 100, model: { position: { x: 8.1, z: 0 } } };
  grid.rebuild([a, b]);
  assert.deepEqual(new Set(grid.near(8, 0, 1)), new Set([a, b]));
  assert.equal(grid.near(80, 80, 1).length, 0);
});
test('spatial obstacle lookup preserves capsule results and refreshes mutated obstacles', () => {
  const obstacles = [{ minX: -2, maxX: 2, minZ: -4, maxZ: 4 }];
  const index = obstacleLookup(obstacles);
  for (let x = -4; x < 4; x += .15) for (let z = -6; z < 6; z += .3) {
    assert.equal(circleBlocked(x, z, .46, index.at(x, z)), circleBlocked(x, z, .46, obstacles));
  }
  obstacles[0].minX = 10; obstacles[0].maxX = 12; index.rebuild();
  assert.equal(circleBlocked(0, 0, .46, index.at(0, 0)), false);
  assert.equal(circleBlocked(11, 0, .46, index.at(11, 0)), true);
});
