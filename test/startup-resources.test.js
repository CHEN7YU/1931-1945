import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_MODES, startupResourceProfile, createStartupTextureBudget, prefetchCommonStartupResources } from '../src/startup-resources.js';

test('idle prefetch downloads shared models only while the launcher is eligible', () => {
  const links = [], tasks = [], warnings = [];
  const document = { hidden: false, createElement: () => ({ addEventListener(_type, listener) { this.error = listener; } }),
    head: { append: link => links.push(link) } };
  const options = { document, schedule: callback => tasks.push(callback), warn: message => warnings.push(message) };
  prefetchCommonStartupResources({ ...options, connection: { saveData: true } });
  prefetchCommonStartupResources({ ...options, connection: { effectiveType: '2g' } });
  prefetchCommonStartupResources({ ...options, deviceMemory: 4 });
  assert.equal(tasks.length, 0, 'data saver, slow connections and low-memory devices skip speculative downloads');
  prefetchCommonStartupResources({ ...options, shouldStart: () => false });
  tasks.shift()();
  assert.equal(links.length, 0, 'a selected or already-loading map cancels speculative work');
  document.hidden = true;
  prefetchCommonStartupResources(options);
  tasks.shift()();
  assert.equal(links.length, 0, 'hidden tabs do not start speculative downloads');
  document.hidden = false;
  prefetchCommonStartupResources(options);
  tasks.shift()();
  assert.equal(links.length, 2);
  assert.ok(links.every(link => link.rel === 'prefetch' && link.fetchPriority === 'low'));
  links[0].error();
  assert.match(warnings[0], /Startup prefetch failed/);
});

test('startup chooses low-resident resources only on an explicit request or a bounded reported memory hint', () => {
  assert.equal(startupResourceProfile('auto', 4).lowMemory, true);
  assert.equal(startupResourceProfile('auto', 2).textureLimit, 512);
  assert.equal(startupResourceProfile('auto', 8).lowMemory, false);
  assert.equal(startupResourceProfile('auto').lowMemory, false);
  assert.equal(startupResourceProfile('standard', 2).lowMemory, false);
  assert.equal(startupResourceProfile('low-memory').lowMemory, true);
  assert.equal(startupResourceProfile('low-memory').motionPhases, 4);
  assert.deepEqual(RESOURCE_MODES, ['auto', 'standard', 'low-memory']);
  assert.throws(() => startupResourceProfile('fast'), RangeError);
  assert.throws(() => startupResourceProfile('auto', NaN), RangeError);
  assert.throws(() => startupResourceProfile('auto', 0), RangeError);
});

test('low-memory textures replace their resident image, preserve aspect and identity, and close the old bitmap once', () => {
  let closed = 0, drawn = null;
  const image = { width: 4096, height: 2048, close() { closed++; } };
  const texture = { image, needsUpdate: false, colorSpace: 'srgb', repeat: [6, 8] };
  const canvas = { getContext() { return { drawImage(...args) { drawn = args; } }; } };
  const budget = createStartupTextureBudget(startupResourceProfile('low-memory'), { createCanvas: () => canvas });
  assert.equal(budget.resize(texture), texture);
  assert.equal(texture.image, canvas); assert.equal(canvas.width, 512); assert.equal(canvas.height, 256);
  assert.equal(texture.colorSpace, 'srgb'); assert.deepEqual(texture.repeat, [6, 8]);
  assert.equal(texture.needsUpdate, true); assert.equal(drawn[0], image); assert.equal(closed, 1);
  budget.resize(texture);
  assert.equal(closed, 1); assert.equal(budget.snapshot.resized, 1);
  assert.equal(budget.snapshot.residentTexels, 512 * 256);
  assert.equal(budget.snapshot.sourceTexels, 4096 * 2048);
});

test('resource texture loads are bounded to two decodes and a failed load does not strand queued work', async () => {
  const budget = createStartupTextureBudget(startupResourceProfile('low-memory'));
  let active = 0, peak = 0;
  const loader = { async loadAsync(url) {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (url === 'missing') throw new Error('Missing texture');
    return { image: { width: 128, height: 128 } };
  } };
  const results = await Promise.allSettled(['one', 'missing', 'two', 'three'].map(url => budget.load(loader, url)));
  assert.equal(peak, 2); assert.equal(results[1].status, 'rejected');
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(budget.snapshot.activeLoads, 0); assert.equal(budget.snapshot.queuedLoads, 0);
  assert.equal(budget.snapshot.peakConcurrentLoads, 2);
});

test('standard resource loading retains the original image and malformed texture data fails explicitly', () => {
  const budget = createStartupTextureBudget(startupResourceProfile('standard'));
  const texture = { image: { width: 4096, height: 2048 } }, image = texture.image;
  assert.equal(budget.resize(texture).image, image);
  assert.equal(budget.snapshot.resized, 0);
  assert.throws(() => budget.resize({ image: null }), /dimensions/);
});
