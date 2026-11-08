import { validatePerformanceBatch, FRAME_BUCKETS_MS, PERFORMANCE_SCHEMA_VERSION, histogramPercentile } from '../src/performance-schema.js';

const retentionDays = 7, maximumBodyBytes = 48000, summaryLimit = 250, dailyReportLimit = 1000;
const json = (body, status = 200) => Response.json(body, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const hex = data => Array.from(new Uint8Array(data), value => value.toString(16).padStart(2, '0')).join('');
const fingerprint = async value => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
async function bodyText(request) {
  if (Number(request.headers.get('Content-Length')) > maximumBodyBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBodyBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return new TextDecoder().decode(bytes);
}
function filters(url) {
  const values = [], conditions = [];
  for (const [parameter, column, pattern] of [
    ['build', 'build', /^[a-f0-9]{7,40}$/], ['session', 'session_id', /^[a-f0-9-]{36}$/],
    ['map', 'map', /^(taierzhuang-fort|taierzhuang-streets|taierzhuang|nanjing|sihang)$/],
  ]) {
    const value = url.searchParams.get(parameter);
    if (value !== null) {
      if (!pattern.test(value)) throw new RangeError(`Invalid ${parameter}`);
      conditions.push(`${column} = ?`); values.push(value);
    }
  }
  const until = url.searchParams.get('until') ?? new Date().toISOString();
  const since = url.searchParams.get('since') ?? new Date(Date.now() - 86400000).toISOString();
  if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) ||
    Date.parse(since) > Date.parse(until) || Date.parse(until) - Date.parse(since) > retentionDays * 86400000) {
    throw new RangeError('Date range must be ordered and no longer than seven days');
  }
  conditions.push('created_at >= ?', 'created_at <= ?');
  values.push(new Date(since).toISOString(), new Date(until).toISOString());
  return { where: conditions.join(' AND '), values, since, until };
}
function summaries(rows) {
  const groups = new Map();
  for (const row of rows) {
    const batch = JSON.parse(row.payload);
    for (const window of batch.windows) {
      const { context } = window, env = batch.environment;
      if (context.state === 'loading') continue;
      const key = [batch.build.commit, batch.build.dirty, batch.build.builtAt, context.map, context.quality, env.browser, env.major,
        env.platform, env.width, env.height, env.dpr].join(':');
      if (!groups.has(key)) groups.set(key, {
        build: batch.build, map: context.map, quality: context.quality, environment: env,
        sessions: new Set(), windows: 0, frames: 0, durationMs: 0, longFrames: 0,
        histogram: FRAME_BUCKETS_MS.map(() => 0), scopes: {}, maximumBacklogSeconds: 0, maximumCorpses: 0,
        maximumAlive: 0, maximumAdaptiveLevel: 0,
      });
      const group = groups.get(key);
      group.sessions.add(batch.sessionId); group.windows++; group.frames += window.frames;
      group.durationMs += window.durationMs; group.longFrames += window.longFrames;
      group.maximumBacklogSeconds = Math.max(group.maximumBacklogSeconds, context.backlogSeconds);
      group.maximumCorpses = Math.max(group.maximumCorpses, context.corpses);
      group.maximumAlive = Math.max(group.maximumAlive, context.allies + context.enemies);
      group.maximumAdaptiveLevel = Math.max(group.maximumAdaptiveLevel, context.adaptiveLevel);
      window.frameMs.forEach((count, index) => { group.histogram[index] += count; });
      for (const [name, scope] of Object.entries(window.scopes)) {
        const total = group.scopes[name] ??= { calls: 0, totalMs: 0, maxMs: 0, sampleEvery: scope.sampleEvery };
        total.calls += scope.calls; total.totalMs += scope.totalMs; total.maxMs = Math.max(total.maxMs, scope.maxMs);
      }
    }
  }
  return [...groups.values()].map(group => ({ ...group, sessions: group.sessions.size,
    p50UpperBoundMs: histogramPercentile(group.histogram, .5),
    p95UpperBoundMs: histogramPercentile(group.histogram, .95),
    p99UpperBoundMs: histogramPercentile(group.histogram, .99) }));
}
function loadingSummaries(rows) {
  const sessions = new Map();
  for (const row of rows) {
    const batch = JSON.parse(row.payload);
    for (const window of batch.windows) {
      if (window.context.state !== 'loading') continue;
      const key = `${batch.sessionId}:${window.context.map}`;
      const previous = sessions.get(key);
      if (previous && previous.sequence >= window.sequence) continue;
      sessions.set(key, { sessionId: batch.sessionId, sequence: window.sequence, build: batch.build,
        map: window.context.map, quality: window.context.quality, environment: batch.environment,
        lastStage: window.context.stage ?? null, elapsedSeconds: window.context.time,
        ready: window.context.stage === 'ready' });
    }
  }
  return [...sessions.values()];
}
function automaticLoadSummary(rows) {
  const sessions = new Map();
  for (const row of rows) {
    const batch = JSON.parse(row.payload);
    for (const window of batch.windows) {
      const load = window.context.automaticLoad;
      if (!load || window.context.state === 'loading') continue;
      const previous = sessions.get(batch.sessionId);
      if (!previous) sessions.set(batch.sessionId, { ...load });
      else for (const key of ['peak', 'activations', 'reductions', 'recoveries', 'activeSeconds', 'aiReductions', 'aiRecoveries'])
        previous[key] = Math.max(previous[key], load[key]);
    }
  }
  const values = [...sessions.values()];
  return { reportingSessions: values.length,
    sessionsWithGraphicsReduction: values.filter(value => value.peak > 0).length,
    maximumLevel: Math.max(0, ...values.map(value => value.peak)),
    ...Object.fromEntries(['activations', 'reductions', 'recoveries', 'activeSeconds', 'aiReductions', 'aiRecoveries']
      .map(key => [key, values.reduce((sum, value) => sum + value[key], 0)])),
    counting: 'Per-session maximum cumulative counters, not a sum of repeated windows. Partial/date-filtered sessions may include earlier activity; undelivered final counters are not recoverable.' };
}
export async function handlePerformance(request, env, authorized) {
  const url = new URL(request.url);
  const enabled = env.PERFORMANCE_DIAGNOSTICS_ENABLED === 'true';
  const configured = Boolean(env.FEEDBACK_DB && typeof env.FEEDBACK_IP_SALT === 'string' && env.FEEDBACK_IP_SALT.length >= 32);
  if (url.pathname === '/api/performance/status' && request.method === 'GET') {
    if (enabled && configured) await env.FEEDBACK_DB.prepare('SELECT sequence FROM performance_batches LIMIT 1').first();
    return json({ available: enabled && configured, schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      runtimeErrorDetails: true, retentionDays, windowSeconds: 5, uploadSeconds: 30, maximumBodyBytes });
  }
  if (!['/api/performance', '/api/performance/summary'].includes(url.pathname)) return json({ error: 'Not found' }, 404);
  if (request.method === 'GET') {
    if (!await authorized(request, env.FEEDBACK_ADMIN_TOKEN)) return json({ error: 'Unauthorized' }, 401);
    if (!configured) return json({ error: 'Performance database unavailable' }, 503);
    let query;
    try { query = filters(url); } catch (error) { return json({ error: error.message }, 400); }
    if (url.pathname === '/api/performance/summary') {
      const { results } = await env.FEEDBACK_DB.prepare(`SELECT sequence, payload FROM performance_batches
        WHERE ${query.where} ORDER BY sequence ASC LIMIT ?`).bind(...query.values, summaryLimit + 1).all();
      const included = results.slice(0, summaryLimit);
      return json({ schemaVersion: 1, since: query.since, until: query.until, reports: included.length,
        truncated: results.length > summaryLimit, nextCursor: included.at(-1)?.sequence ?? 0,
        histogramBoundsMs: FRAME_BUCKETS_MS, groups: summaries(included), loading: loadingSummaries(included),
        automaticLoad: automaticLoadSummary(included),
        notice: 'Percentiles are merged-histogram upper bounds, not averaged FPS. Scope timings overlap. calls counts timed samples; sampleEvery=32 totals cover sampled calls only, not total CPU time. CPU render submission is not GPU execution. Truncated results are partial; export raw pages for full aggregation.' });
    }
    const after = url.searchParams.get('after') ?? '0', limit = url.searchParams.get('limit') ?? '50';
    if (!/^(0|[1-9]\d{0,14})$/.test(after) || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100) {
      return json({ error: 'Invalid cursor or limit' }, 400);
    }
    const { results } = await env.FEEDBACK_DB.prepare(`SELECT sequence, id, created_at, payload FROM performance_batches
      WHERE ${query.where} AND sequence > ? ORDER BY sequence ASC LIMIT ?`)
      .bind(...query.values, +after, +limit + 1).all();
    const rows = results.slice(0, +limit);
    return json({ schemaVersion: 1, items: rows.map(row => ({ sequence: row.sequence, id: row.id,
      createdAt: row.created_at, batch: JSON.parse(row.payload) })),
    nextCursor: rows.at(-1)?.sequence ?? +after, hasMore: results.length > +limit });
  }
  if (request.method !== 'POST' || url.pathname !== '/api/performance') return json({ error: 'Method not allowed' }, 405);
  if (!enabled || !configured) return json({ error: 'Performance collection disabled' }, 503);
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({ error: 'Same-origin diagnostics required' }, 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'JSON required' }, 415);
  const text = await bodyText(request);
  if (text === null) return json({ error: 'Batch too large' }, 413);
  let batch;
  try { batch = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const invalid = validatePerformanceBatch(batch);
  if (invalid) return json({ error: invalid }, 400);
  if (batch.windows.some(window => window.context.map !== batch.windows[0].context.map)) return json({ error: 'Mixed maps in batch' }, 400);
  const serialized = JSON.stringify(batch), hash = await fingerprint(serialized);
  const existing = await env.FEEDBACK_DB.prepare('SELECT fingerprint FROM performance_batches WHERE id = ?').bind(batch.id).first();
  if (existing) return existing.fingerprint === hash ? json({ id: batch.id, saved: true }) : json({ error: 'Conflicting batch identity' }, 409);
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) throw new Error('CF-Connecting-IP missing for performance ingestion');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.FEEDBACK_IP_SALT),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const minute = Math.floor(Date.now() / 60000);
  const client = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`performance:${minute}:${ip}`)));
  const allowed = await env.FEEDBACK_DB.prepare(`INSERT INTO performance_limits(client_hash, minute, count) VALUES (?, ?, 1)
    ON CONFLICT(client_hash) DO UPDATE SET count = performance_limits.count + 1
    WHERE performance_limits.count < 10 RETURNING client_hash`).bind(client, minute).first();
  if (!allowed) return json({ error: 'Diagnostic rate limit exceeded' }, 429);
  const inserted = await env.FEEDBACK_DB.prepare(`INSERT INTO performance_batches(id, session_id, build, map, created_at, fingerprint, payload)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM performance_batches WHERE created_at >= ?) < ?
    ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(batch.id, batch.sessionId, batch.build.commit, batch.windows[0].context.map,
      new Date().toISOString(), hash, serialized, new Date().toISOString().slice(0, 10), dailyReportLimit).first();
  if (!inserted) {
    const row = await env.FEEDBACK_DB.prepare('SELECT fingerprint FROM performance_batches WHERE id = ?').bind(batch.id).first();
    if (!row) return json({ error: 'Daily diagnostic collection cap reached' }, 429);
    if (row.fingerprint !== hash) return json({ error: 'Conflicting batch identity' }, 409);
  }
  await env.FEEDBACK_DB.prepare('DELETE FROM performance_batches WHERE created_at < ?')
    .bind(new Date(Date.now() - retentionDays * 86400000).toISOString()).run();
  await env.FEEDBACK_DB.prepare('DELETE FROM performance_limits WHERE minute < ?').bind(minute - 60).run();
  return json({ id: batch.id, saved: true }, inserted ? 201 : 200);
}

export async function cleanupPerformance(env) {
  if (!env.FEEDBACK_DB) return;
  await env.FEEDBACK_DB.prepare('DELETE FROM performance_batches WHERE created_at < ?')
    .bind(new Date(Date.now() - retentionDays * 86400000).toISOString()).run();
  await env.FEEDBACK_DB.prepare('DELETE FROM performance_limits WHERE minute < ?')
    .bind(Math.floor(Date.now() / 60000) - 60).run();
}
