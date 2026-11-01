import test from 'node:test';
import assert from 'node:assert/strict';
import { makeObjectives, advanceCapture, CAPTURE_SECONDS, TYPES, circleBlocked, createNavigator } from '../src/core.js';
import { armySummary, battleSpawn, reinforcementDue, formationPositions } from '../src/battle-roster.js';
import { supportsSquad, spawnBlockReason } from '../src/spawns.js';
import { encirclementRoster, encirclementSpawns, createEncirclement, captureEncirclement, advanceEncirclement, REAR_SPAWNS } from '../src/encirclement.js';
import { PREVIEW_OBJECTIVES, makeTownPreviewLayout } from '../src/town-preview-layout.js';
import { BATTLE_AREA } from '../src/battle-boundary.js';
import { CHI_HA_SEATS, japaneseArmorSpawns } from '../src/chi-ha.js';

const active = (roster, team) => roster.filter(unit => unit.team === team && unit.active);
const setup = () => {
  const roster = encirclementRoster('infantry');
  for (const unit of roster.filter(unit => unit.active)) {
    unit.members = Array.from({ length: unit.memberCount ?? (unit.type === 'tank' ? CHI_HA_SEATS.length : TYPES[unit.type].members) }, () => ({ health: 100 }));
  }
  return { roster, match: createEncirclement(), points: makeObjectives(PREVIEW_OBJECTIVES) };
};

test('campaign starts with exactly four friendly squads including the selected player and ten enemies', () => {
  for (const type of Object.keys(TYPES)) {
    const roster = encirclementRoster(type);
    assert.equal(active(roster, 'friendly').length, 4);
    assert.equal(active(roster, 'enemy').length, 10);
    assert.equal(roster.find(unit => unit.player).type, type);
    assert.equal(roster.filter(unit => !unit.active).length, 6);
    assert.ok(roster.filter(unit => !unit.active).every(unit => !unit.members.length && !reinforcementDue(unit, 999)));
    assert.equal(armySummary(roster, 'friendly').rosterUnits, 4);
  }
});

test('each completed capture adds two squads up to ten and withdraws one enemy down to five', () => {
  const { roster, match } = setup();
  for (let index = 0; index < 8; index++) {
    const event = captureEncirclement(match, roster, 'A', index);
    assert.equal(event.added.length, index < 3 ? 2 : 0);
    assert.equal(Boolean(event.withdrawn), index < 5);
    assert.equal(active(roster, 'friendly').length, Math.min(10, 4 + (index + 1) * 2));
    assert.equal(active(roster, 'enemy').length, Math.max(5, 10 - index - 1));
    assert.ok(event.added.every(unit => unit.spawnId === REAR_SPAWNS[0].id && reinforcementDue(unit, index)));
    if (event.withdrawn) assert.equal(reinforcementDue(event.withdrawn, 999), false);
  }
  assert.equal(active(roster, 'enemy').filter(unit => unit.type === 'tank').length, 1);
  assert.equal(active(roster, 'enemy').filter(unit => unit.type === 'plane').length, 1);
  assert.equal(match.captures, 8);
  assert.equal(match.unlocked.length, 1, 'recapture never duplicates a permanent point');
});

test('capture ownership transitions count recaptures, not steady ownership or contested progress', () => {
  const { roster, match, points } = setup();
  const point = points[0];
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

test('three simultaneous owned points immediately and irreversibly stop all enemy respawns, not win', () => {
  const { roster, match, points } = setup();
  for (const point of points) {
    captureEncirclement(match, roster, point.id, 0);
    point.owner = 'friendly';
    advanceEncirclement(match, points, roster);
  }
  assert.equal(match.phase, 2);
  assert.equal(match.winner, null, 'holding three objectives is not a victory while enemies live');
  assert.equal(match.unlocked.length, 3);
  assert.equal(active(roster, 'friendly').length, 10);
  for (const unit of roster.filter(unit => unit.team === 'enemy')) {
    assert.equal(unit.respawnEnabled, false);
    assert.equal(unit.respawnAt, null);
    unit.members.forEach(actor => { actor.health = 0; });
    assert.equal(reinforcementDue(unit, 9999), false, 'includes instant-respawning tanks');
  }
  points[0].owner = 'enemy';
  assert.equal(advanceEncirclement(match, points, roster), 'friendly', 'the cleanup phase cannot revert');
  assert.deepEqual(captureEncirclement(match, roster, 'A', 100), { spawn: null, added: [], withdrawn: null, disabled: [] });
});

test('victory requires the last living enemy including crew and has no time or score shortcut', () => {
  const { roster, match, points } = setup();
  for (const point of points) point.owner = 'friendly';
  advanceEncirclement(match, points, roster);
  const crew = roster.find(unit => unit.team === 'enemy' && unit.type === 'tank').members[0];
  for (const unit of roster.filter(unit => unit.team === 'enemy')) unit.members.forEach(actor => { actor.health = 0; });
  crew.health = 1;
  assert.equal(advanceEncirclement(match, points, roster), null);
  crew.health = 0;
  assert.equal(advanceEncirclement(match, points, roster), 'friendly');
  const fresh = setup();
  for (const unit of fresh.roster.filter(unit => unit.team === 'enemy')) unit.members.forEach(actor => { actor.health = 0; });
  assert.equal(advanceEncirclement(fresh.match, fresh.points, fresh.roster), null, 'phase one still needs three points');
  assert.deepEqual(createEncirclement(), { phase: 1, captures: 0, unlocked: [], disabledEnemySpawns: [], winner: null });
});

test('each newly unlocked rear point permanently closes the nearest two active enemy spawns exactly once', () => {
  const { roster, match } = setup();
  const points = encirclementSpawns();
  assert.equal(points.filter(point => point.team === 'enemy').length, 10, 'no unused phantom enemy staging points');
  for (const rear of REAR_SPAWNS) {
    const nearest = points.filter(point => point.team === 'enemy' && point.kind !== 'air' && point.enabled !== false)
      .sort((a, b) => Math.hypot(a.x - rear.x, a.z - rear.z) - Math.hypot(b.x - rear.x, b.z - rear.z) ||
        a.id.localeCompare(b.id)).slice(0, 2).map(point => point.id);
    const event = captureEncirclement(match, roster, rear.objectiveId, 0, points);
    assert.deepEqual(event.disabled.map(point => point.id), nearest);
    assert.ok(event.disabled.every(point => point.enabled === false && point.disabledBy === rear.id));
    assert.ok(event.disabled.every(point => /永久关闭/.test(spawnBlockReason(point, 'infantry', [], []))));
    const count = match.disabledEnemySpawns.length;
    assert.deepEqual(captureEncirclement(match, roster, rear.objectiveId, 1, points).disabled, []);
    assert.equal(match.disabledEnemySpawns.length, count);
  }
  assert.equal(match.disabledEnemySpawns.length, 6);
  assert.equal(new Set(match.disabledEnemySpawns).size, 6);
  assert.equal(points.filter(point => point.team === 'enemy' && point.enabled !== false).length, 4);
  assert.ok(roster.flatMap(unit => unit.members).every(actor => actor.health === 100), 'closing a point does not kill existing soldiers');
  assert.ok(encirclementSpawns().every(point => point.enabled !== false), 'restart creates fresh points');
});

test('nearest closures include live rallies and tanks, but ignore closed points, destroyed rallies and friendly spawns', () => {
  const { roster, match } = setup(), rear = REAR_SPAWNS[0];
  const points = [
    { id: 'closed', team: 'enemy', kind: 'base', ...{ x: rear.x, z: rear.z }, enabled: false },
    { id: 'destroyed', team: 'enemy', kind: 'rally', x: rear.x, z: rear.z, health: 0 },
    { id: 'friendly', team: 'friendly', kind: 'base', x: rear.x, z: rear.z },
    { id: 'live-rally', team: 'enemy', kind: 'rally', x: rear.x + 1, z: rear.z, health: 120 },
    { id: 'garage', team: 'enemy', kind: 'garage', x: rear.x + 2, z: rear.z },
    { id: 'far-base', team: 'enemy', kind: 'base', x: rear.x + 40, z: rear.z },
  ];
  assert.deepEqual(captureEncirclement(match, roster, 'A', 0, points).disabled.map(point => point.id), ['live-rally', 'garage']);
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

test('local aircraft and mortarmen survive integration and the last living pilot blocks victory', () => {
  const { roster, match, points } = setup();
  assert.equal(armySummary(roster, 'friendly').alive, 44);
  assert.equal(armySummary(roster, 'enemy').alive, 96);
  const pilot = roster.find(unit => unit.team === 'enemy' && unit.type === 'plane');
  assert.equal(pilot.spawnId, 'japan-air');
  const spawns = encirclementSpawns();
  assert.equal(spawns.filter(point => point.team === 'enemy').length, 10);
  assert.equal(spawns.some(point => point.id === 'japan-garage-1'), false);
  for (const point of points) {
    captureEncirclement(match, roster, point.id, 0, spawns);
    point.owner = 'friendly';
  }
  assert.equal(battleSpawn(pilot, spawns, [], []).id, 'japan-air');
  assert.equal(advanceEncirclement(match, points, roster), null);
  assert.equal(pilot.respawnEnabled, false);
  pilot.members[0].health = 0;
  assert.equal(reinforcementDue(pilot, 999), false);
  pilot.members[0].health = 1;
  for (const unit of roster.filter(unit => unit.team === 'enemy' && unit !== pilot)) {
    unit.members.forEach(actor => { actor.health = 0; });
  }
  assert.equal(advanceEncirclement(match, points, roster), null);
  pilot.members[0].health = 0;
  assert.equal(advanceEncirclement(match, points, roster), 'friendly');
  for (const type of ['infantry', 'tank', 'plane']) {
    const army = encirclementRoster(type);
    assert.equal(active(army, 'friendly').reduce((sum, unit) => sum + unit.memberCount, 0), 44);
  }
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
    const positions = formationPositions(spawn, unit.memberCount, town.obstacles, occupied);
    occupied.push(...positions);
  }
  assert.equal(occupied.length, 135);
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
