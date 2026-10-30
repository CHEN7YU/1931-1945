// Development injection only. Counters describe commands, not GPU elapsed time.
export function installRenderWorkProbe({ passes = false, backbufferScale = 1 } = {}, target = globalThis) {
  if (typeof passes !== 'boolean' || ![.5, 1].includes(backbufferScale)) throw new TypeError('Invalid render work probe options');
  if (Object.hasOwn(target, '__renderWorkProbe')) throw new Error('Render work probe is already installed');
  const capacity = 8192, events = new Array(capacity), uploads = new Map();
  let renderer, render, shadow, direct, pixelRatio, requestedRatio, serial = 0, depth = 0, current, phase, details = 0, stopped = false;
  const counters = () => ({ submissions: 0, calls: 0, triangles: 0, lines: 0, points: 0, uploads: {}, objects: [] });
  const keys = ['calls', 'triangles', 'lines', 'points'];
  let renderWrapper, shadowWrapper, directWrapper, ratioWrapper;
  Object.defineProperty(target, '__attachRenderWorkProbe', { value(value) {
    if (renderer) throw new Error('Render work probe is already attached');
    renderer = value;
    render = renderer.render; shadow = renderer.shadowMap.render; direct = renderer.renderBufferDirect;
    pixelRatio = renderer.setPixelRatio; requestedRatio = renderer.getPixelRatio();
    ratioWrapper = function(ratio) { requestedRatio = ratio; return pixelRatio.call(this, ratio * backbufferScale); };
    if (backbufferScale !== 1) {
      renderer.setPixelRatio = ratioWrapper;
      renderer.setPixelRatio(requestedRatio);
    }
    if (!passes) return;
    const gl = renderer.getContext();
    for (const name of ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D',
      'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D']) {
      if (typeof gl[name] !== 'function') continue;
      const original = gl[name];
      const wrapper = function(...args) {
        if (current) current[phase].uploads[name] = (current[phase].uploads[name] || 0) + 1;
        return original.apply(this, args);
      };
      uploads.set(name, { gl, original, wrapper });
      gl[name] = wrapper;
    }
    directWrapper = function(camera, scene, geometry, material, object, group) {
      if (!current) return direct.apply(this, arguments);
      const bucket = current[phase], before = keys.map(key => renderer.info.render[key]);
      bucket.submissions++;
      try { return direct.apply(this, arguments); }
      finally {
        const delta = Object.fromEntries(keys.map((key, index) => [key, renderer.info.render[key] - before[index]]));
        for (const key of keys) bucket[key] += delta[key];
        if (current.detailed) {
          let personalWeapon = false;
          for (let parent = object; parent; parent = parent.parent) personalWeapon ||= parent.userData?.personalWeapon === true;
          const role = object.name.startsWith('owned-weapon-') ? 'distant-weapon'
            : geometry.attributes?.nraSkinRegion ? geometry.userData?.distantPoseLod ? 'coarse-body' : 'original-body'
            : personalWeapon ? 'near-weapon' : object.isSkinnedMesh ? 'skinned-body' : 'other';
          bucket.objects.push({ objectId: object.id, name: object.name, type: object.type, role,
            instances: object.isInstancedMesh ? object.count : 1,
            geometryId: geometry.id, materialId: material.id, materialType: material.type,
            transparent: material.transparent, side: material.side, forceSinglePass: material.forceSinglePass,
            castShadow: object.castShadow, ...delta });
        }
      }
    };
    shadowWrapper = function(...args) {
      if (!current) return shadow.apply(this, args);
      const previous = phase, started = target.performance.now();
      current.shadowEntries++; phase = 'shadow';
      try { return shadow.apply(this, args); }
      finally {
        current.shadowCpuMs += target.performance.now() - started;
        phase = previous === 'setup' && depth === 1 ? 'main' : previous;
      }
    };
    renderWrapper = function(...args) {
      if (depth) {
        depth++;
        try { return render.apply(this, args); } finally { depth--; }
      }
      const startedAt = target.performance.now();
      current = { serial: ++serial, startedAt, endedAt: null, threw: true, detailed: details > 0,
        shadowEntries: 0, shadowCpuMs: 0, setup: counters(), shadow: counters(), main: counters() };
      if (details) details--;
      phase = 'setup'; depth = 1;
      try { const result = render.apply(this, args); current.threw = false; return result; }
      finally {
        current.endedAt = target.performance.now();
        events[(serial - 1) % capacity] = current;
        current = null; phase = null; depth = 0;
      }
    };
    renderer.renderBufferDirect = directWrapper;
    renderer.shadowMap.render = shadowWrapper;
    renderer.render = renderWrapper;
  } });
  Object.defineProperty(target, '__beginRenderWorkCapture', { value() { details = passes ? 3 : 0; } });
  Object.defineProperty(target, '__renderWorkProbe', { get() {
    const count = Math.min(serial, capacity);
    return { attached: Boolean(renderer), passes, backbufferScale, totalRenders: serial, stopped,
      drawingBuffer: renderer ? { width: renderer.domElement.width, height: renderer.domElement.height,
        requestedRatio, effectiveRatio: renderer.getPixelRatio() } : null,
      events: Array.from({ length: count }, (_, index) => structuredClone(events[(serial - count + index) % capacity])) };
  } });
  Object.defineProperty(target, '__stopRenderWorkProbe', { value() {
    if (depth) throw new Error('Cannot stop render work probe during rendering');
    if (stopped) return;
    if (renderer && passes) {
      if (renderer.render !== renderWrapper || renderer.shadowMap.render !== shadowWrapper ||
        renderer.renderBufferDirect !== directWrapper) throw new Error('Another tool replaced render work methods');
      renderer.render = render; renderer.shadowMap.render = shadow; renderer.renderBufferDirect = direct;
      for (const [name, item] of uploads) {
        if (item.gl[name] !== item.wrapper) throw new Error('Another tool replaced a WebGL upload method');
        item.gl[name] = item.original;
      }
    }
    if (renderer && backbufferScale !== 1) {
      if (renderer.setPixelRatio !== ratioWrapper) throw new Error('Another tool replaced pixel ratio control');
      renderer.setPixelRatio = pixelRatio; renderer.setPixelRatio(requestedRatio);
    }
    stopped = true;
  } });
}

export function renderWorkWindow(before, after) {
  if (!before && !after) return null;
  if (!before || !after || before.totalRenders > after.totalRenders) throw new Error('Render work probe changed during sample');
  const events = after.events.filter(event => event.serial > before.totalRenders && event.serial <= after.totalRenders);
  if (events.length !== after.totalRenders - before.totalRenders) throw new Error('Render work ring overwrote sample');
  return { passes: after.passes, backbufferScale: after.backbufferScale,
    startBuffer: before.drawingBuffer, endBuffer: after.drawingBuffer, events,
    limitation: 'Instrumented command counts and CPU submission only, not pass GPU time. Per-draw counter deltas retain shadow work despite Three resetting info after shadows. Detailed draws cover only the first three renders after the page-local sample boundary. Capture overhead is not performance acceptance.' };
}
