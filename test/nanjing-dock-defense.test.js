import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { createNavigator, segmentClear } from '../src/core.js';
import { NANJING_DOCK_BUFFER, nanjingDockInside, nanjingDockOutsideGoal,
  nanjingDockAssaultGoal, nanjingDockBufferActive, nanjingDockPathClear,
  nanjingDockPostOutsideBuildings, assignNanjingDockDefense } from '../src/nanjing-dock-defense.js';
import { assignNanjingDefense, nanjingDefenseGoal, nanjingCoreGuard } from '../src/nanjing-defense.js';
import { NANJING_DOCK, NANJING_DOCK_ASSAULT_SPAWNS, NANJING_DOCK_SHIFT, NANJING_SPAWNS } from '../src/nanjing-campaign.js';
import { civilianWaitingSlot, NANJING_CIVILIAN_COUNT } from '../src/civilian-crowd.js';
import { formationPositions } from '../src/battle-roster.js';

let world;
before(() => {
  world = makeNanjingBattlefield(new THREE.Scene(),
    (_kind, color = 0x777777) => new THREE.MeshStandardMaterial({ color }));
});

test('the real civilian queue is behind the exclusion boundary, not just its visible marker', () => {
  for (let index = 0; index < NANJING_CIVILIAN_COUNT; index++)
    assert.ok(nanjingDockInside(civilianWaitingSlot(index)));
  assert.equal(nanjingDockBufferActive('gate-defense'), false);
  assert.equal(nanjingDockBufferActive('withdrawal'), false);
  assert.equal(nanjingDockBufferActive('dock-defense'), true);
  assert.equal(nanjingDockBufferActive('withdrawal-to-boats'), true);
  const outside = { x: -50, z: -80 };
  assert.equal(nanjingDockOutsideGoal(outside), outside);
  assert.equal(nanjingDockInside(nanjingDockOutsideGoal({ x: -66 + NANJING_DOCK_SHIFT, z: -80 }, .6), .6), false);
});

test('a shared route cannot shortcut through the waiting area when both endpoints are outside', () => {
  const start = { x: -65 + NANJING_DOCK_SHIFT, z: -95 }, end = { x: -65 + NANJING_DOCK_SHIFT, z: -65 };
  assert.equal(nanjingDockPathClear(start, [end]), false);
  assert.equal(nanjingDockPathClear(start, [{ x: NANJING_DOCK_BUFFER.maxX + 1, z: -95 }, { x: NANJING_DOCK_BUFFER.maxX + 1, z: -65 }, end]), true);
});

test('all four autonomous squads have distinct reachable outer posts, without redirecting the player squad', () => {
  const actors = Array.from({ length: 5 }, (_, index) => {
    const formation = { index, reserve: false };
    return Array.from({ length: 11 }, (_, slot) => ({ id: `${index}-${slot}`, index: slot, formation,
      friendly: true, playerUnit: index === 0, health: 100, tactics: {} }));
  }).flat();
  const clear = point => nanjingDockPostOutsideBuildings(point, world.landmarks.residentialBuildings) &&
    Math.abs(world.walkHeight(point.x, point.z, 0)) < .1 &&
    !world.obstacles.some(obstacle => {
      return !segmentClear(point, point, .5, [obstacle]);
    });
  const guards = assignNanjingDockDefense(actors, clear);
  assert.equal(guards.length, 44);
  assert.ok(actors.filter(a => a.playerUnit).every(a => !a.tactics.nanjingDockDefense));
  const posts = guards.map(actor => actor.tactics.nanjingDockDefense);
  for (const [index, post] of posts.entries()) {
    assert.ok(!nanjingDockInside(post, .65) && clear(post));
    for (const other of posts.slice(index + 1)) assert.ok(Math.hypot(post.x - other.x, post.z - other.z) >= 1.45);
  }
  const planner = createNavigator([...world.doorSystem.navigationObstacles, NANJING_DOCK_BUFFER]);
  for (const id of ['nanjing-west-ai-1', 'nanjing-west-ai-2']) {
    const spawn = NANJING_SPAWNS.find(point => point.id === id);
    const positions = formationPositions(spawn, 11, world.obstacles);
    assert.equal(positions.length, 11);
    assert.ok(positions.every(point => !nanjingDockInside(point, .5)), 'reinforcements spawn outside the queue too');
    assert.ok(Math.hypot(spawn.x - NANJING_DOCK.x, spawn.z - NANJING_DOCK.z) < 25);
    for (const post of posts) {
      const path = planner(positions[0], post);
      assert.ok(path.length, `${id} cannot reach ${JSON.stringify(post)} from ${JSON.stringify(positions[0])}: ${planner.stats.reason}`);
      assert.ok(path.some(point => point.x > -74), 'the squad must pass through the west wall');
    }
  }
  const entrance = { x: -56, z: -61 };
  for (const post of posts) {
    const path = planner(entrance, post);
    assert.ok(path.length, `outer post unreachable: ${JSON.stringify(post)}`);
    assert.ok(nanjingDockPathClear(entrance, path));
  }
  assignNanjingDockDefense(actors, clear);
  assert.deepEqual(guards.map(a => a.tactics.nanjingDockDefense), posts, 'quiet posts do not churn every update');
  for (const spawnId of NANJING_DOCK_ASSAULT_SPAWNS) {
    const start = NANJING_SPAWNS.find(spawn => spawn.id === spawnId);
    const actor = { formation: { index: NANJING_DOCK_ASSAULT_SPAWNS.indexOf(spawnId) }, index: 0 };
    const goal = nanjingDockAssaultGoal(actor), path = planner(start, goal);
    assert.ok(!nanjingDockInside(goal));
    assert.ok(path.length, `assault lane cannot reach the front: ${spawnId}`);
    assert.ok(nanjingDockPathClear(start, path), spawnId);
  }
  for (const point of posts) {
    const position = new THREE.Vector3(point.x, 0, point.z);
    world.moveInfantry(position, -30, 0, .42, [...world.obstacles, NANJING_DOCK_BUFFER]);
    assert.equal(nanjingDockInside(position, .4), false, 'actual enemy motion cannot enter the buffer');
  }
  const original = new THREE.Vector3(-57, 0, -80);
  world.moveInfantry(original, -6, 0, .42, world.obstacles);
  assert.ok(original.x < -59, 'the exclusion must not physically wall off civilian or friendly boarding');
});

test('all six core positions are physically clear, reachable, and cannot be reassigned to autonomous weapons', () => {
  const actors = [1, 2].flatMap(index => {
    const formation = { index };
    return Array.from({ length: 11 }, (_, slot) => ({
    id: `${index}-${slot}`, index: slot, friendly: true, playerUnit: false, formation,
    health: 100, tactics: {},
    }));
  });
  assignNanjingDefense(actors, 0);
  const core = actors.filter(nanjingCoreGuard);
  assert.equal(core.length, 6);
  const planner = createNavigator(world.doorSystem.navigationObstacles);
  for (const actor of core) {
    const goal = nanjingDefenseGoal(actor);
    assert.ok(planner({ x: 0, z: 27 }, goal).length, JSON.stringify(goal));
    assert.ok(Math.hypot(goal.x + 6.2, goal.z) + .65 < 2.6);
  }
});
