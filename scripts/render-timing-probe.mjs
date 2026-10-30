// Self-contained for Playwright injection; ordinary pages never install this hook.
export function installRenderTimingProbe({ gpu = true } = {}, target = globalThis) {
  if (typeof gpu !== 'boolean') throw new TypeError('GPU timing must be explicitly enabled or disabled');
  if (Object.hasOwn(target, '__renderTimingProbe')) throw new Error('Render timing probe is already installed');
  const capacity = 8192, maxPending = 8, events = new Array(capacity), pending = [], idle = [];
  let renderer, original, wrapper, gl, extension, serial = 0, rendering = false, stopped = false;
  let status = 'unattached', reason = null, created = 0, issued = 0, resolved = 0, invalidated = 0;
  const loseContext = () => {
    status = 'context-lost'; reason = 'WebGL context was lost; GPU timing cannot continue in this sample';
    for (const item of pending) {
      item.event.gpuStatus = 'context-lost'; item.event.gpuMs = null; invalidated++;
    }
    pending.length = idle.length = 0;
  };
  const discardPending = () => {
    for (const item of pending) {
      item.event.gpuStatus = 'disjoint'; item.event.gpuMs = null; invalidated++;
      idle.push(item.query);
    }
    pending.length = 0;
  };
  const poll = () => {
    if (gl.isContextLost()) { loseContext(); return false; }
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { discardPending(); return false; }
    const completed = [];
    for (const item of pending) {
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      const nanoseconds = item.event.threw ? null : gl.getQueryParameter(item.query, gl.QUERY_RESULT);
      completed.push({ item, nanoseconds });
    }
    if (gl.isContextLost()) { loseContext(); return false; }
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { discardPending(); return false; }
    for (const { item, nanoseconds } of completed) {
      if (!item.event.threw) {
        if (!Number.isFinite(nanoseconds) || nanoseconds < 0) throw new Error('GPU query returned an invalid elapsed time');
        item.event.gpuMs = nanoseconds / 1e6;
        item.event.gpuStatus = 'valid';
        item.event.gpuResolvedAt = target.performance.now();
        resolved++;
      }
      idle.push(item.query);
      pending.splice(pending.indexOf(item), 1);
    }
    return true;
  };
  Object.defineProperty(target, '__attachRenderTimingProbe', { value(value) {
    if (renderer) throw new Error('Render timing probe is already attached');
    renderer = value;
    original = renderer.render;
    if (typeof original !== 'function') throw new Error('Renderer has no render method');
    status = gpu ? 'unsupported' : 'cpu-only';
    reason = gpu ? 'WebGL2 disjoint timer queries are unavailable' : 'GPU queries explicitly disabled';
    if (gpu) {
      gl = renderer.getContext();
      extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (extension && ['createQuery', 'beginQuery', 'endQuery', 'getQuery', 'getQueryParameter', 'deleteQuery']
        .every(method => typeof gl[method] === 'function')) {
        status = 'ready'; reason = null;
        renderer.domElement.addEventListener('webglcontextlost', loseContext);
      }
    }
    wrapper = function(...args) {
      if (rendering) return original.apply(this, args);
      const probeStartedAt = target.performance.now();
      const event = { serial: ++serial, startedAt: null, endedAt: null, cpuMs: null,
        gpuMs: null, gpuResolvedAt: null, gpuStatus: status, threw: true, probeOverheadMs: null };
      let query = null;
      if (status === 'ready') {
        if (!poll()) event.gpuStatus = status === 'context-lost' ? status : 'disjoint';
        else if (pending.length >= maxPending) event.gpuStatus = 'pending-limit';
        else if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) event.gpuStatus = 'query-conflict';
        else {
          query = idle.pop();
          if (!query) {
            query = gl.createQuery();
            if (!query) throw new Error('GPU timer query allocation failed');
            created++;
          }
          gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
          event.gpuStatus = 'pending'; issued++;
        }
      }
      event.startedAt = target.performance.now();
      rendering = true;
      try {
        const result = original.apply(this, args);
        event.threw = false;
        return result;
      } finally {
        event.endedAt = target.performance.now();
        event.cpuMs = event.endedAt - event.startedAt;
        rendering = false;
        if (query) {
          if (gl.isContextLost()) { loseContext(); event.gpuStatus = 'context-lost'; }
          else {
            gl.endQuery(extension.TIME_ELAPSED_EXT);
            if (event.threw) event.gpuStatus = 'render-error';
            pending.push({ query, event });
          }
        }
        event.probeOverheadMs = target.performance.now() - probeStartedAt - event.cpuMs;
        events[(event.serial - 1) % capacity] = event;
      }
    };
    renderer.render = wrapper;
  } });
  Object.defineProperty(target, '__renderTimingProbe', { get() {
    const count = Math.min(serial, capacity);
    return { attached: Boolean(renderer), gpuRequested: gpu, status, reason, stopped,
      capacity, maxPending, totalRenders: serial, pending: pending.length, idle: idle.length,
      created, issued, resolved, invalidated,
      events: Array.from({ length: count }, (_, i) => ({ ...events[(serial - count + i) % capacity] })) };
  } });
  Object.defineProperty(target, '__stopRenderTimingProbe', { value() {
    if (rendering) throw new Error('Cannot stop the probe during a render');
    if (stopped) return;
    if (renderer) {
      if (renderer.render !== wrapper) throw new Error('Another tool replaced the instrumented render method');
      renderer.render = original;
      renderer.domElement?.removeEventListener('webglcontextlost', loseContext);
    }
    for (const item of pending) { item.event.gpuStatus = 'stopped-unresolved'; item.event.gpuMs = null; }
    if (extension && !gl.isContextLost()) {
      for (const query of [...idle, ...pending.map(item => item.query)]) gl.deleteQuery(query);
    }
    pending.length = idle.length = 0;
    stopped = true;
  } });
}

export function renderTimingWindow(before, atEnd, resolved, frames = []) {
  if (!before && !atEnd && !resolved) return null;
  if (!before || !atEnd || !resolved || before.totalRenders > atEnd.totalRenders ||
    atEnd.totalRenders > resolved.totalRenders) throw new Error('Render probe changed during the sample');
  const events = resolved.events.filter(event => event.serial > before.totalRenders && event.serial <= atEnd.totalRenders);
  if (events.length !== atEnd.totalRenders - before.totalRenders) throw new Error('Render timing ring overwrote the sample');
  const statuses = {};
  const attributed = events.map(event => {
    statuses[event.gpuStatus] = (statuses[event.gpuStatus] || 0) + 1;
    const index = frames.findIndex(frame => event.startedAt >= frame.renderStartedAt && event.endedAt <= frame.renderEndedAt + 1e-6);
    return { ...event, frameSerial: frames[index]?.serial ?? null,
      frameIntervalMs: frames[index]?.intervalMs ?? null, followingIntervalMs: index < 0 ? null : frames[index + 1]?.intervalMs ?? null };
  });
  return { gpuRequested: resolved.gpuRequested, status: resolved.status, reason: resolved.reason,
    statuses, renders: events.length, validGpuSamples: events.filter(event => event.gpuStatus === 'valid').length,
    events: attributed,
    limitation: 'Asynchronous GPU elapsed span around the original renderer.render, not GPU utilization or pure busy time. GPU and CPU overlap; do not add them. CPU submission can leave idle gaps inside the GPU span. Invalid, unavailable and unresolved GPU timings are null, never assumed zero. Pending results may resolve after the captured window; render serials fix membership.' };
}
