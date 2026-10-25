import test from 'node:test';
import assert from 'node:assert/strict';
import { SQUADS, SPAWN_RULES, makeBaseSpawns, deploymentBlockReason, supportsSquad, spawnBlockReason, rallyBuildBlockReason, spawnPositions } from '../src/spawns.js';
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
