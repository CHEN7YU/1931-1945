import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePostureBlend, POSTURE_TRANSITION } from '../src/posture-transition.js';
import { soldierPostureHeight } from '../src/entities.js';

const motion = () => ({ profile: { kneeling: {}, crouched: {}, prone: {} },
  posture: { kneeling: 0, crouched: 0, prone: 0 } });

test('both teams lower through a supporting knee before lying down, with matching body and eye heights', () => {
  for (const team of ['friendly', 'enemy']) {
    const nativeMotion = motion(), actor = { team, nativeMotion, stance: 'prone' };
    const eyes = [], bodies = [];
    for (let frame = 0; frame < 20; frame++) {
      advancePostureBlend(nativeMotion, 'prone', .05);
      eyes.push(soldierPostureHeight(actor)); bodies.push(soldierPostureHeight(actor, 'body'));
      if (frame === 5) assert.ok(nativeMotion.posture.kneeling > .75 && nativeMotion.posture.prone === 0);
    }
    assert.equal(nativeMotion.posture.prone, 1);
    assert.equal(nativeMotion.postureTransition, null);
    assert.ok(eyes.every((height, i) => !i || height <= eyes[i - 1] + 1e-8));
    assert.ok(bodies.every((height, i) => !i || height <= bodies[i - 1] + 1e-8));
    assert.ok(Math.max(...eyes.slice(1).map((height, i) => Math.abs(height - eyes[i]))) < .13);
  }
});

test('rising takes longer, pauses with simulation time, and can reverse without a pose jump', () => {
  const state = motion(); state.posture.prone = 1;
  advancePostureBlend(state, 'standing', .4);
  assert.ok(state.posture.prone > 0 && state.posture.kneeling > 0);
  const before = JSON.stringify(state); advancePostureBlend(state, 'standing', 0);
  assert.equal(JSON.stringify(state), before);
  const previous = { ...state.posture };
  advancePostureBlend(state, 'prone', .01);
  assert.ok(Object.keys(previous).every(pose => Math.abs(previous[pose] - state.posture[pose]) < .02));
  advancePostureBlend(state, 'prone', POSTURE_TRANSITION.lowerSeconds);
  assert.equal(state.posture.prone, 1);
  advancePostureBlend(state, 'standing', POSTURE_TRANSITION.riseSeconds);
  assert.deepEqual(state.posture, { kneeling: 0, crouched: 0, prone: 0 });
  advancePostureBlend(state, 'prone', .2);
  const knee = state.posture.kneeling;
  advancePostureBlend(state, 'standing', .01);
  assert.ok(state.postureTransition);
  assert.ok(Math.abs(state.posture.kneeling - knee) < .02, 'reversal before reaching the ground also retains continuous far morphing');
});
