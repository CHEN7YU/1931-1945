import { FRAME_BUCKETS_MS, PERFORMANCE_SCHEMA_VERSION, PERFORMANCE_SCOPES, PERFORMANCE_SCOPE_SAMPLE_EVERY,
  PERFORMANCE_MAPS, PERFORMANCE_LOADING_STAGES, sanitizedRuntimeError } from './performance-schema.js';
import { createRuntimeErrorReporter } from './runtime-error-reporter.js';

const STORAGE_KEY = 'shanhe.performance-diagnostics.v1';
const activeStates = new Set(['playing', 'transferring', 'dead']);
const emptyScopes = () => ({});
const addScope = (scopes, name, elapsed) => {
  const entry = scopes[name] ??= { calls: 0, totalMs: 0, maxMs: 0, sampleEvery: PERFORMANCE_SCOPE_SAMPLE_EVERY[name] ?? 1 };
  entry.calls++; entry.totalMs += elapsed; entry.maxMs = Math.max(entry.maxMs, elapsed);
};
export function performanceEnvironment(navigator, width, height, dpr) {
  const ua = navigator.userAgent;
  const match = ua.match(/(Edg)\/(\d+)/) ?? ua.match(/(Chrome|Firefox|Version)\/(\d+)/);
  return {
    browser: match ? ({ Edg: 'Edge', Chrome: 'Chrome', Firefox: 'Firefox', Version: 'Safari' })[match[1]] : 'Other',
    major: match ? Number(match[2]) : 0,
    platform: /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' :
      /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other',
    width, height, dpr,
  };
}
export function createPerformanceDiagnostics({ build, environment, now = () => performance.now(),
  send = (payload, signal) => fetch('/api/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), keepalive: true, signal }),
  uuid = () => crypto.randomUUID(), changed = () => {}, warn = console.warn, automaticRuntimeErrors = false } = {}) {
  let enabled = false, context = null, sessionStarted = null, sequence = 0, sessionId = uuid(), started = now(), current = null;
  let frameScopes = emptyScopes(), frameStarted = 0, intervalMs = 0, queue = [], pending = null, controller = null;
  let recording = false;
  let previousFrame = null;
  let runtimeLimitWarned = false;
  let loadingStarted = null, loadingTimer = null;
  const scopeSerial = {};
  let lastSend = now(), saved = 0, dropped = 0, failures = 0, status = '未开启性能诊断', generation = 0;
  const readContext = () => context?.();
  let loadingContext = null;
  const runtimeReporter = automaticRuntimeErrors ? createRuntimeErrorReporter({
    build, environment, send, uuid, now, getContext: () => readContext() ?? loadingContext, warn }) : null;
  const notify = message => { status = message; changed(); };
  const window = () => current ??= {
    sequence: sequence++, durationMs: 0, reason: 'interval', frames: 0,
    frameMs: FRAME_BUCKETS_MS.map(() => 0), maxFrameMs: 0, longFrames: 0,
    scopes: emptyScopes(), slowFrames: [], errors: {},
  };
  function collect(reason) {
    if (!current) return;
    const snapshot = readContext();
    if (!snapshot) return;
    current.durationMs = Math.max(0, Math.min(120000, current.durationMs));
    current.reason = reason; current.context = snapshot;
    queue.push(current); current = null; started = now(); runtimeLimitWarned = false;
    if (queue.length > 12) { dropped += queue.shift().frames; warn('Performance diagnostics queue full; oldest unsent window dropped'); }
  }
  async function upload() {
    if (!enabled || pending || !queue.length) return;
    const revision = generation;
    const payload = { schemaVersion: PERFORMANCE_SCHEMA_VERSION, id: uuid(), sessionId, build, environment,
      delivery: { droppedFrames: dropped, failedBatches: failures },
      windows: queue.splice(0, 6) };
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 10000);
    pending = payload;
    try {
      const response = await send(payload, requestController.signal);
      if (revision !== generation) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const receipt = await response.json();
      if (receipt.saved !== true || receipt.id !== payload.id) throw new Error('Invalid diagnostic receipt');
      saved += payload.windows.length; failures = 0; notify(`性能诊断采集中 · 已保存${saved}个时间窗`);
    } catch (error) {
      if (revision !== generation) return;
      failures++; dropped += payload.windows.reduce((sum, item) => sum + item.frames, 0);
      warn('Performance diagnostics upload failed; no automatic replay of uncertain batches', error);
      notify('性能诊断上传未确认 · 游戏继续，稍后仅尝试新数据');
    } finally {
      clearTimeout(timeout);
      if (revision === generation) {
        pending = controller = null; changed();
        if (queue.some(item => item.context.state === 'loading')) scheduleLoadingUpload();
      }
    }
  }
  function scheduleLoadingUpload() {
    if (loadingTimer !== null) return;
    loadingTimer = setTimeout(() => {
      loadingTimer = null;
      if (!enabled) return;
      lastSend = now(); void upload();
    }, Math.max(0, 10000 - (now() - lastSend)));
  }
  return {
    setEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('Diagnostics activity must be explicit');
      if (enabled === value) return;
      generation++; enabled = value; controller?.abort(); pending = controller = null;
      clearTimeout(loadingTimer); loadingTimer = null; loadingStarted = null;
      recording = false;
      previousFrame = null;
      queue = []; current = null; frameScopes = emptyScopes(); started = lastSend = now();
      if (value) {
        sessionId = uuid(); sequence = saved = dropped = failures = 0;
        sessionStarted?.();
      }
      notify(value ? '性能诊断已开启 · 每30秒汇总上传，可随时关闭' : '性能诊断已关闭 · 不再收集或上传');
    },
    setContext(reader, { onSessionStart = null } = {}) {
      if (typeof reader !== 'function' || onSessionStart !== null && typeof onSessionStart !== 'function')
        throw new TypeError('Diagnostics context and session callback must be functions');
      context = reader; sessionStarted = onSessionStart;
      void runtimeReporter?.flush();
      if (enabled) sessionStarted?.();
    },
    recordLoading({ map, quality, stage }) {
      loadingContext = { map, quality, state: 'loading', time: 0 };
      void runtimeReporter?.flush();
      if (!enabled) return;
      if (!PERFORMANCE_MAPS.includes(map) || !['high', 'low'].includes(quality) ||
        !PERFORMANCE_LOADING_STAGES.includes(stage)) throw new RangeError('Invalid loading diagnostic context');
      const first = loadingStarted === null;
      if (first) loadingStarted = now();
      queue.push({
        sequence: sequence++, durationMs: 0, reason: 'manual', frames: 0,
        frameMs: FRAME_BUCKETS_MS.map(() => 0), maxFrameMs: 0, longFrames: 0, scopes: {}, slowFrames: [], errors: {},
        context: { map, state: 'loading', stage, time: Math.max(0, now() - loadingStarted) / 1000, quality,
          adaptiveLevel: 0, allies: 0, enemies: 0, corpses: 0, vehicles: 0, reinforcementWaves: 0,
          drawCalls: 0, triangles: 0, backlogSeconds: 0, simulationSteps: 0, unit: 'none' },
      });
      if (queue.length > 12) {
        dropped += queue.shift().frames;
        warn('Performance diagnostics queue full; oldest unsent window dropped');
      }
      if (first) { lastSend = now(); void upload(); }
      else scheduleLoadingUpload();
    },
    beginFrame(elapsed, state, visible = true) {
      if (!enabled) return;
      const previous = recording;
      recording = visible && activeStates.has(state);
      if (!previous || !recording) previousFrame = null;
      frameScopes = emptyScopes(); frameStarted = now();
      intervalMs = previous && recording ? Math.max(0, Math.min(60000, elapsed)) : null;
      if (!previous && recording) started = now();
    },
    measure(name, operation) {
      if (!enabled || !recording) return operation();
      if (!PERFORMANCE_SCOPES.includes(name)) throw new RangeError('Unknown performance scope');
      const interval = PERFORMANCE_SCOPE_SAMPLE_EVERY[name] ?? 1;
      scopeSerial[name] = (scopeSerial[name] ?? 0) + 1;
      if (scopeSerial[name] % interval !== 0) return operation();
      const began = now();
      try { return operation(); }
      finally {
        const elapsed = Math.max(0, now() - began);
        addScope(window().scopes, name, elapsed); addScope(frameScopes, name, elapsed);
      }
    },
    finishFrame(state) {
      if (!enabled || !context) return;
      if (!recording || !activeStates.has(state)) return;
      if (intervalMs !== null) {
        const item = window(), index = FRAME_BUCKETS_MS.findIndex(bound => intervalMs <= bound);
        item.durationMs += intervalMs;
        item.frames++; item.frameMs[index < 0 ? item.frameMs.length - 1 : index]++;
        item.maxFrameMs = Math.max(item.maxFrameMs, intervalMs);
        if (intervalMs > 100) {
          item.longFrames++;
          // The rAF interval includes the preceding callback, not this callback's work.
          if (previousFrame) item.slowFrames.push({ frameMs: intervalMs, ...previousFrame });
          item.slowFrames.sort((a, b) => b.frameMs - a.frameMs); item.slowFrames.length = Math.min(3, item.slowFrames.length);
        }
      }
      previousFrame = { callbackMs: Math.min(60000, now() - frameStarted), scopes: frameScopes };
      if (now() - started >= 5000) collect('interval');
      if (now() - lastSend >= 30000) { lastSend = now(); void upload(); }
    },
    checkpoint(reason = 'manual') { if (enabled) collect(reason); },
    flush(reason = 'manual') {
      if (!enabled) return;
      collect(reason); lastSend = now(); void upload();
    },
    suspend(reason) { this.flush(reason); void runtimeReporter?.flush(true); recording = false; },
    error(kind) {
      if (enabled && ['error', 'unhandledrejection', 'webglcontextlost', 'pose-recovered'].includes(kind)) {
        const errors = window().errors; errors[kind] = Math.min(10000, (errors[kind] ?? 0) + 1);
      }
    },
    runtimeError(error, details) {
      if (!enabled && runtimeReporter) { runtimeReporter.record(sanitizedRuntimeError(error, details)); return; }
      if (!enabled) return;
      const entry = sanitizedRuntimeError(error, details), item = window();
      const entries = item.runtimeErrors ??= [];
      const key = value => [value.code, value.name, value.recovered, value.stage, value.side, value.team, ...value.frames].join(':');
      const existing = entries.find(value => key(value) === key(entry));
      if (existing) {
        existing.count = Math.min(10000, existing.count + 1); existing.position = entry.position;
      } else if (entries.length < 8) entries.push(entry);
      else if (!runtimeLimitWarned) {
        runtimeLimitWarned = true;
        warn('Runtime diagnostics signature limit reached; additional distinct errors were not retained');
      }
    },
    get enabled() { return enabled; },
    get snapshot() { return { enabled, sessionId: enabled ? sessionId : null, savedWindows: saved, droppedFrames: dropped,
      failedBatches: failures, queuedWindows: queue.length, uploading: Boolean(pending), status }; },
  };
}

let shared;
export function getPerformanceDiagnostics() {
  if (shared) return shared;
  const refresh = () => {
    if (!shared) return;
    for (const input of document.querySelectorAll('[data-performance-diagnostics]')) input.checked = shared.enabled;
    for (const label of document.querySelectorAll('[data-performance-status]')) label.textContent = shared.snapshot.status;
  };
  shared = createPerformanceDiagnostics({ automaticRuntimeErrors: true, build: { commit: __BUILD_STAMP__.commit ?? '0000000',
    dirty: __BUILD_STAMP__.dirty, builtAt: __BUILD_STAMP__.builtAt },
    environment: performanceEnvironment(navigator, innerWidth, innerHeight, devicePixelRatio), changed: refresh });
  let selected = false;
  try { selected = localStorage.getItem(STORAGE_KEY) === 'true'; }
  catch (error) { console.warn('Performance diagnostic preference could not be read', error); }
  if (new URLSearchParams(location.search).get('diagnostics') === '1') selected = true;
  const choose = value => {
    shared.setEnabled(value);
    try { localStorage.setItem(STORAGE_KEY, String(value)); }
    catch (error) { console.warn('Performance diagnostic preference could not be saved', error); }
    refresh();
  };
  for (const input of document.querySelectorAll('[data-performance-diagnostics]')) input.addEventListener('change', () => choose(input.checked));
  choose(selected);
  document.addEventListener('visibilitychange', () => { if (document.hidden) shared.suspend('hidden'); });
  window.addEventListener('pagehide', () => shared.suspend('pagehide'));
  window.addEventListener('error', () => shared.error('error'));
  window.addEventListener('unhandledrejection', () => shared.error('unhandledrejection'));
  document.getElementById('world')?.addEventListener('webglcontextlost', () => shared.error('webglcontextlost'));
  return shared;
}
