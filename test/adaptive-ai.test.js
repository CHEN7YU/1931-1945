import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveAI, idleAIForReduction } from '../src/adaptive-ai.js';
import { createAIDecisionScheduler } from '../src/ai-decisions.js';

test('emergency visible-idle deferral never weakens nearby, engaged or player-targeting actors and is counted separately', () => {
  const control = createAdaptiveAI(), far = { x: 100, y: 0, z: 0 }, observer = { x: 0, y: 0, z: 0 };
  assert.equal(control.intervalFor('sensor', far, observer, true, false), 0);
  assert.equal(control.intervalFor('sensor', far, observer, true, false, { idle: true, emergencyLevel: 3 }), 1.4);
  assert.equal(control.intervalFor('sensor', far, observer, true, false, { idle: false, emergencyLevel: 3 }), 0);
  assert.equal(control.intervalFor('sensor', far, observer, true, true, { idle: true, emergencyLevel: 3 }), 0);
  assert.equal(control.intervalFor('sensor', { x: 20, y: 0, z: 0 }, observer, true, false, { idle: true, emergencyLevel: 3 }), 0);
  frames(control, 60, 5);
  assert.equal(control.snapshot.reductions, 2);
  control.reset();
  assert.equal(control.snapshot.level, 0);
  assert.equal(control.snapshot.reductions, 2);
});

test('recent fire, incoming hits, suppression, active grenades and target memory exclude an actor from idle reduction', () => {
  const actor = { health: 100, vehicleId: null, target: null, tactics: { suppressedUntil: 0 },
    grenades: { action: null } };
  assert.equal(idleAIForReduction(actor, 10), true);
  for (const change of [
    { lastHit: { time: 9 } }, { target: {} }, { grenades: { action: 'throw' } },
    { tactics: { suppressedUntil: 12 } }, { tactics: { lastSeen: {} } }, { tactics: { lastShot: { time: 9 } } },
  ]) assert.equal(idleAIForReduction({ ...actor, ...change }, 10), false);
});

function frames(control, ms, seconds, active = true) {
  for (let elapsed = 0; elapsed < seconds; elapsed += ms / 1000) control.observeFrame(ms, active);
}
function pressured() {
  const control = createAdaptiveAI();
  frames(control, 60, 5);
  assert.equal(control.snapshot.level, 2);
  return control;
}

test('sustained overload reduces work, isolated stalls do not, and smooth recovery takes two stable stages', () => {
  const control = createAdaptiveAI();
  frames(control, 1000 / 60, 3);
  control.observeFrame(150, true);
  frames(control, 1000 / 60, 3);
  assert.equal(control.snapshot.level, 0);
  frames(control, 60, 5);
  assert.equal(control.snapshot.level, 2);
  frames(control, 1000 / 60, 3);
  assert.equal(control.snapshot.level, 2);
  frames(control, 1000 / 60, 2);
  assert.equal(control.snapshot.level, 1);
  frames(control, 1000 / 60, 5);
  assert.equal(control.snapshot.level, 0);
});

test('alternating slow and fast frames still shed distant AI when sustained average throughput is poor', () => {
  const control = createAdaptiveAI();
  for (let frame = 0; frame < 300; frame++) control.observeFrame(frame % 2 ? 50 : 16, true);
  assert.equal(control.snapshot.level, 2, 'one short frame must not reset every pressure window');
});

test('visible, nearby, and player-targeting soldiers immediately retain normal decision frequency', () => {
  const control = pressured(), observer = { x: 0, y: 0, z: 0 };
  for (const kind of ['sensor', 'path', 'cover', 'posture']) {
    assert.ok(control.intervalFor(kind, { x: 100, y: 0, z: 0 }, observer, false) > 0);
    assert.equal(control.intervalFor(kind, { x: 100, y: 0, z: 0 }, observer, true), 0);
    assert.equal(control.intervalFor(kind, { x: 40, y: 0, z: 0 }, observer, false), 0);
    assert.equal(control.intervalFor(kind, { x: 100, y: 0, z: 0 }, observer, false, true), 0);
  }
});

test('pause, background gaps, and loading do not create overload or count toward recovery', () => {
  const control = pressured();
  frames(control, 1000 / 60, 1, false);
  control.observeFrame(30000, true);
  assert.equal(control.snapshot.level, 2);
  frames(control, 1000 / 60, 1);
  assert.equal(control.snapshot.level, 2);
  control.reset(); assert.equal(control.snapshot.level, 0);
  assert.throws(() => control.observeFrame(NaN, true), RangeError);
  assert.throws(() => control.observeFrame(-1, true), RangeError);
});

test('offscreen decisions are deferred rather than frozen, and a camera turn bypasses the cooldown without a burst', () => {
  const scheduler = createAIDecisionScheduler(), actor = { id: 'far-soldier' };
  let visible = false;
  const interval = () => visible ? 0 : 2.8;
  const step = time => { scheduler.beginFrame(); scheduler.beginStep(time, () => 0, () => true, interval); };
  step(0); assert.equal(scheduler.take('sensor', actor), true);
  step(1); assert.equal(scheduler.take('sensor', actor), false);
  assert.equal(scheduler.snapshot.pending.sensor, 1);
  visible = true; step(1.1);
  assert.equal(scheduler.take('sensor', actor), true);
  assert.equal(scheduler.take('sensor', actor), false, 'normal frame caps still apply');
  visible = false; step(2);
  assert.equal(scheduler.take('sensor', actor), false);
  step(3.9); assert.equal(scheduler.take('sensor', actor), true);
  scheduler.forget(actor); step(4);
  assert.equal(scheduler.take('sensor', actor), true, 'replacement identities do not inherit stale cooldowns');
  scheduler.reset(); step(0);
  assert.equal(scheduler.take('sensor', actor), true);
});

test('all offscreen actors keep receiving decisions under pressure and continuous visible competition', () => {
  const scheduler = createAIDecisionScheduler();
  const actors = Array.from({ length: 140 }, (_, id) => ({ id, visible: id < 40 }));
  const serviced = new Set();
  for (let frame = 0; frame < 300; frame++) {
    scheduler.beginFrame();
    scheduler.beginStep(frame * .05, actor => Number(actor.visible), () => true, actor => actor.visible ? 0 : 2.8);
    for (const actor of actors) if (scheduler.take('sensor', actor)) serviced.add(actor.id);
  }
  assert.equal(serviced.size, actors.length);
  assert.ok(scheduler.snapshot.deferredAttempts.sensor > 0);
});
