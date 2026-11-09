import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { sihangRiverBounds, SIHANG_WAREHOUSE as W } from '../src/sihang-layout.js';

test('reference topology puts the broad bay west of the warehouse and keeps its southern quay unbuilt', () => {
  const world = makeSihangBattlefield(new THREE.Scene(), (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  assert.ok(sihangRiverBounds(-72).northZ > sihangRiverBounds(W.x).northZ + 15);
  for (let x = W.minX; x <= W.maxX; x += 2)
    assert.equal(sihangRiverBounds(x).northZ - W.maxZ, 8, 'a narrow clear quay, not a row of riverside houses');
  for (const building of world.town.buildings.slice(1)) {
    const r = building.bounds;
    assert.equal(r.minX < W.maxX && r.maxX > W.minX && r.minZ < 0 && r.maxZ > W.maxZ, false, building.id);
  }
  assert.ok(world.town.buildings.some(b => b.x < W.minX), 'west-side city blocks remain');
  assert.ok(world.town.buildings.some(b => b.z < W.minZ), 'north-side city blocks remain');
});
