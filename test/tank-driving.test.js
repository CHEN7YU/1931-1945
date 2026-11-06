import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTankDriving, TANK_DRIVING } from '../src/player-tank.js';
import { Matrix4, Vector3 } from 'three';
import { historicalVehicleModel, animateVickersTracks, VICKERS_TRACK_LENGTH } from '../src/vehicle-model.js';

const tank = () => ({ type: 'tank', variant: null, speed: 0, health: 360 });
const drive = (vehicle, forward, seconds, hz) => {
  let distance = 0;
  for (let step = 0; step < seconds * hz; step++) distance += advanceTankDriving(vehicle, forward, 0, 1 / hz).distance;
  return distance;
};

test('tank accelerates progressively and integrates the exact 1/3/5 second startup distance at different frame rates', () => {
  for (const hz of [20, 30, 60, 144]) for (const seconds of [1, 3, 5]) {
    const vehicle = tank(), distance = drive(vehicle, 1, seconds, hz);
    assert.ok(Math.abs(vehicle.speed - TANK_DRIVING.acceleration * seconds) < 1e-9);
    assert.ok(Math.abs(distance - TANK_DRIVING.acceleration * seconds ** 2 / 2) < 1e-9);
  }
});

test('release brakes to a stop and reverse first consumes the forward stopping interval', () => {
  for (const hz of [20, 60, 144]) {
    const vehicle = tank(); drive(vehicle, 1, 5, hz);
    assert.ok(Math.abs(drive(vehicle, 0, 3, hz) - 10) < 1e-9);
    assert.equal(vehicle.speed, 0);
    vehicle.speed = 8;
    const distance = drive(vehicle, -1, 3, hz);
    assert.ok(Math.abs(distance - (10 - .15)) < 1e-9);
    assert.ok(Math.abs(vehicle.speed + .6) < 1e-9);
    drive(vehicle, -1, 3, hz);
    assert.equal(vehicle.speed, -TANK_DRIVING.reverseSpeed);
  }
});

test('a large step crosses braking and reverse acceleration consistently with small steps', () => {
  const vehicle = tank(), fine = tank(); vehicle.speed = fine.speed = 8;
  const whole = advanceTankDriving(vehicle, -1, 0, 5);
  assert.ok(Math.abs(whole.distance - drive(fine, -1, 5, 60)) < 1e-9);
  assert.equal(vehicle.speed, fine.speed);
});

test('pause and crew changes preserve vehicle speed; dead vehicles cannot keep moving', () => {
  const vehicle = tank(); drive(vehicle, 1, 1, 20);
  const speed = vehicle.speed;
  assert.deepEqual(advanceTankDriving(vehicle, 0, 1, 0), { distance: 0, turn: 0, speed });
  vehicle.occupantId = 'another-crew-member';
  assert.equal(vehicle.speed, speed);
  assert.ok(advanceTankDriving(vehicle, 0, 1, .05).turn > 0);
  vehicle.health = 0;
  assert.deepEqual(advanceTankDriving(vehicle, 1, 1, .05), { distance: 0, turn: 0, speed: 0 });
  for (const value of [NaN, Infinity, -1]) assert.throws(() => advanceTankDriving(tank(), 1, 0, value), /finite/);
});

test('actual track shoes circulate with ground travel, reverse with S and counter-roll when turning', () => {
  const model = historicalVehicleModel('tank'), another = historicalVehicleModel('tank');
  const left = model.getObjectByName('vickers-track--1'), right = model.getObjectByName('vickers-track-1');
  assert.equal(left.count, 80); assert.equal(right.count, 80);
  assert.notEqual(left.instanceMatrix.array, another.getObjectByName('vickers-track--1').instanceMatrix.array);
  const point = (mesh, index) => {
    const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  };
  animateVickersTracks(model, 0, 0);
  const top = point(left, 15), bottom = point(left, 50);
  animateVickersTracks(model, .25, 0);
  assert.ok(Math.abs(point(left, 15).z - top.z + .25) < 1e-6);
  assert.ok(Math.abs(point(left, 50).z - bottom.z - .25) < 1e-6);
  animateVickersTracks(model, 0, .1);
  assert.ok(point(left, 15).z > top.z);
  assert.ok(point(right, 15).z < top.z);
  animateVickersTracks(model, 0, 0);
  const original = [...left.instanceMatrix.array];
  animateVickersTracks(model, VICKERS_TRACK_LENGTH, 0);
  assert.deepEqual([...left.instanceMatrix.array], original);
  const version = left.instanceMatrix.version;
  animateVickersTracks(model, VICKERS_TRACK_LENGTH, 0);
  assert.equal(left.instanceMatrix.version, version, 'idle and paused tracks must not upload unchanged matrices');
});
