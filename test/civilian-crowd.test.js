import test from 'node:test';
import assert from 'node:assert/strict';
import { circleBlocked } from '../src/core.js';
import { NANJING_CIVILIAN_COUNT, civilianWaitingSlot, civilianWaypointReached, moveCivilianInCrowd, animateCivilianWaiting,
  nanjingOpeningCivilianStart, nanjingOpeningCivilianReleaseAt, civilianPaceMultiplier,
  releaseNanjingCivilianWave } from '../src/civilian-crowd.js';

test('sixty bridge refugees have independent exterior positions, and the 120 residents do not emerge before the retreat order', () => {
  const starts = Array.from({ length: 60 }, (_, index) => nanjingOpeningCivilianStart(index));
  for (let index = 0; index < starts.length; index++) {
    assert.ok(starts[index].z >= 39 && starts[index].z <= 64 && Math.abs(starts[index].x + 24) <= 2.2);
    for (const other of starts.slice(index + 1))
      assert.ok(Math.hypot(starts[index].x - other.x, starts[index].z - other.z) > .72);
  }
  const civilians = Array.from({ length: 180 }, (_, civilianId) => ({
    userData: { civilianId, homeId: civilianId % 20, withdrawalWave: civilianId >= 60,
      releaseAt: civilianId < 60 ? 0 : Infinity },
  }));
  releaseNanjingCivilianWave(civilians, 180);
  assert.equal(civilians[59].userData.releaseAt, 0);
  for (const person of civilians.slice(60)) assert.ok(person.userData.releaseAt >= 180 && person.userData.releaseAt < 242);
  for (let home = 0; home < 20; home++) {
    const releases = civilians.slice(60).filter(person => person.userData.homeId === home).map(person => person.userData.releaseAt);
    for (let index = 1; index < releases.length; index++) assert.ok(releases[index] - releases[index - 1] >= 1.4);
  }
});

test('opening refugees arrive in two uneven waves with a real release gap and independently varying walking speeds', () => {
  const releases = Array.from({ length: 60 }, (_, index) => nanjingOpeningCivilianReleaseAt(index));
  assert.equal(releases[0], 0);
  assert.ok(releases[47] < 38);
  assert.equal(releases[48], 46);
  assert.ok(releases[48] - releases[47] >= 8);
  assert.ok(releases[59] < 66);
  assert.ok(new Set(releases.slice(1, 48).map((value, index) => (value - releases[index]).toFixed(3))).size > 30);
  const speeds = Array.from({ length: 180 }, (_, index) => civilianPaceMultiplier(index, 20));
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > .3);
  assert.ok(speeds.every(speed => speed > .77 && speed < 1.26));
  assert.notEqual(civilianPaceMultiplier(1, 20), civilianPaceMultiplier(1, 30));
  const starts = Array.from({ length: 60 }, (_, index) => nanjingOpeningCivilianStart(index));
  assert.equal(new Set(starts.map(point => point.x)).size, 60);
});
test('crowds can spread through a shared street waypoint without cutting solid corners or missing their final slot', () => {
  const route = [{ x: 0, z: 0 }, { x: 0, z: -5 }];
  const position = { x: .7, z: 0 };
  assert.equal(civilianWaypointReached(position, route, 0, []), true);
  const corner = { minX: .25, maxX: 2, minZ: -3, maxZ: -.4, height: 3 };
  assert.equal(civilianWaypointReached(position, route, 0, [corner]), false);
  assert.equal(civilianWaypointReached({ x: .01, z: 0 }, route, 0, [corner]), true);
  assert.equal(civilianWaypointReached({ x: .7, z: -5 }, route, 1, []), false);
  assert.equal(civilianWaypointReached({ x: .01, z: -5 }, route, 1, []), true);
});

test('sixty individual waiting places form a dense crowd on the dock without merged bodies', () => {
  const slots = Array.from({ length: 60 }, (_, index) => civilianWaitingSlot(index));
  for (const [index, slot] of slots.entries()) {
    assert.ok(slot.x > -73 && slot.x < -64 && slot.z > -90 && slot.z < -70);
    assert.equal(slot.y, .36);
    for (const other of slots.slice(index + 1)) assert.ok(Math.hypot(slot.x - other.x, slot.z - other.z) > .89);
  }
  assert.throws(() => civilianWaitingSlot(NANJING_CIVILIAN_COUNT), RangeError);
  for (let index = 0; index < 7; index++) {
    const a = civilianWaitingSlot(index), b = civilianWaitingSlot(index + 1);
    assert.ok(b.z - a.z > 1.7, 'passing aisles remain open even after the adjacent rows have filled');
  }
});

test('one hundred and eighty civilians overflow the dock onto the eastern approach without sharing body space', () => {
  const slots = Array.from({ length: NANJING_CIVILIAN_COUNT }, (_, index) => civilianWaitingSlot(index));
  assert.equal(slots.length, 180);
  assert.equal(slots.filter(slot => slot.x > -59).length, 120);
  for (let index = 0; index < slots.length; index++) for (const other of slots.slice(index + 1))
    assert.ok(Math.hypot(slots[index].x - other.x, slots[index].z - other.z) >= .72);
});
test('a moving civilian cannot pass through a waiting person or a solid barrier', () => {
  const first = { position: { x: 0, y: 0, z: 0 }, userData: { civilianId: 0 } };
  const second = { position: { x: 1, y: 0, z: 0 }, userData: { civilianId: 1 } };
  const wall = { minX: 2, maxX: 3, minZ: -4, maxZ: 4, height: 2 };
  for (let frame = 0; frame < 60; frame++) {
    moveCivilianInCrowd(first, { x: 4, z: 0 }, .1, [first, second], [wall]);
    assert.ok(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z) >= .72);
    assert.ok(first.position.x <= 1.64);
  }
  const dock = { position: { x: -65, y: 0, z: -80 }, userData: { civilianId: 2 } };
  moveCivilianInCrowd(dock, { x: -66, z: -80 }, .1, [dock], []);
  assert.equal(dock.position.y, .36, 'feet stand on the platform instead of sinking through its planks');
});

test('civilians can step sideways away from a solid corner before continuing along a street', () => {
  const person = { position: { x: .369, y: 0, z: 0 }, userData: { civilianId: 11 } };
  const wall = { minX: -3, maxX: 0, minZ: 0, maxZ: 5, height: 3 };
  const target = { x: -4, z: -1 };
  for (let frame = 0; frame < 200; frame++) moveCivilianInCrowd(person, target, .135, [person], [wall]);
  assert.ok(Math.hypot(person.position.x - target.x, person.position.z - target.z) < .02);
});

test('a civilian displaced from a city route replans around a long wall instead of oscillating at its face', () => {
  const person = { position: { x: .4, y: 0, z: 0 }, userData: { civilianId: 135 } };
  const wall = { minX: -4, maxX: 0, minZ: -4, maxZ: 4, height: 3 };
  const target = { x: -5, z: 0 };
  for (let frame = 0; frame < 600; frame++) {
    moveCivilianInCrowd(person, target, .135, [person], [wall]);
    assert.equal(circleBlocked(person.position.x, person.position.z, .36, [wall]), false);
  }
  assert.ok(Math.hypot(person.position.x - target.x, person.position.z - target.z) < .02);
});

test('waiting civilians look toward the boats, shift their upper bodies, and stop walking in place', () => {
  const limb = () => ({ rotation: { x: 1, set(x, y, z) { Object.assign(this, { x, y, z }); } } });
  const civilian = { position: { x: -66, y: .36, z: -80 }, rotation: {},
    userData: { civilianId: 5, carrying: 'none' }, civilianArms: [limb(), limb()],
    civilianLegs: [limb(), limb()], civilianTorso: limb(), civilianHead: limb() };
  const before = { ...civilian.position };
  animateCivilianWaiting(civilian, 10);
  const head = civilian.civilianHead.rotation.y;
  animateCivilianWaiting(civilian, 12);
  assert.notEqual(civilian.civilianHead.rotation.y, head);
  assert.ok(civilian.civilianLegs.every(leg => leg.rotation.x === 0));
  assert.deepEqual(civilian.position, before);
});
