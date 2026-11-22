import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiangyinVoiceReactions } from '../src/jiangyin/jiangyin-voice.js';

test('injury barks vary, skip fatal hits and share a 30-second cooldown', () => {
  const values = [0, .99, .99, 0, .2, .5];
  const reactions = createJiangyinVoiceReactions(() => values.shift() ?? 0);
  assert.deepEqual(reactions.wounded(0, 60), { cue: 'jiangyin-player-wounded-1', variant: 2 });
  assert.equal(reactions.wounded(6, 40), null);
  assert.equal(reactions.wounded(29, 40), null);
  assert.equal(reactions.wounded(30, 0), null, 'fatal damage does not consume the next injury bark');
  assert.deepEqual(reactions.wounded(30, 40), { cue: 'jiangyin-player-wounded-2', variant: 0 });
});

test('troop-hit barks are randomized and throttled; the first kill line can play only once', () => {
  const values = [0, .5, .99, 0, .2, .4, .8];
  const reactions = createJiangyinVoiceReactions(() => values.shift() ?? 0);
  assert.deepEqual(reactions.troopHit(0), { cue: 'jiangyin-player-bark-1', variant: 1 });
  assert.equal(reactions.troopHit(4), null, 'automatic fire cannot cause a voice on every bullet');
  assert.deepEqual(reactions.troopHit(14), { cue: 'jiangyin-player-bark-2', variant: 0 });
  assert.deepEqual(reactions.firstKill(), { cue: 'jiangyin-player-first-kill', variant: 1 });
  assert.equal(reactions.troopHit(15, true), null, 'the first-kill line does not repeat');
});
