import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sihangPursuitGoal, SIHANG_EMPLACEMENTS, sihangSpawns } from '../src/sihang-roster.js';
import { SIHANG_WAREHOUSE as W, sihangNorthBank } from '../src/sihang-layout.js';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { circleBlocked } from '../src/core.js';

test('stage-two infantry must actually penetrate the warehouse before pursuing the retreat corridor', () => {
  for (const index of [0, 1, 2, 5]) {
    const actor = { index: 0, formation: { index }, tactics: {}, position: { x: 0, y: 0, z: -70 } };
    const first = sihangPursuitGoal(actor);
    assert.ok(first.x > W.minX && first.x < W.maxX && first.z > W.minZ && first.z < W.maxZ);
    assert.equal(actor.tactics.sihangPursuit, 'enter-warehouse');
    assert.equal(actor.tactics.sihangEnteredWarehouse, undefined);
    actor.position = { x: -20, y: 0, z: -41 };
    assert.equal(sihangPursuitGoal(actor).x, first.x, 'merely reaching the doorway does not count as clearing the warehouse');
    actor.position = { x: first.x, y: first.y, z: first.z };
    const next = sihangPursuitGoal(actor);
    assert.equal(actor.tactics.sihangEnteredWarehouse, true);
    assert.equal(actor.tactics.sihangPursuit, 'intercept-withdrawal');
    assert.ok(next.x > W.maxX && sihangNorthBank(next, .5));
    actor.position = { x: next.x, y: 0, z: next.z };
    assert.deepEqual(sihangPursuitGoal(actor), next, 'a pursuing soldier does not turn back to clear the warehouse repeatedly');
  }
});

test('real warehouse entry goals remain capsule-clear and reachable from original enemy staging lots', () => {
  const world = makeSihangBattlefield(new THREE.Scene(), (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  for (const formationIndex of [0, 1, 2]) for (const index of [0, 5, 10]) {
    const spawn = sihangSpawns().find(point => point.id === `sihang-enemy-${formationIndex}`);
    const actor = { index, formation: { index: formationIndex }, tactics: {},
      position: { x: spawn.x, y: 0, z: spawn.z } };
    const goal = sihangPursuitGoal(actor);
    assert.equal(circleBlocked(goal.x, goal.z, .42, world.obstacles, goal.y), false, JSON.stringify(goal));
    assert.ok(world.elevatedPath(actor.position, goal).length > 0, JSON.stringify({ spawn, goal }));
  }
  const point = SIHANG_EMPLACEMENTS.find(point => point.id === 'sihang-ground-entrance-mg');
  assert.equal(point.altitude, 0); assert.equal(point.profile, 'maxim24');
  assert.ok(point.x > W.minX && point.x < W.maxX && point.z > W.minZ && point.z < W.maxZ);
});

test('warehouse surroundings have real adjacent buildings while most of the exposed river facade remains masonry', () => {
  const world = makeSihangBattlefield(new THREE.Scene(), (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  const buildings = world.town.buildings.filter(building => building.id.startsWith('warehouse-neighbor'));
  assert.ok(buildings.some(building => building.x < W.minX && Math.abs(building.z - W.z) < 18));
  assert.ok(buildings.some(building => building.x > W.maxX && Math.abs(building.z - W.z) < 18));
  assert.ok(buildings.some(building => building.z < W.minZ && building.x > W.minX && building.x < W.maxX));
  assert.ok(world.town.buildings.some(building => building.id === 'warehouse-east-annex'));
  const holes = world.landmarks.warehouse.breaches.filter(hole => hole.axis === 'x' && hole.z === W.maxZ);
  assert.equal(holes.length, 4);
  assert.ok(holes.every(hole => hole.blown && hole.bottom > W.floorHeight));
  assert.ok(holes.reduce((sum, hole) => sum + hole.width * (hole.top - hole.bottom), 0) < W.width * W.roofY * .03,
    'real shell holes occupy less than 3% of this facade, not rows of open bays');
});
