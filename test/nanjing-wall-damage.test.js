import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { NANJING_GATE_Z, NANJING_GATE_TUNNEL } from '../src/nanjing-layout.js';

test('damaged flanks render real recessed masonry without opening a new route', () => {
  const scene = new THREE.Scene();
  const world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  const colliders = world.solids.filter(mesh => mesh.userData.nanjingBattleDamage);
  const renderBatches = scene.children.filter(mesh => mesh.userData.staticSceneBatch);
  const direction = new THREE.Vector3(0, 0, -1);
  for (const [x, y] of [[-42, 4], [74, 3.8]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 20.7), direction, 0, 6);
    const [collision] = ray.intersectObjects(colliders, false);
    const [visible] = ray.intersectObjects(renderBatches, false);
    assert.ok(collision && visible && visible.distance > collision.distance + .1,
      'the visible face goes inward while the original wall still blocks the route');
  }
  for (const x of [-42.7, 72.8]) {
    const plume = world.smoke.filter(puff => puff.userData.originX === x);
    assert.ok(plume.length > 1 && plume.every(puff => puff.parent === scene && puff.userData.rise < 20));
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 12, 19.95), new THREE.Vector3(0, -1, 0), 0, 12);
    const [collision] = ray.intersectObjects(colliders, false);
    const [visible] = ray.intersectObjects(renderBatches, false);
    assert.ok(collision && visible && visible.distance > collision.distance + 1,
      'the broken edge interrupts the silhouette rather than just changing the color');
    assert.equal(world.walkHeight(x, 17.4, collision.point.y), collision.point.y);
  }
  for (const [wall, x, z] of [['west', -70.25, -32], ['north', -31, -111.25]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 14, z), new THREE.Vector3(0, -1, 0), 0, 14);
    const [collision] = ray.intersectObjects(colliders.filter(mesh => mesh.userData.nanjingBattleDamage === wall), false);
    const [visible] = ray.intersectObjects(renderBatches, false);
    assert.ok(collision && visible && visible.distance > collision.distance + 1,
      `${wall}: the rendered parapet breaks without removing the original wall body`);
  }
  assert.equal(new Set(world.smoke.filter(puff => puff.userData.rise === 10)
    .map(puff => puff.userData.homeId)).size, 4);
  assert.ok(scene.children.some(mesh => mesh.userData.nanjingFeature === 'wall-foot-rubble' && mesh.isInstancedMesh));
  assert.ok(world.landmarks.trees.length >= 25 && world.landmarks.trees.every(tree => tree.dead));
  assert.equal(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'city-tree').length,
    world.landmarks.trees.length, 'retain the trunks without any foliage meshes');
  const front = NANJING_GATE_Z + NANJING_GATE_TUNNEL.depth / 2;
  const marks = scene.children.find(mesh => mesh.userData.nanjingFeature === 'masonry-shell-pocks')
    .geometry.attributes.position;
  const gateMarks = [];
  for (let i = 0; i < marks.count; i++) {
    if (Math.abs(marks.getZ(i) - front - .008) < .001) gateMarks.push(marks.getX(i));
  }
  assert.ok(gateMarks.some(x => x < -3) && gateMarks.some(x => x > 3));
  assert.ok(gateMarks.every(x => Math.abs(x) > NANJING_GATE_TUNNEL.width / 2));
  assert.ok(world.solids.filter(mesh => mesh.userData.nanjingFeature === 'gate-rubble')
    .every(mesh => Math.abs(mesh.position.x) - Math.hypot(mesh.scale.x, mesh.scale.z) / 2 >
      NANJING_GATE_TUNNEL.width / 2), 'loose bricks leave the arch approach clear');
});
