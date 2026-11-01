import test from 'node:test';
import assert from 'node:assert/strict';
import { createAircraftControl, aircraftMouseLook, advancePlayerAircraft, FLIGHT } from '../src/player-aircraft.js';

function aircraft() {
  const plane = { health: 180, heading: 0, pitch: 0, roll: 0, position: { x: 0, y: 60, z: 0 }, speed: 0, throttle: 1 };
  plane.flightControl = createAircraftControl(plane);
  return plane;
}
const input = overrides => ({ roll: 0, pitch: 0, rudder: 0, throttle: 0, freeLook: false, ...overrides });

test('mouse directs an owned target, never instantaneously rotating the aircraft', () => {
  const plane = aircraft();
  aircraftMouseLook(plane, -600, -100, .0022);
  assert.equal(plane.heading, 0); assert.equal(plane.pitch, 0); assert.equal(plane.roll, 0);
  assert.ok(plane.flightControl.targetHeading > 1);
  const initial = structuredClone(plane);
  advancePlayerAircraft(plane, 0, input());
  assert.deepEqual(plane, initial);
  advancePlayerAircraft(plane, 1 / 60, input());
  assert.ok(Math.abs(plane.heading) < .01);
  assert.ok(plane.roll > 0);
  assert.ok(plane.pitch > 0 && plane.pitch < .01);
});

test('banked turns are real arcs, lose speed, and do not turn 180 degrees in one second', () => {
  for (const hz of [30, 60, 144]) {
    const turn = aircraft(), straight = aircraft();
    turn.flightControl.targetHeading = Math.PI;
    for (let frame = 0; frame < hz * 6; frame++) {
      advancePlayerAircraft(turn, 1 / hz, input());
      advancePlayerAircraft(straight, 1 / hz, input());
      assert.ok(Math.abs(turn.roll) <= FLIGHT.bankLimit);
      assert.ok(Math.abs(turn.flightControl.turnRate) < .7);
      if (frame < hz) assert.ok(Math.abs(turn.heading) < .2);
    }
    assert.ok(turn.position.x < -10);
    assert.ok(turn.speed < straight.speed);
    assert.ok(Math.abs(turn.heading) < Math.PI);
  }
});

test('free look changes head direction without altering the steering target or attitude', () => {
  const plane = aircraft();
  const heading = plane.flightControl.targetHeading, pitch = plane.flightControl.targetPitch;
  aircraftMouseLook(plane, 300, 80, .0022, true);
  assert.equal(plane.flightControl.targetHeading, heading);
  assert.equal(plane.flightControl.targetPitch, pitch);
  assert.equal(plane.heading, 0);
  assert.ok(plane.flightControl.lookYaw < 0);
  advancePlayerAircraft(plane, .1, input({ freeLook: true }));
  assert.ok(plane.position.z < 0);
  const looked = plane.flightControl.lookYaw;
  advancePlayerAircraft(plane, .1, input());
  assert.ok(Math.abs(plane.flightControl.lookYaw) < Math.abs(looked));
});

test('low energy flight warns and sinks instead of hovering; pause freezes it', () => {
  const plane = aircraft();
  plane.speed = 16; plane.throttle = 0;
  advancePlayerAircraft(plane, .1, input());
  assert.equal(plane.flightControl.stalling, true);
  assert.ok(plane.position.y < 60);
  assert.ok(plane.position.z < 0);
  const before = structuredClone(plane);
  advancePlayerAircraft(plane, 0, input({ throttle: 1 }));
  assert.deepEqual(plane, before);
});

test('throttle and rudder do not bypass aircraft rates or exceed their bounds', () => {
  const plane = aircraft();
  for (let frame = 0; frame < 600; frame++) advancePlayerAircraft(plane, 1 / 60, input({ roll: 1, rudder: 1, throttle: 1 }));
  assert.equal(plane.throttle, 1);
  assert.ok(plane.speed <= FLIGHT.maxSpeed);
  assert.ok(Math.abs(plane.roll) <= FLIGHT.bankLimit);
  assert.throws(() => advancePlayerAircraft(plane, -.1, input()), RangeError);
  assert.throws(() => aircraftMouseLook(plane, NaN, 0, .0022), RangeError);
});
