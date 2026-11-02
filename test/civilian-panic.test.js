import test from 'node:test';
import assert from 'node:assert/strict';
import { CIVILIAN_PANIC_MEMORY, CIVILIAN_PANIC_RADIUS, frightenCivilian, isCivilianNearCombat } from '../src/civilian-panic.js';
import { civilianEscapeSpeed } from '../src/civilian-panic.js';

test('residents flee at an urgent pace before panic and accelerate when frightened', () => {
  for (const age of ['adult', 'child', 'elderly']) {
    const previous = { adult: 2.2, child: 1.9, elderly: 1.7 }[age];
    assert.ok(civilianEscapeSpeed(age, false) / previous >= 1.2);
    assert.ok(civilianEscapeSpeed(age, false) / previous < 1.25, 'increase urgency moderately rather than sprinting everyone');
    assert.ok(civilianEscapeSpeed(age, true) > civilianEscapeSpeed(age, false));
  }
  assert.throws(() => civilianEscapeSpeed('unknown', false), TypeError);
});

test('civilians react to fresh combat within hearing distance, regardless of which side fired', () => {
  const position = { x: 4, y: 0, z: 8 };
  const sounds = [
    { x: -40, y: 0, z: 8, time: 12, friendly: true },
    { x: 10, y: 1, z: 8, time: 12, friendly: false },
  ];
  assert.equal(isCivilianNearCombat(position, sounds, 12.2), true);
});

test('distant, stale and future combat sounds do not start a panic response', () => {
  const position = { x: 0, y: 0, z: 0 };
  assert.equal(isCivilianNearCombat(position, [
    { x: CIVILIAN_PANIC_RADIUS + 1, y: 0, z: 0, time: 10 },
  ], 10.1), false);
  assert.equal(isCivilianNearCombat(position, [
    { x: 1, y: 0, z: 0, time: 10 },
  ], 10 + CIVILIAN_PANIC_MEMORY + .1), false);
  assert.equal(isCivilianNearCombat(position, [
    { x: 1, y: 0, z: 0, time: 11 },
  ], 10), false);
  assert.throws(() => isCivilianNearCombat(position, [], NaN), /finite/);
});

test('fear keeps the north-then-west escape route and remains active', () => {
  const civilian = { waypoint: 0 };
  const position = { x: 0, y: 0, z: 0 };
  const sounds = [{ x: 4, y: 0, z: 0, time: 3 }];
  assert.equal(frightenCivilian(civilian, position, sounds, 3.2), true);
  assert.equal(civilian.panicked, true);
  assert.equal(civilian.panicStartedAt, 3.2);
  assert.equal(civilian.waypoint, 0);
  assert.equal(frightenCivilian(civilian, position, [], 4), false);
  assert.throws(() => frightenCivilian(null, position, sounds, 3.2), /actor/);
});
