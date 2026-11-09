import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_DECISION_STEP_LIMITS, AI_DECISION_FRAME_LIMITS, aiDecisionPriority,
  createAIDecisionScheduler } from '../src/ai-decisions.js';
import { createAIDecisionScheduler as createLegacyScheduler } from '../scripts/fixtures/ai-decisions-legacy.js';

const actors = Array.from({ length: 206 }, (_, id) => ({ id, health: 100, important: false }));
const eligible = actor => actor.health > 0;
const priority = actor => actor.important ? 1 : 0;
const step = (scheduler, time, importance = priority, active = eligible) => scheduler.beginStep(time, importance, active);

test('five catch-up steps share frame caps without raising the original single-step caps', () => {
  const scheduler = createAIDecisionScheduler(), legacy = createLegacyScheduler();
  for (const value of [scheduler, legacy]) {
    value.beginFrame();
    for (let index = 1; index <= 5; index++) {
      step(value, index * .05);
      for (const kind of Object.keys(AI_DECISION_STEP_LIMITS)) {
        let serviced = 0;
        for (const actor of actors) serviced += Number(value.take(kind, actor));
        assert.ok(serviced <= AI_DECISION_STEP_LIMITS[kind]);
      }
    }
  }
  assert.deepEqual(scheduler.snapshot.serviced, AI_DECISION_FRAME_LIMITS);
  assert.deepEqual(legacy.snapshot.serviced,
    Object.fromEntries(Object.entries(AI_DECISION_STEP_LIMITS).map(([kind, limit]) => [kind, limit * 5])));
});

test('a fresh frame does not accumulate a paused wall-clock decision burst', () => {
  const scheduler = createAIDecisionScheduler();
  scheduler.beginFrame(); step(scheduler, 0);
  for (const actor of actors) scheduler.take('sensor', actor);
  for (let index = 0; index < 600; index++) scheduler.beginFrame();
  step(scheduler, 0);
  assert.equal(actors.filter(actor => scheduler.take('sensor', actor)).length, AI_DECISION_STEP_LIMITS.sensor);
  assert.equal(scheduler.snapshot.oldestWaitSeconds.sensor, 0);
  assert.throws(() => step(scheduler, -1), RangeError);
});

test('camera turn reprioritizes the next catch-up step in the same frame, with stable FIFO ties', () => {
  const scheduler = createAIDecisionScheduler();
  scheduler.beginFrame(); step(scheduler, 0);
  for (const actor of actors) scheduler.take('sensor', actor);
  const newlyVisible = new Set(actors.slice(-12).map(actor => actor.id));
  step(scheduler, .05, actor => newlyVisible.has(actor.id) ? 1 : 0);
  const serviced = actors.filter(actor => scheduler.take('sensor', actor)).map(actor => actor.id);
  assert.deepEqual(serviced, [...newlyVisible]);
  assert.equal(scheduler.snapshot.serviced.sensor, AI_DECISION_FRAME_LIMITS.sensor);
  scheduler.beginFrame(); step(scheduler, .1);
  assert.deepEqual(actors.filter(actor => scheduler.take('sensor', actor)).map(actor => actor.id),
    actors.slice(12, 24).map(actor => actor.id));
});

test('continuous nearby load cannot indefinitely starve any of 206 offscreen actors', () => {
  for (const kind of Object.keys(AI_DECISION_STEP_LIMITS)) {
    const scheduler = createAIDecisionScheduler(), serviced = new Set();
    const urgent = Array.from({ length: 40 }, (_, id) => ({ id: `urgent-${id}`, health: 100, important: true }));
    const frameBound = Math.ceil((actors.length + urgent.length) / AI_DECISION_FRAME_LIMITS[kind]) + Math.ceil(.75 / .2) + 2;
    for (let frame = 0; frame < frameBound; frame++) {
      scheduler.beginFrame();
      for (let substep = 1; substep <= 5; substep++) {
        step(scheduler, frame * .2 + substep * .04);
        for (const actor of urgent) scheduler.take(kind, actor);
        for (const actor of actors) if (scheduler.take(kind, actor)) serviced.add(actor.id);
      }
    }
    assert.equal(serviced.size, actors.length, `${kind}: every offscreen actor must receive service under constant urgent load`);
  }
});

test('dead, removed and newly controlled actors release reservations rather than wasting slots', () => {
  const scheduler = createAIDecisionScheduler(), removed = actors[15], controlled = actors[16];
  scheduler.beginFrame(); step(scheduler, 0);
  for (const actor of actors) scheduler.take('sensor', actor);
  scheduler.forget(removed);
  scheduler.beginFrame();
  step(scheduler, .05, priority, actor => actor !== controlled && actor.id !== 12);
  const serviced = actors.filter(actor => actor !== removed && actor !== controlled && actor.id !== 12 &&
    scheduler.take('sensor', actor));
  assert.deepEqual(serviced.map(actor => actor.id), actors.slice(13, 27)
    .filter(actor => actor !== removed && actor !== controlled).map(actor => actor.id));
  assert.equal(serviced.length, 12);
});

test('cancelled requests expire, new matches clear all state, and snapshots cannot mutate counters', () => {
  const scheduler = createAIDecisionScheduler();
  scheduler.beginFrame(); step(scheduler, 0);
  for (const actor of actors) scheduler.take('path', actor);
  scheduler.beginFrame(); step(scheduler, .05);
  scheduler.beginFrame(); step(scheduler, .1);
  assert.equal(scheduler.snapshot.pending.path, 0);
  scheduler.snapshot.serviced.path = 999;
  assert.equal(scheduler.snapshot.serviced.path, 0);
  scheduler.reset();
  assert.ok(Object.values(scheduler.snapshot.totalServiced).every(value => value === 0));
  scheduler.beginFrame(); step(scheduler, 0);
  assert.equal(scheduler.take('path', actors[0]), true);
  assert.equal(scheduler.take('path', actors[0]), false, 'do not repeat one actor decision in a catch-up frame');
  assert.throws(() => scheduler.take('unknown', actors[0]), RangeError);
});

test('relevance is only a bounded work priority, not an offscreen combat switch', () => {
  const observer = { x: 0, y: 1.6, z: 0 };
  assert.equal(aiDecisionPriority({ x: 0, y: 0, z: 10 }, observer, true), 1);
  assert.equal(aiDecisionPriority({ x: 0, y: 0, z: 10 }, observer, false), .5);
  assert.equal(aiDecisionPriority({ x: 0, y: 0, z: 70 }, observer, true), .5);
  assert.equal(aiDecisionPriority({ x: 0, y: 0, z: 120 }, observer, true), 0);
});

test('real path work shares a frame-time budget across catch-up steps without freezing movement or starving queues', () => {
  const scheduler = createAIDecisionScheduler({ pathBudgetMs: 3 });
  scheduler.beginFrame(); step(scheduler, 0);
  assert.equal(scheduler.take('path', actors[0]), true);
  scheduler.recordPathWork(4);
  assert.equal(scheduler.take('path', actors[1]), false);
  step(scheduler, .05);
  assert.equal(scheduler.take('path', actors[2]), false, 'catch-up steps must not reset the frame budget');
  assert.equal(scheduler.take('sensor', actors[3]), true, 'a path budget is not a switch disabling other AI');
  assert.equal(scheduler.snapshot.pathWorkMs, 4);
  assert.equal(scheduler.snapshot.pathBudgetDeferrals, 2);
  scheduler.beginFrame(); step(scheduler, .1);
  assert.equal(scheduler.take('path', actors[1]), true, 'the deferred request is retained');
  scheduler.recordPathWork(100);
  scheduler.beginFrame(); step(scheduler, .2);
  assert.equal(scheduler.take('path', actors[2]), true, 'even an expensive previous frame cannot prevent future progress');
  assert.throws(() => scheduler.recordPathWork(NaN), RangeError);
  assert.throws(() => createAIDecisionScheduler({ pathBudgetMs: 0 }), RangeError);
});
