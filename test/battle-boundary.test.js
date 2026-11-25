import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_AREA, NANJING_BATTLE_AREA, AIR_BATTLE_AREA, BOUNDARY_RULES, createBoundaryState, advanceBoundary } from '../src/battle-boundary.js';
import { MAP_LIMIT, OBJECTIVES } from '../src/core.js';
import { makeBaseSpawns, rallyBuildBlockReason, groundSpawnCandidates } from '../src/spawns.js';
import { formationPositions, stagingSpawns } from '../src/battle-roster.js';
import { NANJING_SPAWNS } from '../src/nanjing-campaign.js';
import { damageForTarget } from '../src/combat-targets.js';
import { createCombatEvents } from '../src/combat-events.js';

test('safe battle area covers ground spawns and objectives but leaves reachable warning strips', () => {
  for (const point of [...makeBaseSpawns(), ...stagingSpawns()].filter(point => point.kind !== 'air')) {
    const boundary = createBoundaryState();
    assert.equal(advanceBoundary(boundary, point, 30), 0, point.id);
    assert.equal(boundary.outside, false, point.id);
  }
  for (const point of OBJECTIVES) {
    assert.ok(point.x - point.radius > BATTLE_AREA.minX && point.x + point.radius < BATTLE_AREA.maxX);
    assert.ok(point.z - point.radius > BATTLE_AREA.minZ && point.z + point.radius < BATTLE_AREA.maxZ);
  }
  assert.ok(BATTLE_AREA.maxX < MAP_LIMIT - 3 && BATTLE_AREA.maxZ < MAP_LIMIT - 3);
  assert.ok(BATTLE_AREA.minX > -MAP_LIMIT + 3 && BATTLE_AREA.minZ > -MAP_LIMIT + 3);
});

test('Nanjing dock spawn candidates and full squads are inside the actual playable boundary', () => {
  for (const point of NANJING_SPAWNS.filter(spawn => spawn.id === 'nanjing-west-dock' || spawn.id.startsWith('nanjing-west-ai-'))) {
    const candidates = groundSpawnCandidates(point);
    assert.ok(candidates.length >= 11);
    for (const candidate of candidates) {
      assert.ok(candidate.z >= NANJING_BATTLE_AREA.minZ + 2);
      assert.ok(candidate.z > -MAP_LIMIT + 1);
      const state = createBoundaryState();
      assert.equal(advanceBoundary(state, candidate, 30, NANJING_BATTLE_AREA), 0);
      assert.equal(state.outside, false);
    }
    assert.equal(formationPositions(point, 11, []).length, 11);
  }
  assert.ok(NANJING_BATTLE_AREA.minZ > -MAP_LIMIT + 3, 'the northern warning strip remains reachable');
  const outside = createBoundaryState();
  advanceBoundary(outside, { x: -89, z: NANJING_BATTLE_AREA.minZ - .5 }, 0, NANJING_BATTLE_AREA);
  assert.equal(outside.outside, true);
});

test('all four sides and corners warn immediately, with no damage during the eight-second grace period', () => {
  for (const position of [{ x: 101, z: 0 }, { x: -101, z: 0 }, { x: 0, z: 97 },
    { x: 0, z: -97 }, { x: 103, z: -99 }]) {
    const boundary = createBoundaryState();
    assert.equal(advanceBoundary(boundary, position, 0), 0);
    assert.equal(boundary.outside, true);
    assert.equal(advanceBoundary(boundary, position, 8), 0);
    assert.equal(boundary.remaining, 0);
    assert.equal(boundary.damaging, false);
    assert.equal(advanceBoundary(boundary, position, 1), 10);
    assert.equal(boundary.damaging, true);
    const safe = { x: position.x + boundary.returnX, z: position.z + boundary.returnZ };
    assert.equal(advanceBoundary(createBoundaryState(), safe, 1), 0);
  }
});

test('damage integrates only time beyond the grace period, independent of simulation step size', () => {
  for (const steps of [[12], [7, 3, 2], Array(720).fill(1 / 60)]) {
    const boundary = createBoundaryState();
    const damage = steps.reduce((total, dt) => total + advanceBoundary(boundary, { x: 104, z: 40 }, dt), 0);
    assert.ok(Math.abs(damage - 40) < 1e-8);
  }
  const boundary = createBoundaryState();
  advanceBoundary(boundary, { x: 104, z: 40 }, 7.5);
  assert.equal(advanceBoundary(boundary, { x: 104, z: 40 }, 1), 5);
});

test('returning clears the warning and resets grace; individual timers survive control changes', () => {
  const first = createBoundaryState(), second = createBoundaryState();
  advanceBoundary(first, { x: 104, z: 0 }, 9);
  advanceBoundary(second, { x: 0, z: 0 }, 9);
  assert.equal(first.outsideSeconds, 9);
  assert.equal(second.outsideSeconds, 0);
  assert.equal(advanceBoundary(first, { x: 104, z: 0 }, 1), 10);
  assert.equal(advanceBoundary(first, { x: 99, z: 0 }, 1), 0);
  assert.deepEqual(first, createBoundaryState());
  assert.equal(advanceBoundary(first, { x: 104, z: 0 }, 7), 0);
  assert.equal(first.remaining, 1);
});

test('aircraft retain a wide 600-metre flight area with the same gradual warning and attrition', () => {
  const boundary = createBoundaryState();
  assert.deepEqual(AIR_BATTLE_AREA, { minX: -600, maxX: 600, minZ: -600, maxZ: 600 });
  assert.equal(advanceBoundary(boundary, { x: 500, z: -500 }, 60, AIR_BATTLE_AREA), 0);
  assert.equal(boundary.outside, false);
  assert.equal(advanceBoundary(boundary, { x: 601, z: 0 }, 9, AIR_BATTLE_AREA), BOUNDARY_RULES.damagePerSecond);
});

test('engineers cannot establish an unsafe spawn in or against the warning strip', () => {
  for (const point of [{ x: 104, z: 0 }, { x: 99, z: 0 }, { x: 0, z: 95 }, { x: -99, z: -95 }]) {
    assert.match(rallyBuildBlockReason(point, [], [], []), /战区边界/);
  }
  assert.equal(rallyBuildBlockReason({ x: 90, z: 88 }, [], [], []), null);
});

test('boundary damage reaches infantry and vehicles through attributed environmental feedback', () => {
  for (const kind of ['person', 'exposed-crew', 'closed-armor', 'aircraft']) {
    assert.equal(damageForTarget('boundary', kind, 10), 10);
  }
  const events = createCombatEvents();
  const source = { credit: 'environment', cause: 'boundary', subjectId: 'soldier-1' };
  const target = { kind: 'soldier', id: 'soldier-1', unitId: 'friendly-0', team: 'friendly' };
  const event = events.publish('damage', { source, target, amount: 10, health: 90, observerId: 'soldier-1' }, 9);
  assert.deepEqual(event.source, source);
  assert.equal(events.publish('casualty', { source, target, health: 0 }, 18).source.credit, 'environment');
  assert.throws(() => events.publish('damage', { source: { ...source, subjectId: '' }, target, amount: 1, health: 0 }, 20));
});

test('invalid boundary position or time fails explicitly', () => {
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceBoundary(createBoundaryState(), { x: 0, z: 0 }, dt), RangeError);
  assert.throws(() => advanceBoundary(createBoundaryState(), { x: NaN, z: 0 }, 1), RangeError);
});
