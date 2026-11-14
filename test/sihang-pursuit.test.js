import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sihangPursuitGoal, sihangArmorInterceptObjective, SIHANG_EMPLACEMENTS, sihangSpawns } from '../src/sihang-roster.js';
import { SIHANG_BRIDGE, SIHANG_WAREHOUSE as W, sihangNorthBank } from '../src/sihang-layout.js';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';
import { circleBlocked, segmentClear } from '../src/core.js';
import { sihangNightVisibility } from '../src/sihang-night.js';
import { CHI_HA, chiHaObjectiveDestination } from '../src/chi-ha.js';
import { createTankNavigation } from '../src/tank-navigation.js';
import { addSihangBridgeDefenses } from '../src/sihang-bridge-defenses.js';
import { pointSegmentDistance } from '../src/tactics.js';

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
    const approach = sihangPursuitGoal(actor);
    assert.equal(actor.tactics.sihangEnteredWarehouse, true);
    assert.equal(actor.tactics.sihangPursuit, 'approach-interception');
    actor.position = { x: approach.x, y: approach.y, z: approach.z };
    const next = sihangPursuitGoal(actor);
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

test('bridge interception posts remain reachable, visible at night and clear of real cover', () => {
  const scene = new THREE.Scene();
  const world = makeSihangBattlefield(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  addSihangBridgeDefenses(scene, world, SIHANG_EMPLACEMENTS.filter(spec => spec.retreatCover));
  const obstacles = world.obstacles;
  const bridge = { x: SIHANG_BRIDGE.northX, y: 0, z: SIHANG_BRIDGE.northZ };
  const goals = new Map();
  for (let formation = 0; formation < 6; formation++) for (let index = 0; index < 11; index++) {
    const actor = { index, formation: { index: formation },
      tactics: { sihangEnteredWarehouse: true, sihangInterceptStaged: true },
      position: { x: 25, y: 0, z: -14 } };
    const goal = sihangPursuitGoal(actor);
    goals.set(`${goal.x},${goal.z}`, goal);
  }
  assert.equal(goals.size, 23);
  for (const goal of goals.values()) {
    const distance = Math.hypot(goal.x - bridge.x, goal.z - bridge.z);
    assert.ok(distance >= 21.5, JSON.stringify({ goal, distance }));
    assert.ok(sihangNightVisibility({ stage: 'sihang-retreat', stageElapsed: 120, counterattackAt: 0, elapsed: 85 },
      goal, bridge), JSON.stringify(goal));
    assert.ok(sihangNorthBank(goal, 1));
    assert.equal(circleBlocked(goal.x, goal.z, .55, obstacles), false, JSON.stringify(goal));
    assert.ok(segmentClear(goal, bridge, .1, obstacles, null, 1.3, .1), JSON.stringify(goal));
    const path = world.elevatedPath({ x: 25, y: 0, z: -14 }, goal);
    assert.ok(path.length && Math.hypot(path.at(-1).x - goal.x, path.at(-1).z - goal.z) <= .8,
      JSON.stringify({ goal, path }));
  }
});

test('pursuing infantry use actual clear approach points behind the bridge defenses', () => {
  const scene = new THREE.Scene();
  const world = makeSihangBattlefield(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  addSihangBridgeDefenses(scene, world, SIHANG_EMPLACEMENTS.filter(spec => spec.retreatCover));
  for (let formation = 0; formation < 6; formation++) for (let index = 0; index < 11; index++) {
    const actor = { index, formation: { index: formation }, tactics: { sihangEnteredWarehouse: true },
      position: { x: 25, y: 0, z: -14 } };
    const goal = sihangPursuitGoal(actor);
    assert.ok(Math.hypot(goal.x - SIHANG_BRIDGE.northX, goal.z - SIHANG_BRIDGE.northZ) > 25);
    assert.equal(circleBlocked(goal.x, goal.z, .55, world.obstacles), false, JSON.stringify(goal));
    for (const start of [{ x: 25, y: 0, z: -14 }, { x: -20, y: 0, z: -35 }]) {
      const path = world.elevatedPath(start, goal);
      assert.ok(path.length && Math.hypot(path.at(-1).x - goal.x, path.at(-1).z - goal.z) <= .8,
        JSON.stringify({ start, goal, path }));
    }
    actor.position = goal;
    const post = sihangPursuitGoal(actor);
    const path = world.elevatedPath(goal, post);
    assert.ok(path.length && Math.hypot(path.at(-1).x - post.x, path.at(-1).z - post.z) <= .8,
      JSON.stringify({ goal, post, path }));
    let previous = goal;
    for (const point of path) {
      const bridge = { x: SIHANG_BRIDGE.northX, z: SIHANG_BRIDGE.northZ };
      assert.ok(pointSegmentDistance(bridge, previous, point).distance >= 20,
        JSON.stringify({ goal, post, previous, point }));
      previous = point;
    }
  }
});

test('both armor interception destinations are reachable from their regroup positions', () => {
  const scene = new THREE.Scene();
  const world = makeSihangBattlefield(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  addSihangBridgeDefenses(scene, world, SIHANG_EMPLACEMENTS.filter(spec => spec.retreatCover));
  const obstacles = world.obstacles;
  const navigation = createTankNavigation(obstacles), objective = sihangArmorInterceptObjective();
  for (const slot of [0, 1]) {
    const vehicle = { id: `tank-${slot}`, type: 'tank', variant: CHI_HA.id, health: 280, ai: { mode: 'hold' },
      position: new THREE.Vector3(slot === 0 ? -70 : 70, 0, -55) };
    const goal = chiHaObjectiveDestination(slot, objective);
    assert.ok(Math.hypot(goal.x - SIHANG_BRIDGE.northX, goal.z - SIHANG_BRIDGE.northZ) > 20);
    const bridge = { x: SIHANG_BRIDGE.northX, z: SIHANG_BRIDGE.northZ };
    assert.ok(segmentClear(goal, bridge, .1, obstacles, null, 1.3, .1), JSON.stringify(goal));
    assert.ok(sihangNightVisibility({ stage: 'sihang-retreat', stageElapsed: 120, counterattack: true,
      counterattackAt: 0, elapsed: 3 }, goal, bridge), JSON.stringify(goal));
    const path = navigation.pathTo(vehicle, goal, [vehicle]);
    assert.ok(path.length && Math.hypot(path.at(-1).x - goal.x, path.at(-1).z - goal.z) <= CHI_HA.arrivalDistance,
      JSON.stringify({ goal, path, stats: navigation.stats(vehicle) }));
    assert.ok(path.every(point => sihangNorthBank(point, 3)), JSON.stringify(path));
  }
  const stuck = { id: 'stuck-tank', type: 'tank', variant: CHI_HA.id, health: 280, ai: { mode: 'hold' },
    position: new THREE.Vector3(74.91434583905716, 0, -55.52891010576034) };
  const goal = chiHaObjectiveDestination(1, objective);
  const path = navigation.pathTo(stuck, goal, [stuck]);
  assert.ok(Math.hypot(stuck.position.x - goal.x, stuck.position.z - goal.z) <= CHI_HA.arrivalDistance ||
    path.length && Math.hypot(path.at(-1).x - goal.x, path.at(-1).z - goal.z) <= CHI_HA.arrivalDistance,
    JSON.stringify({ goal, path, stats: navigation.stats(stuck) }));
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
