import test from 'node:test';
import assert from 'node:assert/strict';
import { installRenderPassTimingProbe, renderPassTimingWindow } from '../scripts/render-pass-timing-probe.mjs';

function fixture({ supported = true, sampleEvery = 1, shadowCalls = 1, renderThrows = false } = {}) {
  let now = 0, id = 0;
  const listeners = new Map(), calls = [], deleted = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2, CURRENT_QUERY: 3, available: false, disjoint: false,
    active: null, contextLost: false, results: new Map(), begins: [], ends: 0,
    getExtension(name) {
      assert.equal(name, 'EXT_disjoint_timer_query_webgl2');
      return supported ? { GPU_DISJOINT_EXT: 4, TIME_ELAPSED_EXT: 5 } : null;
    },
    isContextLost() { return this.contextLost; },
    getParameter(key) { assert.equal(key, 4); return this.disjoint; },
    getQuery(kind, parameter) { assert.deepEqual([kind, parameter], [5, 3]); return this.active; },
    createQuery() { return { id: ++id }; },
    beginQuery(kind, query) { assert.equal(kind, 5); assert.equal(this.active, null); this.active = query; this.begins.push(query); },
    endQuery(kind) {
      assert.equal(kind, 5); assert.ok(this.active);
      this.results.set(this.active, this.begins.length * 1000000); this.active = null; this.ends++;
    },
    getQueryParameter(query, kind) {
      if (kind === this.QUERY_RESULT_AVAILABLE) return this.available;
      assert.equal(kind, this.QUERY_RESULT); assert.ok(this.available);
      return this.results.get(query);
    },
    deleteQuery(query) { deleted.push(query); },
  };
  const target = { performance: { now: () => now } };
  const shadowMap = { enabled: true, render(...args) { calls.push(['shadow', this, args]); now += 1; } };
  const renderer = {
    shadowMap,
    domElement: {
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
    },
    getContext() { return gl; },
    render(...args) {
      calls.push(['render', this, args]); now += 1;
      for (let i = 0; i < shadowCalls; i++) this.shadowMap.render(...args);
      now += 1;
      if (renderThrows) throw new Error('render failed');
      return 42;
    },
  };
  const originalRender = renderer.render, originalShadow = shadowMap.render;
  installRenderPassTimingProbe({ sampleEvery }, target);
  target.__attachRenderPassTimingProbe(renderer);
  return { target, renderer, gl, calls, listeners, deleted, originalRender, originalShadow };
}

test('shadow and post-shadow elapsed queries are sequential, asynchronous and independently attributed', () => {
  const { target, renderer, gl, calls } = fixture();
  assert.equal(renderer.render('scene', 'camera'), 42);
  assert.deepEqual(gl.begins.map(query => query.id), [1, 2]);
  assert.equal(gl.ends, 2); assert.equal(gl.active, null);
  assert.equal(target.__renderPassTimingProbe.events[0].shadowGpuMs, null);
  gl.available = true;
  renderer.render('scene', 'camera');
  const event = target.__renderPassTimingProbe.events[0];
  assert.deepEqual([event.shadowGpuMs, event.mainGpuMs], [1, 2]);
  assert.equal(event.gpuStatus, 'valid');
  assert.equal(target.__renderPassTimingProbe.resolved, 1);
  assert.ok(calls.every(call => call[1] === renderer.shadowMap || call[1] === renderer));
});

test('sampling is low-frequency, keeps full-strength renders, and does not change call order', () => {
  const { target, renderer, gl, calls } = fixture({ sampleEvery: 3 });
  for (let i = 0; i < 7; i++) renderer.render(i);
  assert.equal(calls.filter(call => call[0] === 'render').length, 7);
  assert.equal(calls.filter(call => call[0] === 'shadow').length, 7);
  assert.equal(gl.begins.length, 4);
  assert.deepEqual(target.__renderPassTimingProbe.events.map(event => event.sampled),
    [false, false, true, false, false, true, false]);
});

test('disjoint intervals invalidate both pass results and unsupported devices stay explicitly null', () => {
  const supported = fixture();
  supported.renderer.render();
  supported.gl.disjoint = true; supported.gl.available = true;
  supported.renderer.render();
  const invalid = supported.target.__renderPassTimingProbe.events[0];
  assert.equal(invalid.gpuStatus, 'disjoint');
  assert.equal(invalid.shadowGpuMs, null); assert.equal(invalid.mainGpuMs, null);
  const unsupported = fixture({ supported: false });
  unsupported.renderer.render();
  assert.equal(unsupported.calls.length, 2);
  assert.equal(unsupported.target.__renderPassTimingProbe.status, 'unsupported');
  assert.equal(unsupported.target.__renderPassTimingProbe.events[0].shadowGpuMs, null);
  const noShadow = fixture({ shadowCalls: 0 });
  noShadow.renderer.render();
  assert.equal(noShadow.target.__renderPassTimingProbe.events[0].gpuStatus, 'no-shadow-entry');
});

test('ambiguous shadow entry counts and render failures are surfaced, not reported as GPU timings', () => {
  const ambiguous = fixture({ shadowCalls: 2 });
  ambiguous.renderer.render();
  const multi = ambiguous.target.__renderPassTimingProbe.events[0];
  assert.equal(multi.gpuStatus, 'multiple-shadow-entries');
  assert.equal(multi.shadowGpuMs, null); assert.equal(multi.mainGpuMs, null);
  const failed = fixture({ renderThrows: true });
  assert.throws(() => failed.renderer.render(), /render failed/);
  const error = failed.target.__renderPassTimingProbe.events[0];
  assert.equal(error.gpuStatus, 'render-error');
  assert.equal(error.shadowGpuMs, null); assert.equal(error.mainGpuMs, null);
});

test('window results retain sampled events, renderer boundaries and null invalid samples', () => {
  const { target, renderer, gl } = fixture({ sampleEvery: 2 });
  const before = target.__renderPassTimingProbe;
  renderer.render(); renderer.render();
  const atEnd = target.__renderPassTimingProbe;
  gl.available = true; renderer.render(); renderer.render();
  const result = renderPassTimingWindow(before, atEnd, target.__renderPassTimingProbe,
    [{ serial: 1, renderStartedAt: 0, renderEndedAt: 3, intervalMs: 16 },
      { serial: 2, renderStartedAt: 3, renderEndedAt: 6, intervalMs: 24 },
      { serial: 3, renderStartedAt: 6, renderEndedAt: 9, intervalMs: 280 }]);
  assert.equal(result.renders, 2); assert.equal(result.sampledRenders, 1);
  assert.equal(result.validPassPairs, 1);
  assert.deepEqual(result.shadow, [1]);
  assert.deepEqual(result.postShadow, [2]);
  assert.equal(result.events[0].followingIntervalMs, 280);
  assert.equal(renderPassTimingWindow(null, null, null), null);
  assert.throws(() => installRenderPassTimingProbe({ sampleEvery: 0 }, {}), RangeError);
});

test('stopping restores the exact renderer entry points and deletes retained query handles', () => {
  const { target, renderer, originalRender, originalShadow, gl, deleted, listeners } = fixture();
  renderer.render(); renderer.render();
  target.__stopRenderPassTimingProbe();
  assert.equal(renderer.render, originalRender);
  assert.equal(renderer.shadowMap.render, originalShadow);
  assert.equal(gl.active, null); assert.equal(deleted.length, 4);
  assert.equal(listeners.size, 0);
  target.__stopRenderPassTimingProbe();
});

test('context loss and externally active queries are explicit; unresolved samples are never zero', () => {
  const active = fixture();
  active.gl.active = { id: 'foreign-query' };
  active.renderer.render();
  assert.equal(active.target.__renderPassTimingProbe.events[0].gpuStatus, 'query-conflict');
  active.gl.active = null;
  active.renderer.render();
  active.gl.contextLost = true;
  active.listeners.get('webglcontextlost')();
  const snapshot = active.target.__renderPassTimingProbe;
  assert.equal(snapshot.status, 'context-lost');
  assert.equal(snapshot.events[1].gpuStatus, 'context-lost');
  assert.equal(snapshot.events[1].shadowGpuMs, null);
  active.target.__stopRenderPassTimingProbe();
  assert.equal(active.renderer.render, active.originalRender);
});
