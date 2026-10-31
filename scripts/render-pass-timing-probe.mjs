// Development-only low-frequency asynchronous pass attribution.
export function installRenderPassTimingProbe({ sampleEvery = 16 } = {}, target = globalThis) {
  if (!Number.isInteger(sampleEvery) || sampleEvery < 1 || sampleEvery > 1024) {
    throw new RangeError('GPU pass sample interval must be an integer in 1..1024');
  }
  if (Object.hasOwn(target, '__renderPassTimingProbe')) throw new Error('GPU pass timing probe is already installed');
  const capacity = 8192, maxPending = 8, events = new Array(capacity), pending = [], idle = [];
  let renderer, render, shadow, renderWrapper, shadowWrapper, gl, extension, serial = 0, depth = 0, current = null, activeQuery = null;
  let status = 'unattached', reason = null, issued = 0, resolved = 0, invalidated = 0, stopped = false;

  const invalidate = state => {
    for (const item of pending) {
      item.event.gpuStatus = state;
      item.event[`${item.pass}GpuStatus`] = state;
      item.event.shadowGpuMs = item.event.mainGpuMs = null;
      idle.push(item.query);
      invalidated++;
    }
    pending.length = 0;
  };
  const loseContext = () => {
    status = 'context-lost';
    reason = 'WebGL context was lost; pass GPU timings cannot continue';
    for (const item of pending) {
      item.event.gpuStatus = status;
      item.event[`${item.pass}GpuStatus`] = status;
      item.event.shadowGpuMs = item.event.mainGpuMs = null;
      invalidated++;
    }
    pending.length = idle.length = 0;
    if (activeQuery) {
      activeQuery.event.gpuStatus = status;
      activeQuery.event[`${activeQuery.pass}GpuStatus`] = status;
      activeQuery.event.shadowGpuMs = activeQuery.event.mainGpuMs = null;
      activeQuery = null;
      invalidated++;
    }
  };
  const poll = () => {
    if (gl.isContextLost()) { loseContext(); return false; }
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { invalidate('disjoint'); return false; }
    const completed = [];
    for (const item of pending) {
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      const nanoseconds = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
      completed.push({ item, nanoseconds });
    }
    if (gl.isContextLost()) { loseContext(); return false; }
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { invalidate('disjoint'); return false; }
    for (const { item, nanoseconds } of completed) {
      if (!Number.isFinite(nanoseconds) || nanoseconds < 0) throw new Error('GPU pass query returned an invalid elapsed time');
      item.event[`${item.pass}GpuMs`] = nanoseconds / 1e6;
      item.event[`${item.pass}GpuStatus`] = 'valid';
      idle.push(item.query);
      pending.splice(pending.indexOf(item), 1);
      const event = item.event;
      if (event.shadowGpuStatus === 'valid' && event.mainGpuStatus === 'valid') {
        event.gpuStatus = 'valid'; resolved++;
      }
    }
    return true;
  };
  const begin = (event, pass) => {
    if (!event || event.gpuStatus !== 'pending' || activeQuery || pending.length >= maxPending * 2 ||
      gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return false;
    const query = idle.pop() ?? gl.createQuery();
    if (!query) throw new Error('GPU pass query allocation failed');
    gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    event[`${pass}GpuStatus`] = 'pending';
    activeQuery = { event, pass, query };
    return true;
  };
  const end = threw => {
    if (!activeQuery) return;
    const item = activeQuery;
    activeQuery = null;
    gl.endQuery(extension.TIME_ELAPSED_EXT);
    if (threw) {
      item.event[`${item.pass}GpuStatus`] = 'render-error';
      item.event.gpuStatus = 'render-error';
      idle.push(item.query);
      return;
    }
    pending.push(item);
    issued++;
  };

  Object.defineProperty(target, '__attachRenderPassTimingProbe', { value(value) {
    if (renderer) throw new Error('GPU pass timing probe is already attached');
    renderer = value;
    render = renderer.render;
    shadow = renderer.shadowMap?.render;
    if (typeof render !== 'function' || typeof shadow !== 'function') {
      throw new Error('GPU pass timing requires a WebGL renderer shadowMap.render method');
    }
    gl = renderer.getContext();
    extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!extension || !['createQuery', 'beginQuery', 'endQuery', 'getQuery', 'getQueryParameter', 'deleteQuery']
      .every(method => typeof gl[method] === 'function')) {
      status = 'unsupported'; reason = 'WebGL2 disjoint timer queries are unavailable';
    } else {
      status = 'ready'; reason = null;
      renderer.domElement.addEventListener('webglcontextlost', loseContext);
    }
    shadowWrapper = function(...args) {
      if (!depth || !current) return shadow.apply(this, args);
      current.shadowEntries++;
      if (current.gpuStatus !== 'pending') return shadow.apply(this, args);
      if (current.shadowEntries > 1) {
        end(false);
        current.gpuStatus = 'multiple-shadow-entries';
        current.shadowGpuStatus = current.mainGpuStatus = 'ambiguous';
        const result = shadow.apply(this, args);
        return result;
      }
      const started = begin(current, 'shadow');
      if (!started) {
        current.gpuStatus = current.shadowGpuStatus = 'query-conflict';
        return shadow.apply(this, args);
      }
      let threw = true;
      try {
        const result = shadow.apply(this, args);
        threw = false;
        return result;
      }
      finally {
        if (started) end(threw);
        if (current.gpuStatus === 'pending' && !begin(current, 'main')) current.gpuStatus = current.mainGpuStatus = 'query-conflict';
      }
    };
    renderWrapper = function(...args) {
      if (depth) { depth++; try { return render.apply(this, args); } finally { depth--; } }
      const queriesHealthy = status !== 'ready' || poll();
      const event = { serial: ++serial, startedAt: target.performance.now(), endedAt: null, threw: true,
        sampled: serial % sampleEvery === 0, shadowEntries: 0, shadowGpuMs: null, mainGpuMs: null,
        shadowGpuStatus: null, mainGpuStatus: null,
        gpuStatus: status === 'ready' ? 'not-sampled' : status };
      if (event.sampled && status === 'ready') {
        if (!queriesHealthy) event.gpuStatus = status === 'context-lost' ? 'context-lost' : 'disjoint';
        else if (pending.length >= maxPending * 2) event.gpuStatus = 'pending-limit';
        else if (gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) event.gpuStatus = 'query-conflict';
        else event.gpuStatus = 'pending';
      }
      current = event; depth = 1;
      if (event.sampled && event.gpuStatus === 'pending' && !renderer.shadowMap.enabled) {
        event.shadowGpuStatus = 'shadows-disabled';
        event.gpuStatus = 'shadows-disabled';
        begin(event, 'main');
      }
      try {
        const result = render.apply(this, args);
        event.threw = false;
        return result;
      } finally {
        event.endedAt = target.performance.now();
        if (activeQuery?.event === event) end(event.threw);
        if (event.threw) {
          event.gpuStatus = 'render-error';
          if (event.shadowGpuStatus === 'pending') event.shadowGpuStatus = 'render-error';
          if (event.mainGpuStatus === 'pending') event.mainGpuStatus = 'render-error';
        } else if (event.sampled && event.gpuStatus === 'pending' && event.shadowEntries === 0) {
          event.shadowGpuStatus = 'unavailable';
          event.mainGpuStatus = 'unavailable';
          event.gpuStatus = 'no-shadow-entry';
        }
        events[(event.serial - 1) % capacity] = event;
        current = null; depth = 0;
      }
    };
    renderer.shadowMap.render = shadowWrapper;
    renderer.render = renderWrapper;
  } });
  Object.defineProperty(target, '__renderPassTimingProbe', { get() {
    const count = Math.min(serial, capacity);
    return { attached: Boolean(renderer), sampleEvery, status, reason, stopped, capacity, maxPending,
      totalRenders: serial, pending: pending.length, issued, resolved, invalidated,
      events: Array.from({ length: count }, (_, index) => ({ ...events[(serial - count + index) % capacity] })) };
  } });
  Object.defineProperty(target, '__stopRenderPassTimingProbe', { value() {
    if (depth) throw new Error('Cannot stop GPU pass probe during a render');
    if (stopped) return;
    if (renderer) {
      if (renderer.render !== renderWrapper || renderer.shadowMap.render !== shadowWrapper) {
        throw new Error('Another tool replaced an instrumented render method');
      }
      renderer.render = render;
      renderer.shadowMap.render = shadow;
      renderer.domElement.removeEventListener('webglcontextlost', loseContext);
    }
    if (activeQuery && !gl.isContextLost()) end(true);
    invalidate('stopped-unresolved');
    if (extension && !gl.isContextLost()) for (const query of idle) gl.deleteQuery(query);
    idle.length = 0; stopped = true;
  } });
}

export function renderPassTimingWindow(before, atEnd, resolvedSnapshot, frames = []) {
  if (!before && !atEnd && !resolvedSnapshot) return null;
  if (!before || !atEnd || !resolvedSnapshot || before.totalRenders > atEnd.totalRenders ||
    atEnd.totalRenders > resolvedSnapshot.totalRenders) throw new Error('GPU pass probe changed during sample');
  const events = resolvedSnapshot.events.filter(event => event.serial > before.totalRenders && event.serial <= atEnd.totalRenders);
  if (events.length !== atEnd.totalRenders - before.totalRenders) throw new Error('GPU pass probe ring overwrote sample');
  const sampled = events.filter(event => event.sampled);
  const statuses = {};
  for (const event of sampled) {
    statuses[event.gpuStatus] = (statuses[event.gpuStatus] || 0) + 1;
    if (event.gpuStatus === 'valid' && (event.shadowGpuStatus !== 'valid' || event.mainGpuStatus !== 'valid')) {
      throw new Error('GPU pass event is marked valid without both valid pass queries');
    }
    if (event.gpuStatus !== 'valid' && (event.shadowGpuMs !== null || event.mainGpuMs !== null)) {
      throw new Error('Invalid GPU pass event must not retain elapsed values');
    }
  }
  for (const event of sampled) {
    const index = frames.findIndex(frame => Number.isFinite(frame.renderStartedAt) &&
      event.startedAt >= frame.renderStartedAt && event.endedAt <= frame.renderEndedAt + 1e-6);
    event.frameSerial = frames[index]?.serial ?? null;
    event.frameIntervalMs = frames[index]?.intervalMs ?? null;
    event.followingIntervalMs = index < 0 ? null : frames[index + 1]?.intervalMs ?? null;
  }
  const valid = sampled.filter(event => event.gpuStatus === 'valid');
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return { status: resolvedSnapshot.status, sampleEvery: resolvedSnapshot.sampleEvery, renders: events.length,
    sampledRenders: sampled.length, validPassPairs: sampled.filter(event => event.gpuStatus === 'valid').length,
    statuses, events: sampled,
    shadow: valid.map(event => event.shadowGpuMs), postShadow: valid.map(event => event.mainGpuMs),
    medianShadowGpuMs: median(valid.map(event => event.shadowGpuMs)),
    medianPostShadowGpuMs: median(valid.map(event => event.mainGpuMs)),
    limitation: 'Low-frequency asynchronous WebGL elapsed queries: shadowMap.render and post-shadow renderer work are sequential, not nested. Timings are spans including GPU idle gaps, not utilization. CPU/GPU overlap; never add them. Disjoint/unsupported/ambiguous/unresolved samples are not zero and are excluded.' };
}
