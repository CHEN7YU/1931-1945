import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sihangVoiceClips, SIHANG_VOICE_LINES, createSihangVoices } from '../src/sihang-voices.js';
import { voiceSSML, VOICE_FORMAT } from '../scripts/prepare-battle-voices.mjs';

test('all new Sihang warnings, encouragement and memorial recordings have original Azure provenance and bounded charges', async () => {
  const root = new URL('../public/assets/audio/sihang-voices/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  assert.equal(manifest.provider, 'Azure AI Speech'); assert.equal(manifest.files.length, 9);
  assert.ok(manifest.attemptedSSMLCharacters < 10000);
  assert.ok(manifest.attemptedCharactersByPhase.sihang < 10000);
  for (const clip of sihangVoiceClips()) {
    const record = manifest.files.find(file => file.file === clip.file);
    assert.equal(record.text, SIHANG_VOICE_LINES[clip.cue]);
    const bytes = await readFile(new URL(record.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(createHash('sha256').update(`${VOICE_FORMAT}\n${voiceSSML(clip)}`).digest('hex'), record.synthesisHash);
  }
});

test('Sihang scene voices require valid clips and do not invent playback before activation', () => {
  assert.throws(() => createSihangVoices({}), /Missing or invalid/);
  const buffers = Object.fromEntries(sihangVoiceClips().map(clip => [clip.cue, { duration: 2 }]));
  const voices = createSihangVoices(buffers);
  assert.equal(voices.play(null, 'armed'), false);
  assert.equal(voices.snapshot.spoken, 0);
  assert.throws(() => voices.play(null, 'unknown'), RangeError);
});
