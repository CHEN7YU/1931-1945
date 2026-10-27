import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationClock, SIMULATION_CLOCK } from '../src/simulation-clock.js';

function frame(clock, now) {
  const budget = clock.beginFrame(now), values = [];
  for (let dt; (dt = clock.takeStep()) > 0;) values.push(dt);
  return { budget, values };
}
const balanced = clock => {
  const state = clock.snapshot;
  assert.ok(Math.abs(state.activeSeconds - state.simulatedSeconds - state.pendingSeconds) < 1e-8);
};
test('normal 30/60/144Hz frames keep their elapsed step instead of adding a fixed-tick input delay', () => {
  for (const fps of [30, 60, 144]) {
    const clock = createSimulationClock();
    clock.setActive(true, 0);
    for (let i = 1; i <= fps * 10; i++) {
      const result = frame(clock, i * 1000 / fps);
      assert.equal(result.values.length, 1);
      assert.ok(Math.abs(result.values[0] - 1 / fps) < 1e-10);
    }
    assert.ok(Math.abs(clock.snapshot.simulatedSeconds - 10) < 1e-8);
    balanced(clock);
  }
});
test('a 200ms long frame advances the full world time through bounded substeps', () => {
  const clock = createSimulationClock();
  clock.setActive(true, 0);
  const result = frame(clock, 200);
  assert.equal(result.values.length, 4);
  assert.ok(result.values.every(dt => dt <= .05));
  assert.ok(Math.abs(clock.snapshot.simulatedSeconds - .2) < 1e-10);
  balanced(clock);
});
test('catch-up retains debt without turning a recovered render frame into a fast-forward burst', () => {
  const clock = createSimulationClock();
  clock.setActive(true, 0);
  const result = frame(clock, 1000);
  assert.equal(result.values.length, SIMULATION_CLOCK.maxStepsPerFrame);
  assert.equal(result.budget, .25);
  assert.equal(clock.snapshot.limited, true);
  assert.ok(Math.abs(clock.snapshot.pendingSeconds - .75) < 1e-10);
  let now = 1000;
  for (let i = 0; i < 600 && clock.snapshot.pendingSeconds > 1e-8; i++) {
    now += 1000 / 60;
    const recovery = frame(clock, now);
    assert.ok(recovery.values.length <= 5);
    assert.ok(clock.snapshot.frameSeconds <= SIMULATION_CLOCK.maxRecoveryRate / 60 + 1e-10);
    balanced(clock);
  }
  assert.ok(clock.snapshot.pendingSeconds < 1e-8);
  assert.ok(Math.abs(clock.snapshot.simulatedSeconds - now / 1000) < 1e-8);
});
test('recovery rate is bounded at 30, 60 and 144Hz, including repeated foreground stalls', () => {
  for (const fps of [30, 60, 144]) {
    const clock = createSimulationClock();
    clock.setActive(true, 0);
    let now = 0;
    for (let index = 0; index < fps * 5; index++) {
      const elapsed = index === 1 || index === fps ? 650 : 1000 / fps;
      now += elapsed;
      frame(clock, now);
      assert.ok(clock.snapshot.frameSeconds <= elapsed / 1000 * SIMULATION_CLOCK.maxRecoveryRate + 1e-10);
      balanced(clock);
    }
    assert.ok(clock.snapshot.simulatedSeconds > 4);
  }
});
test('pause accounts the active boundary, freezes debt, and never charges inactive wall time', () => {
  const clock = createSimulationClock();
  clock.setActive(true, 100);
  frame(clock, 1100);
  clock.setActive(false, 1120);
  const paused = clock.snapshot;
  assert.ok(Math.abs(paused.activeSeconds - 1.02) < 1e-10);
  frame(clock, 10000);
  assert.equal(clock.snapshot.pendingSeconds, paused.pendingSeconds);
  assert.equal(clock.snapshot.activeSeconds, paused.activeSeconds);
  assert.equal(clock.takeStep(), 0);
  clock.setActive(true, 20000);
  frame(clock, 20016);
  assert.ok(Math.abs(clock.snapshot.activeSeconds - 1.036) < 1e-10);
  balanced(clock);
});
test('stopping a batch preserves unconsumed active time and a new battle explicitly resets it', () => {
  const clock = createSimulationClock();
  clock.setActive(true, 0);
  clock.beginFrame(200);
  assert.equal(clock.takeStep(), .05);
  clock.setActive(false, 200);
  assert.equal(clock.takeStep(), 0);
  assert.ok(Math.abs(clock.snapshot.pendingSeconds - .15) < 1e-10);
  clock.reset(500);
  assert.deepEqual(clock.snapshot, { active: false, activeSeconds: 0, simulatedSeconds: 0, pendingSeconds: 0,
    stepsThisFrame: 0, frameSeconds: 0, peakPendingSeconds: 0, limited: false, limits: { ...SIMULATION_CLOCK } });
});
test('sub-nanosecond remainder is retained, not erased or turned into an extra near-zero update', () => {
  const clock = createSimulationClock();
  clock.setActive(true, 0);
  frame(clock, .0000005);
  assert.equal(clock.snapshot.simulatedSeconds, 0);
  assert.ok(clock.snapshot.pendingSeconds > 0);
  frame(clock, 1);
  assert.ok(Math.abs(clock.snapshot.simulatedSeconds - .001) < 1e-12);
  balanced(clock);
});
test('invalid time and activity fail explicitly without inventing elapsed time', () => {
  assert.throws(() => createSimulationClock(NaN), RangeError);
  const clock = createSimulationClock(10);
  assert.throws(() => clock.beginFrame(9), /monotonic/);
  assert.throws(() => clock.beginFrame(Infinity), RangeError);
  assert.throws(() => clock.setActive('yes', 10), TypeError);
  assert.equal(clock.snapshot.activeSeconds, 0);
});
