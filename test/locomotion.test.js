import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES } from '../src/core.js';
import { FOOT_SPEEDS, createLocomotion, advanceLocomotion, advanceStamina, stopLocomotion, recoverLocomotion, landLocomotion } from '../src/locomotion.js';

const input = changes => ({ type: 'infantry', forward: 1, sideways: 0, yaw: 0, stance: 'standing', grounded: true, ...changes });
test('player-controlled infantry and mortar sprint exactly 50 percent longer without increasing speed or AI endurance', () => {
  for (const type of ['infantry', 'mortar']) for (const fps of [30, 60, 144]) {
    const durations = [false, true].map(playerControlled => {
      const motion = createLocomotion(), position = { x: 0, z: 0 };
      motion.vz = -FOOT_SPEEDS[type].sprint;
      let elapsed = 0;
      while (!motion.exhausted && elapsed < 20) {
        advanceLocomotion(motion, position, input({ type, playerControlled, sprint: true }), [], 1 / fps);
        elapsed += 1 / fps;
        if (!motion.exhausted) assert.ok(Math.abs(motion.speed - FOOT_SPEEDS[type].sprint) < .001);
      }
      assert.equal(motion.stamina, 0);
      return elapsed;
    });
    assert.ok(Math.abs(durations[1] / durations[0] - 1.5) < .006, `${type}/${fps}: ${durations}`);
  }
});
test('AI and player sprint effort share depletion, delayed recovery and exhaustion without free zero-time changes', () => {
  for (const fps of [30, 60, 144]) {
    const motion = createLocomotion();
    for (let i = 0; i < fps * 2; i++) advanceStamina(motion, 1 / fps, true, 1);
    assert.ok(Math.abs(motion.stamina - .72) < 1e-9);
    const before = { ...motion };
    advanceStamina(motion, 0, true);
    assert.deepEqual(motion, before);
    advanceStamina(motion, 1, false);
    assert.ok(Math.abs(motion.stamina - .72) < 1e-9);
    for (let i = 0; i < fps * 6; i++) advanceStamina(motion, 1 / fps, true, 1);
    assert.equal(motion.stamina, 0);
    assert.equal(motion.exhausted, true);
    advanceStamina(motion, 1.4, false);
    advanceStamina(motion, 3.4, false);
    assert.equal(motion.exhausted, true);
    advanceStamina(motion, .2, false);
    assert.equal(motion.exhausted, false);
  }
  assert.throws(() => advanceStamina(createLocomotion(), -1, true), RangeError);
});
function run(seconds, changes = {}, fps = 60, obstacles = []) {
  const motion = createLocomotion(), position = { x: 0, z: 0 };
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) advanceLocomotion(motion, position, input(changes), obstacles, seconds / frames);
  return { motion, position };
}
function traverse(distance, changes, fps) {
  const motion = createLocomotion(), position = { x: 0, z: 0 };
  let elapsed = 0;
  while (motion.distance < distance && elapsed < 60) {
    advanceLocomotion(motion, position, input(changes), [], 1 / fps);
    elapsed += 1 / fps;
  }
  return { elapsed, motion, position };
}

test('foot profiles replace the old high-speed translation without changing vehicles', () => {
  assert.equal(TYPES.infantry.speed, FOOT_SPEEDS.infantry.jog);
  assert.equal(TYPES.mortar.speed, FOOT_SPEEDS.mortar.jog);
  assert.equal(TYPES.tank.speed, 8);
  assert.equal(TYPES.plane.speed, 24);
});

test('acceleration and braking are bounded, reverse movement does not instantly change velocity', () => {
  const motion = createLocomotion(), position = { x: 0, z: 0 };
  advanceLocomotion(motion, position, input(), [], .1);
  assert.ok(Math.abs(motion.vz) <= .801 && Math.abs(motion.vz) > .7);
  assert.ok(-position.z < .05, 'starting displacement integrates acceleration, not instant full speed');
  for (let i = 0; i < 60; i++) advanceLocomotion(motion, position, input(), [], 1 / 60);
  const fullSpeed = motion.vz;
  advanceLocomotion(motion, position, input({ forward: -1 }), [], 1 / 60);
  assert.ok(motion.vz < 0 && motion.vz > fullSpeed, 'direction reversal brakes before moving back');
  const stopZ = position.z;
  for (let i = 0; i < 60; i++) advanceLocomotion(motion, position, input({ forward: 0 }), [], 1 / 60);
  assert.equal(motion.vz, 0);
  assert.ok(stopZ - position.z < .4, 'braking is weighted but does not slide metres after release');
});

test('20m and 50m lanes have calibrated travel times at 30, 60 and 144fps', () => {
  for (const [changes, range20, range50] of [
    [{ walking: true }, [11.5, 11.7], [28.6, 28.8]],
    [{}, [7.5, 7.7], [18.6, 18.8]],
    [{ sprint: true }, [5.1, 5.3], [14, 16.5]],
  ]) {
    for (const [distance, bounds] of [[20, range20], [50, range50]]) {
      const runs = [30, 60, 144].map(fps => traverse(distance, changes, fps));
      for (const result of runs) assert.ok(result.elapsed >= bounds[0] && result.elapsed <= bounds[1], `${distance}m ${JSON.stringify(changes)}: ${result.elapsed}s`);
      assert.ok(Math.max(...runs.map(result => result.elapsed)) - Math.min(...runs.map(result => result.elapsed)) < .05, 'cross-frame-rate travel-time spread stays below 50ms');
    }
  }
});

test('diagonal motion never gains speed and stance/load profiles remain distinct', () => {
  const forward = run(3), diagonal = run(3, { sideways: 1 });
  assert.ok(Math.abs(forward.motion.distance - diagonal.motion.distance) < .001);
  for (const [changes, expected] of [
    [{ walking: true }, 1.75], [{ aiming: true, sprint: true }, 1.5],
    [{ stance: 'crouched', sprint: true }, 1.35], [{ stance: 'prone', sprint: true }, .55],
    [{ type: 'mortar' }, 2.45], [{ type: 'mortar', sprint: true }, 3.7],
  ]) {
    const { motion } = run(2, changes);
    assert.ok(Math.abs(motion.speed - expected) < .001, JSON.stringify(changes));
    if (changes.aiming || changes.stance) assert.equal(motion.sprinting, false);
  }
  assert.ok(run(3, { forward: -1, sprint: true }).motion.speed < forward.motion.speed);
});

test('steady cadence distinguishes walking, jogging and sprinting without rapid tiny footsteps', () => {
  for (const [changes, min, max] of [[{ walking: true }, 2, 2.5], [{}, 2.5, 3], [{ sprint: true }, 3, 3.7]]) {
    const { motion, position } = run(1, changes);
    const before = motion.steps;
    for (let i = 0; i < 180; i++) advanceLocomotion(motion, position, input(changes), [], 1 / 60);
    const cadence = (motion.steps - before) / 3;
    assert.ok(cadence >= min && cadence <= max, `${JSON.stringify(changes)}: ${cadence} contacts/s`);
  }
});
test('actual collision displacement drives gait, not held keys or desired velocity', () => {
  const wall = [{ minX: -10, maxX: 10, minZ: -2, maxZ: -1 }];
  const { motion, position } = run(3, { sprint: true }, 60, wall);
  const steps = motion.steps, phase = motion.phase, stamina = motion.stamina;
  for (let i = 0; i < 120; i++) advanceLocomotion(motion, position, input({ sprint: true }), wall, 1 / 60);
  assert.ok(position.z >= -.60001);
  assert.equal(motion.steps, steps);
  assert.equal(motion.phase, phase);
  assert.equal(motion.speed, 0);
  assert.ok(motion.stamina >= stamina, 'holding sprint against a wall does not consume stamina');
  assert.ok(Math.abs(motion.cameraY) < .00001 && Math.abs(motion.weaponX) < .00001);
});

test('wall sliding keeps valid motion and a narrow doorway remains traversable', () => {
  const wall = [{ minX: 1, maxX: 2, minZ: -10, maxZ: 10 }];
  const { position, motion } = run(3, { sideways: 1 }, 60, wall);
  assert.ok(position.x <= .60001 && position.z < -5);
  assert.ok(motion.steps > 0);
  const doorway = [{ minX: -10, maxX: -.7, minZ: -3, maxZ: -2 }, { minX: .7, maxX: 10, minZ: -3, maxZ: -2 }];
  assert.ok(run(2.5, {}, 60, doorway).position.z < -5);
});

test('stamina exhaustion prevents endless sprint, hysteresis and rest restore it', () => {
  const { motion, position } = run(8, { sprint: true });
  assert.equal(motion.exhausted, true);
  assert.equal(motion.sprinting, false);
  assert.ok(motion.stamina < .1);
  assert.ok(motion.distance < 39);
  const before = motion.stamina;
  advanceLocomotion(motion, position, input({ sprint: true }), [], 1 / 60);
  assert.equal(motion.sprinting, false);
  assert.ok(motion.stamina >= before);
  for (let i = 0; i < 240; i++) advanceLocomotion(motion, position, input({ forward: 0 }), [], 1 / 60);
  assert.equal(motion.exhausted, false);
  assert.ok(motion.stamina > .35);
  const mortar = run(6, { type: 'mortar', sprint: true });
  assert.equal(mortar.motion.exhausted, true, 'heavy mortar load consumes stamina faster');
});

test('sprint-to-aim and weapon-ready recovery cannot be bypassed by aiming or firing', () => {
  const { motion, position } = run(2, { sprint: true });
  advanceLocomotion(motion, position, input({ aiming: true, sprint: true }), [], 1 / 60);
  assert.equal(motion.sprinting, false);
  assert.ok(motion.aimRecovery > .4);
  for (let i = 0; i < 40; i++) advanceLocomotion(motion, position, input({ aiming: true, sprint: true }), [], 1 / 60);
  assert.equal(motion.aimRecovery, 0);
  assert.ok(Math.abs(motion.speed - FOOT_SPEEDS.infantry.aim) < .001);
  assert.equal(run(2, { sprint: true, busy: true }).motion.sprinting, false, 'construction, firing and reload prevent sprint');
});

test('airborne displacement has no ground footsteps and landing feedback settles', () => {
  const { motion, position } = run(2, { grounded: false });
  assert.ok(motion.distance > 4);
  assert.equal(motion.groundDistance, 0);
  assert.equal(motion.steps, 0);
  landLocomotion(motion, 5);
  advanceLocomotion(motion, position, input({ forward: 0 }), [], 1 / 60);
  assert.ok(motion.landing < 0);
  for (let i = 0; i < 150; i++) advanceLocomotion(motion, position, input({ forward: 0 }), [], 1 / 60);
  assert.ok(Math.abs(motion.landing) < .000001);
});

test('pause or squad switching clears momentum but never refills per-member stamina', () => {
  const { motion } = run(2, { sprint: true });
  const stamina = motion.stamina, recovery = motion.aimRecovery, distance = motion.distance;
  stopLocomotion(motion);
  assert.equal(motion.vx, 0); assert.equal(motion.vz, 0); assert.equal(motion.speed, 0);
  assert.ok(Math.abs(motion.cameraY) === 0);
  assert.equal(motion.stamina, stamina); assert.equal(motion.aimRecovery, recovery);
  assert.equal(motion.distance, distance);
  recoverLocomotion(motion, 2);
  assert.ok(motion.stamina > stamina);
});

test('stationary aiming stays steady and invalid timesteps fail explicitly', () => {
  const { motion } = run(2, { forward: 0, aiming: true });
  assert.equal(motion.steps, 0);
  assert.ok(Math.abs(motion.cameraY) === 0);
  assert.equal(motion.weaponX, 0);
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceLocomotion(motion, { x: 0, z: 0 }, input(), [], dt), RangeError);
  assert.throws(() => advanceLocomotion(motion, { x: 0, z: 0 }, input({ type: 'tank' }), [], .1), /No foot movement profile/);
});
