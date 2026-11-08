import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceDiagnostics, performanceEnvironment } from '../src/performance-diagnostics.js';
import { validatePerformanceBatch, FRAME_BUCKETS_MS, histogramPercentile, sanitizedRuntimeError } from '../src/performance-schema.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(send) {
  let time = 0;
  const sent = [], warnings = [];
  const context = { map: 'taierzhuang-fort', state: 'playing', time: 90, quality: 'high', adaptiveLevel: 2,
    allies: 80, enemies: 50, corpses: 100, vehicles: 3, reinforcementWaves: 2,
    drawCalls: 400, triangles: 3000000, backlogSeconds: .1, simulationSteps: 2, unit: 'infantry' };
  const diagnostics = createPerformanceDiagnostics({
    build: { commit: 'dca50fe', dirty: false, builtAt: '2026-11-02T10:00:00.000Z' },
    environment: { browser: 'Chrome', major: 156, platform: 'Windows', width: 1280, height: 720, dpr: 1 },
    now: () => time, warn: (...args) => warnings.push(args),
    send: async payload => {
      sent.push(payload);
      return send ? send(payload) : Response.json({ id: payload.id, saved: true }, { status: 201 });
    },
  });
  diagnostics.setContext(() => ({ ...context }));
  return { diagnostics, sent, context, warnings,
    advance(milliseconds) { time += milliseconds; },
    frame(ms = 16.7, callbackMs = 2) {
      diagnostics.beginFrame(ms, context.state);
      diagnostics.measure('render', () => { time += callbackMs; });
      diagnostics.finishFrame(context.state);
    } };
}

test('recoverable errors reach the opt-in private diagnostic batch as bounded anonymous signatures, not raw stacks or messages', async () => {
  const f = fixture(), error = new Error('private-player-name and secret credential must not be sent');
  error.name = 'NativeGaitReachError';
  error.stack = 'NativeGaitReachError\n at sample (https://game.test/assets/nra-gait-abc.js:12:34)\n at hidden (https://game.test/file.js?token=secret:1:2)';
  const details = { recovered: true, stage: 'native-gait', side: 'Left', team: 'enemy',
    position: [-14.292, 0, 27.4401] };
  f.diagnostics.runtimeError(error, details); f.diagnostics.flush();
  assert.equal(f.sent.length, 0, 'no upload without existing diagnostic opt-in');
  f.diagnostics.setEnabled(true);
  for (let i = 0; i < 3; i++) f.diagnostics.runtimeError(error, details);
  f.diagnostics.error('pose-recovered'); f.diagnostics.flush();
  await settle();
  const batch = f.sent[0];
  assert.equal(validatePerformanceBatch(batch), null);
  const item = batch.windows[0].runtimeErrors[0];
  assert.equal(item.count, 3); assert.equal(item.code, 'native-gait-reach');
  assert.deepEqual(item.position, [-14.3, 0, 27.4]);
  assert.deepEqual(item.frames, ['nra-gait-abc.js:12:34']);
  assert.equal(batch.windows[0].errors['pose-recovered'], 1);
  const text = JSON.stringify(batch);
  assert.ok(!text.includes('private-player-name') && !text.includes('secret') && !text.includes('https://game.test'));
  const sanitized = sanitizedRuntimeError(new TypeError("Cannot read properties of undefined (reading 'bolt')"),
    { recovered: false, stage: 'battle' });
  assert.equal(sanitized.code, 'equipment-view-metadata');
  f.diagnostics.setEnabled(false);
});
test('opt-in startup markers upload before combat context exists, use bounded stages and contain no battle samples', async () => {
  const f = fixture();
  const context = { map: 'nanjing', quality: 'high', stage: 'friendly-model' };
  f.diagnostics.recordLoading(context);
  assert.equal(f.sent.length, 0);
  f.diagnostics.setEnabled(true);
  f.diagnostics.recordLoading(context);
  await settle();
  assert.equal(f.sent.length, 1);
  assert.equal(validatePerformanceBatch(f.sent[0]), null);
  assert.equal(f.sent[0].windows[0].context.state, 'loading');
  assert.equal(f.sent[0].windows[0].context.stage, 'friendly-model');
  assert.equal(f.sent[0].windows[0].frames, 0);
  assert.deepEqual(f.sent[0].windows[0].scopes, {});
  f.advance(1500);
  f.diagnostics.recordLoading({ ...context, stage: 'friendly-poses' });
  f.diagnostics.flush();
  await settle();
  assert.equal(f.sent[1].windows[0].context.time, 1.5);
  assert.equal(validatePerformanceBatch(f.sent[1]), null);
  assert.throws(() => f.diagnostics.recordLoading({ ...context, stage: 'private text' }), /Invalid loading/);
  f.diagnostics.setEnabled(false);
  assert.equal(f.diagnostics.snapshot.queuedWindows, 0);
});
test('diagnostics collect nothing until enabled, then upload bounded validated anonymous windows with a receipt', async () => {
  const f = fixture();
  for (let index = 0; index < 8; index++) { f.advance(5001); f.frame(); }
  assert.equal(f.sent.length, 0);
  f.diagnostics.setEnabled(true);
  f.frame();
  for (let index = 0; index < 6; index++) {
    f.advance(5001); f.frame(index === 2 ? 150 : 16.7);
  }
  await settle();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].windows.length, 6);
  assert.equal(validatePerformanceBatch(f.sent[0]), null);
  assert.equal(f.diagnostics.snapshot.savedWindows, 6);
  assert.equal(f.sent[0].windows[2].longFrames, 1);
  assert.equal(f.sent[0].windows[2].slowFrames.length, 1);
  assert.deepEqual(f.warnings, []);
});

test('each new opt-in session resets owner counters once without resetting them for normal time windows', async () => {
  const f = fixture();
  let starts = 0;
  f.diagnostics.setContext(() => ({ ...f.context }), { onSessionStart() { starts++; } });
  f.diagnostics.setEnabled(true);
  assert.equal(starts, 1);
  f.frame(); f.advance(5001); f.frame(); f.diagnostics.flush(); await settle();
  assert.equal(starts, 1);
  f.diagnostics.setEnabled(false); f.diagnostics.setEnabled(true);
  assert.equal(starts, 2);
  f.diagnostics.setEnabled(false);
});
test('returning from a hidden tab does not upload background elapsed time as a gameplay stall', async () => {
  const f = fixture();
  f.diagnostics.setEnabled(true); f.frame(); f.frame(16);
  f.diagnostics.suspend('hidden'); await settle();
  f.advance(60000); f.frame(60000);
  f.diagnostics.flush(); await settle();
  assert.equal(f.sent.at(-1).windows[0].maxFrameMs, 0);
  assert.equal(f.sent.at(-1).windows[0].longFrames, 0);
});
test('stage labels and civilian timing survive ingestion while old contexts remain valid',async()=>{
  const f=fixture();f.context.map='nanjing';f.context.stage='dock-defense';
  f.diagnostics.setEnabled(true);
  f.diagnostics.beginFrame(16,'playing');
  f.diagnostics.measure('civilians',()=>f.advance(8));
  f.diagnostics.finishFrame('playing');f.diagnostics.flush();await settle();
  const payload=f.sent[0];
  assert.equal(validatePerformanceBatch(payload),null);
  assert.equal(payload.windows[0].context.stage,'dock-defense');
  assert.equal(payload.windows[0].scopes.civilians.totalMs,8);
  for (const stage of ['sihang-defense', 'sihang-retreat']) {
    payload.windows[0].context.map = 'sihang'; payload.windows[0].context.stage = stage;
    assert.equal(validatePerformanceBatch(payload), null);
  }
  delete payload.windows[0].context.stage;
  assert.equal(validatePerformanceBatch(payload),null);
  payload.windows[0].context.stage='arbitrary player text';
  assert.match(validatePerformanceBatch(payload),/Invalid performance window/);
});
test('high-frequency timers sample every 32 calls, do not advance gameplay, and label sampled counts', async () => {
  const f = fixture();
  f.diagnostics.setEnabled(true); f.diagnostics.beginFrame(16, 'playing');
  let operations = 0;
  for (let index = 0; index < 64; index++) f.diagnostics.measure('steering', () => { operations++; f.advance(1); });
  f.diagnostics.finishFrame('playing'); f.diagnostics.flush();
  await settle();
  assert.equal(operations, 64);
  assert.deepEqual(f.sent[0].windows[0].scopes.steering, { calls: 2, totalMs: 2, maxMs: 1, sampleEvery: 32 });
});
test('pause and background frames are not timed as battle; close flushes a partial window and opt-out discards unsent data', async () => {
  const f = fixture();
  f.diagnostics.setEnabled(true); f.frame(); f.frame();
  f.context.state = 'pause'; f.advance(2000); f.frame(2000);
  f.diagnostics.flush('pause'); await settle();
  assert.equal(f.sent[0].windows[0].frames, 1);
  f.context.state = 'playing';
  f.diagnostics.beginFrame(1000, 'playing', false); f.diagnostics.finishFrame('playing');
  f.diagnostics.setEnabled(false); f.diagnostics.flush('pagehide'); await settle();
  assert.equal(f.sent.length, 1);
  assert.equal(f.diagnostics.snapshot.sessionId, null);
});
test('network failures and invalid receipts are explicit and cannot create infinite retries', async () => {
  for (const send of [() => { throw new TypeError('network'); }, payload => Response.json({ id: payload.id, saved: false })]) {
    const f = fixture(send);
    f.diagnostics.setEnabled(true); f.frame(); f.frame(); f.diagnostics.flush(); await settle();
    assert.equal(f.diagnostics.snapshot.savedWindows, 0);
    assert.equal(f.diagnostics.snapshot.failedBatches, 1);
    assert.ok(f.diagnostics.snapshot.droppedFrames > 0);
    f.diagnostics.flush(); await settle(); assert.equal(f.sent.length, 1);
    assert.match(f.diagnostics.snapshot.status, /未确认/);
  }
});
test('strict schema rejects private fields, arbitrary strings, corrupt histograms and invalid timings', async () => {
  const f = fixture();
  f.diagnostics.setEnabled(true); f.frame(); f.diagnostics.flush(); await settle();
  for (const change of [
    batch => { batch.contact = 'private'; },
    batch => { batch.environment.userAgent = 'full fingerprint'; },
    batch => { batch.windows[0].context.position = [1, 2, 3]; },
    batch => { batch.windows[0].frameMs[0]++; },
    batch => { batch.windows[0].scopes.render.totalMs = NaN; },
    batch => { batch.windows[0].context.allies = -1; },
    batch => { batch.windows[0].context.state = 'arbitrary text'; },
    batch => { batch.windows.push({ ...batch.windows[0] }); },
    batch => { batch.schemaVersion = 2; },
  ]) {
    const batch = structuredClone(f.sent[0]); change(batch);
    assert.ok(validatePerformanceBatch(batch));
  }
  const hist = FRAME_BUCKETS_MS.map(() => 0); hist[0] = 100; hist[9] = 1;
  assert.equal(histogramPercentile(hist, .95), 8, 'merge frame counts, never average per-window FPS or medians');
  assert.equal(histogramPercentile(FRAME_BUCKETS_MS.map(() => 0), .5), null);
});
test('coarse environment omits exact user agents, GPU IDs and persistent fingerprints', () => {
  assert.deepEqual(performanceEnvironment({ userAgent: 'Mozilla Windows Chrome/156.0 Edg/156.0' }, 1280, 720, 1),
    { browser: 'Edge', major: 156, platform: 'Windows', width: 1280, height: 720, dpr: 1 });
});
