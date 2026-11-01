import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFacingSector } from '../src/minimap-view.js';

test('facing indicator is a 90-degree sector aligned with world camera heading', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 9]) {
    const calls = [];
    const ctx = Object.fromEntries(['save', 'beginPath', 'moveTo', 'arc', 'closePath', 'fill', 'stroke', 'restore']
      .map(name => [name, (...args) => calls.push({ name, args })]));
    drawFacingSector(ctx, 50, 70, heading);
    const [x, z, radius, start, end] = calls.find(call => call.name === 'arc').args;
    assert.deepEqual([x, z, radius], [50, 70, 48]);
    assert.ok(Math.abs(end - start - Math.PI / 2) < 1e-12);
    const center = (start + end) / 2;
    assert.ok(Math.abs(Math.cos(center) + Math.sin(heading)) < 1e-12);
    assert.ok(Math.abs(Math.sin(center) + Math.cos(heading)) < 1e-12);
    assert.deepEqual(calls.find(call => call.name === 'moveTo').args, [50, 70]);
    assert.equal(calls.at(-1).name, 'restore');
    assert.equal(ctx.fillStyle, '#f6e0a970');
    assert.equal(calls.filter(call => call.name === 'stroke').length, 1);
  }
});

test('invalid sector inputs fail explicitly', () => {
  assert.throws(() => drawFacingSector({}, 0, 0, NaN), RangeError);
  assert.throws(() => drawFacingSector({}, 0, 0, 0, 0), RangeError);
});
