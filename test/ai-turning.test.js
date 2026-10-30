import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_TURN, advanceAITurn, headingError } from '../src/ai-turning.js';

test('a 180 degree reversal takes real simulated time instead of one-frame flipping at every framerate', () => {
  for (const fps of [30, 60, 144]) {
    const actor = { heading: 0 }, dt = 1 / fps;
    for (let frame = 0; frame < fps; frame++) {
      const before = actor.heading;
      const result = advanceAITurn(actor, Math.PI, dt);
      assert.ok(Math.abs(headingError(before, actor.heading)) <= AI_TURN.standingRate * dt + 1e-10);
      assert.ok(Math.abs(result.step) <= AI_TURN.standingRate * dt + 1e-10);
    }
    assert.ok(Math.abs(actor.heading - 2.4) < 1e-9);
    assert.ok(Math.abs(headingError(actor.heading, Math.PI)) > AI_TURN.fireAngle);
    for (let frame = 0; frame < fps; frame++) advanceAITurn(actor, Math.PI, dt);
    assert.ok(Math.abs(headingError(actor.heading, Math.PI)) < 1e-9);
  }
});

test('turning crosses the wrap boundary by the short route and brakes until a path reversal settles', () => {
  const actor = { heading: Math.PI - .02 };
  advanceAITurn(actor, -Math.PI + .03, .02);
  assert.ok(Math.abs(headingError(actor.heading, -Math.PI + .03)) < .003);
  actor.heading = 0;
  assert.equal(advanceAITurn(actor, Math.PI, .05, true).mayMove, false);
  for (let i = 0; i < 40 && actor.turningToPath; i++) advanceAITurn(actor, Math.PI, .05, true);
  assert.equal(actor.turningToPath, false);
  assert.ok(Math.abs(headingError(actor.heading, Math.PI)) <= AI_TURN.resumeAngle);
});

test('zero time and invalid turning inputs cannot advance orientation', () => {
  const actor = { heading: .5, turningToPath: true }, before = structuredClone(actor);
  advanceAITurn(actor, 2, 0, true);
  assert.deepEqual(actor, before);
  for (const args of [[NaN, .1, true], [1, -.1, false], [1, .1, 'yes']]) {
    assert.throws(() => advanceAITurn(actor, ...args), RangeError);
  }
});

test('a moving turn supplies a slowed body-forward arc rather than a sideways heading-independent slide', () => {
  for (const fps of [30, 60, 144]) {
    const actor = { heading: 0 }, position = { x: 0, z: 0 };
    const samples = [];
    for (let frame = 0; frame < fps; frame++) {
      const turn = advanceAITurn(actor, .6, 1 / fps, true);
      assert.equal(turn.mayMove, true, 'gentle turns do not force a full stop');
      assert.ok(turn.moveScale > 0 && turn.moveScale <= 1);
      assert.ok(Math.abs(turn.direction.x + Math.sin(actor.heading)) < 1e-10);
      position.x += turn.direction.x * 2 * turn.moveScale / fps;
      position.z += turn.direction.z * 2 * turn.moveScale / fps;
      samples.push(turn.moveScale);
    }
    assert.ok(position.x < -.7 && position.z < -1.4);
    assert.ok(samples[0] < samples.at(-1), 'recover full speed as body aligns');
    assert.ok(Math.hypot(position.x, position.z) <= 2);
  }
});
