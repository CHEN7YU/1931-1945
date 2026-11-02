import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSolidIndex } from '../src/solid-index.js';
import { SpatialGrid, obstacleLookup } from '../src/spatial.js';
import { circleBlocked } from '../src/core.js';

test('collision indexing updates new mesh and ancestor transforms before the first rendered frame', () => {
  const scene = new THREE.Scene(), parent = new THREE.Group();
  parent.position.set(12, 0, 30);
  scene.add(parent);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 3), new THREE.MeshBasicMaterial());
  wall.position.set(4, 5, -12);
  parent.add(wall);
  const index = createSolidIndex([wall]);
  const ray = new THREE.Raycaster(new THREE.Vector3(16, 1.5, 28), new THREE.Vector3(0, 0, -1), 0, 20);
  assert.equal(ray.intersectObjects(index.candidates(ray.ray.origin, ray.ray.direction, 20))[0]?.object, wall,
    'an unrendered wall must block gunfire at its real world position');
});

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
test('rays ending on rounded grid corners terminate and preserve physical intersection candidates', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), material);
  object.position.set(8, 2, 16); object.updateMatrixWorld(true);
  const solids = [object], index = createSolidIndex(solids), ray = new THREE.Raycaster();
  for (const epsilon of [-1e-12, 0, 1e-12]) for (const end of [new THREE.Vector3(8 + epsilon, 1, 16), new THREE.Vector3(16, 1, 8 + epsilon), new THREE.Vector3(-8 + epsilon, 1, -16)]) {
    const origin = new THREE.Vector3(0, 1.45, 83), direction = end.clone().sub(origin).normalize(), distance = end.distanceTo(origin);
    ray.set(origin, direction); ray.far = distance;
    assert.equal(ray.intersectObjects(index.candidates(origin, direction, distance), false)[0]?.object, ray.intersectObjects(solids, false)[0]?.object);
  }
  assert.throws(() => index.candidates(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(1, 0, 0), 10), RangeError);
  assert.ok(index.candidates(new THREE.Vector3(8, 2, 16), new THREE.Vector3(), 0).includes(object), 'a zero-length segment inside a bound terminates conservatively');
});
test('numeric cell lookup preserves rectangular query coverage across negative and positive coordinates', () => {
  const grid = new SpatialGrid(8);
  const actors = Array.from({ length: 97 }, (_, i) => ({ health: i % 7 ? 100 : 0, model: { position: { x: (i % 13 - 6) * 7.7, z: (Math.floor(i / 13) - 3) * 9.1 } } }));
  grid.rebuild(actors);
  for (const x of [-32, -8.01, -.01, 0, 7.99, 24]) for (const z of [-24, -.01, 0, 16]) for (const radius of [0, 1, 10, 75]) {
    const expected = actors.filter(actor => {
      const p = actor.model.position;
      return actor.health > 0 && Math.floor(p.x / 8) >= Math.floor((x - radius) / 8) && Math.floor(p.x / 8) <= Math.floor((x + radius) / 8) &&
        Math.floor(p.z / 8) >= Math.floor((z - radius) / 8) && Math.floor(p.z / 8) <= Math.floor((z + radius) / 8);
    });
    assert.deepEqual(new Set(grid.near(x, z, radius)), new Set(expected));
  }
  actors[1].model.position = { x: 100, z: -100 };
  grid.rebuild(actors);
  assert.ok(grid.near(100, -100, 0).includes(actors[1]));
  grid.clear();
  assert.equal(grid.near(0, 0, 1000).length, 0);
});
test('spatial obstacle lookup preserves capsule results and refreshes mutated obstacles', () => {
  const obstacles = [{ minX: -2, maxX: 2, minZ: -4, maxZ: 4 }];
  for (const size of [2, 4, 8, 16]) {
    const index = obstacleLookup(obstacles, .46, size);
    for (let x = -4; x < 4; x += .15) for (let z = -6; z < 6; z += .3) {
      assert.equal(circleBlocked(x, z, .46, index.at(x, z)), circleBlocked(x, z, .46, obstacles),
        `grid size ${size} at ${x},${z}`);
    }
    obstacles[0].minX = 10; obstacles[0].maxX = 12; index.rebuild();
    assert.equal(circleBlocked(0, 0, .46, index.at(0, 0)), false);
    assert.equal(circleBlocked(11, 0, .46, index.at(11, 0)), true);
    obstacles[0].minX = -2; obstacles[0].maxX = 2;
  }
});
