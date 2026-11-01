import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateFeedback } from '../worker/feedback.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const payload = () => ({ id: crypto.randomUUID(), category: 'suggestion', content: 'Please improve the gameplay',
  contact: '', website: '', context: { build: 'local', map: 'taierzhuang-fort', state: 'dead', browser: 'Chrome', viewport: '1280x720' } });
test('feedback validates both real stages and rejects missing or oversized private inputs', () => {
  assert.equal(validateFeedback(payload()), null);
  for (const map of ['taierzhuang', 'taierzhuang-streets', 'taierzhuang-fort']) {
    const value = payload(); value.context.map = map; assert.equal(validateFeedback(value), null);
  }
  const bad = payload(); bad.context.map = 'shanghai'; assert.ok(validateFeedback(bad));
  bad.context.map = 'taierzhuang-fort'; bad.contact = 'secret\nvalue'; assert.ok(validateFeedback(bad));
  bad.contact = ''; bad.content = 'x'.repeat(2001); assert.ok(validateFeedback(bad));
});
test('unconfigured feedback is explicitly unavailable and assets still pass through', async () => {
  const env = { ASSETS: { fetch: () => new Response('asset') } };
  assert.deepEqual(await (await worker.fetch(new Request('https://game.test/api/feedback/status'), env)).json(), { available: false });
  assert.equal(await (await worker.fetch(new Request('https://game.test/'), env)).text(), 'asset');
  const request = new Request('https://game.test/api/feedback', { method: 'POST', headers: {
    Origin: 'https://game.test', 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
  assert.equal((await worker.fetch(request, env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://game.test/api/feedback'), env)).status, 401);
});
test('cross-origin feedback cannot write to private storage', async () => {
  const request = new Request('https://game.test/api/feedback', { method: 'POST', headers: {
    Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
  assert.equal((await worker.fetch(request, {})).status, 403);
});

test('real SQL stores one private row, deduplicates receipts and rate-limits the next request', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_feedback.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    return { async first() { return sqlite.prepare(sql).get() ?? null; }, bind(...values) { return {
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async run() { return sqlite.prepare(sql).run(...values); },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    }; } };
  } };
  const env = { FEEDBACK_DB: db, FEEDBACK_IP_SALT: 'test-fixture-salt-'.repeat(3), FEEDBACK_ADMIN_TOKEN: 'test-fixture-admin-'.repeat(3) };
  const post = value => new Request('https://game.test/api/feedback', { method: 'POST', headers: {
    Origin: 'https://game.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(value) });
  try {
    const value = payload();
    const response = await worker.fetch(post(value), env);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: value.id, saved: true });
    assert.deepEqual(await (await worker.fetch(post(value), env)).json(), { id: value.id, saved: true });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM feedback').get().count, 1);
    assert.equal((await worker.fetch(post(payload()), env)).status, 429);
    value.content = 'changed replay payload';
    assert.equal((await worker.fetch(post(value), env)).status, 409);
    const unauthorized = await worker.fetch(new Request('https://game.test/api/feedback'), env);
    assert.equal(unauthorized.status, 401);
    const list = await worker.fetch(new Request('https://game.test/api/feedback', {
      headers: { Authorization: `Bearer ${env.FEEDBACK_ADMIN_TOKEN}` } }), env);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).items.length, 1);
    assert.deepEqual(await (await worker.fetch(new Request('https://game.test/api/feedback/status'), env)).json(), { available: true });
  } finally { sqlite.close(); }
});
