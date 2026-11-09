import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameWork, renderBound } from '../src/frame-work.js';

test('CPU and rendering pressure are distinguished rather than treating AI debt as GPU overload', () => {
  assert.equal(renderBound({ aiMs: 25, renderMs: 4, gpuMs: 8 }), false);
  assert.equal(renderBound({ aiMs: 4, renderMs: 6, gpuMs: 30 }), true);
  assert.equal(renderBound({ aiMs: 3, renderMs: 20 }), true);
  assert.equal(renderBound({ aiMs: 3, renderMs: 20, gpuMs: 0 }), true);
  assert.equal(renderBound({ aiMs: 0, renderMs: 2, gpuMs: null }), false);
});

test('actual work measurements exclude inactive preparation and retain unsupported GPU timing as unknown', () => {
  let now = 0;
  const work = createFrameWork({ now: () => now });
  work.beginFrame(false); now += 2000; work.finishFrame();
  assert.equal(work.snapshot.samples, 0);
  work.beginFrame(true);
  work.measureAI(() => { now += 7; });
  work.measureRender(() => { now += 3; });
  work.finishFrame();
  assert.equal(work.snapshot.aiMs, 7);
  assert.equal(work.snapshot.renderMs, 3);
  assert.equal(work.snapshot.cpuMs, 10);
  assert.equal(work.snapshot.gpuMs, null);
  assert.equal(work.snapshot.gpuTiming, 'unsupported');
  work.reset(); assert.equal(work.snapshot.samples, 0);
  assert.throws(() => work.measureAI(() => { throw new Error('real failure'); }), /real failure/);
});

test('optional GPU timer allocation failure is reported without stopping the game renderer', () => {
  const warnings = [], gl = { getExtension: () => ({ TIME_ELAPSED_EXT: 1 }), isContextLost: () => false,
    getQuery: () => null, createQuery: () => null };
  const work = createFrameWork({ gl, warn: message => warnings.push(message) });
  let rendered = 0;
  for (let frame = 0; frame < 24; frame++) {
    work.beginFrame(true); work.measureRender(() => rendered++); work.finishFrame();
  }
  assert.equal(rendered, 24);
  assert.equal(work.snapshot.gpuTiming, 'disabled');
  assert.equal(work.snapshot.gpuMs, null);
  assert.equal(warnings.length, 1);
});
