import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeErrorReporter } from '../src/runtime-error-reporter.js';
import { sanitizedRuntimeError, validatePerformanceBatch } from '../src/performance-schema.js';
import { createPerformanceDiagnostics } from '../src/performance-diagnostics.js';

const build = { commit: 'a'.repeat(40), dirty: false, builtAt: '2026-11-09T12:00:00Z' };
const environment = { browser: 'Chrome', major: 130, platform: 'Windows', width: 1280, height: 720, dpr: 1 };
const context = { map: 'nanjing', state: 'playing', quality: 'low', time: 45 };
const settle = () => new Promise(resolve => setImmediate(resolve));
test('automatic errors upload without performance opt-in, contain no frame samples and use the existing validated backend shape', async () => {
  const sent = [], diagnostics = createPerformanceDiagnostics({ build, environment, automaticRuntimeErrors: true,
    send: async payload => { sent.push(payload); return Response.json({ id: payload.id, saved: true }); } });
  diagnostics.setContext(() => context);
  const error = new Error('private text must stay local'); error.code = 'pose-geometry';
  diagnostics.runtimeError(error, { stage: 'character-pose', recovered: true, team: 'enemy' });
  await settle();
  assert.equal(diagnostics.enabled, false); assert.equal(sent.length, 1);
  assert.equal(validatePerformanceBatch(sent[0]), null);
  const window = sent[0].windows[0];
  assert.equal(window.frames, 0); assert.deepEqual(window.scopes, {});
  assert.equal(window.runtimeErrors[0].code, 'pose-geometry');
  assert.equal(JSON.stringify(sent).includes('private text'), false);
});

test('repeated runtime errors are aggregated and rate limited, and failed registration never rejects into the game', async () => {
  let time = 0;
  const sent = [], warnings = [];
  const reporter = createRuntimeErrorReporter({ build, environment, now: () => time,
    uuid: () => crypto.randomUUID(), getContext: () => context, warn: (...args) => warnings.push(args),
    send: async payload => { sent.push(payload); return Response.json({ id: payload.id, saved: true }); } });
  const entry = () => sanitizedRuntimeError(new Error('same error'), { recovered: true, stage: 'battle' });
  reporter.record(entry()); await settle();
  for (let i = 0; i < 50; i++) reporter.record(entry());
  assert.equal(sent.length, 1);
  time = 31000; await reporter.flush();
  assert.equal(sent.length, 2); assert.equal(sent[1].windows[0].runtimeErrors[0].count, 50);
  const offline = createRuntimeErrorReporter({ build, environment, now: () => 0,
    uuid: () => crypto.randomUUID(), getContext: () => context, warn: (...args) => warnings.push(args),
    send: async () => { throw new Error('offline'); } });
  assert.doesNotThrow(() => offline.record(entry())); await settle();
  assert.equal(warnings.length, 1);
});
