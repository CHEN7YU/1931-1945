// Self-contained so Playwright can serialize it into the benchmark page.
export function sampleBattleWindow({ seconds, settleSeconds }, target = globalThis) {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(settleSeconds) || settleSeconds < 0) {
    throw new RangeError('A sample needs positive duration and non-negative settling time');
  }

  return new Promise((resolve, reject) => {
    let request, start;
    const readyAt = target.performance.now() + settleSeconds * 1000;
    const timeout = target.setTimeout(() => {
      target.cancelAnimationFrame(request);
      reject(new Error('The page-local benchmark window did not finish'));
    }, Math.max(30000, (seconds + settleSeconds) * 2000));
    const capture = rafTimestamp => {
      const now = target.performance.now(), data = target.__battle, telemetry = target.__battleTelemetry;
      if (!data || !telemetry) throw new Error('Development battle telemetry is unavailable');
      const driverProbe = target.__driverProbe ?? null;
      const renderTimingProbe = target.__renderTimingProbe ?? null;
      const renderWorkProbe = target.__renderWorkProbe ?? null;
      return { now, rafTimestamp, data, telemetry, driverProbe, renderTimingProbe, renderWorkProbe, captureMs: target.performance.now() - now };
    };
    const next = callback => { request = target.requestAnimationFrame(callback); };
    const sample = rafTimestamp => {
      try {
        if (!start) {
          if (target.performance.now() < readyAt) { next(sample); return; }
          start = capture(rafTimestamp);
          target.__beginRenderWorkCapture?.();
        } else if (target.performance.now() - start.now >= seconds * 1000) {
          const end = capture(rafTimestamp), data = start.data, final = end.data;
          target.clearTimeout(timeout);
          resolve({
            sampleStart: { now: start.now, rafTimestamp: start.rafTimestamp, time: data.time, state: data.state,
              clock: data.simulationClock, shots: data.combatStats.aiRifleShots,
              corpses: data.corpses.count, serial: start.telemetry.totalFrames,
              queryDiagnostics: data.queryDiagnostics, renderIsolation: data.renderIsolation,
              characterRendering: { friendly: data.historicalForce ?? null, enemy: data.enemyHistoricalForce ?? null },
              shaderPrograms: data.shaderPrograms, tracers: data.tracers, driverProbe: start.driverProbe,
              renderTimingProbe: start.renderTimingProbe, renderWorkProbe: start.renderWorkProbe },
            now: end.now, frames: end.telemetry.frames,
            boundaries: { requestedSeconds: seconds, settleSeconds,
              startRafTimestamp: start.rafTimestamp, endRafTimestamp: end.rafTimestamp,
              startCaptureMs: start.captureMs, endCaptureMs: end.captureMs },
            final: { time: final.time, state: final.state, combat: final.combatStats,
              population: final.population, corpses: final.corpses, position: final.position,
              graphics: final.graphics, collisionAcceleration: final.collisionAcceleration ?? null,
              simulationClock: final.simulationClock, aiDecisions: final.aiDecisions,
              shaderPrograms: final.shaderPrograms, queryDiagnostics: final.queryDiagnostics,
              renderIsolation: final.renderIsolation, tracers: final.tracers, driverProbe: end.driverProbe,
              characterRendering: { friendly: final.historicalForce ?? null, enemy: final.enemyHistoricalForce ?? null },
              renderTimingProbe: end.renderTimingProbe, renderWorkProbe: end.renderWorkProbe },
          });
          return;
        }
        next(sample);
      } catch (error) {
        target.clearTimeout(timeout);
        reject(error);
      }
    };
    next(sample);
  });
}

// An external rAF observer, not production game tick/AI CPU instrumentation.
export function installFrameObserver(target = globalThis) {
  if (Object.hasOwn(target, '__battleTelemetry')) throw new Error('Frame telemetry already exists');
  const capacity = 8192, frames = new Array(capacity);
  let serial = 0, last = null;
  const observe = now => {
    if (last !== null) {
      frames[serial % capacity] = { serial: ++serial, now, intervalMs: now - last,
        observerEnteredAt: target.performance.now() };
    }
    last = now;
    target.requestAnimationFrame(observe);
  };
  Object.defineProperty(target, '__battleTelemetry', { get() {
    const count = Math.min(serial, capacity);
    return { totalFrames: serial, capacity,
      frames: Array.from({ length: count }, (_, i) => ({ ...frames[(serial - count + i) % capacity] })) };
  } });
  target.requestAnimationFrame(observe);
}

export function activeWindowStatus(start, result) {
  const end = result.final.simulationClock;
  const rafSeconds = (result.boundaries.endRafTimestamp - result.boundaries.startRafTimestamp) / 1000;
  const activeSeconds = end.activeSeconds - start.clock.activeSeconds;
  const activeStates = ['playing', 'transferring', 'dead'], toleranceSeconds = .25;
  return { valid: start.clock.active && end.active && activeStates.includes(start.state) &&
      activeStates.includes(result.final.state) && Number.isFinite(rafSeconds) && rafSeconds > 0 &&
      Number.isFinite(activeSeconds) && Math.abs(activeSeconds - rafSeconds) <= toleranceSeconds,
    startState: start.state, endState: result.final.state, rafSeconds, activeSeconds, toleranceSeconds,
    limitation: 'Boundary states and active-clock conservation detect interrupted windows; the 250ms allowance covers rAF/clock entry skew, not a simulation-speed target.' };
}
