import test from 'node:test';
import assert from 'node:assert/strict';
import { TINNITUS_CANDIDATES, tinnitusCandidateSamples } from '../src/tinnitus-candidates.js';

test('ear-ringing candidates are distinct, bounded, softly introduced and fade to silence without impulse noise', () => {
  const samples = TINNITUS_CANDIDATES.map(preset => tinnitusCandidateSamples(preset.id));
  for (const data of samples) {
    assert.ok(data.slice(0, 28800).every(value => value === 0));
    assert.ok(data.every(value => Number.isFinite(value) && Math.abs(value) <= .035));
    const rms = (start, end) => Math.sqrt(data.slice(start, end).reduce((sum, value) => sum + value * value, 0) / (end - start));
    assert.ok(rms(30000, 31000) < rms(48000, 49000));
    assert.ok(rms(300000, 310000) < rms(48000, 49000) * .2);
    assert.ok(Math.abs(data.at(-1)) < 1e-8);
  }
  assert.notDeepEqual(samples[0], samples[1]); assert.notDeepEqual(samples[1], samples[2]);
  assert.throws(() => tinnitusCandidateSamples('unknown'), RangeError);
});
