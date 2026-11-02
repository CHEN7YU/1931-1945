import test from 'node:test';
import assert from 'node:assert/strict';
import { setLoadingProgress } from '../src/loading-progress.js';

function fixture() {
  const elements = Object.fromEntries(['loading-progress', 'loading-percentage', 'loading-message'].map(id =>
    [id, { textContent: '', setAttribute(name, value) { this[name] = value; } }]));
  return { elements, doc: { getElementById: id => elements[id] } };
}

test('actual initialization milestones keep the progress bar, visible percentage and accessible value in sync', () => {
  const { elements, doc } = fixture();
  for (const value of [0, 5, 35, 45, 55, 60, 80, 90, 92, 96, 100]) {
    setLoadingProgress(value, `Stage ${value}`, doc);
    assert.equal(elements['loading-progress'].value, value);
    assert.equal(elements['loading-progress']['aria-valuetext'], `${value}%`);
    assert.equal(elements['loading-percentage'].textContent, `${value}%`);
    assert.equal(elements['loading-message'].textContent, `Stage ${value}`);
  }
  setLoadingProgress(0, 'Restart', doc);
  assert.equal(elements['loading-progress'].value, 0);
});

test('invalid percentages and missing loading elements fail explicitly instead of claiming completion', () => {
  const { doc } = fixture();
  for (const value of [-1, 101, NaN, Infinity, 1.5]) {
    assert.throws(() => setLoadingProgress(value, 'Invalid', doc), RangeError);
  }
  assert.throws(() => setLoadingProgress(5, 'Loading', { getElementById: () => null }), /requires/);
});
