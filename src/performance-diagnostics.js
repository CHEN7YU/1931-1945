import { FRAME_BUCKETS_MS, PERFORMANCE_SCHEMA_VERSION, PERFORMANCE_SCOPES, PERFORMANCE_SCOPE_SAMPLE_EVERY } from './performance-schema.js';

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
  uuid = () => crypto.randomUUID(), changed = () => {}, warn = console.warn } = {}) {
  let enabled = false, context = null, sequence = 0, sessionId = uuid(), started = now(), current = null;
  let frameScopes = emptyScopes(), frameStarted = 0, intervalMs = 0, queue = [], pending = null, controller = null;
  let recording = false;
  const scopeSerial = {};
  let lastSend = now(), saved = 0, dropped = 0, failures = 0, status = '未开启性能诊断', generation = 0;
  const readContext = () => context?.();
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
    queue.push(current); current = null; started = now();
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
      if (revision === generation) { pending = controller = null; changed(); }
    }
  }
  return {
    setEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('Diagnostics activity must be explicit');
      if (enabled === value) return;
      generation++; enabled = value; controller?.abort(); pending = controller = null;
      recording = false;
      queue = []; current = null; frameScopes = emptyScopes(); started = lastSend = now();
      if (value) { sessionId = uuid(); sequence = saved = dropped = failures = 0; }
      notify(value ? '性能诊断已开启 · 每30秒汇总上传，可随时关闭' : '性能诊断已关闭 · 不再收集或上传');
    },
    setContext(reader) { if (typeof reader !== 'function') throw new TypeError('Diagnostics context must be a function'); context = reader; },
    beginFrame(elapsed, state, visible = true) {
      if (!enabled) return;
      const previous = recording;
      recording = visible && activeStates.has(state);
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
          item.slowFrames.push({ frameMs: intervalMs, callbackMs: Math.min(60000, now() - frameStarted), scopes: frameScopes });
          item.slowFrames.sort((a, b) => b.frameMs - a.frameMs); item.slowFrames.length = Math.min(3, item.slowFrames.length);
        }
      }
      if (now() - started >= 5000) collect('interval');
      if (now() - lastSend >= 30000) { lastSend = now(); void upload(); }
    },
    flush(reason = 'manual') {
      if (!enabled) return;
      collect(reason); lastSend = now(); void upload();
    },
    suspend(reason) { this.flush(reason); recording = false; },
    error(kind) {
      if (enabled && ['error', 'unhandledrejection', 'webglcontextlost'].includes(kind)) {
        const errors = window().errors; errors[kind] = Math.min(10000, (errors[kind] ?? 0) + 1);
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
  shared = createPerformanceDiagnostics({ build: { commit: __BUILD_STAMP__.commit ?? '0000000',
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
