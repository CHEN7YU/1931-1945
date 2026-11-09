import test from 'node:test';
import assert from 'node:assert/strict';
import { createRifleRecoil } from '../src/rifle-recoil.js';

test('a rifle shot has a fast shoulder impulse and muzzle rise, then damps without a frame-dependent base-position lag', () => {
  const recoil = createRifleRecoil(); recoil.shot(1);
  const atShot = recoil.sample(1), cameraPeak = recoil.sample(1.018), gunPeak = recoil.sample(1.028);
  assert.ok(Object.values(atShot).every(value => value === 0), 'the emitted shot keeps its original physical muzzle');
  assert.ok(cameraPeak.pitch >= .049 && cameraPeak.pitch <= .051);
  assert.ok(gunPeak.weaponPitch >= .069 && gunPeak.rear >= .044);
  assert.ok(recoil.sample(1.1).rear < gunPeak.rear * .3);
  const expected = recoil.sample(1.2);
  assert.ok(Object.values(recoil.sample(1.3)).every(value => value === 0));
  for (const fps of [30, 60, 144]) {
    const sampled = createRifleRecoil(); sampled.shot(1);
    for (let frame = 0; frame / fps < .2; frame++) sampled.sample(1 + frame / fps);
    assert.deepEqual(sampled.sample(1.2), expected);
  }
});

test('aiming, prone, scope and real weapon support reduce but do not erase recoil; automatic bursts stay bounded', () => {
  const sample = options => { const recoil = createRifleRecoil(); recoil.shot(0, options); return recoil.sample(.018); };
  const hip = sample({}), aim = sample({ aiming: true }), prone = sample({ stance: 'prone', aiming: true });
  const mounted = sample({ aiming: true, support: .3 }), scope = sample({ model: 'sniper', aiming: true });
  assert.ok(hip.pitch > aim.pitch && aim.pitch > prone.pitch && prone.pitch > mounted.pitch && mounted.pitch > 0);
  assert.ok(scope.pitch > 0 && scope.pitch < aim.pitch);
  const burst = createRifleRecoil();
  for (let index = 0; index < 100; index++) burst.shot(index * .1, { model: 'sigm1920' });
  const kick = burst.sample(9.918);
  assert.ok(kick.pitch > 0 && kick.pitch <= .075 && kick.rear <= .06 && Math.abs(kick.yaw) <= .008);
  assert.deepEqual(burst.sample(9.918), kick, 'pause cannot advance, decay or re-emit an impulse');
  burst.clear();
  assert.ok(Object.values(burst.sample(10)).every(value => value === 0), 'changing soldier or redeploying clears the previous weapon impulse');
  assert.throws(() => burst.shot(NaN), /finite shot/);
  assert.throws(() => burst.shot(1, { support: -1 }), /finite shot/);
});
