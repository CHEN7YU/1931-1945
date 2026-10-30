// Self-contained because Playwright serializes this function into the diagnostic page.
export function installDriverProbe(target = globalThis) {
  if (Object.hasOwn(target, '__driverProbe')) throw new Error('Driver probe is already installed');
  const capacity = 1024, events = new Array(capacity), handles = new WeakMap(), logged = new WeakSet();
  const installed = [], visited = new Set();
  let serial = 0, handleSerial = 0, deleteCalls = 0, disposingMaterial = null, materialAttached = false;
  const idFor = handle => {
    if (handle === null || typeof handle !== 'object' && typeof handle !== 'function') return null;
    if (!handles.has(handle)) handles.set(handle, ++handleSerial);
    return handles.get(handle);
  };
  for (const constructor of [target.WebGLRenderingContext, target.WebGL2RenderingContext]) {
    for (let prototype = constructor?.prototype; prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)) {
      if (visited.has(prototype)) continue;
      visited.add(prototype);
      for (const method of ['getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'createProgram', 'deleteProgram']) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
        if (typeof descriptor?.value !== 'function') continue;
        const original = descriptor.value;
        Object.defineProperty(prototype, method, { ...descriptor, value: function(...args) {
          if (method === 'getProgramParameter' && args[1] !== this.LINK_STATUS) return original.apply(this, args);
          const handle = args[0], object = handle !== null && (typeof handle === 'object' || typeof handle === 'function');
          let handleId = idFor(handle);
          const firstInfoLogForHandle = method === 'getProgramInfoLog' && object && !logged.has(handle);
          if (method === 'getProgramInfoLog' && object) logged.add(handle);
          const startedAt = target.performance.now();
          let completed = false;
          try {
            const result = original.apply(this, args);
            if (method === 'createProgram') handleId = idFor(result);
            completed = true;
            return result;
          } finally {
            const endedAt = target.performance.now();
            const releaseStack = method === 'deleteProgram' && ++deleteCalls % 16 === 1
              ? new Error('Sampled program release').stack : null;
            events[serial % capacity] = { serial: ++serial, method, handleId,
              firstInfoLogForHandle, startedAt, endedAt, durationMs: endedAt - startedAt, threw: !completed,
              disposingMaterial: disposingMaterial ? { type: disposingMaterial.type, name: disposingMaterial.name,
                uuid: disposingMaterial.uuid } : null, releaseStack };
          }
        } });
        installed.push(method);
      }
    }
  }
  if (!installed.length) throw new Error('No WebGL driver query methods are available to instrument');
  Object.defineProperty(target, '__driverProbe', { configurable: false, get() {
    const count = Math.min(serial, capacity);
    return { totalCalls: serial, capacity, installed: [...installed], materialAttached, deleteStackEvery: 16,
      events: Array.from({ length: count }, (_, i) => {
        const event = events[(serial - count + i) % capacity];
        return { ...event, disposingMaterial: event.disposingMaterial ? { ...event.disposingMaterial } : null };
      }) };
  } });
  Object.defineProperty(target, '__attachDriverMaterials', { value(Material) {
    if (materialAttached) throw new Error('Material disposal probe is already attached');
    const original = Material.prototype.dispose;
    if (typeof original !== 'function') throw new Error('Material disposal method is unavailable');
    Material.prototype.dispose = function(...args) {
      const previous = disposingMaterial;
      disposingMaterial = this;
      try { return original.apply(this, args); }
      finally { disposingMaterial = previous; }
    };
    materialAttached = true;
  } });
}

export function driverProbeWindow(before, after, frames) {
  if (!before && !after) return null;
  if (!before || !after || after.totalCalls < before.totalCalls) throw new Error('Driver probe changed during the sample');
  const events = after.events.filter(event => event.serial > before.totalCalls);
  if (events.length !== after.totalCalls - before.totalCalls) throw new Error('Driver trace ring overwrote the sample');
  const methods = {};
  const attributed = events.map(event => {
    const index = frames.findIndex(frame => event.startedAt >= frame.renderStartedAt && event.endedAt <= frame.renderEndedAt + 1e-6);
    const frame = frames[index];
    const summary = methods[event.method] ??= { calls: 0, cpuMs: 0, maxMs: 0 };
    summary.calls++; summary.cpuMs += event.durationMs; summary.maxMs = Math.max(summary.maxMs, event.durationMs);
    return { ...event, frameSerial: frame?.serial ?? null, frameCpuMs: frame?.cpuMs ?? null,
      frameRenderMs: frame?.renderMs ?? null, precedingRafIntervalMs: frame?.intervalMs ?? null,
      followingRafIntervalMs: index < 0 ? null : frames[index + 1]?.intervalMs ?? null };
  });
  return { calls: events.length, methods, events: attributed,
    insideRenderCpuMs: attributed.filter(event => event.frameSerial !== null).reduce((sum, event) => sum + event.durationMs, 0),
    limitation: 'Times existing CPU driver queries and program lifetime calls, not GPU execution. First info-log query is not proof of first shader use or compilation. Disposal stacks are sampled once per 16 deletes; releases outside render windows keep null frame attribution.' };
}
