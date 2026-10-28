import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, circleBlocked, canDeploySquad } from '../src/core.js';
import { makeBaseSpawns } from '../src/spawns.js';
import { makeTownLayout } from '../src/town-layout.js';
import { BATTLE_RULES, battleRoster, stagingSpawns, formationPositions, validateRoster, armySummary, FormationPlacementError, reinforcementDue, battleSpawn, holdDestination, infantryLoadout, sectionOffset } from '../src/battle-roster.js';

test('default armies contain ten eleven-person infantry units on each side', () => {
  const roster = battleRoster();
  validateRoster(roster);
  assert.equal(TYPES.infantry.members, 11);
  assert.equal(roster.length, 20);
  assert.equal(roster.filter(unit => unit.player).length, 1);
  assert.ok(roster.every(unit => unit.type === 'infantry'));
});
test('a single selected vehicle replaces one friendly platoon and vehicle caps reject overbooking', () => {
  const roster = battleRoster('tank');
  assert.equal(roster.filter(unit => unit.team === 'friendly' && unit.type === 'infantry').length, 9);
  roster[1].type = 'plane';
  validateRoster(roster);
  roster[2].type = 'tank';
  assert.throws(() => validateRoster(roster), /vehicle limit/);
});
test('all 220 staged soldiers have clear, separated, registered spawn positions', () => {
  const roster = battleRoster(), spawns = [...makeBaseSpawns(), ...stagingSpawns()], obstacles = makeTownLayout().obstacles, occupied = [];
  for (const unit of roster) {
    const spawn = spawns.find(point => point.id === unit.spawnId);
    assert.ok(spawn && spawn.team === unit.team);
    const positions = formationPositions(spawn, TYPES.infantry.members, obstacles, occupied);
    assert.equal(positions.length, 11);
    for (const point of positions) {
      assert.equal(circleBlocked(point.x, point.z, .48, obstacles), false);
      assert.ok(occupied.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= 1.25));
      occupied.push(point);
    }
  }
  assert.equal(occupied.length, 220);
});
test('each eleven-person section retains its engineer and gunner and replaces one rifleman with a sniper', () => {
  for (const team of ['friendly', 'enemy']) {
    const loadouts = Array.from({ length: TYPES.infantry.members }, (_, index) => infantryLoadout(team, index));
    assert.deepEqual(loadouts[0], { role: 'engineer', model: 'rifle' });
    assert.ok(loadouts.slice(1, 9).every(item => item.role === 'rifleman' && item.model === 'rifle'));
    assert.deepEqual(loadouts[9], { role: 'sniper', model: 'sniper' });
    assert.equal(loadouts.filter(item => item.role === 'rifleman').length, 8);
    assert.deepEqual(loadouts[10], { role: 'machine-gunner', model: team === 'friendly' ? 'zb26' : 'type11' });
    assert.equal(loadouts.filter(item => item.role === 'engineer').length, 1);
    for (let index = 0; index < 10; index++) assert.deepEqual(sectionOffset(index),
      { x: (index % 5 - 2) * 1.15, z: Math.floor(index / 5) * 1.4 - .7 });
    assert.deepEqual(sectionOffset(10), { x: 0, z: 2.1 });
    for (const type of ['mortar', 'tank', 'plane']) for (const index of [0, 9, 10]) {
      assert.equal(infantryLoadout(team, index, type).model, 'rifle');
    }
    assert.deepEqual(infantryLoadout(team, 20), loadouts[9], 'additional sections keep the same role slot');
  }
  assert.throws(() => infantryLoadout('unknown', 0), /Invalid/);
});
test('blocked staging fails explicitly instead of reducing the member count', () => {
  assert.throws(() => formationPositions({ id: 'blocked', x: 0, z: 0 }, 30,
    [{ minX: -40, maxX: 40, minZ: -40, maxZ: 40 }]), FormationPlacementError);
  assert.throws(() => formationPositions({ id: 'hostile', x: 0, z: 0 }, 30, [], [],
    [{ x: 0, z: 0, health: 100 }]), FormationPlacementError);
});
test('army counters derive from living members, not roster labels or desired counts', () => {
  const roster = battleRoster();
  for (const unit of roster) unit.members = Array.from({ length: 11 }, () => ({ health: 100 }));
  assert.deepEqual(armySummary(roster, 'friendly'), { units: 10, rosterUnits: 10, alive: 110, vehicles: 0 });
  roster[0].members[0].health = 0;
  assert.equal(armySummary(roster, 'friendly').alive, 109);
  roster[0].members.forEach(actor => { actor.health = 0; });
  assert.equal(armySummary(roster, 'friendly').units, 9);
  const survivors = Array.from({ length: BATTLE_RULES.infantryMembers }, (_, index) => ({ health: index === 10 ? 1 : 0 }));
  assert.equal(canDeploySquad('dead', survivors), false);
  survivors[10].health = 0;
  assert.equal(canDeploySquad('dead', survivors), true);
});
test('autonomous reinforcement waits for a full wipe and cooldown, then uses a safe registered rally', () => {
  const unit = battleRoster().find(item => item.team === 'enemy' && item.index === 0);
  unit.members = Array.from({ length: 11 }, () => ({ health: 0 }));
  unit.respawnAt = 17;
  assert.equal(reinforcementDue(unit, 16.99), false);
  unit.members[10].health = 1;
  assert.equal(reinforcementDue(unit, 20), false);
  unit.members[10].health = 0;
  assert.equal(reinforcementDue(unit, 20), true);
  const rally = { id: 'enemy-rally-test', team: 'enemy', kind: 'rally', health: 120, x: -48, z: -53 };
  const points = [...makeBaseSpawns(), rally];
  assert.equal(battleSpawn(unit, points, [], []).id, rally.id);
  assert.equal(battleSpawn(unit, points, [{ x: -48, z: -53, health: 100 }], []).id, 'japan-base');
  unit.player = true;
  assert.equal(reinforcementDue(unit, 20), false, 'player deployment never silently respawns');
});
test('a dismounted member holds their actual exit point rather than applying a squad offset into the hull', () => {
  const actor = { index: 0, orderPoint: { x: 3.1, z: 82.3 }, personalHold: true };
  assert.deepEqual(holdDestination(actor), actor.orderPoint);
  actor.personalHold = false;
  assert.notDeepEqual(holdDestination(actor), actor.orderPoint);
});
