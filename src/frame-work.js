export function renderBound({ aiMs = 0, renderMs = 0, gpuMs = null } = {}) {
  if (![aiMs, renderMs].every(value => Number.isFinite(value) && value >= 0) ||
    gpuMs !== null && (!Number.isFinite(gpuMs) || gpuMs < 0)) throw new RangeError('Invalid frame work measurements');
  const graphicsMs = Math.max(renderMs, gpuMs ?? 0);
  return graphicsMs >= (gpuMs !== null && gpuMs > renderMs ? 20 : 12) &&
    graphicsMs > Math.max(4, aiMs * 1.25);
}

export function createFrameWork({ gl = null, now = () => performance.now(), warn = console.warn } = {}) {
  const extension = gl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
  let gpuEnabled = Boolean(extension), gpuTiming = extension ? 'available' : 'unsupported';
  let active = false, started = 0, serial = 0, pending = null, query = null;
  let ai = 0, render = 0, samples = 0, gpuSamples = 0;
  const mean = { cpuMs: 0, aiMs: 0, renderMs: 0, gpuMs: null };
  const unavailable = message => {
    gpuEnabled = false; gpuTiming = 'disabled'; mean.gpuMs = null; warn(message);
  };
  const blend = (name, value) => { mean[name] = samples ? mean[name] + (value - mean[name]) * .08 : value; };
  return {
    beginFrame(playing) {
      if (typeof playing !== 'boolean') throw new TypeError('Frame work requires explicit activity');
      active = playing; started = now(); ai = render = 0; serial++;
      if (pending && !gl.isContextLost() && gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(extension.GPU_DISJOINT_EXT)) {
          const value = gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6;
          if (!Number.isFinite(value) || value < 0) unavailable('Invalid GPU timing result; GPU timing disabled, rendering continues');
          else {
            mean.gpuMs = mean.gpuMs === null ? value : mean.gpuMs + (value - mean.gpuMs) * .15;
            gpuSamples++;
          }
        } else mean.gpuMs = null;
        query = pending; pending = null;
      }
    },
    measureAI(operation) {
      const start = now();
      try { return operation(); }
      finally { ai += now() - start; }
    },
    measureRender(operation) {
      let measure = active && gpuEnabled && !pending && serial % 12 === 0 && !gl.isContextLost() &&
        !gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY);
      if (measure) {
        query ??= gl.createQuery();
        if (!query) {
          unavailable('Unable to allocate GPU timing query; GPU timing disabled, rendering continues');
          measure = false;
        } else gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      }
      const start = now();
      try { return operation(); }
      finally {
        render += now() - start;
        if (measure) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending = query; query = null; }
      }
    },
    finishFrame() {
      if (!active) return;
      blend('cpuMs', Math.max(0, now() - started)); blend('aiMs', ai); blend('renderMs', render);
      samples++;
    },
    reset() {
      samples = gpuSamples = 0;
      mean.cpuMs = mean.aiMs = mean.renderMs = 0; mean.gpuMs = null;
      if (pending && !gl.isContextLost()) gl.deleteQuery(pending);
      pending = null;
    },
    get snapshot() { return { ...mean, samples, gpuSamples, gpuTiming }; },
  };
}
