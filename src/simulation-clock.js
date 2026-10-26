export const SIMULATION_CLOCK = Object.freeze({ maxStepSeconds: .05, maxStepsPerFrame: 5, lagWarningSeconds: .25 });
const epsilon = 1e-9;

export function createSimulationClock(initialNow = 0) {
  let lastNow, active, pending, activeSeconds, simulatedSeconds, steps, frameSeconds, peakPending;
  const validNow = now => {
    if (!Number.isFinite(now) || now < 0) throw new RangeError('Simulation clock requires a non-negative finite timestamp');
  };
  const reset = now => {
    validNow(now);
    lastNow = now; active = false;
    pending = activeSeconds = simulatedSeconds = steps = frameSeconds = peakPending = 0;
  };
  const advance = now => {
    validNow(now);
    if (now < lastNow) throw new RangeError('Simulation clock timestamps must be monotonic');
    if (active) {
      const elapsed = (now - lastNow) / 1000;
      pending += elapsed; activeSeconds += elapsed;
      peakPending = Math.max(peakPending, pending);
    }
    lastNow = now;
  };
  reset(initialNow);
  return {
    reset,
    setActive(value, now) {
      if (typeof value !== 'boolean') throw new TypeError('Simulation clock activity must be explicit');
      advance(now);
      active = value;
    },
    beginFrame(now) {
      advance(now);
      steps = frameSeconds = 0;
      return Math.min(pending, SIMULATION_CLOCK.maxStepSeconds * SIMULATION_CLOCK.maxStepsPerFrame);
    },
    takeStep() {
      if (!active || steps >= SIMULATION_CLOCK.maxStepsPerFrame || pending <= epsilon) return 0;
      const dt = Math.min(pending, SIMULATION_CLOCK.maxStepSeconds);
      pending -= dt; simulatedSeconds += dt; frameSeconds += dt; steps++;
      return dt;
    },
    get active() { return active; },
    get snapshot() {
      return { active, activeSeconds, simulatedSeconds, pendingSeconds: pending, stepsThisFrame: steps,
        frameSeconds, peakPendingSeconds: peakPending, limited: steps >= SIMULATION_CLOCK.maxStepsPerFrame && pending > epsilon,
        limits: { ...SIMULATION_CLOCK } };
    },
  };
}
