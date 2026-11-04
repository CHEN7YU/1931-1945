import test from 'node:test';
import assert from 'node:assert/strict';
import { SQUADS, SPAWN_RULES, makeBaseSpawns, deploymentBlockReason, supportsSquad, spawnBlockReason, rallyBuildBlockReason, spawnPositions,
  createRallyPoint, replaceTeamRally, damageRallyPoint } from '../src/spawns.js';
import { makeObjectives, circleBlocked } from '../src/core.js';
import { NANJING_WALL_WALK } from '../src/nanjing-layout.js';
import { NANJING_SPAWNS } from '../src/nanjing-campaign.js';
import { formationPositions } from '../src/battle-roster.js';

test('Nanjing defense spawns retain enemy blocking while the northern rampart offers a separate counterattack entry', () => {
  for (const id of ['nanjing-gate', 'nanjing-gate-north-wall']) {
    const point = NANJING_SPAWNS.find(point => point.id === id);
    const enemy = { x: point.x, z: point.z, health: 100, altitude: point.altitude };
    assert.equal(spawnBlockReason(point, 'infantry', [enemy], []), '附近有敌军，暂时无法部署');
    if (point.layout === 'wall' || point.deploymentZone) {
      assert.throws(() => formationPositions(point, 11, [], [], [enemy]));
    } else {
      assert.ok(formationPositions(point, 11, [], [], [enemy]).every(position =>
        Math.hypot(position.x - enemy.x, position.z - enemy.z) >= SPAWN_RULES.enemyBlockRadius));
    }
    assert.equal(spawnBlockReason(point, 'tank', [enemy], []), '该重生点不支持此小队');
    assert.equal(spawnBlockReason(point, 'infantry', [],
      [{ minX: point.x - 3, maxX: point.x + 3, minZ: point.z - 3, maxZ: point.z + 3 }]), '重生区域受阻');
  }
  const rampart = NANJING_SPAWNS.find(point => point.id === 'nanjing-gate-north-wall');
  const groundEnemy = { x: rampart.x, z: rampart.z, health: 100, altitude: 0 };
  assert.equal(spawnBlockReason(rampart, 'infantry', [groundEnemy], []), null);
  const positions = formationPositions(rampart, 11, [],
    [{ x: rampart.x, y: 0, z: rampart.z }], [groundEnemy]);
  assert.equal(positions.length, 11);
  assert.ok(positions.every(position => Math.abs(position.z - rampart.z) <= .71));
});

test('Nanjing dock deployment permits nearby enemies but retains body, geometry, bounded-area and squad-type clearance', () => {
  const point = NANJING_SPAWNS.find(point => point.id === 'nanjing-west-dock');
  const enemy = { x: point.x, z: point.z, health: 100, altitude: 0 };
  assert.equal(spawnBlockReason(point, 'infantry', [enemy], []), null);
  const occupied = [{ x: point.x + 3, y: .36, z: point.z - 2 }];
  const positions = formationPositions(point, 11, [], occupied, [enemy]);
  assert.equal(positions.length, 11);
  for (const position of positions) {
    assert.ok(Math.hypot(position.x - enemy.x, position.z - enemy.z) >= 1.25);
    assert.ok(Math.hypot(position.x - point.x, position.z - point.z) <= 20);
    assert.ok(position.x >= point.deploymentZone.minX && position.x <= point.deploymentZone.maxX);
    assert.ok(position.z >= point.deploymentZone.minZ && position.z <= point.deploymentZone.maxZ);
    assert.ok(occupied.every(other => Math.hypot(position.x - other.x, position.z - other.z) >= 1.25));
  }
  assert.equal(spawnBlockReason(point, 'tank', [enemy], []), '该重生点不支持此小队');
  const wreck = { minX: point.x - 3, maxX: point.x + 3, minZ: point.z - 3, maxZ: point.z + 3 };
  assert.equal(spawnBlockReason(point, 'infantry', [enemy], [wreck]), null, 'a blocked central marker still permits a nearby clear area');
  assert.ok(formationPositions(point, 11, [wreck], occupied, [enemy]).every(position =>
    !circleBlocked(position.x, position.z, .48, [wreck])));
  assert.equal(spawnBlockReason(point, 'infantry', [enemy],
    [{ minX: -73, maxX: -40, minZ: -95, maxZ: -65 }]), '重生区域受阻');
});

const wiped = [{ health: 0 }, { health: 0 }];
const rally = { id: 'test-rally', team: 'friendly', kind: 'rally', x: 0, z: 68, health: SPAWN_RULES.rallyHealth };

test('a wiped squad can redeploy its same type; live squads cannot refresh themselves', () => {
  assert.deepEqual(Object.keys(SQUADS), ['infantry', 'tank', 'plane']);
  assert.equal(deploymentBlockReason('dead', wiped, 'infantry', 'infantry'), null);
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
  assert.equal(supportsSquad(rally, 'mortar'), false);
  assert.equal(supportsSquad(rally, 'unknown'), false);
});

test('objective spawns retain enemy and geometry checks; retired rallies cannot deploy anyone', () => {
  const point = { ...rally, kind: 'objective' };
  assert.equal(spawnBlockReason(point, 'infantry', [], []), null);
  assert.ok(spawnBlockReason(point, 'infantry', [{ x: 0, z: 70, health: 100 }], []));
  assert.equal(spawnBlockReason(point, 'infantry', [{ x: 0, z: 70, health: 0 }], []), null);
  assert.equal(spawnBlockReason(point, 'infantry', [{ x: 0, z: 70, health: 100, altitude: 27 }], []), null);
  assert.ok(spawnBlockReason(rally, 'infantry', [], []));
  assert.ok(spawnBlockReason(point, 'infantry', [], [{ minX: -1, maxX: 1, minZ: 67, maxZ: 69 }]));
  const wall = { ...point, x: (NANJING_WALL_WALK.minX + NANJING_WALL_WALK.maxX) / 2,
    z: -16, altitude: NANJING_WALL_WALK.height, layout: 'wall' };
  assert.equal(spawnBlockReason(wall, 'infantry', [{ x: wall.x, z: wall.z, health: 100 }], []), null);
  assert.ok(spawnBlockReason(wall, 'infantry', [{ x: wall.x, z: wall.z,
    altitude: NANJING_WALL_WALK.height, health: 100 }], []));
});

test('rally building requires clearance from terrain, capture zones and nearby hostiles', () => {
  assert.equal(rallyBuildBlockReason(rally, makeObjectives(), [], []), null);
  assert.ok(rallyBuildBlockReason({ x: -12, z: 30 }, makeObjectives(), [], []));
  assert.ok(rallyBuildBlockReason(rally, makeObjectives(), [{ x: 0, z: 69, health: 100 }], []));
  assert.ok(rallyBuildBlockReason({ x: 108, z: 0 }, [], [], []));
  assert.ok(rallyBuildBlockReason(rally, [], [], [{ minX: -2, maxX: 2, minZ: 65, maxZ: 72 }]));
  const captured = makeObjectives().map(point => ({ ...point, owner: 'friendly', captured: true }));
  assert.equal(rallyBuildBlockReason({ x: -12, z: 30 }, captured, [], []), null);
  assert.ok(rallyBuildBlockReason({ x: -12, z: 30 }, captured, [], [], 'enemy'));
  const enemyOwned = captured.map(point => ({ ...point, owner: 'enemy', captured: false }));
  assert.equal(rallyBuildBlockReason({ x: -12, z: 30 }, enemyOwned, [], [], 'enemy'), null);
  assert.ok(rallyBuildBlockReason({ x: -12, z: 30 }, enemyOwned, [], []));
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
  assert.ok(spawnBlockReason(next, 'mortar', [], []), 'retained legacy data must not enable rally spawning');
  assert.doesNotThrow(() => JSON.stringify(points));
});
test('rally destruction is a single simulation transition and immediately blocks deployment without a renderer', () => {
  const point = createRally('rally');
  assert.deepEqual(damageRallyPoint(point, 100), { damage: 100, destroyed: false });
  assert.equal(point.health, 20);
  assert.deepEqual(damageRallyPoint(point, 100), { damage: 20, destroyed: true });
  assert.equal(point.health, 0);
  assert.match(spawnBlockReason(point, 'infantry', [], []), /不支持/);
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
