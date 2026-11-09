import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveQuality } from '../src/adaptive-quality.js';

function fixture(initialLevel = 0) {
  let now = 0;
  const changes = [], controller = createAdaptiveQuality({ initialLevel, onChange: change => changes.push(change) });
  const frame = (ms, extra = {}) => { now += ms; controller.observe(ms, { active: true, now, ...extra }); };
  const run = (ms, seconds, extra) => { for (let t = 0; t < seconds * 1000; t += ms) frame(ms, extra); };
  return { controller, changes, frame, run, now: () => now };
}

test('CPU overload cannot reduce graphics before distant AI shedding has been tried and allowed to settle', () => {
  const f = fixture(), cpu = { aiMs: 25, renderMs: 3, gpuMs: 4 };
  f.run(80, 5, { aiLevel: 0, work: cpu, backlogSeconds: 2 });
  f.run(80, 5, { aiLevel: 1, work: cpu, backlogSeconds: 2 });
  assert.equal(f.controller.snapshot.level, 0);
  f.run(80, 3, { aiLevel: 2, work: cpu, backlogSeconds: 2 });
  assert.equal(f.controller.snapshot.level, 0);
  f.run(80, 6, { aiLevel: 2, work: cpu, backlogSeconds: 2 });
  assert.equal(f.controller.snapshot.level, 0);
  f.run(80, 4, { aiLevel: 2, work: cpu, backlogSeconds: 2 });
  assert.equal(f.controller.snapshot.level, 1, 'last-resort visual shedding is staged, never a jump straight to level 3');
});

test('measured graphics overload reduces far effects first and only reaches resolution fallback after separate settling periods', () => {
  const f = fixture(), work = { aiMs: 3, renderMs: 5, gpuMs: 35 };
  f.run(60, 3, { work });
  assert.equal(f.controller.snapshot.level, 1);
  f.run(60, 3, { work });
  assert.equal(f.controller.snapshot.level, 1);
  f.run(60, 3, { work });
  assert.equal(f.controller.snapshot.level, 2);
  f.run(60, 6, { work });
  assert.equal(f.controller.snapshot.level, 3);
  assert.equal(f.controller.statistics.reductions, 3);
});

test('pause, hidden tabs, first loading gaps and isolated stalls do not trigger reductions', () => {
  const f = fixture();
  f.frame(30000, { active: false }); f.frame(30000, { visible: false }); f.frame(30000);
  f.run(16, 2); f.frame(1000); f.run(16, 3);
  assert.equal(f.controller.snapshot.level, 0);
});

test('saved fallback survives menus, respects manual override, and recovers only after stable play without debt', () => {
  const f = fixture(3);
  assert.equal(f.controller.snapshot.reason, 'restored');
  f.controller.leaveBattle(); assert.equal(f.controller.snapshot.level, 3);
  f.run(16, 30, { backlogSeconds: 1 }); assert.equal(f.controller.snapshot.level, 3);
  f.run(16, 25); assert.equal(f.controller.snapshot.level, 2);
  f.controller.manualChange(f.now()); assert.equal(f.controller.snapshot.level, 0);
  f.run(80, 10, { work: { renderMs: 40 } }); assert.equal(f.controller.snapshot.level, 0);
  f.controller.resetStatistics(); assert.equal(f.controller.statistics.activations, 0);
  assert.throws(() => f.frame(-1), RangeError);
  assert.throws(() => createAdaptiveQuality({ initialLevel: 4 }), RangeError);
});
