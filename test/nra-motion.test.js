import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { createNraMotion, advanceNraMotion, sampleNraMotion, nativeMuzzleLocal } from '../src/nra-motion.js';
import { soldierRifleMuzzle } from '../src/entities.js';
import { createNativeGaitProfile } from '../src/nra-gait.js';

const data = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url), 'utf8'));
function actor() {
  const person = { team: 'friendly', heading: .7, position: { x: 2, y: .4, z: -5 }, walkPhase: 0, locomotion: { speed: 0 } };
  person.nativeMotion = createNraMotion(data.motion, person);
  return person;
}

test('native idle holds hips and knees still with a long subtle breathing cycle', () => {
  assert.equal(data.idle.duration, 6);
  for (const name of ['Hips', 'LeftLeg', 'RightLeg', 'LeftUpLeg', 'RightUpLeg']) {
    const track = data.idle.tracks.find(track => track.name === `.bones[${name}].quaternion`);
    for (let index = 4; index < track.values.length; index += 4) {
      assert.deepEqual(track.values.slice(index, index + 4), track.values.slice(0, 4), name);
    }
  }
  const hips = data.idle.tracks.find(track => track.name === '.bones[Hips].position');
  for (let index = 3; index < hips.values.length; index += 3) assert.deepEqual(hips.values.slice(index, index + 3), hips.values.slice(0, 3));
});

test('gait phase follows actual displacement without resetting across short stop/start periods', () => {
  const person = actor();
  for (let index = 0; index < 20; index++) {
    person.locomotion.speed = index % 4 === 3 ? 0 : 2;
    person.position.z -= person.locomotion.speed * .025;
    advanceNraMotion(person, .025);
  }
  const first = sampleNraMotion(person);
  assert.ok(first.runTime > 0 && first.weight > .5);
  const expectedDistance = person.nativeMotion.distance;
  for (let index = 0; index < 5; index++) { person.locomotion.speed = 0; advanceNraMotion(person, .025); }
  assert.equal(person.nativeMotion.distance, expectedDistance);
  assert.equal(sampleNraMotion(person).runTime, first.runTime, 'Stopping holds the accumulated gait phase rather than restarting the clip');
  person.position.z -= .1; person.locomotion.speed = 2; advanceNraMotion(person, .05);
  assert.notEqual(sampleNraMotion(person).runTime, 0);
});

test('idle settles without repeated animation resets and paused sampling never advances state', () => {
  const person = actor();
  for (let index = 0; index < 150; index++) advanceNraMotion(person, .02);
  assert.equal(sampleNraMotion(person).weight, 0);
  const before = JSON.stringify(person.nativeMotion);
  for (let index = 0; index < 30; index++) sampleNraMotion(person);
  advanceNraMotion(person, 0);
  assert.equal(JSON.stringify(person.nativeMotion), before);
});

test('body-relative carry moves the gun and defines the same authoritative muzzle under actor rotation', () => {
  const person = actor(); person.nativeMotion.weight = 1; person.nativeMotion.speed = 3.15;
  const heights = [];
  for (let index = 0; index < 20; index++) {
    person.position.z = -5 - index * data.motion.strideMeters / 20;
    const pose = sampleNraMotion(person), local = nativeMuzzleLocal(person), world = soldierRifleMuzzle(person);
    const expected = new Vector3(...data.motion.muzzle).applyQuaternion(new Quaternion(...pose.weaponQuaternion))
      .add(new Vector3(...pose.weaponPosition)).applyAxisAngle(new Vector3(0, 1, 0), person.heading)
      .add(new Vector3(person.position.x, person.position.y, person.position.z));
    assert.ok(expected.distanceTo(new Vector3(world.x, world.y, world.z)) < 1e-8);
    assert.ok(Number.isFinite(local.y));
    heights.push(pose.weaponPosition[1]);
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > .01, 'Gun must move with the running torso, not remain frozen');
});

test('loop endpoints match and invalid motion data fails explicitly', () => {
  for (const track of [data.motion.idle, data.motion.walk, data.motion.run]) {
    assert.deepEqual(track.positions.slice(-3), track.positions.slice(0, 3));
    assert.deepEqual(track.quaternions.slice(-4), track.quaternions.slice(0, 4));
  }
  const person = actor();
  assert.throws(() => advanceNraMotion(person, -1), /owned finite/);
  assert.throws(() => createNraMotion({ ...data.motion, strideMeters: 0 }, person), /profile/);
  assert.throws(() => createNraMotion(data.motion, { ...person, position: { x: NaN, y: 0, z: 0 } }), /profile/);
});

test('real walking and running clips blend by measured speed and soldiers do not share identical phases', () => {
  assert.match(data.walk.name, /KayKit_Walking_C/);
  assert.ok(data.walk.tracks.some(track => track.name === '.bones[LeftLeg].quaternion' && track.times.length > 10));
  const person = actor(); person.nativeMotion.weight = 1; person.nativeMotion.speed = 1.75;
  const walking = sampleNraMotion(person); assert.equal(walking.jog, 0);
  person.nativeMotion.speed = 3.15;
  const running = sampleNraMotion(person); assert.equal(running.jog, 1);
  const other = { ...person, walkPhase: 2.8 };
  other.nativeMotion = createNraMotion(data.motion, other);
  assert.notEqual(other.nativeMotion.strideScale, person.nativeMotion.strideScale);
  assert.notEqual(sampleNraMotion(other).walkTime, walking.walkTime);
});

test('current native carry lowers the real muzzle during travel and raises smoothly only for firing intent', () => {
  const person = actor();
  person.rifleReady = false; person.locomotion = { speed: 3.15, mode: 'jog' };
  person.nativeMotion = createNraMotion(createNativeGaitProfile(data.motion.idle), person);
  for (let i = 0; i < 50; i++) advanceNraMotion(person, .02);
  const carried = sampleNraMotion(person);
  const direction = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...carried.weaponQuaternion));
  assert.ok(direction.y < -.5, 'running barrel is visibly down, not just translated lower');
  assert.ok(nativeMuzzleLocal(person).y < carried.weaponPosition[1] - .4);
  const before = JSON.stringify(person.nativeMotion);
  advanceNraMotion(person, 0); sampleNraMotion(person);
  assert.equal(JSON.stringify(person.nativeMotion), before);
  person.locomotion.speed = 0; person.rifleReady = true;
  advanceNraMotion(person, .02);
  assert.ok(person.nativeMotion.lowReady > .5, 'weapon cannot snap instantly to a firing pose');
  for (let i = 0; i < 40; i++) advanceNraMotion(person, .02);
  assert.ok(person.nativeMotion.lowReady < .001);
  const raised = sampleNraMotion(person);
  assert.ok(Math.abs(new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...raised.weaponQuaternion)).y) < .05);
});
