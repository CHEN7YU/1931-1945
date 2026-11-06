import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveStepBudget } from '../src/adaptive-step-budget.js';
import { createSimulationClock } from '../src/simulation-clock.js';

test('one expensive step yields before a second, without taking or discarding simulation debt', () => {
  const clock = createSimulationClock(), budget = createAdaptiveStepBudget();
  clock.setActive(true, 0);
  clock.beginFrame(1000);
  budget.beginFrame(1000, { frameMs: 1000, active: true, emergencyLevel: 3, backlogSeconds: 1 });
  let now = 1000;
  for (let dt; budget.canTakeStep(now) && (dt = clock.takeStep()) > 0;) {
    assert.equal(dt, .05);
    budget.recordStep(now, now += 130);
  }
  assert.equal(clock.snapshot.stepsThisFrame, 1);
  assert.equal(clock.snapshot.simulatedSeconds, .05);
  assert.equal(clock.snapshot.pendingSeconds, .95);
  assert.equal(clock.snapshot.activeSeconds, clock.snapshot.simulatedSeconds + clock.snapshot.pendingSeconds);
  assert.equal(budget.snapshot.workMs, 130, 'the budget cannot preempt an already running step');
  assert.equal(budget.snapshot.yieldedFrames, 1);
  assert.equal(budget.canTakeStep(now), false);
  assert.equal(budget.snapshot.yieldedFrames, 1, 'repeated checks are not additional yielded frames');
});

test('cheap steps keep the existing dt, recovery rate and five-step ceiling', () => {
  const clock = createSimulationClock(), budget = createAdaptiveStepBudget();
  clock.setActive(true, 0);
  let now = 250, simulated = 0;
  for (let frame = 0; frame < 20; frame++) {
    clock.beginFrame(now);
    budget.beginFrame(now, { frameMs: 250, active: true });
    for (let dt; budget.canTakeStep(now) && (dt = clock.takeStep()) > 0;) {
      assert.equal(dt, .05); simulated += dt;
      budget.recordStep(now, now += .1);
    }
    assert.equal(clock.snapshot.stepsThisFrame, 5);
    now += 250;
  }
  assert.ok(Math.abs(simulated - 5) < 1e-8);
  assert.ok(Math.abs(clock.snapshot.activeSeconds - clock.snapshot.simulatedSeconds - clock.snapshot.pendingSeconds) < 1e-8);
});

test('prediction prevents admitting another step that would exceed the work budget', () => {
  const budget = createAdaptiveStepBudget();
  budget.beginFrame(0, { frameMs: 16, active: true });
  assert.equal(budget.canTakeStep(0), true);
  budget.recordStep(0, 7);
  assert.equal(budget.canTakeStep(7), false);
  budget.beginFrame(20, { frameMs: 20, active: true });
  assert.equal(budget.canTakeStep(20), true);
  budget.recordStep(20, 21);
  assert.equal(budget.canTakeStep(21), true);
  assert.equal(budget.canTakeStep(32), false, 'elapsed callback work is also bounded');
});

test('emergency pressure tightens gradually and only sustained healthy active frames recover', () => {
  const budget = createAdaptiveStepBudget();
  let now = 0;
  const frame = (ms, emergencyLevel = 3, backlogSeconds = 240, active = true) => {
    now += ms;
    budget.beginFrame(now, { frameMs: ms, active, emergencyLevel, backlogSeconds });
  };
  frame(16);
  frame(200);
  assert.equal(budget.snapshot.level, 0);
  for (let i = 0; i < 6; i++) frame(200);
  assert.equal(budget.snapshot.level, 3);
  assert.equal(budget.snapshot.budgetMs, 3);
  frame(60000, 0, 0, false);
  frame(60000, 0, 0);
  assert.equal(budget.snapshot.level, 3, 'hidden/pause gaps do not count as recovery');
  for (let i = 0; i < 199; i++) frame(20, 0, 0);
  assert.equal(budget.snapshot.level, 3);
  frame(20, 0, 0);
  assert.equal(budget.snapshot.level, 2);
  for (let i = 0; i < 401; i++) frame(20, 0, 0);
  assert.equal(budget.snapshot.level, 0);
});

test('inactive callbacks never advance work and invalid timestamps/pressure fail closed', () => {
  const budget = createAdaptiveStepBudget();
  budget.beginFrame(10, { frameMs: 16, active: false });
  assert.equal(budget.canTakeStep(10), false);
  assert.throws(() => budget.recordStep(10, 11), RangeError);
  assert.throws(() => budget.beginFrame(9, { frameMs: 16, active: true }), RangeError);
  assert.throws(() => budget.beginFrame(11, { frameMs: NaN, active: true }), RangeError);
  assert.throws(() => budget.beginFrame(12, { frameMs: 16, active: true, emergencyLevel: 4 }), RangeError);
  budget.reset();
  budget.beginFrame(0, { frameMs: 0, active: true });
  assert.equal(budget.canTakeStep(0), true);
  assert.equal(budget.snapshot.totalSteps, 0);
});
