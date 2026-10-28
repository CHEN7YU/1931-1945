import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTownLayout } from '../src/town-layout.js';
import { makeDoors, doorCollider, requestDoor, advanceDoor, resetDoors } from '../src/doors.js';
import { circleBlocked, createNavigator, segmentClear } from '../src/core.js';
import * as THREE from 'three';
import { createDoorWorld } from '../src/door-world.js';

const makeDoor = () => makeDoors(makeTownLayout()).find(door => door.id === 'west-0-east-door');
test('new courtyard gate leaves match their authored openings and stay clear when open', () => {
  const town = makeTownLayout(), doors = makeDoors(town);
  assert.equal(doors.length, 93);
  for (const gate of doors.filter(door => door.width === 2.4)) {
    assert.ok(Math.abs(gate.height - 1.85) < 1e-9);
    assert.equal(gate.state, 'open');
    assert.equal(circleBlocked(gate.x, gate.z, .46, [doorCollider(gate)]), false);
    requestDoor(gate, { x: gate.x, z: gate.z - 2 });
    advanceDoor(gate, 1);
    assert.equal(gate.state, 'closed');
    assert.equal(circleBlocked(gate.x, gate.z, .46, [doorCollider(gate)]), true);
  }
});
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
test('cached edges are invalidated across repeated closed/open door changes without wall shortcuts', () => {
  const door = makeDoor(), obstacle = doorCollider(door), layout = makeTownLayout();
  const obstacles = [...layout.obstacles, obstacle], navigator = createNavigator(obstacles);
  const start = { x: -2, z: 64 }, goal = { x: -8.5, z: 64 };
  const bounds = { minX: -8, maxX: -1, minZ: 60, maxZ: 68 };
  for (const angle of [0, Math.PI / 2, 0, -Math.PI / 2]) {
    Object.assign(obstacle, doorCollider(door, angle));
    navigator.refresh(bounds);
    const path = navigator(start, goal);
    assert.ok(path.length, 'a longer route through other real doors is still available');
    let previous = start;
    for (const point of path) {
      assert.equal(segmentClear(previous, point, .46, obstacles), true, `door angle ${angle}`);
      previous = point;
    }
    assert.deepEqual(path.at(-1), goal);
  }
});
test('AI blocking the final degrees of opening has a safe non-teleport escape route', () => {
  const town = { buildings: [{ id: 'west-0', x: -8.5 }], passages: [{ id: 'west-0-east-door', axis: 'z', width: 1.9, x: -4.5, z: 64 }] };
  const obstacles = [], material = new THREE.MeshBasicMaterial(), scene = new THREE.Scene();
  const world = createDoorWorld(scene, town, obstacles, [], material, material), door = world.doors[0];
  world.interact(door, { x: -7, z: 64 });
  world.update(1.485 / 1.8, []);
  let blocker;
  for (let x = -4; x < -1.5 && !blocker; x += .025) for (let z = 62; z < 65; z += .025) {
    if (!circleBlocked(x, z, .42, obstacles) && circleBlocked(x, z, .42, [doorCollider(door, door.angle + .025)])) {
      blocker = { x, z, radius: .42 }; break;
    }
  }
  assert.ok(blocker);
  world.update(.04, [blocker]);
  assert.equal(door.state, 'blocked');
  assert.ok(door.angle > 1.48 && door.angle < Math.PI / 2);
  const escape = world.swingEscape(blocker);
  assert.ok(escape, 'nearly-open doors still ask an obstructing AI to yield');
  assert.equal(segmentClear(blocker, escape, .42, obstacles), true);
  world.update(1, [escape]);
  assert.equal(door.state, 'open');
  assert.equal(world.swingEscape(escape), null);
});
