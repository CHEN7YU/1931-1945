import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveQuality } from '../src/adaptive-quality.js';

function fixture() {
  let now = 0;
  const changes = [];
  const controller = createAdaptiveQuality({ onChange: change => changes.push(change) });
  const frame = (ms, extra = {}) => {
    now += ms;
    controller.observe(ms, { active: true, now, ...extra });
  };
  return { controller, changes, frame, now: () => now };
}

test('healthy play never downgrades; sustained pressure reduces quality and severe backlog reacts in wall time', () => {
  const f = fixture();
  for (let i = 0; i < 300; i++) f.frame(16);
  assert.equal(f.controller.snapshot.level, 0);
  for (let i = 0; i < 70; i++) f.frame(50);
  assert.equal(f.controller.snapshot.level, 1);
  f.frame(1000, { backlogSeconds: 1 });
  assert.equal(f.controller.snapshot.level, 3);
  assert.equal(f.controller.statistics.activations, 1);
  assert.equal(f.controller.statistics.reductions, 2);
  assert.equal(f.changes.at(-1).reason, 'backlog');
});

test('pause, hidden tabs and initial loading gaps do not downgrade or count as active reduced time', () => {
  const f = fixture();
  f.frame(10000, { active: false });
  f.frame(10000, { visible: false });
  f.frame(10000);
  assert.equal(f.controller.statistics.reductions, 0);
  f.frame(600, { backlogSeconds: 1 });
  assert.equal(f.controller.snapshot.level, 3);
  const before = f.controller.statistics.activeSeconds;
  f.frame(60000, { active: false });
  f.frame(60000, { visible: false });
  f.frame(16);
  assert.equal(f.controller.statistics.activeSeconds, before);
});

test('one isolated long callback does not force low quality if normal frames immediately resume', () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) f.frame(16);
  f.frame(1000);
  for (let i = 0; i < 100; i++) f.frame(16);
  assert.equal(f.controller.statistics.reductions, 0);
});

test('a new diagnostics session clears counters without changing the current quality level', () => {
  const f = fixture();
  f.frame(16); f.frame(600, { backlogSeconds: 1 });
  assert.equal(f.controller.statistics.activations, 1);
  f.controller.resetStatistics();
  assert.equal(f.controller.snapshot.level, 3);
  assert.equal(f.controller.statistics.peak, 3);
  assert.equal(f.controller.statistics.activations, 0);
  assert.equal(f.controller.statistics.activeSeconds, 0);
});

test('recovery is gradual, requires a stable real-time interval, and does not discard existing backlog', () => {
  const f = fixture();
  f.frame(16); f.frame(600, { backlogSeconds: 1 });
  for (let i = 0; i < 250; i++) f.frame(16);
  assert.equal(f.controller.snapshot.level, 3);
  for (let i = 0; i < 1500; i++) f.frame(16, { backlogSeconds: 2 });
  assert.equal(f.controller.snapshot.level, 3);
  for (let i = 0; i < 4100; i++) f.frame(16);
  assert.equal(f.controller.snapshot.level, 0);
  assert.equal(f.controller.statistics.recoveries, 3);
  assert.equal(f.controller.statistics.activations, 1);
});

test('manual preferences temporarily override automatic shedding without being counted as an automatic recovery', () => {
  const f = fixture();
  f.frame(16); f.frame(600, { backlogSeconds: 1 });
  f.controller.manualChange(f.now());
  for (let i = 0; i < 10; i++) f.frame(1000, { backlogSeconds: 10 });
  assert.equal(f.controller.snapshot.level, 0);
  assert.equal(f.controller.statistics.recoveries, 0);
  for (let i = 0; i < 7; i++) f.frame(1000, { backlogSeconds: 10 });
  assert.equal(f.controller.snapshot.level, 3);
  assert.equal(f.controller.statistics.activations, 2);
  f.controller.leaveBattle();
  assert.equal(f.controller.snapshot.level, 0);
  assert.equal(f.controller.statistics.activations, 2);
  assert.throws(() => f.controller.observe(-1, { active: true, now: 0 }), RangeError);
});
