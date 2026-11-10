import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleFrameLoop, createPresentationRecovery } from '../src/presentation-recovery.js';

test('a failed animation frame is recorded without losing the next animation callback', () => {
  const callbacks = [], errors = [], observed = [];
  let running = true;
  const failure = new Error('one presentation update failed');
  const frame = createBattleFrameLoop({
    requestFrame: callback => callbacks.push(callback), active: () => running,
    step(now) { observed.push(now); if (now === 1) throw failure; },
    record: error => errors.push(error),
  });
  frame(1);
  assert.deepEqual(errors, [failure]);
  assert.equal(callbacks.length, 1);
  callbacks.shift()(2);
  assert.deepEqual(observed, [1, 2]);
  assert.equal(callbacks.length, 1);
  running = false;
  callbacks.shift()(3);
  assert.deepEqual(observed, [1, 2]);
  assert.equal(callbacks.length, 0);
});

test('a broken sword view is isolated and logged once while other views and combat can continue', () => {
  const errors = [], view = { visible: true }, other = { visible: true };
  const recovery = createPresentationRecovery((...args) => errors.push(args));
  const error = new Error('Unknown dadao view phase: stowed');
  let calls = 0;
  const broken = () => { calls++; throw error; };
  for (let frame = 0; frame < 60; frame++)
    assert.equal(recovery.run(view, broken, { team: 'friendly', position: [1, 0, 3] }), false);
  assert.equal(view.visible, false);
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], error);
  assert.equal(errors[0][1].details.component, 'first-person-dadao');
  assert.equal(recovery.run(other, () => {}, {}), true);
  recovery.reset(view);
  assert.equal(recovery.run(view, () => {}, {}), true);
  assert.equal(view.visible, true);
});
