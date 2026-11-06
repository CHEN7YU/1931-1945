import test from 'node:test';
import assert from 'node:assert/strict';
import { sihangCoverContext, sihangCoverCandidates, sihangOutsideCover, sihangGroundGuardGoal } from '../src/sihang-tactics.js';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { circleBlocked } from '../src/core.js';
import { SIHANG_EMPLACEMENTS } from '../src/sihang-roster.js';
import { createEmplacement, emplacementObstacles } from '../src/emplacements.js';
import { SIHANG_STAIRWELLS, SIHANG_STAIR_ROUTES } from '../src/sihang-layout.js';

test('support goals remain twenty metres from every member, not merely from the squad centroid', () => {
  const members = Array.from({ length: 20 }, (_, index) => ({
    x: (index % 5 - 2) * 1.02, z: -48 - Math.floor(index / 5) * 1.46,
  }));
  const context = sihangCoverContext(members);
  for (const x of [-78, 0, 78]) for (let index = 0; index < 14; index++)
    for (const point of sihangCoverCandidates({ index, spawnPosition: { x, z: -90 } }, context))
      assert.equal(sihangOutsideCover(point, context), true);
  assert.equal(sihangOutsideCover({ x: 0, z: -58 }, context), false);
  assert.equal(sihangCoverContext([]), null);
  assert.throws(() => sihangCoverContext([{ x: NaN, z: 0 }]), RangeError);
});

test('eleven ground defenders have separate outside-wall interception positions', () => {
  const goals = Array.from({ length: 11 }, (_, index) => sihangGroundGuardGoal(index));
  assert.equal(new Set(goals.map(point => `${point.x}:${point.z}`)).size, 11);
  assert.ok(goals.every(point => point.y === 0 && point.z < -42));
});

test('all eleven interception goals clear actual sandbags and remain reachable from the live stationary-spawn case', () => {
  const world = makeSihangBattlefield(new THREE.Scene(),
    (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  const obstacles = [...world.obstacles,
    ...SIHANG_EMPLACEMENTS.flatMap(spec => emplacementObstacles(createEmplacement(spec)))];
  for (let index = 0; index < 11; index++) {
    const goal = sihangGroundGuardGoal(index);
    assert.equal(circleBlocked(goal.x, goal.z, .55, obstacles, 0), false, JSON.stringify(goal));
    assert.ok(world.elevatedPath({ x: 18, y: 8.4, z: -34.1 }, goal).length, JSON.stringify(goal));
  }
  for (const stair of SIHANG_STAIRWELLS) {
    const route = SIHANG_STAIR_ROUTES.find(route => route.stairId === stair.id && route.floor === 0);
    const path = world.elevatedPath({ x: 18, y: 8.4, z: -34.1 }, sihangGroundGuardGoal(0), stair.id);
    assert.ok(path.some(point => Math.hypot(point.x - route.top.x, point.z - route.top.z) < .1 &&
      Math.abs(point.y - route.top.y) < .025), `Assigned ${stair.id} is actually used`);
  }
});
