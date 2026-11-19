import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveContainsPosition, advanceCapture, CAPTURE_SECONDS, TYPES, circleBlocked, createNavigator } from '../src/core.js';
import { armySummary, battleSpawn, reinforcementDue, formationPositions, validateRoster } from '../src/battle-roster.js';
import { supportsSquad, spawnBlockReason } from '../src/spawns.js';
import { encirclementRoster, encirclementSpawns, encirclementObjectives, supplyGarrisonPositions,
  createEncirclement, captureEncirclement, advanceEncirclement, advanceEncirclementSupport,
  scheduleEncirclementRespawn, ENCIRCLEMENT_RULES, REAR_SPAWNS, EAST_BREAKOUT,
  moveChinaBaseToEastBreakout } from '../src/encirclement.js';
import { PREVIEW_OBJECTIVES, makeTownPreviewLayout } from '../src/town-preview-layout.js';
import { BATTLE_AREA } from '../src/battle-boundary.js';
import { CHI_HA_SEATS, japaneseArmorSpawns } from '../src/chi-ha.js';
import { assignAssaultObjectives, objectiveDestination } from '../src/tactics.js';

const active = (roster, team) => roster.filter(unit => unit.team === team && unit.active);
const setup = () => {
  const roster = encirclementRoster('infantry');
  for (const unit of roster.filter(unit => unit.active)) {
    unit.members = Array.from({ length: unit.memberCount ?? (unit.type === 'tank' ? CHI_HA_SEATS.length : TYPES[unit.type].members) },
      () => ({ health: 100, vehicleId: unit.type === 'plane' ? unit.id : null }));
  }
  return { roster, match: createEncirclement(), points: encirclementObjectives() };
};

test('A begins as an enemy supply point and only indoor positions can contribute to capture', () => {
  const point = encirclementObjectives()[0], area = point.captureArea;
  assert.equal(point.owner, 'enemy'); assert.equal(point.control, -1);
  for (const position of [
    { x: area.minX - .1, y: 0, z: 12 }, { x: -36, y: 0, z: area.minZ - .1 },
    { x: -36, y: 12.8, z: 12 }, { x: -36, y: -1, z: 12 },
  ]) {
    assert.equal(objectiveContainsPosition(point, position), false);
    advanceCapture(point, 30, objectiveContainsPosition(point, position), false);
    assert.equal(point.control, -1, 'being outside or on the roof cannot start capture');
  }
  for (const height of [0, 3.2, 6.4, 9.6]) assert.equal(objectiveContainsPosition(point, { x: -36, y: height, z: 12 }), true);
  advanceCapture(point, 24, true, true);
  assert.equal(point.control, -1, 'living defenders contest the indoor attack');
  advanceCapture(point, 24, true, false);
  assert.equal(point.owner, 'friendly');
});

test('two complete existing squads fit inside the granary and do not increase total Japanese strength', () => {
  const town = makeTownPreviewLayout(), roster = encirclementRoster('infantry');
  const guards = roster.filter(unit => unit.supplyGarrison), occupied = [];
  assert.equal(guards.length, 2);
  assert.equal(active(roster, 'enemy').length, 8);
  for (const guard of guards) {
    assert.equal(guard.type, 'infantry'); assert.equal(guard.memberCount, 11);
    const positions = supplyGarrisonPositions(guard.memberCount, town.obstacles, occupied);
    assert.ok(positions.every(position => objectiveContainsPosition(PREVIEW_OBJECTIVES[0], { ...position, y: 0 }) &&
      !circleBlocked(position.x, position.z, .48, town.obstacles)));
    assert.ok(positions.every(position => occupied.every(other => Math.hypot(position.x - other.x, position.z - other.z) >= 1.25)));
    occupied.push(...positions);
  }
  assert.equal(occupied.length, 22);
});

test('the dedicated supply squads keep A rather than joining attacks on B or C', () => {
  const roster = encirclementRoster('infantry'), points = encirclementObjectives();
  for (const unit of roster.filter(unit => unit.active)) unit.members = [{
    health: 100, vehicleId: ['tank', 'plane'].includes(unit.type) ? unit.id : null,
    position: { x: unit.supplyGarrison ? -36 : 0, z: unit.supplyGarrison ? 12 : -82 },
  }];
  assignAssaultObjectives(roster, points);
  assert.equal(roster.filter(unit => unit.team === 'enemy' && unit.type === 'infantry' && unit.objectiveId === 'A').length, 2);
  points[0].owner = 'friendly'; points[0].control = 1;
  assignAssaultObjectives(roster, points);
  assert.ok(roster.filter(unit => unit.supplyGarrison).every(unit => unit.objectiveId === 'A'));
  for (let squad = 0; squad < 10; squad++) for (let slot = 0; slot < 11; slot++) {
    const goal = objectiveDestination({ squad, slot }, { x: 0, z: 80 }, points[0]);
    assert.equal(objectiveContainsPosition(points[0], goal), true, 'attack destinations must be inside the building');
  }
});

test('six starting squads receive two waves at 45 and 90 seconds and never exceed ten squads', () => {
  const { roster, match, points } = setup();
  assert.equal(advanceEncirclementSupport(match, points, roster, 44.99).added.length, 0);
  for (const [time, count] of [[45, 8], [90, 10], [135, 10]]) {
    const wave = advanceEncirclementSupport(match, points, roster, time);
    assert.equal(wave.added.length, time === 135 ? 0 : 2);
    assert.ok(wave.added.every(unit => !unit.player && unit.respawnAt === time));
    assert.equal(active(roster, 'friendly').length, count);
    assert.equal(advanceEncirclementSupport(match, points, roster, time).added.length, 0, 'same simulation time cannot deliver twice');
  }
  assert.equal(match.reinforcementWaves, 2);
  assert.equal(active(roster, 'enemy').length, 8);
  assert.equal(advanceEncirclementSupport(match, points, roster, 999).added.length, 0);
  const fresh = setup();
  assert.equal(advanceEncirclementSupport(fresh.match, fresh.points, fresh.roster, 135).added.length, 4, 'a large step respects the ten-squad cap');
});

test('a resolved battle cannot dispatch extra waves or unlock positions through a later capture', () => {
  const { roster, match, points } = setup();
  for (const point of points) point.owner = 'enemy';
  advanceEncirclement(match, points, roster, 90);
  assert.equal(advanceEncirclementSupport(match, points, roster, 999).added.length, 0);
  assert.equal(active(roster, 'friendly').length, 6);
  assert.equal(captureEncirclement(match, roster, 'A', 999).spawn, null);
  assert.deepEqual(match.unlocked, []);
});

test('A ownership delays already-pending infantry, tank and air reinforcements and enemy recapture restores supply', () => {
  const { roster, match, points } = setup();
  const units = ['infantry', 'tank', 'plane'].map(type => roster.find(unit => unit.team === 'enemy' && unit.type === type));
  for (const unit of units) unit.members.forEach(actor => { actor.health = 0; });
  advanceEncirclementSupport(match, points, roster, 10);
  assert.ok(units.every(unit => unit.respawnAt === 27));
  points[0].owner = 'friendly';
  assert.equal(advanceEncirclementSupport(match, points, roster, 20).supplyChanged, true);
  assert.ok(units.every(unit => unit.respawnAt === 45 && unit.reinforcementStartedAt === 10));
  points[0].owner = null;
  advanceEncirclementSupport(match, points, roster, 25);
  assert.equal(match.supplyInterrupted, true, 'neutralization alone does not mean enemy supply has been restored');
  units[0].blockedReason = 'earlier physical obstruction'; units[0].spawnRetryAt = 26;
  points[0].owner = 'enemy';
  assert.equal(advanceEncirclementSupport(match, points, roster, 30).supplyChanged, true);
  assert.ok(units.every(unit => unit.respawnAt === 27 && reinforcementDue(unit, 30)));
  assert.equal(match.supplyInterrupted, false);
});

test('supply changes cannot bypass physical spawn retries, alter living soldiers or restore phase-two respawns', () => {
  const { roster, match, points } = setup();
  const unit = roster.find(unit => unit.team === 'enemy' && unit.type === 'infantry');
  unit.members.forEach(actor => { actor.health = 0; });
  scheduleEncirclementRespawn(match, unit, 5);
  unit.blockedReason = 'physical obstruction'; unit.respawnAt = unit.spawnRetryAt = 50;
  points[0].owner = 'friendly'; advanceEncirclementSupport(match, points, roster, 10);
  assert.equal(unit.respawnAt, 50);
  points[0].owner = 'enemy'; advanceEncirclementSupport(match, points, roster, 12);
  assert.equal(unit.respawnAt, 50);
  const living = roster.find(candidate => candidate.team === 'enemy' && candidate.type === 'plane');
  assert.equal(living.members[0].health, 100);
  for (const point of points) point.owner = 'friendly';
  advanceEncirclement(match, points, roster);
  points[0].owner = 'enemy'; advanceEncirclementSupport(match, points, roster, 20);
  assert.ok(roster.filter(candidate => candidate.team === 'enemy' && candidate.type !== 'plane')
    .every(candidate => candidate.respawnEnabled === false && candidate.respawnAt === null));
  assert.equal(living.respawnEnabled, true);
  assert.equal(ENCIRCLEMENT_RULES.cutEnemyDelay, 35);
});

test('campaign starts with six friendly squads including the selected player and eight enemies', () => {
  for (const type of Object.keys(TYPES)) {
    const roster = encirclementRoster(type);
    validateRoster(roster, { friendly: 10, enemy: 8 });
    assert.equal(active(roster, 'friendly').length, 6);
    assert.equal(active(roster, 'enemy').length, 8);
    assert.equal(roster.find(unit => unit.player).type, type);
    assert.equal(roster.filter(unit => !unit.active).length, 4);
    assert.ok(roster.filter(unit => !unit.active).every(unit => !unit.members.length && !reinforcementDue(unit, 999)));
    assert.equal(armySummary(roster, 'friendly').rosterUnits, 6);
    assert.equal(active(roster, 'enemy').filter(unit => unit.type === 'infantry').length, 6);
  }
});

test('captures unlock positions without giving old reinforcements, withdrawing enemies or closing spawn points', () => {
  const { roster, match } = setup();
  for (let index = 0; index < 8; index++) {
    const event = captureEncirclement(match, roster, 'A', index);
    assert.equal(event.added.length, 0);
    assert.equal(event.withdrawn, null);
    assert.deepEqual(event.disabled, []);
    assert.equal(active(roster, 'friendly').length, 6);
    assert.equal(active(roster, 'enemy').length, 8);
  }
  assert.equal(active(roster, 'enemy').filter(unit => unit.type === 'tank').length, 1);
  assert.equal(active(roster, 'enemy').filter(unit => unit.type === 'plane').length, 1);
  assert.equal(match.captures, 8);
  assert.equal(match.unlocked.length, 1, 'recapture never duplicates a permanent point');
});

test('capture ownership transitions count recaptures, not steady ownership or contested progress', () => {
  const { roster, match, points } = setup();
  const point = points[1];
  const step = (dt, friendly, enemy) => {
    const owner = point.owner;
    advanceCapture(point, dt, friendly, enemy);
    if (owner !== 'friendly' && point.owner === 'friendly') captureEncirclement(match, roster, point.id, 0);
  };
  step(CAPTURE_SECONDS - .1, true, false);
  assert.equal(match.captures, 0);
  step(20, true, true);
  assert.equal(match.captures, 0);
  step(.1, true, false);
  step(100, true, false);
  assert.equal(match.captures, 1);
  step(CAPTURE_SECONDS * 2, false, true);
  assert.equal(point.owner, 'enemy');
  assert.equal(match.unlocked.length, 1);
  step(CAPTURE_SECONDS * 2, true, false);
  assert.equal(match.captures, 2);
  assert.equal(match.unlocked.length, 1);
});

test('three simultaneous owned points stop ground respawns but preserve air reinforcements, not win', () => {
  const { roster, match, points } = setup();
  for (const point of points) {
    captureEncirclement(match, roster, point.id, 0);
    point.owner = 'friendly';
    advanceEncirclement(match, points, roster);
  }
  assert.equal(match.phase, 2);
  assert.equal(match.winner, null, 'holding three objectives is not a victory while enemies live');
  assert.equal(match.unlocked.length, 3);
  assert.equal(active(roster, 'friendly').length, 6, 'capturing all three points does not bypass timed waves');
  for (const unit of roster.filter(unit => unit.team === 'enemy')) {
    assert.equal(unit.respawnEnabled, unit.type === 'plane');
    assert.equal(unit.respawnAt, null);
    unit.members.forEach(actor => { actor.health = 0; });
    assert.equal(reinforcementDue(unit, 9999), false, 'includes instant-respawning tanks');
  }
  points[0].owner = 'enemy';
  assert.equal(advanceEncirclement(match, points, roster), 'friendly', 'the cleanup phase cannot revert');
  assert.deepEqual(captureEncirclement(match, roster, 'A', 100), { spawn: null, added: [], withdrawn: null, disabled: [] });
});

test('three enemy-owned objectives grant exactly 90 seconds for a counterattack in phase one', () => {
  for (const phase of [1]) {
    const { roster, match, points } = setup();
    match.phase = phase;
    points[0].owner = points[1].owner = 'enemy';
    assert.equal(advanceEncirclement(match, points, roster), null, 'two lost points are not defeat');
    advanceCapture(points[2], CAPTURE_SECONDS - .1, false, true);
    assert.equal(advanceEncirclement(match, points, roster), null, 'partial capture cannot end the game');
    advanceCapture(points[2], .1, false, true);
    assert.equal(advanceEncirclement(match, points, roster), null, 'the third capture starts a grace window, not immediate defeat');
    assert.equal(advanceEncirclement(match, points, roster, 89.9), null);
    assert.equal(advanceEncirclement(match, points, roster, .1), 'enemy', 'continuous enemy ownership for 90 seconds ends the game');
    for (const point of points) point.owner = 'friendly';
    assert.equal(advanceEncirclement(match, points, roster), 'enemy', 'a resolved defeat cannot turn into victory');
  }
});

test('expired phase-one enemy-control grace cannot turn into victory because enemies died', () => {
  const { roster, match, points } = setup();
  for (const point of points) point.owner = 'enemy';
  for (const unit of roster) unit.members.forEach(actor => { actor.health = 0; });
  assert.equal(advanceEncirclement(match, points, roster, 90), 'enemy');
});

test('phase-two threshold is recorded but the last remaining ground crew must be resolved before victory', () => {
  const { roster, match, points } = setup();
  for (const point of points) point.owner = 'friendly';
  advanceEncirclement(match, points, roster);
  const crew = roster.find(unit => unit.team === 'enemy' && unit.type === 'tank').members[0];
  for (const unit of roster.filter(unit => unit.team === 'enemy')) unit.members.forEach(actor => { actor.health = 0; });
  crew.health = 1;
  assert.equal(advanceEncirclement(match, points, roster), null);
  assert.equal(match.breakout.objectiveStatus,'achieved');
  crew.health = 0;
  assert.equal(advanceEncirclement(match, points, roster), 'friendly');
  const fresh = setup();
  for (const unit of fresh.roster.filter(unit => unit.team === 'enemy')) unit.members.forEach(actor => { actor.health = 0; });
  assert.equal(advanceEncirclement(fresh.match, fresh.points, fresh.roster), null, 'phase one still needs three points');
  assert.deepEqual(createEncirclement(), { phase: 1, captures: 0, unlocked: [], disabledEnemySpawns: [], winner: null,
    supplyInterrupted: false, reinforcementWaves: 0, enemyControlSeconds: 0, breakout: null });
});

test('neutralizing or recapturing any objective clears grace, and a fresh enemy takeover starts from zero', () => {
  for (const recoveredOwner of [null, 'friendly']) {
    const { roster, match, points } = setup();
    for (const point of points) point.owner = 'enemy';
    advanceEncirclement(match, points, roster, 70);
    points[1].owner = recoveredOwner;
    assert.equal(advanceEncirclement(match, points, roster, 0), null);
    assert.equal(match.enemyControlSeconds, 0);
    points[1].owner = 'enemy';
    assert.equal(advanceEncirclement(match, points, roster, 89), null);
    assert.equal(advanceEncirclement(match, points, roster, 1), 'enemy');
  }
});

test('a merely contested but still enemy-owned point cannot reset the defeat countdown', () => {
  const { roster, match, points } = setup();
  for (const point of points) point.owner = 'enemy';
  advanceEncirclement(match, points, roster, 30);
  points[1].status = 'contested';
  assert.equal(advanceEncirclement(match, points, roster, 60), 'enemy');
});

test('grace integrates simulated time consistently, freezes on zero steps, and permits friendly reinforcement waves', () => {
  for (const hz of [30, 60, 144]) {
    const { roster, match, points } = setup();
    for (const point of points) point.owner = 'enemy';
    for (let frame = 1; frame < hz * 90; frame++) {
      assert.equal(advanceEncirclement(match, points, roster, 1 / hz), null);
    }
    const before = structuredClone(match);
    advanceEncirclement(match, points, roster, 0);
    assert.deepEqual(match, before);
    assert.equal(advanceEncirclement(match, points, roster, 1 / hz), 'enemy');
  }
  const { roster, match, points } = setup();
  for (const point of points) point.owner = 'enemy';
  advanceEncirclement(match, points, roster, 45);
  assert.equal(advanceEncirclementSupport(match, points, roster, 45).added.length, 2);
  assert.equal(active(roster, 'friendly').length, 8);
  assert.equal(ENCIRCLEMENT_RULES.initialFriendly, 6);
  assert.deepEqual(ENCIRCLEMENT_RULES.reinforcementTimes, [45, 90]);
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceEncirclement(match, points, roster, dt), RangeError);
});

test('unlocking rear points no longer stacks permanent enemy closures on top of the supply-delay mechanic', () => {
  const { roster, match } = setup();
  const points = encirclementSpawns();
  assert.equal(points.filter(point => point.team === 'enemy').length, 8, 'no unused phantom enemy staging points');
  for (const rear of REAR_SPAWNS) {
    const event = captureEncirclement(match, roster, rear.objectiveId, 0, points);
    assert.deepEqual(event.disabled, []);
    const count = match.disabledEnemySpawns.length;
    assert.deepEqual(captureEncirclement(match, roster, rear.objectiveId, 1, points).disabled, []);
    assert.equal(match.disabledEnemySpawns.length, count);
  }
  assert.equal(match.disabledEnemySpawns.length, 0);
  assert.equal(points.filter(point => point.team === 'enemy' && point.enabled !== false).length, 8);
  assert.ok(roster.flatMap(unit => unit.members).every(actor => actor.health === 100), 'closing a point does not kill existing soldiers');
  assert.ok(encirclementSpawns().every(point => point.enabled !== false), 'restart creates fresh points');
});

test('capture does not silently destroy or close rallies, tanks or unrelated spawning positions', () => {
  const { roster, match } = setup(), rear = REAR_SPAWNS[0];
  const points = [
    { id: 'closed', team: 'enemy', kind: 'base', ...{ x: rear.x, z: rear.z }, enabled: false },
    { id: 'destroyed', team: 'enemy', kind: 'rally', x: rear.x, z: rear.z, health: 0 },
    { id: 'friendly', team: 'friendly', kind: 'base', x: rear.x, z: rear.z },
    { id: 'live-rally', team: 'enemy', kind: 'rally', x: rear.x + 1, z: rear.z, health: 120 },
    { id: 'garage', team: 'enemy', kind: 'garage', x: rear.x + 2, z: rear.z },
    { id: 'far-base', team: 'enemy', kind: 'base', x: rear.x + 40, z: rear.z },
  ];
  assert.deepEqual(captureEncirclement(match, roster, 'A', 0, points).disabled, []);
  assert.ok(points.filter(point => point.id !== 'closed').every(point => point.enabled === undefined));
  assert.equal(points.find(point => point.id === 'friendly').enabled, undefined);
});

test('formations reroute only to compatible remaining safe points and never reuse a closed point', () => {
  const roster = encirclementRoster('infantry'), points = [...encirclementSpawns(), japaneseArmorSpawns()[1]];
  const infantry = roster.find(unit => unit.id === 'enemy-1');
  points.find(point => point.id === infantry.spawnId).enabled = false;
  const replacement = battleSpawn(infantry, points, [], []);
  assert.equal(replacement.id, 'enemy-staging-2');
  assert.equal(replacement.team, 'enemy');
  assert.equal(replacement.kind, 'base');
  const tank = roster.find(unit => unit.id === 'enemy-8');
  points.find(point => point.id === tank.spawnId).enabled = false;
  assert.equal(battleSpawn(tank, points, [], []).id, 'japan-garage-1');
  points.find(point => point.id === 'japan-garage-1').enabled = false;
  assert.equal(battleSpawn(tank, points, [], []), undefined, 'infantry points cannot spawn tanks');
  for (const point of points.filter(point => point.team === 'enemy')) point.enabled = false;
  assert.equal(battleSpawn(infantry, points, [], []), undefined, 'no success-shaped fallback when all sources are gone');
});

test('permanent rear spawns support players, survive ownership loss and disperse AI respawns', () => {
  const roster = encirclementRoster('infantry');
  const points = [...encirclementSpawns(), ...REAR_SPAWNS];
  const chosen = new Set();
  for (const unit of active(roster, 'friendly')) {
    const point = battleSpawn(unit, points, [], []);
    assert.equal(point.permanent, true);
    chosen.add(point.id);
  }
  assert.equal(chosen.size, 3);
  for (const point of REAR_SPAWNS) {
    assert.equal(supportsSquad(point, 'infantry'), true);
    assert.equal(supportsSquad(point, 'mortar'), true);
    assert.equal(supportsSquad(point, 'tank'), false);
    assert.equal(supportsSquad(point, 'plane'), false);
    assert.equal(spawnBlockReason(point, 'infantry', [], []), null);
    assert.equal(spawnBlockReason(point, 'infantry', [{ ...point, health: 100 }], []), null);
    assert.equal(spawnBlockReason(point, 'mortar', [{ ...point, health: 100 }], []), null);
  }
});

test('local aircraft and mortarmen survive integration but a lone seated pilot cannot block cleanup victory', () => {
  const { roster, match, points } = setup();
  assert.equal(armySummary(roster, 'friendly').alive, 66);
  assert.equal(armySummary(roster, 'enemy').alive, 73);
  const pilot = roster.find(unit => unit.team === 'enemy' && unit.type === 'plane');
  assert.equal(pilot.spawnId, 'japan-air');
  const spawns = encirclementSpawns();
  assert.equal(spawns.filter(point => point.team === 'enemy').length, 8);
  assert.equal(spawns.some(point => point.id === 'japan-garage-1'), false);
  for (const point of points) {
    captureEncirclement(match, roster, point.id, 0, spawns);
    point.owner = 'friendly';
  }
  assert.equal(battleSpawn(pilot, spawns, [], []).id, 'japan-air');
  assert.equal(advanceEncirclement(match, points, roster), null);
  assert.equal(pilot.respawnEnabled, true);
  pilot.members[0].health = 0;
  assert.equal(reinforcementDue(pilot, 999), false);
  pilot.members[0].health = 1;
  for (const unit of roster.filter(unit => unit.team === 'enemy' && unit !== pilot)) {
    unit.members.forEach(actor => { actor.health = 0; });
  }
  assert.equal(pilot.members[0].health, 1, 'do not silently kill the pilot to force victory');
  assert.equal(advanceEncirclement(match, points, roster), 'friendly');
  for (const type of ['infantry', 'tank', 'plane']) {
    const army = encirclementRoster(type);
    assert.equal(active(army, 'friendly').reduce((sum, unit) => sum + unit.memberCount, 0), 66);
  }
});

test('aircraft-only enemies do not bypass the initial encirclement requirement and a dismounted pilot still counts', () => {
  const { roster, match, points } = setup();
  const pilot = roster.find(unit => unit.team === 'enemy' && unit.type === 'plane');
  for (const unit of roster.filter(unit => unit.team === 'enemy' && unit !== pilot)) {
    unit.members.forEach(actor => { actor.health = 0; });
  }
  assert.equal(advanceEncirclement(match, points, roster), null);
  for (const point of points) point.owner = 'friendly';
  pilot.members[0].vehicleId = null;
  assert.equal(advanceEncirclement(match, points, roster), null, 'a pilot fighting on foot is a ground enemy');
  pilot.members[0].vehicleId = pilot.id;
  assert.equal(advanceEncirclement(match, points, roster), 'friendly');
  assert.equal(pilot.members[0].health, 100);
});

test('the second-stage friendly base moves south of C onto clear ground', () => {
  const spawns = encirclementSpawns();
  const otherSpawns = spawns.filter(point => point.id !== 'china-base')
    .map(({ id, x, z }) => ({ id, x, z }));
  const base = moveChinaBaseToEastBreakout(spawns);
  const obstacles = makeTownPreviewLayout().obstacles;

  assert.equal(base.name, 'C点南侧集结地');
  assert.deepEqual({ x: base.x, z: base.z }, EAST_BREAKOUT.friendlySpawn);
  assert.equal(base.x, PREVIEW_OBJECTIVES.find(point => point.id === 'C').x);
  assert.ok(base.z > PREVIEW_OBJECTIVES.find(point => point.id === 'C').z);
  assert.equal(spawnBlockReason(base, 'infantry', [], obstacles), null);
  assert.equal(formationPositions(base, 11, obstacles).length, 11);
  assert.deepEqual(spawns.filter(point => point.id !== 'china-base')
    .map(({ id, x, z }) => ({ id, x, z })), otherSpawns);
});

test('enemy presence cannot seal permanent player or AI spawns, but physical clearance remains', () => {
  const point = REAR_SPAWNS[0], hostiles = [{ x: point.x, z: point.z, health: 100 }];
  const positions = formationPositions(point, 11, [], [], hostiles);
  assert.equal(positions.length, 11);
  assert.ok(positions.every(position => Math.hypot(position.x - point.x, position.z - point.z) >= 1.25));
  const next = formationPositions(point, 11, [], positions, hostiles);
  assert.ok(next.every(position => positions.every(other => Math.hypot(position.x - other.x, position.z - other.z) >= 1.25)));
  const unit = encirclementRoster('infantry').find(unit => unit.team === 'friendly' && !unit.player);
  unit.spawnId = point.id;
  assert.equal(battleSpawn(unit, [...encirclementSpawns(), point], hostiles, []), point);
  const normal = { ...point, permanent: false };
  assert.match(spawnBlockReason(normal, 'infantry', hostiles, []), /附近有敌军/);
  const walls = [{ minX: point.x - 30, maxX: point.x + 30, minZ: point.z - 30, maxZ: point.z + 30 }];
  assert.match(spawnBlockReason(point, 'infantry', hostiles, walls), /受阻/);
  assert.throws(() => formationPositions(point, 11, walls, [], hostiles), /无法安全容纳/);
});

test('fortress initial infantry and two rear reinforcement squads fit physically and can reach each landmark', () => {
  const town = makeTownPreviewLayout(), occupied = [], spawns = encirclementSpawns();
  const roster = encirclementRoster('infantry');
  for (const unit of active(roster, 'friendly').concat(active(roster, 'enemy')).filter(unit => unit.type === 'infantry')) {
    const spawn = spawns.find(point => point.id === unit.spawnId);
    const positions = unit.supplyGarrison ? supplyGarrisonPositions(unit.memberCount, town.obstacles, occupied)
      : formationPositions(spawn, unit.memberCount, town.obstacles, occupied);
    occupied.push(...positions);
  }
  assert.equal(occupied.length, 132);
  const navigate = createNavigator(town.obstacles, 1, .46);
  for (const spawn of REAR_SPAWNS) {
    assert.ok(spawn.x > BATTLE_AREA.minX && spawn.x < BATTLE_AREA.maxX);
    assert.ok(spawn.z > BATTLE_AREA.minZ && spawn.z < BATTLE_AREA.maxZ);
    assert.equal(circleBlocked(spawn.x, spawn.z, 2.8, town.obstacles), false);
    const deployed = formationPositions(spawn, 11, town.obstacles, occupied);
    assert.equal(formationPositions(spawn, 11, town.obstacles, [...occupied, ...deployed]).length, 11);
    for (const objective of PREVIEW_OBJECTIVES) assert.ok(navigate(spawn, objective).length, `${spawn.id} to ${objective.id}`);
  }
});
