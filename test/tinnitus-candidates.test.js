import test from 'node:test';
import assert from 'node:assert/strict';
import { TINNITUS_CANDIDATES, tinnitusCandidateSamples, repeatedBlastPreviewSamples } from '../src/tinnitus-candidates.js';

test('ear-ringing candidates are distinct, bounded, softly introduced and fade to silence without impulse noise', () => {
  const samples = TINNITUS_CANDIDATES.map(preset => tinnitusCandidateSamples(preset.id));
  for (const [index, data] of samples.entries()) {
    assert.ok(data.slice(0, 28800).every(value => value === 0));
    assert.ok(data.every(value => Number.isFinite(value) && Math.abs(value) <= .035));
    const rms = (start, end) => Math.sqrt(data.slice(start, end).reduce((sum, value) => sum + value * value, 0) / (end - start));
    const onset = Math.round((TINNITUS_CANDIDATES[index].onset ?? .6) * 48000);
    assert.ok(rms(onset + 1200, onset + 2200) < rms(onset + 19200, onset + 20200));
    assert.ok(rms(300000, 310000) < rms(onset + 19200, onset + 20200) * .2);
    assert.ok(Math.abs(data.at(-1)) < 1e-8);
  }
  assert.notDeepEqual(samples[0], samples[1]); assert.notDeepEqual(samples[1], samples[2]);
  assert.throws(() => tinnitusCandidateSamples('unknown'), RangeError);
  assert.throws(() => tinnitusCandidateSamples('D', 8000), RangeError);
});

test('three near-blast preview markers do not restart phase, create clicks or extend the fixed episode', () => {
  const samples = repeatedBlastPreviewSamples();
  assert.ok(samples.slice(0, 28800).every(value => value === 0));
  assert.ok(samples.slice(Math.ceil(5.1 * 48000)).every(value => value === 0));
  assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= .02800001));
  const amplitude = index => Math.abs(samples[index] / Math.sin(2 * Math.PI * 4200 * (index / 48000 - .6)));
  for (const marker of [1.3, 1.9]) {
    const index = Math.round(marker * 48000) + 1;
    assert.ok(amplitude(index) > .01, 'the ongoing episode does not drop to silence at a subsequent exposure');
    assert.ok(Math.abs(amplitude(index + 1) - amplitude(index)) < .00001, 'gain remains continuous');
  }
  assert.throws(() => repeatedBlastPreviewSamples(0), RangeError);
  assert.throws(() => repeatedBlastPreviewSamples(8000), RangeError);
});
