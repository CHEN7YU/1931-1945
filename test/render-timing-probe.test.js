import test from 'node:test';
import assert from 'node:assert/strict';
import { installRenderTimingProbe, renderTimingWindow } from '../scripts/render-timing-probe.mjs';

function fixture({ gpu = true, supported = true } = {}) {
  let now = 0;
  const calls = [], deleted = [], listeners = new Map(), failure = new Error('original render failed');
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2, CURRENT_QUERY: 3,
    available: false, disjoint: false, lost: false, active: null, resultReads: 0, begins: 0, ends: 0,
    getExtension(name) {
      assert.equal(name, 'EXT_disjoint_timer_query_webgl2');
      return supported ? { GPU_DISJOINT_EXT: 4, TIME_ELAPSED_EXT: 5 } : null;
    },
    isContextLost() { return this.lost; },
    getParameter(kind) { assert.equal(kind, 4); return this.disjoint; },
    getQuery(kind, parameter) { assert.deepEqual([kind, parameter], [5, 3]); return this.active; },
    createQuery() { return {}; },
    beginQuery(kind, query) { assert.equal(kind, 5); assert.equal(this.active, null); this.active = query; this.begins++; },
    endQuery(kind) { assert.equal(kind, 5); assert.ok(this.active); this.active = null; this.ends++; },
    getQueryParameter(query, kind) {
      assert.ok(query);
      if (kind === this.QUERY_RESULT_AVAILABLE) return this.available;
      assert.equal(kind, this.QUERY_RESULT); assert.ok(this.available, 'never read a result before availability');
      this.resultReads++; return 2500000;
    },
    deleteQuery(query) { deleted.push(query); },
  };
  const target = { performance: { now: () => now } };
  const renderer = {
    domElement: {
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
    },
    getContext() { assert.ok(gpu, 'CPU-only mode must issue no extra WebGL calls'); return gl; },
    render(...args) {
      calls.push({ self: this, args }); now += 3;
      if (this.fail) throw failure;
      if (this.recursive) { this.recursive = false; this.render(...args); }
      return 42;
    },
  };
  const original = renderer.render;
  installRenderTimingProbe({ gpu }, target);
  target.__attachRenderTimingProbe(renderer);
  return { target, renderer, original, gl, calls, deleted, listeners, failure };
}

test('GPU results are read only after availability on later render calls; args, this and results are preserved', () => {
  const { target, renderer, gl, calls } = fixture();
  assert.equal(renderer.render('scene', 'camera'), 42);
  assert.equal(gl.resultReads, 0);
  assert.equal(target.__renderTimingProbe.events[0].gpuMs, null);
  renderer.render('scene', 'camera');
  assert.equal(gl.resultReads, 0);
  gl.available = true;
  renderer.render('scene', 'camera');
  assert.equal(gl.resultReads, 2);
  assert.deepEqual(target.__renderTimingProbe.events.slice(0, 2).map(event => event.gpuMs), [2.5, 2.5]);
  assert.equal(target.__renderTimingProbe.events[2].gpuMs, null, 'never read the just-ended query');
  assert.ok(calls.every(call => call.self === renderer && call.args.join() === 'scene,camera'));
  assert.equal(target.__renderTimingProbe.created, 2, 'reuse completed handles instead of allocating per frame');
});

test('unsupported GPUs and CPU-only runs report null GPU time without skipping rendering', () => {
  for (const options of [{ supported: false }, { gpu: false }]) {
    const { target, renderer, gl, calls } = fixture(options);
    renderer.render();
    assert.equal(calls.length, 1);
    assert.equal(gl.begins, 0);
    const snapshot = target.__renderTimingProbe;
    assert.equal(snapshot.events[0].gpuMs, null);
    assert.equal(snapshot.events[0].cpuMs, 3);
    assert.equal(snapshot.status, options.gpu === false ? 'cpu-only' : 'unsupported');
    assert.ok(snapshot.reason);
  }
});

test('disjoint results invalidate every outstanding query rather than reporting false zero times', () => {
  const { target, renderer, gl } = fixture();
  renderer.render();
  const copied = target.__renderTimingProbe;
  gl.disjoint = true; gl.available = true;
  renderer.render();
  assert.equal(gl.resultReads, 0);
  assert.equal(target.__renderTimingProbe.invalidated, 1);
  assert.ok(target.__renderTimingProbe.events.every(event => event.gpuMs === null && event.gpuStatus === 'disjoint'));
  assert.equal(copied.events[0].gpuStatus, 'pending', 'snapshots must be independent');
  gl.disjoint = false;
  renderer.render(); renderer.render();
  assert.equal(target.__renderTimingProbe.events[2].gpuStatus, 'valid');
});

test('a disjoint change or context loss while reading results invalidates them', () => {
  for (const kind of ['disjoint', 'lost']) {
    const { target, renderer, gl } = fixture();
    renderer.render(); gl.available = true;
    const original = gl.getQueryParameter;
    gl.getQueryParameter = function(query, parameter) {
      const result = original.call(this, query, parameter);
      if (parameter === this.QUERY_RESULT) this[kind] = true;
      return result;
    };
    renderer.render();
    assert.equal(target.__renderTimingProbe.events[0].gpuMs, null);
    assert.equal(target.__renderTimingProbe.events[0].gpuStatus, kind === 'lost' ? 'context-lost' : 'disjoint');
  }
});

test('pending query limits and another active query never cap or suppress real renders', () => {
  const { target, renderer, gl, calls } = fixture();
  for (let i = 0; i < 10; i++) renderer.render();
  assert.equal(calls.length, 10);
  assert.equal(target.__renderTimingProbe.created, 8);
  assert.equal(target.__renderTimingProbe.pending, 8);
  assert.equal(target.__renderTimingProbe.events.at(-1).gpuStatus, 'pending-limit');
  gl.available = true;
  renderer.render();
  assert.equal(target.__renderTimingProbe.created, 8);
  const externalQuery = {};
  gl.active = externalQuery;
  const begins = gl.begins, ends = gl.ends;
  renderer.render();
  assert.equal(gl.active, externalQuery);
  assert.equal(gl.begins, begins); assert.equal(gl.ends, ends);
  assert.equal(target.__renderTimingProbe.events.at(-1).gpuStatus, 'query-conflict');
});

test('nested renders do not nest GPU queries, and original exceptions still propagate', () => {
  const { target, renderer, gl, calls, failure } = fixture();
  renderer.recursive = true;
  renderer.render();
  assert.equal(calls.length, 2);
  assert.equal(gl.begins, 1); assert.equal(gl.ends, 1);
  renderer.fail = true;
  assert.throws(() => renderer.render(), error => error === failure);
  assert.equal(gl.begins, 2); assert.equal(gl.ends, 2);
  assert.equal(target.__renderTimingProbe.events.at(-1).gpuStatus, 'render-error');
  renderer.fail = false; gl.available = true;
  renderer.render();
  assert.equal(gl.resultReads, 1, 'a failed partial render must not produce a valid GPU time');
});

test('context loss is explicit, does not alter event handling, and leaves original rendering installed', () => {
  const { target, renderer, gl, listeners, calls } = fixture();
  renderer.render(); gl.lost = true;
  listeners.get('webglcontextlost')();
  renderer.render();
  assert.equal(calls.length, 2);
  assert.equal(target.__renderTimingProbe.status, 'context-lost');
  assert.equal(target.__renderTimingProbe.pending, 0);
  assert.ok(target.__renderTimingProbe.events.every(event => event.gpuMs === null));
  target.__stopRenderTimingProbe();
  assert.equal(listeners.size, 0);
});

test('stopping restores the exact original render method, releases handles and exposes unresolved results', () => {
  const { target, renderer, original, deleted } = fixture();
  renderer.render(); renderer.render();
  target.__stopRenderTimingProbe();
  assert.equal(renderer.render, original);
  assert.equal(deleted.length, 2);
  assert.equal(new Set(deleted).size, 2);
  assert.ok(target.__renderTimingProbe.events.every(event => event.gpuStatus === 'stopped-unresolved'));
  target.__stopRenderTimingProbe();
  assert.equal(deleted.length, 2);
  assert.throws(() => installRenderTimingProbe({}, target), /already installed/);
});

test('late GPU resolution keeps original window membership and real CPU-frame attribution', () => {
  const { target, renderer, gl } = fixture();
  const before = target.__renderTimingProbe;
  renderer.render();
  const atEnd = target.__renderTimingProbe;
  gl.available = true; renderer.render();
  const result = renderTimingWindow(before, atEnd, target.__renderTimingProbe,
    [{ serial: 7, renderStartedAt: 0, renderEndedAt: 4, intervalMs: 20 }, { intervalMs: 40 }]);
  assert.equal(result.renders, 1); assert.equal(result.validGpuSamples, 1);
  assert.equal(result.events[0].frameSerial, 7);
  assert.equal(result.events[0].followingIntervalMs, 40);
  result.events[0].gpuMs = 100;
  assert.equal(target.__renderTimingProbe.events[0].gpuMs, 2.5);
  assert.equal(renderTimingWindow(null, null, null), null);
  assert.throws(() => renderTimingWindow(before, null, null), /changed/);
});

test('ring overwrite and malformed probe options fail explicitly', () => {
  const { target, renderer } = fixture({ gpu: false });
  const before = target.__renderTimingProbe;
  for (let i = 0; i < before.capacity + 1; i++) renderer.render();
  assert.throws(() => renderTimingWindow(before, target.__renderTimingProbe, target.__renderTimingProbe), /overwrote/);
  assert.throws(() => installRenderTimingProbe({ gpu: '1' }, {}), TypeError);
});
