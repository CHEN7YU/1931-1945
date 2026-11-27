import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { createNraMotion, advanceNraMotion, sampleNraMotion, sampleNraPhase, nativeGaitParameters, nativeMuzzleLocal, nativeGaitDrop, nativeChestFireTarget, nativeAimReady } from '../src/nra-motion.js';
import { soldierRifleMuzzle } from '../src/entities.js';
import { createNativeGaitProfile } from '../src/nra-gait.js';
import { RIFLE_CONTACTS } from '../src/rifle-contacts.js';
import { FIRING_POSES } from '../src/combat-posture.js';
import { createRifleState, shootRifle } from '../src/rifle-action.js';
import { RIFLE_HAND_SAMPLES, rifleHandWeights } from '../src/rifle-hand-action.js';
import { rifleWorldModel, syncWorldWeapon } from '../src/rifle-model.js';

const data = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url), 'utf8'));

test('SMG first-person changes leave the native world and anatomical reload path unchanged', () => {
  const person = { health: 100, rifleReady: false, position: { x: 0, y: 0, z: 0 }, walkPhase: 0,
    stance: 'standing', locomotion: { speed: 0, mode: 'idle' },
    rifle: { ...createRifleState('sigm1920'), action: 'reload', ammo: 0 } };
  person.nativeMotion = createNraMotion(createNativeGaitProfile(data.motion.idle), person);
  const gun = rifleWorldModel('near', person.rifle);
  const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * smooth(t));
  const zero = [0, 0, 0], away = [-.14, -.08, .05], grip = [-.20, -.043, -.15], ready = [0, -.095, -.34];
  for (let frame = 0; frame <= 200; frame++) {
    const t = frame / 200;
    person.rifle.elapsed = 3.2 * t;
    const motion = sampleNraMotion(person), pose = motion.automaticReload;
    const feed = t < .15 ? zero : t < .35 ? mix(zero, away, (t - .15) / .2) : t < .45 ? away
      : t < .8 ? mix(away, zero, (t - .45) / .35) : zero;
    const palm = t < .15 ? mix(ready, grip, t / .15) : t < .8
      ? grip.map((value, index) => value + feed[index]) : mix(grip, ready, (t - .8) / .2);
    for (let index = 0; index < 3; index++) {
      assert.ok(Math.abs(pose.feed[index] - feed[index]) < 1e-12);
      assert.ok(Math.abs(pose.palm[index] - palm[index]) < 1e-12);
    }
    syncWorldWeapon(gun, person.rifle, pose);
    assert.deepEqual(gun.getObjectByName('feed').position.toArray(), pose.feed);
  }
});

test('automatic chest fire is distinct, simulation-blended, and never replaces player shoulder ADS or supported firing', () => {
  const person = { health: 100, rifleReady: true, position: { x: 0, y: 0, z: 0 }, walkPhase: 0,
    stance: 'standing', locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState('sigm1920') };
  const profile = { ...createNativeGaitProfile(data.motion.idle),
    rifleContacts: Object.fromEntries(['standing', ...Object.keys(FIRING_POSES)].map(name => [name, [.15, 1.5, 0]])) };
  person.nativeMotion = createNraMotion(profile, person);
  const chest = sampleNraMotion(person);
  assert.equal(chest.chestFire, 1); assert.equal(nativeAimReady(person), true);
  const frozen = JSON.stringify(person.nativeMotion);
  advanceNraMotion(person, 0); assert.equal(JSON.stringify(person.nativeMotion), frozen);
  person.shoulderAiming = true;
  assert.equal(nativeChestFireTarget(person), 0);
  advanceNraMotion(person, 1 / 60);
  assert.ok(person.nativeMotion.chestFire > .8 && person.nativeMotion.chestFire < 1);
  for (let frame = 0; frame < 90; frame++) advanceNraMotion(person, 1 / 60);
  const shoulder = sampleNraMotion(person);
  assert.equal(shoulder.chestFire, 0);
  assert.ok(shoulder.weaponPosition[1] - chest.weaponPosition[1] > .15);
  person.rifle = createRifleState('zb26'); person.shoulderAiming = false;
  person.nativeMotion = createNraMotion(profile, person);
  const lmg = sampleNraMotion(person);
  assert.ok(chest.weaponPosition[1] - lmg.weaponPosition[1] > .05);
  for (const patch of [{ stance: 'prone' }, { weaponMount: { active: true } },
    { supportWeaponPose: { active: true } }, { emplacementId: 'mg' },
    { rifle: createRifleState() }, { rifle: createRifleState('sniper') }]) {
    assert.equal(nativeChestFireTarget({ ...person, ...patch }), 0);
  }
});
test('travel carries vary by soldier, blend continuously and converge to the same raised firing pose', () => {
  const samples = [];
  for (let style = 0; style < 3; style++) {
    const person = { health: 100, rifleReady: false, position: { x: 0, y: 0, z: 0 }, walkPhase: 0,
      locomotion: { speed: 4.1, mode: 'sprint' }, rifle: createRifleState() };
    person.nativeMotion = createNraMotion(createNativeGaitProfile(data.motion.idle), person);
    Object.assign(person.nativeMotion, { travelCarryStyle: style, speed: 4.1, weight: 1 });
    for (let step = 0; step < 60; step++) { person.position.z -= 4.1 / 60; advanceNraMotion(person, 1 / 60); }
    const travel = sampleNraMotion(person);
    assert.ok(travel.travelCarryBlend > .95);
    assert.ok(travel.lowReady > .99);
    const saved = structuredClone(person.nativeMotion.travelCarryBlend);
    advanceNraMotion(person, 0);
    assert.equal(person.nativeMotion.travelCarryBlend, saved);
    person.rifleReady = true; person.locomotion.speed = 0; person.locomotion.mode = 'idle';
    const before = new Quaternion().fromArray(travel.weaponQuaternion);
    advanceNraMotion(person, 1 / 60);
    const beginning = sampleNraMotion(person);
    assert.ok(before.angleTo(new Quaternion().fromArray(beginning.weaponQuaternion)) < .2,
      String(before.angleTo(new Quaternion().fromArray(beginning.weaponQuaternion))));
    for (let step = 0; step < 120; step++) advanceNraMotion(person, 1 / 60);
    const raised = sampleNraMotion(person);
    assert.ok(raised.lowReady < .001); assert.ok(raised.travelCarryBlend < .001);
    samples.push({ travel, raised });
  }
  assert.equal(new Set(samples.map(sample => sample.travel.travelCarry)).size, 3);
  assert.notDeepEqual(samples[0].travel.weaponQuaternion, samples[1].travel.weaponQuaternion);
  for (const sample of samples.slice(1)) {
    assert.ok(new Quaternion().fromArray(sample.raised.weaponQuaternion)
      .angleTo(new Quaternion().fromArray(samples[0].raised.weaponQuaternion)) < .001);
  }
});

test('native walking and running coordinate shoulder and carried-weapon motion, but leave firing and support stable', () => {
  for (const speed of [1.75, 2.7, 4.1]) {
    const person = { health: 100, position: { x: 0, y: 0, z: 0 }, walkPhase: 0,
      locomotion: { speed, mode: speed > 3 ? 'sprint' : speed > 2 ? 'jog' : 'walk' } };
    const profile = { ...createNativeGaitProfile(data.motion.idle),
      rifleContacts: Object.fromEntries(['standing', ...Object.keys(FIRING_POSES)].map(name => [name, [.15, 1.5, 0]])) };
    person.nativeMotion = createNraMotion(profile, person);
    Object.assign(person.nativeMotion, { speed, weight: 1, gaitAim: 0, gaitCharge: speed > 3 ? 1 : 0,
      travelCarryBlend: 1 });
    const samples = [];
    for (let i = 0; i < 16; i++) {
      person.nativeMotion.gaitCycles = i / 16;
      samples.push(sampleNraMotion(person));
    }
    const yaws = samples.map(s => s.upperBody.yaw), rolls = samples.map(s => s.upperBody.roll);
    assert.ok(Math.max(...yaws) - Math.min(...yaws) >= .089);
    assert.ok(Math.max(...rolls) - Math.min(...rolls) >= .099);
    for (const name of ['lift', 'lateral']) {
      const values = samples.map(s => s.upperBody[name]);
      assert.ok(Math.max(...values) - Math.min(...values) > .022, 'walking includes visible upper-body translation');
    }
    const weaponX = samples.map(sample => sample.weaponPosition[0]);
    const weaponY = samples.map(sample => sample.weaponPosition[1]);
    const weaponZ = samples.map(sample => sample.weaponPosition[2]);
    assert.ok(Math.max(...weaponX) - Math.min(...weaponX) > .005, 'the rifle moves laterally with each stride');
    assert.ok(Math.max(...weaponY) - Math.min(...weaponY) > .003, 'the rifle follows the vertical running rhythm');
    assert.ok(Math.max(...weaponZ) - Math.min(...weaponZ) > .004, 'the rifle rocks forward and back with each stride');
    for (const sample of samples) {
      const stock = new Vector3(...RIFLE_CONTACTS.stock).applyQuaternion(new Quaternion(...sample.weaponQuaternion))
        .add(new Vector3(...sample.weaponPosition));
      assert.ok(stock.distanceTo(new Vector3(...sample.stockContact)) < 1e-8,
        'the stock remains anchored to the shoulder as the hands follow the carried rifle');
    }
    assert.notDeepEqual(samples[4].weaponQuaternion, samples[12].weaponQuaternion);
    const before = JSON.stringify(person.nativeMotion);
    assert.deepEqual(sampleNraMotion(person), sampleNraMotion(person), 'sampling/pause cannot advance the gait');
    assert.equal(JSON.stringify(person.nativeMotion), before);
    const aiming = sampleNraMotion({ ...person, rifleReady: true, nativeMotion: { ...person.nativeMotion, lowReady: 0 } });
    assert.ok(Math.abs(aiming.upperBody.yaw) < .03);
    for (let cycle = 0; cycle < 4; cycle++) {
      const aimingPose = (travelCarryBlend, lowReady) => sampleNraMotion({ ...person, rifleReady: true,
        nativeMotion: { ...person.nativeMotion, gaitCycles: cycle / 4, travelCarryBlend, lowReady } });
      assert.deepEqual(aimingPose(1, 0).weaponPosition, aimingPose(0, 0).weaponPosition,
        'travel carry sway stops once the rifle is raised to aim');
    }
    for (const patch of [{ emplacementId: 'gun' },
      { discharger: { presentationActive: true } }, { health: 0 }]) {
      const stable = sampleNraMotion({ ...person, ...patch });
      assert.deepEqual(stable.upperBody, { yaw: 0, pitch: 0, roll: 0, lift: 0, lateral: 0 });
    }
  }
});

test('sprint strides grow to a longer full-speed cycle without changing the speed-derived cadence', () => {
  const motion = { profile: { walkStrideMeters: 1.25 }, speed: 4.1, gaitAim: 0, strideScale: 1 };
  const strideAt = charge => nativeGaitParameters({ ...motion, gaitCharge: charge }).runStride;
  assert.equal(strideAt(0), 1.6);
  assert.ok(Math.abs(strideAt(.6) - 2.104) < 1e-10);
  assert.equal(strideAt(1), 2.3);
});

test('rifle action body blend matches its distant samples and excludes support equipment', () => {
  const person = { health: 100, position: { x: 0, y: 0, z: 0 }, walkPhase: 0,
    locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState() };
  person.nativeMotion = createNraMotion(createNativeGaitProfile(data.motion.idle), person);
  const sample = { hand: .7, loading: .6, boltLift: .4, boltTravel: .05, cartridgePush: .3, bodyRecoil: .35 };
  const direct = sampleNraMotion(person, false, sample).upperBody;
  const weights = rifleHandWeights(sample);
  for (const axis of Object.keys(direct)) {
    const blended = RIFLE_HAND_SAMPLES.reduce((sum, pose, index) =>
      sum + weights[index] * sampleNraMotion(person, false, pose).upperBody[axis], 0);
    assert.ok(Math.abs(direct[axis] - blended) < 1e-12, `${axis}: ${direct[axis]} vs ${blended}`);
  }
  assert.notEqual(direct.yaw, 0);
  for (const patch of [{ emplacementId: 'gun' }, { vehicleId: 'tank' },
    { engineer: { construction: { mode: 'building' } } }, { sihangShield: { active: true } },
    { supportWeaponPose: { active: true } }, { discharger: { presentationActive: true } }]) {
    assert.deepEqual(sampleNraMotion({ ...person, ...patch }, false, sample).upperBody,
      { yaw: 0, pitch: 0, roll: 0, lift: 0, lateral: 0 });
  }
});

test('shot-body recoil follows the owned shot without shifting its initial muzzle or changing ammunition', () => {
  const person = { health: 100, rifleReady: true, position: { x: 0, y: 0, z: 0 }, walkPhase: 0,
    locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState() };
  person.nativeMotion = createNraMotion(createNativeGaitProfile(data.motion.idle), person);
  const muzzle = nativeMuzzleLocal(person);
  assert.ok(shootRifle(person.rifle));
  assert.deepEqual(nativeMuzzleLocal(person), muzzle);
  assert.equal(sampleNraMotion(person).upperBody.pitch, 0);
  person.rifle.elapsed = .025;
  assert.ok(sampleNraMotion(person).upperBody.pitch > 0);
  person.rifle.elapsed = .13;
  assert.equal(sampleNraMotion(person).upperBody.pitch, 0);
  assert.ok(sampleNraMotion(person).rifleOperation.hand > 0);
  assert.equal(person.rifle.ammo, 4);
});

function actor() {
  const person = { team: 'friendly', heading: .7, position: { x: 2, y: .4, z: -5 }, walkPhase: 0, locomotion: { speed: 0 } };
  person.nativeMotion = createNraMotion(data.motion, person);
  return person;
}

test('distant phase sampling matches original arithmetic and full consumed fields across 5000 blended states', () => {
  let seed = 1938;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const fraction = phase => ((phase % 1) + 1) % 1;
  for (const profile of [data.motion, createNativeGaitProfile(data.motion.idle)]) {
    const person = actor(); person.nativeMotion = createNraMotion(profile, person);
    for (let index = 0; index < 2500; index++) {
      const motion = person.nativeMotion;
      person.position.x = random() * 100; person.position.z = random() * 100;
      motion.position = { x: random() * 100, z: random() * 100 };
      motion.distance = random() * 100; motion.idleTime = random() * 100;
      motion.speed = random() * 5; motion.strideScale = .9 + random() * .2;
      motion.gaitAim = random(); motion.gaitCharge = random(); motion.gaitCycles = random() * 100;
      motion.phaseDistance = random() * 100; motion.weight = random();
      const names = Object.keys(motion.posture);
      for (const name of names) motion.posture[name] = profile[name] ? random() / names.length : 0;
      const before = JSON.stringify(motion), phase = sampleNraPhase(person), full = sampleNraMotion(person, false);
      const distance = motion.distance + Math.hypot(person.position.x - motion.position.x, person.position.z - motion.position.z);
      const gait = profile.footCycleGait ? nativeGaitParameters(motion) : null;
      const cycle = gait ? motion.gaitCycles + (distance - motion.phaseDistance) /
        (gait.walkStride + (gait.runStride - gait.walkStride) * gait.jog) : null;
      const runTime = fraction(cycle ?? distance / (profile.strideMeters * motion.strideScale)) * profile.run.duration;
      const walkTime = profile.walk ? fraction(cycle ?? distance / (profile.walkStrideMeters * motion.strideScale)) * profile.walk.duration : runTime;
      const transition = Math.max(0, Math.min(1, (motion.speed - 2.1) / .9));
      const jog = gait ? gait.jog : profile.walk ? transition * transition * (3 - 2 * transition) : 1;
      assert.deepEqual(phase, { idleTime: motion.idleTime % profile.idle.duration, runTime, walkTime, jog, gait,
        travelStyle: gait?.style ?? (jog > .5 ? 'run' : 'walk'), ...motion.posture,
        upright: Math.max(0, 1 - Object.values(motion.posture).reduce((sum, weight) => sum + weight, 0)), weight: motion.weight, dadao: null });
      for (const key of ['idleTime', 'runTime', 'walkTime', 'jog', 'travelStyle', 'upright', 'weight', 'dadao', ...names])
        assert.deepEqual(phase[key], full[key], key);
      assert.equal(JSON.stringify(motion), before, 'sampling must not mutate authoritative motion');
      assert.equal(phase.weaponPosition, undefined);
      assert.equal(phase.headAim, undefined);
    }
  }
  assert.throws(() => sampleNraPhase({}), /state is missing/);
  assert.throws(() => sampleNraPhase({ ...actor(), position: { x: NaN, y: 0, z: 0 } }), /state is missing/);
});

test('turning steps follow real yaw, freeze on pause and never invent travel distance or running', () => {
  for (const fps of [30, 60, 144]) {
    const person = actor();
    person.health = 100; person.tactics = {}; person.stance = 'standing';
    const distance = person.nativeMotion.distance, position = { ...person.position };
    for (let frame = 0; frame < fps; frame++) {
      person.heading -= 1.5 / fps;
      advanceNraMotion(person, 1 / fps);
    }
    const pose = sampleNraMotion(person);
    assert.ok(pose.turn.weight > .99);
    assert.equal(pose.turn.direction, -1);
    assert.equal(pose.weight, 0);
    assert.equal(person.nativeMotion.distance, distance);
    assert.deepEqual(person.position, position);
    assert.ok(Math.abs(person.nativeMotion.turn.angle - 1.5) < 1e-8);
    const paused = JSON.stringify(person.nativeMotion);
    advanceNraMotion(person, 0); sampleNraMotion(person);
    assert.equal(JSON.stringify(person.nativeMotion), paused);
    for (let frame = 0; frame < fps; frame++) advanceNraMotion(person, 1 / fps);
    assert.equal(sampleNraMotion(person).turn.weight, 0);
  }
});

test('dead, prone and travelling soldiers do not start an upright stationary turning step', () => {
  for (const patch of [{ health: 0 }, { stance: 'prone' }, { locomotion: { speed: 2 } }]) {
    const person = actor();
    Object.assign(person, { health: 100, tactics: {}, stance: 'standing' }, patch);
    person.heading += .1;
    advanceNraMotion(person, .05);
    assert.equal(sampleNraMotion(person).turn.weight, 0);
  }
});

test('crouched stationary turning steps activate, but fixed gun and discharger operators stay planted', () => {
  for (const patch of [{ stance: 'crouched' }, { stance: 'crouched', emplacementId: 'field-gun' },
    { stance: 'crouched', discharger: { presentationActive: true } }]) {
    const person = actor();
    Object.assign(person, { health: 100, tactics: {} }, patch);
    person.heading += .12;
    advanceNraMotion(person, .05);
    assert.equal(person.nativeMotion.turn.weight > 0, !patch.emplacementId && !patch.discharger);
  }
});

test('reversing a turn releases its original foot cycle before changing direction, without fake movement', () => {
  for (const fps of [30, 60, 144]) {
    const person = actor();
    Object.assign(person, { health: 100, tactics: {}, stance: 'standing' });
    for (let frame = 0; frame < fps; frame++) {
      person.heading += 1.5 / fps;
      advanceNraMotion(person, 1 / fps);
    }
    const previous = { ...person.nativeMotion.turn }, distance = person.nativeMotion.distance;
    person.heading -= 1.5 / fps;
    advanceNraMotion(person, 1 / fps);
    assert.equal(person.nativeMotion.turn.direction, 1);
    assert.ok(person.nativeMotion.turn.weight < previous.weight);
    for (let frame = 0; frame < fps; frame++) {
      const before = { ...person.nativeMotion.turn };
      person.heading -= 1.5 / fps;
      advanceNraMotion(person, 1 / fps);
      if (before.direction !== person.nativeMotion.turn.direction) {
        assert.ok(before.weight <= .05, 'the old planted-foot cycle must be released before it is mirrored');
        assert.ok(person.nativeMotion.turn.angle <= 1.5 / fps + 1e-9);
      }
    }
    assert.equal(person.nativeMotion.turn.direction, -1);
    assert.ok(person.nativeMotion.turn.weight > .99);
    assert.equal(person.nativeMotion.distance, distance);
  }
});

test('stationary turning has bounded knee clearance without fake travel or altered bone lengths', () => {
  const person = actor();
  person.nativeMotion = createNraMotion(createNativeGaitProfile(data.motion.idle), person);
  Object.assign(person, { health: 100, tactics: {}, stance: 'standing' });
  for (let frame = 0; frame < 60; frame++) {
    person.heading += .025;
    advanceNraMotion(person, 1 / 60);
    const drop = nativeGaitDrop(person);
    assert.ok(drop >= 0 && drop <= .045);
    assert.equal(person.nativeMotion.speed, 0);
    assert.equal(person.nativeMotion.distance, 0);
    assert.equal(sampleNraMotion(person).hipDrop, drop);
  }
  assert.ok(nativeGaitDrop(person) > .044);
  for (let frame = 0; frame < 120; frame++) advanceNraMotion(person, 1 / 60);
  assert.equal(nativeGaitDrop(person), 0);
});

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
  for (let i = 0; i < 50; i++) {
    person.position.z -= person.locomotion.speed * .02;
    advanceNraMotion(person, .02);
  }
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

test('native rifle pose raises its muzzle for elevated targets while retaining a valid aiming quaternion', () => {
  const person = actor();
  person.rifleReady = true;
  person.nativeMotion.lowReady = 0;
  person.nativeMotion.aim = 1;
  const level = sampleNraMotion(person);
  person.aimPitch = .4;
  const raised = sampleNraMotion(person);
  const levelDirection = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...level.weaponQuaternion));
  const raisedDirection = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...raised.weaponQuaternion));
  assert.ok(raisedDirection.y > levelDirection.y + .3);
  assert.ok(Math.abs(Math.hypot(...raised.weaponQuaternion) - 1) < 1e-8);
  assert.equal(raised.aimPitch, .4);
  person.rifleReady = false;
  assert.equal(sampleNraMotion(person).aimPitch, 0, 'AI elevation aim cannot leak into a travel pose');
});

test('contact-based carry anchors the actual buttplate, not the receiver or camera, for shoulder and armpit modes', () => {
  for (const ready of [true, false]) {
    const person = actor(), shoulder = [.184, 1.41, .063];
    person.rifleReady = ready;
    const profile = { ...createNativeGaitProfile(data.motion.idle, shoulder),
      rifleContacts: Object.fromEntries(['standing', ...Object.keys(FIRING_POSES)].map(pose => [pose, shoulder])) };
    person.nativeMotion = createNraMotion(profile, person);
    const pose = sampleNraMotion(person), rotation = new Quaternion(...pose.weaponQuaternion);
    const stock = new Vector3(...RIFLE_CONTACTS.stock).applyQuaternion(rotation).add(new Vector3(...pose.weaponPosition));
    assert.ok(stock.distanceTo(new Vector3(...pose.stockContact)) < 1e-10);
    assert.ok(Math.abs(stock.y - (shoulder[1] + (ready ? .045 : -.08))) < 1e-10);
    assert.ok(Math.abs(stock.z - shoulder[2]) < .03, 'buttplate cannot sit far behind the actual shoulder');
    if (!ready) assert.ok(new Vector3(0, 0, -1).applyQuaternion(rotation).x < -.08, 'carrying muzzle lies across the front rather than crowding both hands to the right');
  }
});

test('one soldier switches between charge, quick short steps and aimed slow movement with continuous distance-driven phase', () => {
  const person = actor();
  person.nativeMotion = createNraMotion({ ...createNativeGaitProfile(data.motion.idle), leanPivot: [0, 1, 0] }, person);
  const samples = {};
  for (const [mode, speed, aimed] of [['sprint', 4.8, false], ['jog', 3.15, false], ['aim', 1.5, true]]) {
    person.locomotion = { mode, speed }; person.aimWalking = aimed; person.rifleReady = aimed;
    for (let frame = 0; frame < 120; frame++) {
      const previous = person.nativeMotion.gaitCycles;
      person.position.z -= speed / 60;
      advanceNraMotion(person, 1 / 60);
      assert.ok(person.nativeMotion.gaitCycles > previous && person.nativeMotion.gaitCycles - previous < .08);
    }
    samples[mode] = sampleNraMotion(person);
  }
  assert.equal(samples.sprint.travelStyle, 'charge'); assert.equal(samples.jog.travelStyle, 'short'); assert.equal(samples.aim.travelStyle, 'aim');
  assert.ok(samples.sprint.runStride >= 2.29 * samples.sprint.strideScale &&
    samples.sprint.runStride <= 2.3 * samples.sprint.strideScale);
  assert.ok(samples.sprint.runStride > samples.jog.runStride * 1.42);
  assert.ok(samples.sprint.heelHeight > samples.jog.heelHeight + .09);
  assert.ok(samples.jog.bodyLean >= .64 && samples.jog.bodyLean <= .66);
  assert.ok(samples.sprint.bodyLean > samples.jog.bodyLean + .04);
  assert.ok(samples.sprint.runContact < samples.jog.runContact - .1);
  assert.ok(samples.aim.walkClearance < samples.jog.walkClearance * .5);
  assert.ok(samples.aim.lowReady < .001 && samples.aim.bodyLean < samples.jog.bodyLean * .5);
  const distance = person.nativeMotion.distance, phase = person.nativeMotion.gaitCycles;
  person.locomotion = { mode: 'sprint', speed: 0 }; person.aimWalking = false;
  for (let frame = 0; frame < 60; frame++) advanceNraMotion(person, 1 / 60);
  assert.equal(person.nativeMotion.distance, distance); assert.equal(person.nativeMotion.gaitCycles, phase);
  const before = JSON.stringify(person.nativeMotion);
  advanceNraMotion(person, 0); sampleNraMotion(person);
  assert.equal(JSON.stringify(person.nativeMotion), before);
  person.nativeMotion.gaitCycles = -3.2;
  const wrapped = sampleNraMotion(person);
  assert.ok(wrapped.runPhase >= 0 && wrapped.runPhase < 1 && wrapped.walkPhase >= 0 && wrapped.walkPhase < 1);
});

test('both factions use the approved travel lean while automatic chest fire blends to its reachable carry', () => {
  for (const team of ['friendly', 'enemy']) for (const [speed, target] of [[2.7, .6108652382], [4.1, .7330382858]]) {
    const person = actor();
    Object.assign(person, { team, health: 100, stance: 'standing', rifleReady: false,
      rifle: createRifleState(team === 'friendly' ? 'zb26' : 'type11'), locomotion: { speed, mode: 'sprint' } });
    person.nativeMotion = createNraMotion({ ...createNativeGaitProfile(data.motion.idle), leanPivot: [0, 1, 0] }, person);
    for (let frame = 0; frame < 180; frame++) {
      person.position.z -= speed / 60; advanceNraMotion(person, 1 / 60);
    }
    assert.ok(Math.abs(person.nativeMotion.bodyLean - target) < .001);
    person.rifleReady = true;
    for (let frame = 0; frame < 180; frame++) {
      person.position.z -= speed / 60; advanceNraMotion(person, 1 / 60);
    }
    assert.equal(person.nativeMotion.chestFire, 1);
    assert.ok(person.nativeMotion.bodyLean < .28);
  }
});

test('fast actual movement cannot retain an upright walk even when its mode label lags behind', () => {
  const person = actor();
  person.nativeMotion = createNraMotion({ ...createNativeGaitProfile(data.motion.idle), leanPivot: [0, 1, 0] }, person);
  person.locomotion = { mode: 'walk', speed: 4.8 };
  for (let frame = 0; frame < 120; frame++) {
    person.position.z -= 4.8 / 60; advanceNraMotion(person, 1 / 60);
  }
  const fast = sampleNraMotion(person);
  assert.equal(fast.travelStyle, 'charge');
  assert.ok(fast.bodyLean >= .73 && fast.bodyLean <= .74);
  assert.ok(fast.hipDrop >= .03 && fast.hipDrop <= .09);
  person.locomotion = { mode: 'walk', speed: 0 };
  for (let frame = 0; frame < 120; frame++) advanceNraMotion(person, 1 / 60);
  assert.ok(sampleNraMotion(person).bodyLean < .001);
});

test('real metres set running cadence at every timestep, even when requested locomotion speed is stale', () => {
  for (const fps of [30, 60, 144]) for (const speed of [3.15, 4.8]) {
    const person = actor();
    person.nativeMotion = createNraMotion({ ...createNativeGaitProfile(data.motion.idle), leanPivot: [0, 1, 0] }, person);
    person.locomotion = { mode: 'walk', speed: 0 };
    for (let frame = 0; frame < fps * 2; frame++) {
      person.position.z -= speed / fps; advanceNraMotion(person, 1 / fps);
    }
    const initial = person.nativeMotion.gaitCycles, initialDistance = person.nativeMotion.distance;
    for (let frame = 0; frame < fps * 3; frame++) {
      person.position.z -= speed / fps; advanceNraMotion(person, 1 / fps);
    }
    const pose = sampleNraMotion(person), cycles = person.nativeMotion.gaitCycles - initial;
    assert.ok(Math.abs((person.nativeMotion.distance - initialDistance) / cycles - pose.runStride) < .002,
      'one complete left/right cycle covers exactly its visual stride');
    const stepsPerSecond = cycles * 2 / 3;
    assert.ok(Math.abs(stepsPerSecond - 2 * speed / pose.runStride) < .01,
      'larger strides reduce cadence while preserving the measured travel speed');
    assert.ok(stepsPerSecond > 3.6 && stepsPerSecond < 4.35);
    assert.ok(pose.bodyLean >= (speed === 3.15 ? .64 : .73) && pose.bodyLean <= .74);
    const stopped = person.nativeMotion.gaitCycles;
    person.locomotion.speed = 4.8;
    for (let frame = 0; frame < fps; frame++) advanceNraMotion(person, 1 / fps);
    assert.equal(person.nativeMotion.gaitCycles, stopped, 'a stale run command must not keep feet cycling against a wall');
    assert.equal(sampleNraMotion(person).weight, 0);
  }
});
