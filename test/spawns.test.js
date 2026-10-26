import test from 'node:test';
import assert from 'node:assert/strict';
import { SQUADS, SPAWN_RULES, makeBaseSpawns, deploymentBlockReason, supportsSquad, spawnBlockReason, rallyBuildBlockReason, spawnPositions,
  createRallyPoint, replaceTeamRally, damageRallyPoint } from '../src/spawns.js';
import { makeObjectives, circleBlocked } from '../src/core.js';

const wiped = [{ health: 0 }, { health: 0 }];
const rally = { id: 'test-rally', team: 'friendly', kind: 'rally', x: 0, z: 68, health: SPAWN_RULES.rallyHealth };

test('a wiped squad is unavailable but another squad of the same class is selectable', () => {
  assert.notEqual(SQUADS.infantry, SQUADS['infantry-reserve']);
  assert.equal(SQUADS.infantry.type, SQUADS['infantry-reserve'].type);
  assert.ok(deploymentBlockReason('dead', wiped, 'infantry', 'infantry'));
  assert.equal(deploymentBlockReason('dead', wiped, 'infantry-reserve', 'infantry'), null);
  assert.ok(deploymentBlockReason('pause', wiped, 'tank', 'infantry'));
  assert.ok(deploymentBlockReason('dead', [{ health: 1 }], 'tank', 'infantry'));
  assert.ok(deploymentBlockReason('dead', wiped, 'missing', 'infantry'));
  assert.equal(deploymentBlockReason('menu', [], 'infantry', 'infantry'), null);
});

test('registered spawn points are team-specific and distinguish ground, garage and air entry', () => {
  const bases = makeBaseSpawns();
  assert.ok(bases.some(point => point.team === 'enemy' && point.kind === 'base'));
  for (const type of ['infantry', 'tank', 'mortar', 'plane']) {
    assert.ok(bases.some(point => point.team === 'friendly' && supportsSquad(point, type)));
  }
  assert.equal(supportsSquad(rally, 'tank'), false);
  assert.equal(supportsSquad(rally, 'plane'), false);
  assert.equal(supportsSquad(rally, 'mortar'), true);
  assert.equal(supportsSquad(rally, 'unknown'), false);
});

test('rally spawns are blocked by nearby living ground enemies, not corpses or flyovers', () => {
  assert.equal(spawnBlockReason(rally, 'infantry', [], []), null);
  assert.ok(spawnBlockReason(rally, 'infantry', [{ x: 0, z: 70, health: 100 }], []));
  assert.equal(spawnBlockReason(rally, 'infantry', [{ x: 0, z: 70, health: 0 }], []), null);
  assert.equal(spawnBlockReason(rally, 'infantry', [{ x: 0, z: 70, health: 100, altitude: 27 }], []), null);
  assert.ok(spawnBlockReason({ ...rally, health: 0 }, 'infantry', [], []));
  assert.ok(spawnBlockReason(rally, 'infantry', [], [{ minX: -1, maxX: 1, minZ: 67, maxZ: 69 }]));
});

test('rally building requires clearance from terrain, capture zones and nearby hostiles', () => {
  assert.equal(rallyBuildBlockReason(rally, makeObjectives(), [], []), null);
  assert.ok(rallyBuildBlockReason({ x: -12, z: 30 }, makeObjectives(), [], []));
  assert.ok(rallyBuildBlockReason(rally, makeObjectives(), [{ x: 0, z: 69, health: 100 }], []));
  assert.ok(rallyBuildBlockReason({ x: 108, z: 0 }, [], [], []));
  assert.ok(rallyBuildBlockReason(rally, [], [], [{ minX: -2, maxX: 2, minZ: 65, maxZ: 72 }]));
  const captured = makeObjectives().map(point => ({ ...point, captured: true }));
  assert.equal(rallyBuildBlockReason({ x: -12, z: 30 }, captured, [], []), null);
});

test('squad members enter as a formation at the selected point, not at the current objective', () => {
  for (const point of makeBaseSpawns().filter(point => point.kind === 'base')) {
    const positions = spawnPositions(point, 8);
    assert.equal(positions.length, 8);
    assert.equal(new Set(positions.map(p => `${p.x}:${p.z}`)).size, 8);
    for (const position of positions) {
      assert.ok(Math.hypot(position.x - point.x, position.z - point.z) < 4);
      assert.equal(circleBlocked(position.x, position.z, .4, []), false);
    }
  }
});
const createRally = (id, team = 'friendly') => createRallyPoint({ id, team, builderId: `${team}-engineer`,
  position: { x: 0, y: .45, z: 68 } });
test('rallies store only simulation data and replace only the same team while preserving registered bases', () => {
  const old = createRally('old'), enemy = createRally('enemy', 'enemy');
  const original = [...makeBaseSpawns(), old, enemy], next = createRally('new');
  const points = replaceTeamRally(original, next);
  assert.equal('model' in next, false);
  assert.equal(next.builderId, 'friendly-engineer');
  assert.equal(next.altitude, .45);
  assert.equal(next.health, 120);
  assert.equal(points.includes(old), false);
  assert.equal(original.includes(old), true);
  assert.ok(points.includes(enemy));
  assert.deepEqual(points.filter(point => point.kind !== 'rally'), makeBaseSpawns());
  assert.equal(points.filter(point => point.team === 'friendly' && point.kind === 'rally').length, 1);
  assert.equal(spawnBlockReason(next, 'mortar', [], []), null);
  assert.doesNotThrow(() => JSON.stringify(points));
});
test('rally destruction is a single simulation transition and immediately blocks deployment without a renderer', () => {
  const point = createRally('rally');
  assert.deepEqual(damageRallyPoint(point, 100), { damage: 100, destroyed: false });
  assert.equal(point.health, 20);
  assert.deepEqual(damageRallyPoint(point, 100), { damage: 20, destroyed: true });
  assert.equal(point.health, 0);
  assert.match(spawnBlockReason(point, 'infantry', [], []), /已被摧毁/);
  assert.deepEqual(damageRallyPoint(point, 100), { damage: 0, destroyed: false });
  assert.equal(point.builderId, 'friendly-engineer');
});
test('invalid or reused rally identities and damage fail explicitly', () => {
  const point = createRally('rally');
  for (const amount of [-1, NaN, Infinity]) assert.throws(() => damageRallyPoint(point, amount), RangeError);
  assert.equal(point.health, 120);
  assert.throws(() => damageRallyPoint(makeBaseSpawns()[0], 1), /simulation state/);
  assert.throws(() => replaceTeamRally([point], createRally(point.id)), /new live identity/);
  assert.throws(() => createRallyPoint({ id: 'r', team: 'friendly', builderId: '', position: { x: 0, y: 0, z: 0 } }), /simulation state/);
  assert.throws(() => createRallyPoint({ id: 'r', team: 'missing', builderId: 'e', position: { x: 0, y: 0, z: 0 } }), /simulation state/);
  assert.throws(() => createRallyPoint({ id: 'r', team: 'friendly', builderId: 'e', position: { x: NaN, y: 0, z: 0 } }), /simulation state/);
});
