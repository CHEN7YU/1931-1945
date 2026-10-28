import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOutskirtsLayout, outskirtsObstacles } from '../src/outskirts-layout.js';
import { makeTownLayout } from '../src/town-layout.js';
import { makeBaseSpawns, spawnBlockReason } from '../src/spawns.js';
import { stagingSpawns, formationPositions } from '../src/battle-roster.js';
import { MAP_LIMIT, OBJECTIVES, circleBlocked, segmentClear } from '../src/core.js';
import { SHELL_CRATERS, CRATER_EDGE } from '../src/war-damage-layout.js';

const layout = makeOutskirtsLayout(), town = makeTownLayout(), obstacles = outskirtsObstacles(layout);
test('layered outskirts fill all horizons with mixed low-rise and damaged buildings', () => {
  assert.deepEqual(makeOutskirtsLayout(), layout);
  assert.equal(layout.buildings.length, 148);
  assert.equal(obstacles.length, 148);
  assert.equal(layout.buildings.filter(house => house.near).length, 16);
  assert.ok(layout.buildings.filter(house => house.ruined).length >= 25);
  for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
    assert.ok(layout.buildings.filter(house => house[axis] * side > MAP_LIMIT).length >= 25);
  }
  for (const house of layout.buildings.filter(house => !house.near)) {
    assert.ok(Math.abs(house.x) - house.w / 2 > MAP_LIMIT || Math.abs(house.z) - house.d / 2 > MAP_LIMIT,
      `${house.id} must not be a reachable collision-free backdrop`);
  }
});

test('new closed buildings do not cover existing interiors, shell craters or objective capture circles', () => {
  for (const b of obstacles) {
    for (const house of town.buildings) {
      assert.ok(house.x + house.w / 2 < b.minX || house.x - house.w / 2 > b.maxX ||
        house.z + house.d / 2 < b.minZ || house.z - house.d / 2 > b.maxZ, house.id);
    }
    for (const crater of SHELL_CRATERS) {
      const dx = Math.max(b.minX - crater.x, 0, crater.x - b.maxX);
      const dz = Math.max(b.minZ - crater.z, 0, crater.z - b.maxZ);
      assert.ok(Math.hypot(dx, dz) > crater.radius * CRATER_EDGE, crater.id);
    }
    for (const point of OBJECTIVES) {
      const dx = Math.max(b.minX - point.x, 0, point.x - b.maxX);
      const dz = Math.max(b.minZ - point.z, 0, point.z - b.maxZ);
      assert.ok(Math.hypot(dx, dz) > point.radius, point.id);
    }
  }
});

test('all registered ground deployments retain clearance and ten-person formation space', () => {
  const allObstacles = [...town.obstacles, ...obstacles];
  for (const point of [...makeBaseSpawns(), ...stagingSpawns()].filter(point => point.kind !== 'air')) {
    assert.equal(spawnBlockReason(point, point.kind === 'garage' ? 'tank' : 'infantry', [], allObstacles), null, point.id);
    const positions = formationPositions(point, 10, allObstacles);
    assert.equal(positions.length, 10);
    for (const position of positions) assert.equal(circleBlocked(position.x, position.z, .48, allObstacles), false);
  }
  assert.equal(segmentClear({ x: 20, z: 82 }, { x: 20, z: 106 }, .46, obstacles), true,
    'the marked southern warning strip remains physically reachable and escapable');
  for (const z of [-8.1, -25.5]) assert.equal(segmentClear({ x: -51, z }, { x: 54, z }, 1.2, obstacles), true);
});

test('outskirts preserve the exterior approach to every existing side door', () => {
  for (const house of town.buildings) for (const side of [-1, 1]) {
    const faceX = house.x + side * house.w / 2;
    assert.equal(segmentClear({ x: faceX + side * .65, z: house.doorZ },
      { x: faceX + side * 2, z: house.doorZ }, .46, obstacles), true, `${house.id} side ${side}`);
  }
});

test('distant low hills are southwest only, separated from the playable town and not a mountain ring', () => {
  assert.equal(layout.hills.length, 3);
  for (const hill of layout.hills) {
    assert.ok(hill.x + hill.w / 2 < -MAP_LIMIT);
    assert.ok(hill.z - hill.d / 2 > MAP_LIMIT);
    assert.ok(hill.height >= 20 && hill.height <= 35);
    assert.ok(hill.w > hill.height * 5);
  }
});
