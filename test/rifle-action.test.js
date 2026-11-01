import test from 'node:test';
import assert from 'node:assert/strict';
import { RIFLE, createRifleState, shootRifle, reloadRifle, advanceRifle, riflePose, rifleReloadSeconds } from '../src/rifle-action.js';

test('a shot spends exactly one round and cannot fire again before the bolt locks', () => {
  const rifle = createRifleState();
  assert.equal(shootRifle(rifle), true);
  assert.equal(rifle.ammo, 4);
  assert.equal(shootRifle(rifle), false);
  advanceRifle(rifle, .64);
  assert.equal(shootRifle(rifle), false);
  advanceRifle(rifle, .011);
  assert.equal(shootRifle(rifle), true);
  assert.equal(rifle.ammo, 3);
});

test('bolt lift, extraction and lock are tied to the action clock', () => {
  const rifle = createRifleState();
  shootRifle(rifle);
  assert.equal(riflePose(rifle).boltTravel, 0);
  assert.deepEqual(advanceRifle(rifle, .35), ['unlock', 'extract']);
  assert.ok(riflePose(rifle).boltTravel > .08);
  assert.ok(riflePose(rifle).boltLift > .9);
  assert.deepEqual(advanceRifle(rifle, .3), ['close']);
  assert.equal(riflePose(rifle).boltTravel, 0);
  assert.equal(riflePose(rifle).boltLift, 0);
});

test('reload completes only after the loading action, not a wall-clock deadline', () => {
  const rifle = createRifleState();
  shootRifle(rifle); advanceRifle(rifle, 1);
  assert.equal(reloadRifle(rifle), true);
  const duration = rifleReloadSeconds(rifle);
  advanceRifle(rifle, 1);
  assert.equal(riflePose(rifle).clipVisible, true);
  assert.equal(rifle.ammo, 4);
  const paused = structuredClone(rifle);
  assert.deepEqual(rifle, paused);
  assert.equal(shootRifle(rifle), false);
  advanceRifle(rifle, duration - 1 - .001);
  assert.equal(rifle.ammo, 4);
  assert.equal(riflePose(rifle).clipVisible, false);
  assert.deepEqual(advanceRifle(rifle, .002), ['ready']);
  assert.equal(rifle.ammo, 5);
  assert.equal(rifle.action, 'idle');
});

test('reload queued during cycling finishes the cycle before loading', () => {
  const rifle = createRifleState();
  shootRifle(rifle); advanceRifle(rifle, .2);
  assert.equal(reloadRifle(rifle), true);
  assert.equal(rifle.action, 'cycle');
  advanceRifle(rifle, .6);
  assert.equal(rifle.action, 'reload');
  assert.ok(Math.abs(rifle.elapsed - .15) < 1e-8);
  advanceRifle(rifle, rifleReloadSeconds(rifle) - rifle.elapsed + .001);
  assert.equal(rifle.ammo, 5);
  assert.equal(rifle.action, 'idle');
});

test('the last rifle shot automatically queues the same reload as R after completing the bolt cycle', () => {
  const rifle = createRifleState();
  for (let i = 0; i < 4; i++) { assert.equal(shootRifle(rifle), true); advanceRifle(rifle, 1); }
  assert.equal(shootRifle(rifle), true);
  assert.equal(rifle.ammo, 0);
  assert.equal(rifle.action, 'cycle');
  assert.equal(rifle.queuedReload, true);
  const paused = structuredClone(rifle);
  assert.deepEqual(advanceRifle(rifle, 0), []);
  assert.deepEqual(rifle, paused);
  advanceRifle(rifle, RIFLE.cycleSeconds);
  assert.equal(shootRifle(rifle), false);
  assert.equal(rifle.action, 'reload');
  assert.equal(rifle.shots, 5);
  assert.equal(rifle.ammo, 0);
  assert.equal(reloadRifle(rifle), false, 'manual R cannot restart an automatic reload');
  const duration = rifleReloadSeconds(rifle);
  advanceRifle(rifle, duration - .001);
  assert.equal(rifle.ammo, 0);
  advanceRifle(rifle, .002);
  assert.equal(rifle.ammo, 5);
  assert.equal(rifle.shots, 5);
  assert.equal(rifle.action, 'idle');
});

test('a full magazine cannot start loading and timestep validation is explicit', () => {
  const rifle = createRifleState();
  assert.equal(reloadRifle(rifle), false);
  assert.throws(() => advanceRifle(rifle, -1), RangeError);
  assert.throws(() => advanceRifle(rifle, NaN), RangeError);
  assert.throws(() => advanceRifle(rifle, Infinity), RangeError);
});

test('30/60/144 Hz advance the same mechanical events and final ammo', () => {
  const run = hz => {
    const rifle = createRifleState(), events = [];
    shootRifle(rifle); reloadRifle(rifle);
    for (let i = 0; i < hz * 4; i++) events.push(...advanceRifle(rifle, 1 / hz));
    return { rifle, events };
  };
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(144));
  assert.equal(RIFLE.length, 1.11);
});
