import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/feedback.js';
import { FRAME_BUCKETS_MS } from '../src/performance-schema.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_feedback.sql', '0002_performance.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const db = { prepare(sql) {
    return { async first() { return sqlite.prepare(sql).get() ?? null; }, bind(...values) { return {
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async run() { return sqlite.prepare(sql).run(...values); },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    }; } };
  } };
  const token = 'performance-admin-test-'.repeat(3);
  const env = { FEEDBACK_DB: db, FEEDBACK_IP_SALT: 'performance-salt-test-'.repeat(3),
    FEEDBACK_ADMIN_TOKEN: token, PERFORMANCE_DIAGNOSTICS_ENABLED: 'true' };
  const histogram = FRAME_BUCKETS_MS.map(() => 0); histogram[2] = 100; histogram[9] = 1;
  const batch = () => ({ schemaVersion: 1, id: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    build: { commit: 'dca50fe', dirty: false, builtAt: '2026-11-02T10:00:00.000Z' },
    environment: { browser: 'Chrome', major: 156, platform: 'Windows', width: 1280, height: 720, dpr: 1 },
    delivery: { droppedFrames: 0, failedBatches: 0 },
    windows: [{ sequence: 0, durationMs: 5000, reason: 'interval', frames: 101, frameMs: [...histogram],
      maxFrameMs: 120, longFrames: 1, slowFrames: [], errors: {},
      scopes: { ai: { calls: 100, totalMs: 100, maxMs: 3, sampleEvery: 1 } },
      context: { map: 'taierzhuang-fort', state: 'playing', time: 90, quality: 'high', adaptiveLevel: 2,
        allies: 80, enemies: 50, corpses: 100, vehicles: 3, reinforcementWaves: 2,
        drawCalls: 400, triangles: 3000000, backlogSeconds: .1, simulationSteps: 2, unit: 'infantry' } }] });
  const post = (body, extra = {}) => new Request('https://game.test/api/performance', { method: 'POST',
    headers: { Origin: 'https://game.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...extra },
    body: JSON.stringify(body) });
  const get = path => new Request(`https://game.test${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { sqlite, env, batch, post, get };
}
test('loading breadcrumbs persist independently and never inflate battle FPS, CPU time or session counts', async () => {
  const f = fixture();
  try {
    const body = f.batch();
    const first = body.windows[0];
    Object.assign(first, { frames: 0, frameMs: FRAME_BUCKETS_MS.map(() => 0), longFrames: 0,
      maxFrameMs: 0, durationMs: 0, scopes: {} });
    Object.assign(first.context, { state: 'loading', stage: 'friendly-model', time: 0 });
    assert.equal((await worker.fetch(f.post(body), f.env)).status, 201);
    let summary = await (await worker.fetch(f.get('/api/performance/summary'), f.env)).json();
    assert.deepEqual(summary.groups, []);
    assert.equal(summary.loading[0].lastStage, 'friendly-model');
    assert.equal(summary.loading[0].ready, false);
    body.id = crypto.randomUUID(); first.sequence = 1; first.context.stage = 'ready'; first.context.time = 17;
    assert.equal((await worker.fetch(f.post(body), f.env)).status, 201);
    assert.equal((await worker.fetch(f.post(f.batch()), f.env)).status, 201);
    summary = await (await worker.fetch(f.get('/api/performance/summary'), f.env)).json();
    assert.equal(summary.groups.length, 1);
    assert.equal(summary.groups[0].frames, 101);
    assert.equal(summary.groups[0].windows, 1);
    assert.equal(summary.groups[0].sessions, 1);
    assert.equal(summary.loading.length, 1);
    assert.equal(summary.loading[0].ready, true);
    assert.equal(summary.loading[0].elapsedSeconds, 17);
    first.context.stage = 'private text'; body.id = crypto.randomUUID();
    assert.equal((await worker.fetch(f.post(body), f.env)).status, 400);
  } finally { f.sqlite.close(); }
});
test('automatic load counters deduplicate sessions across quality changes and reject invalid statistics', async () => {
  const f = fixture();
  try {
    const sessionId = crypto.randomUUID();
    for (const quality of ['high', 'low', 'low']) {
      const body = f.batch(); body.sessionId = sessionId;
      Object.assign(body.windows[0].context, { quality, automaticLoad: {
        level: 3, peak: 3, activations: 2, reductions: 4, recoveries: 1, activeSeconds: 80,
        aiReductions: 2, aiRecoveries: 1,
      } });
      assert.equal((await worker.fetch(f.post(body), f.env)).status, 201);
    }
    const legacy = f.batch();
    assert.equal((await worker.fetch(f.post(legacy), f.env)).status, 201);
    const summary = await (await worker.fetch(f.get('/api/performance/summary'), f.env)).json();
    assert.equal(summary.groups.length, 2);
    assert.equal(summary.automaticLoad.reportingSessions, 1);
    assert.equal(summary.automaticLoad.activations, 2);
    assert.equal(summary.automaticLoad.reductions, 4);
    assert.equal(summary.automaticLoad.activeSeconds, 80);
    assert.equal(summary.automaticLoad.aiReductions, 2);
    const invalid = f.batch(); invalid.windows[0].context.automaticLoad = {
      level: 4, peak: 3, activations: 2, reductions: 1, recoveries: 0, activeSeconds: 0,
      aiReductions: 0, aiRecoveries: 0,
    };
    assert.equal((await worker.fetch(f.post(invalid), f.env)).status, 400);
  } finally { f.sqlite.close(); }
});

test('production diagnostic ingestion persists, deduplicates receipts and keeps all reads authenticated', async () => {
  const f = fixture();
  try {
    const body = f.batch();
    assert.equal((await worker.fetch(f.post(body), f.env)).status, 201);
    assert.deepEqual(await (await worker.fetch(f.post(body), f.env)).json(), { id: body.id, saved: true });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM performance_batches').get().count, 1);
    body.windows[0].context.allies++;
    assert.equal((await worker.fetch(f.post(body), f.env)).status, 409);
    assert.equal((await worker.fetch(new Request('https://game.test/api/performance'), f.env)).status, 401);
    assert.equal((await worker.fetch(new Request('https://game.test/api/performance/summary'), f.env)).status, 401);
    const raw = await (await worker.fetch(f.get('/api/performance?limit=1'), f.env)).json();
    assert.equal(raw.items.length, 1); assert.equal(raw.hasMore, false);
    assert.equal(raw.items[0].batch.id, body.id);
    const summary = await (await worker.fetch(f.get('/api/performance/summary'), f.env)).json();
    assert.equal(summary.groups[0].frames, 101);
    assert.equal(summary.groups[0].p95UpperBoundMs, 16.7);
    assert.equal(summary.groups[0].sessions, 1);
    assert.equal(summary.groups[0].maximumCorpses, 100);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM feedback').get().count, 0);
  } finally { f.sqlite.close(); }
});
test('strict payloads, body size, origin, disabling and rate caps cannot bypass collection boundaries', async () => {
  const f = fixture();
  try {
    const privateBody = f.batch(); privateBody.contact = 'should not be stored';
    assert.equal((await worker.fetch(f.post(privateBody), f.env)).status, 400);
    assert.equal((await worker.fetch(f.post(f.batch(), { Origin: 'https://other.test' }), f.env)).status, 403);
    assert.equal((await worker.fetch(f.post(f.batch()), { ...f.env, PERFORMANCE_DIAGNOSTICS_ENABLED: 'false' })).status, 503);
    assert.equal((await worker.fetch(new Request('https://game.test/api/performance', { method: 'POST',
      headers: { Origin: 'https://game.test', 'Content-Type': 'application/json' }, body: 'x'.repeat(48001) }), f.env)).status, 413);
    for (let index = 0; index < 10; index++) assert.equal((await worker.fetch(f.post(f.batch()), f.env)).status, 201);
    assert.equal((await worker.fetch(f.post(f.batch()), f.env)).status, 429);
    assert.equal((await worker.fetch(f.get('/api/performance?limit=1000'), f.env)).status, 400);
    assert.equal((await worker.fetch(f.get('/api/performance/summary?since=invalid'), f.env)).status, 400);
    const page = await (await worker.fetch(f.get('/api/performance?limit=3'), f.env)).json();
    assert.equal(page.items.length, 3); assert.equal(page.hasMore, true);
    const next = await (await worker.fetch(f.get(`/api/performance?limit=3&after=${page.nextCursor}`), f.env)).json();
    assert.ok(next.items[0].sequence > page.nextCursor);
    assert.equal((await (await worker.fetch(f.get('/api/performance/status'), f.env)).json()).available, true);
  } finally { f.sqlite.close(); }
});
test('shared performance APIs store and filter independent Nanjing, Sihang and Taierzhuang reports', async () => {
  const f = fixture();
  try {
    for (const map of ['nanjing', 'sihang', 'taierzhuang-fort']) {
      const body = f.batch();
      body.windows[0].context.map = map;
      assert.equal((await worker.fetch(f.post(body), f.env)).status, 201);
    }
    const raw = await (await worker.fetch(f.get('/api/performance?map=nanjing'), f.env)).json();
    assert.equal(raw.items.length, 1);
    assert.equal(raw.items[0].batch.windows[0].context.map, 'nanjing');
    const sihang = await (await worker.fetch(f.get('/api/performance?map=sihang'), f.env)).json();
    assert.equal(sihang.items.length, 1);
    assert.equal(sihang.items[0].batch.windows[0].context.map, 'sihang');
    const summary = await (await worker.fetch(f.get('/api/performance/summary'), f.env)).json();
    assert.deepEqual(summary.groups.map(group => group.map).sort(), ['nanjing', 'sihang', 'taierzhuang-fort']);
  } finally { f.sqlite.close(); }
});
test('civilian combat counters round-trip and reject invalid counts while older batches remain valid', async () => {
  const f = fixture();
  try {
    const body = f.batch();
    Object.assign(body.windows[0].context, { map: 'nanjing', civilianCasualties: 3,
      civilianShots: 21, civilianAircraftHits: 4 });
    assert.equal((await worker.fetch(f.post(body), f.env)).status, 201);
    const raw = await (await worker.fetch(f.get('/api/performance?map=nanjing'), f.env)).json();
    const context = raw.items[0].batch.windows[0].context;
    assert.equal(context.civilianCasualties, 3);
    assert.equal(context.civilianShots, 21);
    assert.equal(context.civilianAircraftHits, 4);
    for (const name of ['civilianCasualties', 'civilianShots', 'civilianAircraftHits']) {
      for (const invalid of [-1, .5, 10000001, '2']) {
        const invalidBody = f.batch();
        invalidBody.windows[0].context[name] = invalid;
        assert.equal((await worker.fetch(f.post(invalidBody), f.env)).status, 400);
      }
    }
    assert.equal((await worker.fetch(f.post(f.batch()), f.env)).status, 201);
  } finally { f.sqlite.close(); }
});
test('daily scheduled retention removes old diagnostics only, without touching private feedback tables', async () => {
  const f = fixture();
  try {
    await worker.fetch(f.post(f.batch()), f.env);
    f.sqlite.prepare('UPDATE performance_batches SET created_at = ?').run('2020-01-01T00:00:00.000Z');
    await worker.scheduled({}, f.env);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM performance_batches').get().count, 0);
    assert.doesNotThrow(() => f.sqlite.prepare('SELECT COUNT(*) FROM feedback').get());
  } finally { f.sqlite.close(); }
});
test('summary truncation and the atomic daily write bound are explicit, not success-shaped fallbacks', async () => {
  const f = fixture();
  try {
    const insert = f.sqlite.prepare(`INSERT INTO performance_batches(id, session_id, build, map, created_at, fingerprint, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const created = new Date().toISOString();
    for (let index = 0; index < 1000; index++) {
      const body = f.batch();
      insert.run(body.id, body.sessionId, body.build.commit, body.windows[0].context.map, created, 'fixture', JSON.stringify(body));
    }
    const response = await (await worker.fetch(f.get('/api/performance/summary'), f.env)).json();
    assert.equal(response.truncated, true); assert.equal(response.reports, 250);
    assert.equal(response.groups[0].frames, 250 * 101);
    assert.equal((await worker.fetch(f.post(f.batch()), f.env)).status, 429);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM performance_batches').get().count, 1000);
    const empty = await (await worker.fetch(f.get('/api/performance?build=abcdef0'), f.env)).json();
    assert.equal(empty.items.length, 0);
  } finally { f.sqlite.close(); }
});
