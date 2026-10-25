import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityProfile } from '../src/quality.js';

test('high/low profiles cap actual DPR, shadow resolution and smoke counts independently', () => {
  assert.deepEqual(qualityProfile('high', 2, 8192), { pixelRatioCap: 1.6, pixelRatio: 1.6, shadowSize: 4096, smokeBudget: 30 });
  assert.deepEqual(qualityProfile('low', 2, 8192), { pixelRatioCap: 1, pixelRatio: 1, shadowSize: 1024, smokeBudget: 10 });
  assert.equal(qualityProfile('high', .8, 2048).pixelRatio, .8);
  assert.equal(qualityProfile('high', 2, 2048).shadowSize, 2048);
});
test('invalid graphics presets and capabilities are reported rather than silently defaulting', () => {
  assert.throws(() => qualityProfile('ultra', 1, 4096), RangeError);
  assert.throws(() => qualityProfile('high', NaN, 4096), RangeError);
  assert.throws(() => qualityProfile('low', 1, 0), RangeError);
});
