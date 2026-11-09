import { FRAME_BUCKETS_MS, PERFORMANCE_SCHEMA_VERSION, PERFORMANCE_MAPS } from './performance-schema.js';

export function createRuntimeErrorReporter({ build, environment, send, uuid, now, getContext, warn }) {
  const sessionId = uuid(), queue = [];
  let sequence = 0, pending = false, lastSend = -Infinity, timer = null, limitWarned = false;
  async function flush(force = false) {
    if (pending || !queue.length) return;
    const source = getContext();
    if (!source || !PERFORMANCE_MAPS.includes(source.map)) return;
    const wait = 30000 - (now() - lastSend);
    if (!force && wait > 0) {
      if (timer === null) timer = setTimeout(() => { timer = null; void flush(); }, wait);
      return;
    }
    clearTimeout(timer); timer = null;
    pending = true; lastSend = now(); limitWarned = false;
    const context = { map: source.map, state: source.state, quality: source.quality, time: source.time ?? 0,
      adaptiveLevel: 0, allies: 0, enemies: 0, corpses: 0, vehicles: 0, reinforcementWaves: 0,
      drawCalls: 0, triangles: 0, backlogSeconds: 0, simulationSteps: 0, unit: 'none' };
    const payload = { schemaVersion: PERFORMANCE_SCHEMA_VERSION, id: uuid(), sessionId, build, environment,
      delivery: { droppedFrames: 0, failedBatches: 0 }, windows: [{ sequence: sequence++, durationMs: 0,
        reason: 'manual', frames: 0, frameMs: FRAME_BUCKETS_MS.map(() => 0), maxFrameMs: 0, longFrames: 0,
        scopes: {}, slowFrames: [], errors: {}, context, runtimeErrors: queue.splice(0, 8) }] };
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await send(payload, controller.signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const receipt = await response.json();
      if (receipt.saved !== true || receipt.id !== payload.id) throw new Error('Invalid runtime error receipt');
    } catch (error) {
      warn('Runtime error registration was not confirmed; battle continues and the local diagnostic is retained', error);
    } finally {
      clearTimeout(timeout); pending = false;
      if (queue.length) void flush();
    }
  }
  return {
    record(entry) {
      const signature = value => [value.code, value.name, value.stage, value.side, value.team,
        value.recovered, ...value.frames].join(':');
      const existing = queue.find(value => signature(value) === signature(entry));
      if (existing) { existing.count = Math.min(10000, existing.count + 1); existing.position = entry.position; }
      else if (queue.length < 8) queue.push(entry);
      else if (!limitWarned) {
        limitWarned = true;
        warn('Runtime error signature queue is full; additional signatures remain in the local diagnostic');
      }
      void flush();
    },
    flush,
  };
}
