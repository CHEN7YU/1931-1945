import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dryRiverGeometry, sedimentDepositAt, dryRiverDetails, siltPatchGeometry } from '../src/dry-river.js';
import { BRIDGE, RIVER, riverBedHeight } from '../src/ground.js';

test('rendered dry terrain uses the same irregular heights as movement and meets the dry ground', () => {
  const geometry = dryRiverGeometry(), positions = geometry.attributes.position;
  assert.equal(geometry.attributes.color.count, positions.count);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
    assert.ok(Math.abs(y - (riverBedHeight(x, z) - .035)) < 1e-6);
    if (Math.abs(z - RIVER.centerZ) === RIVER.bankHalfWidth) assert.ok(Math.abs(y + .035) < 1e-6);
    assert.ok(geometry.attributes.normal.getY(i) > .9);
  }
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  object.updateMatrixWorld(true);
  for (const x of [-95, -48, -1, 17, 56, 95]) for (const z of [-22, -19, -16, -12, -10]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(object)[0];
    assert.ok(hit, 'the riverbed has an upward-facing, gap-free surface');
    assert.ok(Math.abs(hit.point.y - (riverBedHeight(x, z) - .035)) < .012);
  }
  geometry.dispose(); object.material.dispose();
});

test('dry detail placement is deterministic, on terrain and clear of the bridge', () => {
  const details = dryRiverDetails();
  assert.deepEqual(dryRiverDetails(), details);
  assert.ok(details.stones.length > 450);
  assert.ok(details.grass.length > 20);
  assert.ok(details.silt.length > 15);
  for (const item of [...details.stones, ...details.grass]) {
    assert.ok(item.x <= BRIDGE.minX - 2 || item.x >= BRIDGE.maxX + 2);
    assert.equal(item.y, riverBedHeight(item.x, item.z) - .035);
  }
  for (const patch of details.silt) {
    const geometry = siltPatchGeometry(patch), positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.abs(positions.getY(i) - (riverBedHeight(positions.getX(i), positions.getZ(i)) - .019)) < 1e-6);
    }
    geometry.dispose();
  }
});

test('sediment varies in both directions as broken patches, not parallel continuous tire-like bands', () => {
  let along = 0, across = 0, pale = 0, dark = 0;
  for (let x = -100; x < 100; x += .5) for (let z = -20; z < -12; z += .5) {
    const deposit = sedimentDepositAt(x, z);
    assert.ok(deposit >= 0 && deposit <= 1);
    assert.equal(sedimentDepositAt(x, z), deposit);
    along += Math.abs(deposit - sedimentDepositAt(x + .5, z));
    across += Math.abs(deposit - sedimentDepositAt(x, z + .5));
    if (deposit > .65) pale++;
    if (deposit < .35) dark++;
  }
  assert.ok(along / across > .7 && along / across < 1.4, 'no preferred long stripe direction');
  assert.ok(pale > 500 && dark > 500, 'both sand deposits and exposed darker mud remain visible');
});
