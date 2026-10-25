import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTownLayout } from '../src/town-layout.js';
import { makeDoors, doorCollider, requestDoor, advanceDoor, resetDoors } from '../src/doors.js';
import { circleBlocked, createNavigator, segmentClear } from '../src/core.js';

const makeDoor = () => makeDoors(makeTownLayout()).find(door => door.id === 'west-0-east-door');
test('closed door blocks the actual opening and opens with an oriented collider', () => {
  const door = makeDoor();
  assert.equal(door.state, 'closed');
  assert.equal(circleBlocked(-4.5, 64, .42, [doorCollider(door)]), true);
  requestDoor(door, { x: -2, z: 64 });
  advanceDoor(door, 1);
  assert.equal(door.state, 'open');
  assert.equal(circleBlocked(-4.5, 64, .42, [doorCollider(door)]), false);
  assert.equal(circleBlocked(-5.5, 63.05, .42, [doorCollider(door)]), true, 'opened leaf still physically occupies its rotated position');
});
test('opening direction is away from the interacting side', () => {
  const outside = makeDoor(), inside = makeDoor();
  requestDoor(outside, { x: -2, z: 64 });
  requestDoor(inside, { x: -7, z: 64 });
  assert.equal(outside.targetAngle, -Math.PI / 2);
  assert.equal(inside.targetAngle, Math.PI / 2);
});
test('swept motion stops before hitting someone behind the leaf and resumes after they leave', () => {
  const door = makeDoor();
  requestDoor(door, { x: -2, z: 64 });
  const actor = { x: -5.45, z: 63.9, radius: .42 };
  const moved = advanceDoor(door, 1, [actor]);
  assert.equal(moved, true, 'safe partial movement must be published even when a later sweep step is blocked');
  assert.equal(door.blocked, true);
  assert.ok(door.angle > -Math.PI / 2);
  assert.equal(circleBlocked(actor.x, actor.z, .42, [doorCollider(door)]), false, 'the door never sweeps through the capsule');
  advanceDoor(door, 1, []);
  assert.equal(door.state, 'open');
  assert.equal(door.blocked, false);
});
test('AI requests do not repeatedly toggle an opening door and pause freezes it', () => {
  const door = makeDoor();
  requestDoor(door, { x: -2, z: 64 }, true);
  advanceDoor(door, .2);
  const angle = door.angle;
  assert.equal(requestDoor(door, { x: -2, z: 64 }, true), false);
  advanceDoor(door, 0);
  assert.equal(door.angle, angle);
  assert.throws(() => advanceDoor(door, NaN), RangeError);
});
test('new battle resets each door to its authored starting state', () => {
  const doors = makeDoors(makeTownLayout()), door = doors.find(item => item.id === 'west-0-east-door');
  requestDoor(door, { x: 0, z: 64 }); advanceDoor(door, 1);
  resetDoors(doors);
  assert.equal(door.state, 'closed');
  assert.equal(door.angle, 0);
});
test('local navigation refresh sees moved obstacles without rebuilding the whole grid', () => {
  const door = makeDoor(), obstacle = doorCollider(door), obstacles = [obstacle];
  const nav = createNavigator(obstacles);
  assert.equal(segmentClear({ x: -3, z: 64 }, { x: -6, z: 64 }, .46, obstacles), false);
  requestDoor(door, { x: -2, z: 64 }); advanceDoor(door, 1);
  Object.assign(obstacle, doorCollider(door));
  nav.refresh({ minX: -8, maxX: 0, minZ: 60, maxZ: 68 });
  const path = nav({ x: -3, z: 64 }, { x: -6, z: 64 });
  assert.ok(path.length > 0);
  assert.equal(segmentClear({ x: -3, z: 64 }, path[0], .46, obstacles), true);
});
