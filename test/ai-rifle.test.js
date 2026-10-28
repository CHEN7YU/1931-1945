import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_RIFLE, createAIRifleControl, attemptAIRifleShot, resetAIRifleAim, rifleAIAimSeconds } from '../src/ai-rifle.js';
import { createRifleState, advanceRifle, RIFLE } from '../src/rifle-action.js';

function fixture(team = 'enemy') {
  const actor = { team, health: 100, vehicleId: null, nextFire: 0, rifle: createRifleState(),
    aiRifle: createAIRifleControl(), locomotion: { speed: 0, sprinting: false, aimRecovery: 0 } };
  const fire = (now, extra = {}) => attemptAIRifleShot(actor, { now, targetId: 'target', mayFire: true,
    postureSettled: true, suppressed: false, confirmShot: () => 20, ...extra });
  return { actor, fire };
}

test('both factions require confirmed stationary aim and spend the actual personal magazine', () => {
  for (const team of ['friendly', 'enemy']) {
    const { actor, fire } = fixture(team);
    for (let frame = 0; frame <= 6; frame++) assert.equal(fire(frame / 10), false);
    assert.equal(actor.rifle.ammo, 5);
    assert.equal(fire(.7), true);
    assert.equal(actor.rifle.ammo, 4);
    assert.equal(actor.rifle.action, 'cycle');
    assert.ok(actor.aiRifle.lastShot.aimedSeconds >= rifleAIAimSeconds(20, false));
    assert.equal(fire(.8), false);
    assert.equal(actor.rifle.shots, 1);
  }
});

test('motion, sprint recovery, posture and changed target invalidate prior aiming', () => {
  for (const block of ['moving', 'sprint', 'recovering', 'posture', 'mayFire', 'target']) {
    const { actor, fire } = fixture();
    for (let frame = 0; frame < 6; frame++) fire(frame / 10);
    const options = {};
    if (block === 'moving') actor.locomotion.speed = 1;
    if (block === 'sprint') actor.locomotion.sprinting = true;
    if (block === 'recovering') actor.locomotion.aimRecovery = .1;
    if (block === 'posture') options.postureSettled = false;
    if (block === 'mayFire') options.mayFire = false;
    if (block === 'target') options.targetId = 'different-target';
    assert.equal(fire(.6, options), false);
    Object.assign(actor.locomotion, { speed: 0, sprinting: false, aimRecovery: 0 });
    assert.equal(fire(.7), false);
    assert.equal(actor.rifle.ammo, 5);
    assert.equal(actor.aiRifle.lastShot, null);
  }
});

test('occlusion, lost validation and out-of-sight range cannot bank a shot', () => {
  for (const confirmShot of [() => null, () => 75.01]) {
    const { actor, fire } = fixture();
    for (let frame = 0; frame < 6; frame++) fire(frame / 10);
    assert.equal(fire(.6, { confirmShot }), false);
    assert.equal(fire(.7), false);
    assert.equal(actor.rifle.ammo, 5);
  }
  const { actor, fire } = fixture();
  fire(0); fire(.1);
  assert.equal(fire(1), false, 'a stale sight sample restarts, not completes, aiming');
  assert.equal(actor.aiRifle.aimingSince, 1);
});

test('simulation pause does not charge aim and sight checks are bounded', () => {
  const { actor, fire } = fixture();
  let queries = 0;
  const confirmShot = () => { queries++; return 75; };
  fire(0, { confirmShot });
  for (let frame = 0; frame < 500; frame++) fire(0, { confirmShot });
  assert.equal(queries, 1);
  for (let frame = 1; frame <= 60; frame++) fire(frame / 60, { confirmShot });
  assert.ok(queries <= 11);
  assert.equal(actor.rifle.shots, 0);
  assert.equal(actor.rifle.ammo, 5);
});

test('five real shots queue loading, with no sixth shot or early refill', () => {
  const { actor, fire } = fixture();
  let now = 0;
  for (let shot = 1; shot <= 5; shot++) {
    let fired = false;
    for (let sample = 0; sample < 30 && !fired; sample++) {
      now += .1;
      fired = fire(now);
    }
    assert.equal(fired, true);
    assert.equal(actor.rifle.ammo, 5 - shot);
    if (shot < 5) { advanceRifle(actor.rifle, RIFLE.cycleSeconds); now += RIFLE.cycleSeconds; }
  }
  assert.equal(actor.rifle.queuedReload, true);
  advanceRifle(actor.rifle, RIFLE.cycleSeconds);
  assert.equal(actor.rifle.action, 'reload');
  assert.equal(fire(now + 1), false);
  advanceRifle(actor.rifle, RIFLE.reloadSeconds - .01);
  assert.equal(actor.rifle.ammo, 0);
  advanceRifle(actor.rifle, .02);
  assert.equal(actor.rifle.ammo, 5);
  assert.equal(actor.rifle.shots, 5);
});

test('control handoff resets aim, not ammunition or the owned action', () => {
  const { actor, fire } = fixture();
  fire(0); fire(.1);
  const before = structuredClone(actor.rifle);
  resetAIRifleAim(actor.aiRifle, 'controlled');
  assert.equal(fire(.7), false);
  assert.deepEqual(actor.rifle, before);
});

test('invalid aim facts and query results fail explicitly', () => {
  const { actor, fire } = fixture();
  for (const extra of [{ mayFire: 'yes' }, { postureSettled: 1 }, { targetId: '' }, { suppressed: undefined },
    { confirmShot: () => undefined }, { confirmShot: () => -1 }]) assert.throws(() => fire(0, extra), RangeError);
  assert.throws(() => rifleAIAimSeconds(NaN, false), RangeError);
  assert.throws(() => rifleAIAimSeconds(10, 1), RangeError);
  actor.rifle.ammo = 6;
  assert.throws(() => fire(0), RangeError);
  actor.rifle.ammo = 5; actor.rifle.action = 'invalid';
  assert.throws(() => fire(0), RangeError);
});

test('far contacts get a normally aimed first shot then a long stable follow-up, including machine guns and changed targets', () => {
  for (const team of ['friendly', 'enemy']) for (const automatic of [false, true]) {
    const { actor, fire } = fixture(team);
    if (automatic) actor.rifle = createRifleState('zb26');
    let first = null, second = null;
    for (let frame = 0; frame < 360; frame++) {
      const now = frame * .05;
      advanceRifle(actor.rifle, .05);
      if (fire(now, { targetId: first !== null ? 'new-far-target' : 'target', confirmShot: () => 55 })) {
        if (first === null) first = now;
        else { second = now; break; }
      }
    }
    assert.ok(first > .7 && first < 1.5, `${team} first far shot must actually occur after basic aiming`);
    assert.ok(second - first >= rifleAIAimSeconds(55, false, true));
    assert.ok(second - first < 11);
    assert.equal(actor.aiRifle.lastShot.continuingBurst, false);
    assert.ok(actor.aiRifle.lastShot.requiredSeconds >= 6);
  }
});

test('close bolt follow-ups and machine-gun bursts do not inherit the far-contact long aim penalty', () => {
  assert.equal(AI_RIFLE.closeRange, 35);
  const { actor, fire } = fixture();
  actor.aiRifle.lastDistantShotAt = 1;
  const fired = [];
  for (let frame = 0; frame < 100; frame++) {
    const now = 2 + frame * .05; advanceRifle(actor.rifle, .05);
    if (fire(now)) fired.push(now);
    if (fired.length === 3) break;
  }
  assert.equal(fired.length, 3);
  assert.ok(fired[1] - fired[0] < 1.1 && fired[1] - fired[0] >= RIFLE.cycleSeconds);
  assert.ok(actor.aiRifle.lastShot.requiredSeconds <= .35);
});
