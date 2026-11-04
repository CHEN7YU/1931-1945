import test from 'node:test';
import assert from 'node:assert/strict';
import { createAircraftFall, advanceAircraftFall } from '../src/aircraft-wreck.js';

const wreck = () => {
  const vehicle = { health: 0, position: { x: 0, y: 35, z: 0 }, heading: .7, pitch: 0, roll: -.2, speed: 24 };
  vehicle.fall = createAircraftFall(vehicle);
  return vehicle;
};
test('destroyed aircraft keeps horizontal momentum and falls instead of freezing in the sky', () => {
  for (const hz of [30, 60, 144]) {
    const vehicle = wreck();
    const before = structuredClone(vehicle);
    assert.equal(advanceAircraftFall(vehicle, 0, 0, () => assert.fail('paused wreck must not trace')), false);
    assert.deepEqual(vehicle, before);
    for (let frame = 1; frame <= hz; frame++) advanceAircraftFall(vehicle, 1 / hz, frame / hz, () => null);
    assert.ok(vehicle.position.y < 30);
    assert.ok(Math.hypot(vehicle.position.x, vehicle.position.z) > 15);
    assert.equal(vehicle.health, 0);
    assert.equal(vehicle.fall.grounded, false);
  }
});
test('wreck rests only after a real contact and emits a single landing transition', () => {
  const vehicle = wreck();
  assert.equal(advanceAircraftFall(vehicle, .1, 1, () => ({ x: 1, y: .45, z: 1 })), true);
  assert.equal(vehicle.fall.grounded, true);
  assert.equal(vehicle.fall.groundTime, 1);
  const before = structuredClone(vehicle);
  assert.equal(advanceAircraftFall(vehicle, .1, 2, () => assert.fail('grounded wreck cannot fall again')), false);
  assert.deepEqual(vehicle, before);
});

test('deep-water impacts sink below the surface exactly once and never become a floating ground wreck', () => {
  const vehicle = wreck();
  assert.equal(advanceAircraftFall(vehicle, .1, 1, () => ({ x: -84, y: .17, z: -80, water: true, waterLevel: -.28 })), true);
  assert.equal(vehicle.fall.grounded, false); assert.ok(vehicle.fall.sinking);
  const before = structuredClone(vehicle);
  advanceAircraftFall(vehicle, 0, 1, () => assert.fail('paused sinking cannot trace'));
  assert.deepEqual(vehicle, before);
  for (let step = 1; step <= 60; step++) {
    assert.equal(advanceAircraftFall(vehicle, .05, 1 + step * .05, () => assert.fail('deep water is not solid ground')), false);
  }
  assert.ok(vehicle.fall.sunk); assert.ok(vehicle.position.y < -5.28);
});
