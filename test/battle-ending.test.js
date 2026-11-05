import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleEnding, BATTLE_HISTORY, ENDING_NARRATION, endingVoiceClips, playEndingNarration } from '../src/battle-ending.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('result locks once, fade remains controllable, history fully enters before settlement and paused time is not consumed', () => {
  const events = [], ending = createBattleEnding({ onBlack: () => events.push('black'), onFinish: result => events.push(result) });
  assert.equal(ending.start('victory', 0, 9), true);
  assert.equal(ending.start('defeat', 1), false);
  ending.update(4000);
  assert.equal(ending.fading, true); assert.ok(ending.snapshot.opacity > 0 && ending.snapshot.opacity < 1);
  ending.update(15000, true);
  assert.equal(ending.snapshot.elapsed, 4);
  ending.update(20500);
  assert.equal(ending.black, true);
  assert.deepEqual(events, ['black']);
  assert.equal(ending.finish(), false);
  ending.update(26500);
  assert.equal(ending.snapshot.pageProgress, 1);
  assert.equal(ending.snapshot.canContinue, true);
  assert.equal(ending.finish(), true);
  assert.deepEqual(events, ['black', 'victory']);
  ending.reset(); assert.equal(ending.start('defeat', 30000), true);
});

test('history also auto-completes for defeat and separates Zhonghua Gate resistance from Shangxinhe atrocities', () => {
  const events = [], ending = createBattleEnding({ onFinish: outcome => events.push(outcome) });
  ending.start('defeat', 0);
  ending.update(8000); ending.update(27999);
  assert.equal(ending.complete, false);
  ending.update(28000);
  assert.deepEqual(events, ['defeat']);
  const text = BATTLE_HISTORY.nanjing.sections.map(section => section.join('：')).join('\n');
  assert.match(text, /中华门/); assert.match(text, /上新河/); assert.match(text, /28730/);
  assert.match(text, /不能混作/); assert.match(text, /不改变南京沦陷/);
  assert.match(ENDING_NARRATION.nanjing, /唐司令命令我们撤离南京/);
});

test('narration pauses and resumes from its actual audio offset without restarting', () => {
  const sources = [], context = { currentTime: 0, createBufferSource() {
    const source = { connect() {}, disconnect() {}, stop() {}, start(when, offset) { this.offset = offset; } };
    sources.push(source); return source;
  } };
  const voice = playEndingNarration(context, { duration: 10 }, {});
  context.currentTime = 2; voice.pause();
  context.currentTime = 20; voice.resume();
  assert.equal(sources.length, 2); assert.equal(sources[1].offset, 2);
  voice.stop();
});

test('both ending recordings match the user wording and declared Azure synthesis hashes', async () => {
  const root = new URL('../public/assets/audio/battle-endings/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  for (const clip of endingVoiceClips()) {
    const record = manifest.files.find(record => record.id === clip.id);
    assert.equal(record.text, ENDING_NARRATION[clip.campaign]);
    assert.equal(record.gender, 'Male');
    const bytes = await readFile(new URL(record.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  }
});
