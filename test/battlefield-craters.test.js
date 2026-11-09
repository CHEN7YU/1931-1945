import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { selectBattlefieldCraters, addBattlefieldCraters } from '../src/battlefield-craters.js';
import { createBuildingFire } from '../src/building-fire.js';

test('shell bowls cut every overlapping ground and rotated road layer and have matching physical depths', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial(), solids = [];
  for (const [width, depth, angle] of [[40, 40, 0], [8, 35, .37]]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.set(-Math.PI / 2, 0, angle); mesh.position.y = .005;
    scene.add(mesh); solids.push(mesh);
  }
  const craters = [{ id: 'large', x: 0, z: 0, radius: 2.15, depth: .5, rim: .13 },
    { id: 'small', x: 9, z: 0, radius: .65, depth: .15, rim: .045 }];
  const height = addBattlefieldCraters(scene, [...solids], solids, craters, material);
  scene.updateMatrixWorld(true);
  for (const crater of craters) for (const fraction of [0, .3, .7, .95]) for (let angle = 0; angle < 6.28; angle += .7) {
    const x = crater.x + Math.cos(angle) * crater.radius * fraction;
    const z = crater.z + Math.sin(angle) * crater.radius * fraction;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(solids);
    assert.ok(hits.length && Math.abs(hits[0].point.y - height(x, z)) < .018,
      `A flat cap or unsupported bowl remains at ${x}, ${z}: ${hits[0]?.point.y} vs ${height(x, z)}`);
  }
});

test('deterministic crater selection protects buildings, water, spawn zones and tactical corridors', () => {
  const options = { bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    obstacles: [{ minX: -15, maxX: 15, minZ: -15, maxZ: 15, height: 6 }],
    reserved: [{ minX: -60, maxX: 60, minZ: 20, maxZ: 25 }],
    spawns: [{ x: 35, z: 35 }], dry: (x, z) => x < 42 };
  const craters = selectBattlefieldCraters(options);
  assert.deepEqual(craters, selectBattlefieldCraters(options));
  assert.equal(craters.length, 6);
  assert.equal(new Set(craters.map(crater => crater.radius)).size, 3);
  for (const crater of craters) {
    assert.ok(crater.x + crater.radius * 1.35 < 42);
    assert.ok(Math.hypot(crater.x - 35, crater.z - 35) > crater.radius * 1.35 + 9);
    assert.ok(crater.z + crater.radius * 1.35 < 20 || crater.z - crater.radius * 1.35 > 25);
  }
});

test('damaged houses get bounded batched fire and smoke; simulation pause, low quality and smoke toggle remain coherent', () => {
  const scene = new THREE.Scene();
  const fire = createBuildingFire(scene, [{ id: 'burning', x: 0, z: 2, width: 8, damaged: true },
    { id: 'ruined', x: 10, z: 2, w: 6, ruined: true }, { id: 'intact', x: 20, z: 2 }]);
  fire.update(12);
  assert.deepEqual(fire.snapshot, { sources: 2, smoke: 16, flames: 6, drawCalls: 2 });
  const matrices = scene.children.map(mesh => [...mesh.instanceMatrix.array]);
  fire.update(12);
  assert.deepEqual(scene.children.map(mesh => [...mesh.instanceMatrix.array]), matrices);
  fire.update(13, { low: true });
  assert.deepEqual(fire.snapshot, { sources: 2, smoke: 6, flames: 2, drawCalls: 2 });
  fire.update(13, { low: true, smoke: false });
  assert.deepEqual(fire.snapshot, { sources: 2, smoke: 0, flames: 2, drawCalls: 1 });
  assert.ok(scene.children.every(mesh => mesh.isInstancedMesh && !mesh.material.depthWrite));
});
