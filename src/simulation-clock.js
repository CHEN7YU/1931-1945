export const SIMULATION_CLOCK = Object.freeze({ maxStepSeconds: .05, maxStepsPerFrame: 5, maxRecoveryRate: 1.1, lagWarningSeconds: .25 });
const epsilon = 1e-9;

export function createSimulationClock(initialNow = 0) {
  let lastNow, active, pending, activeSeconds, simulatedSeconds, steps, frameSeconds, peakPending, frameBudget;
  const validNow = now => {
    if (!Number.isFinite(now) || now < 0) throw new RangeError('Simulation clock requires a non-negative finite timestamp');
  };
  const reset = now => {
    validNow(now);
    lastNow = now; active = false;
    pending = activeSeconds = simulatedSeconds = steps = frameSeconds = peakPending = frameBudget = 0;
  };
  const advance = now => {
    validNow(now);
    if (now < lastNow) throw new RangeError('Simulation clock timestamps must be monotonic');
    const elapsed = active ? (now - lastNow) / 1000 : 0;
    if (active) {
      pending += elapsed; activeSeconds += elapsed;
      peakPending = Math.max(peakPending, pending);
    }
    lastNow = now;
    return elapsed;
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
      const elapsed = advance(now);
      steps = frameSeconds = 0;
      frameBudget = Math.min(pending, elapsed * SIMULATION_CLOCK.maxRecoveryRate,
        SIMULATION_CLOCK.maxStepSeconds * SIMULATION_CLOCK.maxStepsPerFrame);
      return frameBudget;
    },
    takeStep() {
      if (!active || steps >= SIMULATION_CLOCK.maxStepsPerFrame || pending <= epsilon || frameBudget <= epsilon) return 0;
      const dt = Math.min(pending, frameBudget, SIMULATION_CLOCK.maxStepSeconds);
      pending -= dt; frameBudget -= dt; simulatedSeconds += dt; frameSeconds += dt; steps++;
      return dt;
    },
    get active() { return active; },
    get snapshot() {
      return { active, activeSeconds, simulatedSeconds, pendingSeconds: pending, stepsThisFrame: steps,
        frameSeconds, peakPendingSeconds: peakPending,
        limited: pending > epsilon && (steps >= SIMULATION_CLOCK.maxStepsPerFrame || frameBudget <= epsilon),
        limits: { ...SIMULATION_CLOCK } };
    },
  };
}
