import test from 'node:test';
import assert from 'node:assert/strict';
import { createRifleState, rifleReloadSeconds } from '../src/rifle-action.js';
import { RIFLE_HAND_SAMPLES, rifleHandAction, rifleHandWeights, rifleActionPalm } from '../src/rifle-hand-action.js';
import { RIFLE_CONTACTS } from '../src/rifle-contacts.js';

test('shared third-person action samples represent trigger, bolt lift/pull and cartridge pressing with finite convex weights', () => {
  for (const [index, sample] of RIFLE_HAND_SAMPLES.entries()) {
    const weights = rifleHandWeights(sample);
    assert.equal(weights[index], 1); assert.equal(weights.reduce((a, b) => a + b, 0), 1);
  }
  const state = createRifleState();
  state.ammo = 0;
  for (const action of ['cycle', 'reload']) {
    state.action = action;
    const duration = action === 'cycle' ? .65 : rifleReloadSeconds(state), before = JSON.stringify(state);
    for (let index = 0; index <= 300; index++) {
      state.elapsed = index / 300 * duration;
      const weights = rifleHandWeights(rifleHandAction(state));
      assert.ok(weights.every(value => Number.isFinite(value) && value >= -1e-12 && value <= 1 + 1e-12));
      assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    }
    state.elapsed = JSON.parse(before).elapsed;
    assert.equal(JSON.stringify(state), before, 'pose sampling never changes weapon timing or ammunition');
  }
});
test('the right palm actually leaves the trigger grip, follows the bolt and moves above the receiver while the left contact is unchanged', () => {
  assert.deepEqual(rifleActionPalm(RIFLE_HAND_SAMPLES[0]), [...RIFLE_CONTACTS.triggerPalm]);
  const before = rifleActionPalm(RIFLE_HAND_SAMPLES[2]), after = rifleActionPalm(RIFLE_HAND_SAMPLES[3]);
  assert.ok(Math.abs(after[2] - before[2] - .09) < 1e-8);
  assert.ok(rifleActionPalm(RIFLE_HAND_SAMPLES[4])[1] > .1);
  assert.ok(rifleActionPalm(RIFLE_HAND_SAMPLES[5])[1] < rifleActionPalm(RIFLE_HAND_SAMPLES[4])[1]);
  assert.equal(rifleActionPalm(RIFLE_HAND_SAMPLES[5], -.027)[1], .13 - .027,
    'third-person palm follows the same moving clip as the first-person hand');
  assert.equal(rifleHandAction(createRifleState()), null);
  assert.equal(rifleHandAction({ ...createRifleState('zb26'), action: 'reload' }), null);
});
