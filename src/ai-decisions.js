export const AI_DECISION_STEP_LIMITS = Object.freeze({ sensor: 12, cover: 1, posture: 4, path: 4 });
export const AI_DECISION_FRAME_LIMITS = Object.freeze({ sensor: 24, cover: 2, posture: 8, path: 8 });
const PRIORITY_SECONDS = .75;

export function aiDecisionPriority(position, observer, inView) {
  const distance = Math.hypot(position.x - observer.x, position.y - observer.y, position.z - observer.z);
  return (distance < 24 ? .5 : 0) + (distance < 90 && inView ? .5 : 0);
}

export function createAIDecisionScheduler({ pathBudgetMs = Infinity } = {}) {
  if (typeof pathBudgetMs !== 'number' || !(pathBudgetMs > 0)) throw new RangeError('Path decision budget must be positive');
  const kinds = Object.keys(AI_DECISION_STEP_LIMITS);
  const queues = Object.fromEntries(kinds.map(kind => [kind, new Map()]));
  const grants = Object.fromEntries(kinds.map(kind => [kind, new Set()]));
  const used = Object.fromEntries(kinds.map(kind => [kind, new Set()]));
  const lastServiced = Object.fromEntries(kinds.map(kind => [kind, new Map()]));
  const counts = () => Object.fromEntries(kinds.map(kind => [kind, 0]));
  let frame = 0, now = 0, serial = 0, frameCounts = counts(), stepCounts = counts(), totals = counts();
  let intervalFor = () => 0, deferredAttempts = counts();
  let pathWorkMs = 0, pathBudgetDeferrals = 0;
  const ready = (kind, actor) => {
    const interval = intervalFor(actor, kind);
    if (!Number.isFinite(interval) || interval < 0) throw new RangeError('AI decision interval must be finite and non-negative');
    const last = lastServiced[kind].get(actor.id);
    return last === undefined || now - last + 1e-8 >= interval;
  };
  return {
    beginFrame() {
      frame++;
      pathWorkMs = 0;
      frameCounts = counts();
      for (const kind of kinds) { used[kind].clear(); grants[kind].clear(); }
    },
    beginStep(time, priority, eligible, interval = () => 0) {
      if (!Number.isFinite(time) || time < now) throw new RangeError('AI decisions require monotonic simulation time');
      if (typeof interval !== 'function') throw new RangeError('AI decision interval must be a function');
      now = time;
      intervalFor = interval;
      stepCounts = counts();
      for (const kind of kinds) {
        grants[kind].clear();
        const waiting = [];
        for (const [id, request] of queues[kind]) {
          if (request.frame < frame - 1 || !eligible(request.actor, kind)) {
            queues[kind].delete(id);
            continue;
          }
          if (used[kind].has(id) || !ready(kind, request.actor)) continue;
          const importance = priority(request.actor);
          if (!Number.isFinite(importance) || importance < 0 || importance > 1) throw new RangeError('AI priority must be in 0..1');
          waiting.push({ id, score: now - request.since + importance * PRIORITY_SECONDS, serial: request.serial });
        }
        waiting.sort((a, b) => b.score - a.score || a.serial - b.serial);
        const capacity = Math.min(AI_DECISION_STEP_LIMITS[kind], AI_DECISION_FRAME_LIMITS[kind] - frameCounts[kind]);
        for (const request of waiting.slice(0, capacity)) grants[kind].add(request.id);
      }
    },
    take(kind, actor) {
      if (!queues[kind] || actor?.id == null) throw new RangeError('AI decision requires a known kind and actor');
      const id = actor.id;
      let request = queues[kind].get(id);
      if (!request) {
        request = { actor, since: now, serial: serial++, frame };
        queues[kind].set(id, request);
      }
      request.frame = frame;
      if (kind === 'path' && frameCounts.path > 0 && pathWorkMs >= pathBudgetMs) {
        pathBudgetDeferrals++;
        return false;
      }
      if (!ready(kind, actor)) { deferredAttempts[kind]++; return false; }
      const available = Math.min(AI_DECISION_STEP_LIMITS[kind] - stepCounts[kind],
        AI_DECISION_FRAME_LIMITS[kind] - frameCounts[kind]);
      // Do not let newly arriving jobs steal slots already reserved for waiting actors.
      if (used[kind].has(id) || available <= 0 || !grants[kind].has(id) && available <= grants[kind].size) return false;
      queues[kind].delete(id);
      grants[kind].delete(id);
      used[kind].add(id);
      lastServiced[kind].set(id, now);
      frameCounts[kind]++; stepCounts[kind]++; totals[kind]++;
      return true;
    },
    recordPathWork(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid completed path decision timing');
      pathWorkMs += elapsedMs;
    },
    forget(actor) {
      for (const kind of kinds) {
        queues[kind].delete(actor.id); grants[kind].delete(actor.id); used[kind].delete(actor.id);
        lastServiced[kind].delete(actor.id);
      }
    },
    reset() {
      frame = now = serial = 0;
      frameCounts = counts(); stepCounts = counts(); totals = counts();
      deferredAttempts = counts(); intervalFor = () => 0;
      pathWorkMs = pathBudgetDeferrals = 0;
      for (const kind of kinds) lastServiced[kind].clear();
      for (const kind of kinds) { queues[kind].clear(); grants[kind].clear(); used[kind].clear(); }
    },
    get snapshot() {
      return { stepLimits: AI_DECISION_STEP_LIMITS, frameLimits: AI_DECISION_FRAME_LIMITS,
        pathBudgetMs, pathWorkMs, pathBudgetDeferrals,
        serviced: { ...frameCounts }, totalServiced: { ...totals },
        deferredAttempts: { ...deferredAttempts },
        pending: Object.fromEntries(kinds.map(kind => [kind, queues[kind].size])),
        oldestWaitSeconds: Object.fromEntries(kinds.map(kind =>
          [kind, Math.max(0, ...[...queues[kind].values()].map(request => now - request.since))])) };
    },
  };
}
