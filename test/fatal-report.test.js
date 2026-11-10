import test from 'node:test';
import assert from 'node:assert/strict';
import { createFatalReporter, makeFatalReport } from '../src/fatal-report.js';

const build = { commit: 'a'.repeat(40), dirty: true, builtAt: '2026-10-30T06:00:00.000Z', development: true };
function fixture(clipboard = { writeText: async () => {} }, onRecorded = () => {}) {
  const nodes = new Map();
  for (const id of ['world', 'loading', 'fatal', 'fatal-title', 'fatal-message', 'fatal-details', 'fatal-copy', 'fatal-copy-status']) {
    const node = new EventTarget();
    Object.assign(node, { hidden: true, textContent: '', value: '', focused: false, selected: false,
      focus() { this.focused = true; }, select() { this.selected = true; } });
    nodes.set(id, node);
  }
  const window = new EventTarget();
  window.navigator = { clipboard };
  let stopped = 0;
  const reporter = createFatalReporter({ document: { getElementById: id => nodes.get(id) }, window, build,
    getContext: () => ({ state: 'playing', time: 23, control: { soldierId: 'friendly-1' } }),
    onFatal: () => stopped++, onRecorded });
  const dispatch = (type, fields) => {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    window.dispatchEvent(event);
    return event;
  };
  return { reporter, nodes, window, dispatch, get stopped() { return stopped; } };
}

test('fatal report retains exact build, original error and minimal context without transmitting', () => {
  const error = new Error('<img src=x onerror=alert(1)>');
  const report = makeFatalReport({ kind: 'runtime', stage: 'battle', error, build,
    context: { time: 1.5 }, occurredAt: '2026-10-30T06:10:00.000Z' });
  const details = JSON.parse(report.text);
  assert.deepEqual(details.build, build);
  assert.equal(details.error.message, error.message);
  assert.equal(details.error.stack, error.stack);
  assert.equal(details.context.time, 1.5);
  assert.match(report.title, /作战/);
  assert.throws(() => makeFatalReport({ kind: 'ignored' }), RangeError);
});

test('a recorded local pose recovery does not activate the fatal overlay or stop combat, and is grouped rather than spammed', t => {
  const f = fixture(), warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const error = new Error('Native resting foot is unreachable: Left'); error.name = 'NativeGaitReachError';
  for (let i = 0; i < 20; i++) f.reporter.recordRecovery(error, { stage: 'native-gait', details: { side: 'Left' } });
  assert.equal(f.stopped, 0); assert.equal(f.reporter.failed, false);
  assert.equal(f.nodes.get('fatal').hidden, true);
  assert.equal(f.reporter.recoveries.length, 1); assert.equal(f.reporter.recoveries[0].count, 20);
  assert.equal(warnings.length, 1);
  const copy = f.reporter.recoveries; copy[0].count = 0;
  assert.equal(f.reporter.recoveries[0].count, 20);
});

test('startup failures keep their first diagnostic when the rethrow arrives globally', () => {
  const f = fixture();
  const error = new Error('material missing');
  f.reporter.show(error, { stage: 'scene-materials' });
  const original = f.nodes.get('fatal-details').value;
  f.dispatch('unhandledrejection', { reason: error });
  assert.equal(f.nodes.get('fatal-details').value, original);
  assert.equal(JSON.parse(original).kind, 'loading');
  assert.equal(JSON.parse(original).stage, 'scene-materials');
  assert.equal(f.nodes.get('fatal-title').textContent, '战场未能加载');
  assert.equal(f.nodes.get('fatal').hidden, false);
  assert.equal(f.nodes.get('loading').hidden, true);
  assert.equal(f.reporter.failed, true);
  assert.equal(f.stopped, 1);
});

test('image load events expose the failing asset path instead of [object Event], without query credentials', () => {
  const report = makeFatalReport({ kind: 'loading', stage: 'scene-materials', build, context: {},
    error: { type: 'error', target: { currentSrc: 'https://example.test/assets/brick.jpg?token=do-not-copy#fragment' } } });
  const details = JSON.parse(report.text);
  assert.equal(details.error.name, 'ResourceError');
  assert.match(details.error.message, /\/assets\/brick\.jpg$/);
  assert.equal(report.text.includes('do-not-copy'), false);
  assert.equal(report.text.includes('[object Event]'), false);
});

test('runtime errors and rejected promises after ready are recorded without blocking the battle', t => {
  t.mock.method(console, 'warn', () => {});
  for (const type of ['error', 'unhandledrejection']) {
    const f = fixture();
    f.reporter.ready();
    const error = new Error(type);
    f.dispatch(type, type === 'error' ? { error } : { reason: error });
    assert.equal(f.reporter.failed, false);
    assert.equal(f.nodes.get('fatal').hidden, true);
    assert.equal(f.reporter.recoveries[0].error.message, error.message);
    assert.equal(f.stopped, 0);
  }
});

test('both local recoveries and global runtime events reach the unified background logging hook', t => {
  t.mock.method(console, 'warn', () => {});
  const recorded = [], f = fixture(undefined, (...args) => recorded.push(args)), reporter = f.reporter;
  reporter.ready();
  reporter.recordRecovery(new Error('local animation'), { stage: 'battle', team: 'friendly' });
  f.dispatch('unhandledrejection', { reason: 'asynchronous audio failure' });
  assert.equal(recorded.length, 2);
  assert.equal(recorded[0][1].recovered, true);
  assert.equal(recorded[1][1].recovered, true);
  assert.equal(recorded[1][1].position, null);
  assert.equal(f.stopped, 0);
  assert.equal(f.nodes.get('fatal').hidden, true);
});

test('WebGL loss is explicit, prevents default, and cannot overwrite a prior crash', () => {
  for (const previousCrash of [false, true]) {
    const f = fixture();
    f.reporter.ready();
    if (previousCrash) f.reporter.show(new Error('original crash'));
    const event = new Event('webglcontextlost', { cancelable: true });
    f.nodes.get('world').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    const details = JSON.parse(f.nodes.get('fatal-details').value);
    assert.equal(details.kind, previousCrash ? 'runtime' : 'webgl');
    assert.equal(details.error.message, previousCrash ? 'original crash' : 'WebGL context lost');
    assert.equal(f.stopped, 1);
  }
});

test('copy is user-initiated; denied or absent clipboard exposes manual selection and an honest status', async () => {
  let copied = null;
  const success = fixture({ writeText: async text => { copied = text; } });
  success.reporter.show(new Error('copy test'));
  assert.equal(copied, null);
  success.nodes.get('fatal-copy').dispatchEvent(new Event('click'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, success.nodes.get('fatal-details').value);
  assert.match(success.nodes.get('fatal-copy-status').textContent, /已复制/);
  for (const clipboard of [null, { writeText: async () => { throw new Error('permission denied'); } }]) {
    const f = fixture(clipboard);
    f.reporter.show(new Error('copy failure'));
    f.nodes.get('fatal-copy').dispatchEvent(new Event('click'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.nodes.get('fatal-details').selected, true);
    assert.equal(f.nodes.get('fatal-details').focused, true);
    assert.match(f.nodes.get('fatal-copy-status').textContent, /自动复制失败.*Ctrl\+C/);
    assert.equal(f.stopped, 1);
  }
});
