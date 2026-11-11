import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementObstacles } from '../src/movement-obstacles.js';
import { createMovementObstacles as legacyMovementObstacles } from '../scripts/fixtures/movement-obstacles-legacy.js';
import { obstacleLookup } from '../src/spatial.js';
import { vehicleCollider } from '../src/entities.js';
import { circleBlocked } from '../src/core.js';

const tank = (id, x, z, heading = 0) => ({ id, type: 'tank', variant: 'chi-ha', position: { x, z }, heading, health: 100 });

test('stable passes reuse exact ordered candidates, include wrecks, exclude aircraft, and preserve ignored vehicles', () => {
  const obstacles = [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2, height: 2 }];
  const lookup = obstacleLookup(obstacles, 2.5);
  const vehicles = new Map([['a', tank('a', 5, 0, .7)], ['b', { ...tank('b', 8, 3), health: 0 }],
    ['plane', { id: 'plane', type: 'plane' }]]);
  let constructions = 0;
  const current = createMovementObstacles(lookup, vehicles, vehicle => { constructions++; return vehicleCollider(vehicle); });
  const previous = legacyMovementObstacles(lookup, vehicles, vehicleCollider);
  current.beginStablePass();
  assert.throws(() => current.beginStablePass(), /cannot nest/);
  for (let i = 0; i < 2000; i++) {
    const x = (i * 13 % 200) / 10 - 10, z = (i * 17 % 200) / 10 - 10;
    const ignore = i % 3 === 0 ? 'a' : null;
    const actual = current.at(x, z, ignore), expected = previous.at(x, z, ignore);
    assert.deepEqual(actual, expected);
    assert.equal(circleBlocked(x, z, .43, actual, i % 4), circleBlocked(x, z, .43, expected, i % 4));
  }
  assert.equal(constructions, 2);
  assert.equal(current.at(.1, .1), current.at(.2, .2));
  current.endStablePass();
  vehicles.get('a').position.x = 1;
  vehicles.get('a').heading = 1.2;
  assert.deepEqual(current.at(0, 0), previous.at(0, 0));
  current.beginStablePass();
  assert.deepEqual(current.at(0, 0), previous.at(0, 0));
  current.endStablePass();
});

test('door index rebuilds, spawn/removal and vehicle replacements are reflected without stale merged buckets', () => {
  const door = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 2 };
  const lookup = obstacleLookup([door], 2.5), vehicles = new Map([['a', tank('a', 3, 0)]]);
  const current = createMovementObstacles(lookup, vehicles, vehicleCollider);
  const previous = legacyMovementObstacles(lookup, vehicles, vehicleCollider);
  current.beginStablePass();
  const old = current.at(0, 0);
  door.minX = 15; door.maxX = 17;
  lookup.rebuild();
  assert.notEqual(current.at(0, 0), old);
  assert.deepEqual(current.at(0, 0), previous.at(0, 0));
  assert.deepEqual(current.at(16, 0), previous.at(16, 0));
  current.endStablePass();
  vehicles.delete('a');
  vehicles.set('b', tank('b', -1, -3, 2));
  current.beginStablePass();
  assert.deepEqual(current.at(0, 0), previous.at(0, 0));
  current.endStablePass();
  vehicles.clear();
  current.beginStablePass();
  assert.equal(current.at(0, 0), lookup.at(0, 0));
  current.endStablePass();
});

test('a synchronous casualty search snapshots vehicle hulls once and can safely run inside an AI pass', () => {
  const lookup = obstacleLookup([{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 2 }], 2.5);
  const vehicles = new Map([['a', tank('a', 3, 0)], ['wreck', { ...tank('wreck', -2, 4), health: 0 }]]);
  let constructions = 0;
  const current = createMovementObstacles(lookup, vehicles, vehicle => { constructions++; return vehicleCollider(vehicle); });
  current.beginStablePass();
  const at = current.snapshot();
  const before = constructions;
  for (let i = 0; i < 2000; i++) {
    const x = i % 20 - 10, z = i % 17 - 8;
    assert.deepEqual(at(x, z), current.at(x, z));
  }
  assert.equal(constructions, before);
  current.endStablePass();
  vehicles.get('a').position.x = 30;
  assert.notDeepEqual(at(0, 0), current.snapshot()(0, 0), 'the next search must use the current hull pose');
});
