// Benchmark-only adapter reproducing the former per-substep budgets, not a gameplay option.
const limits = Object.freeze({ sensor: 12, cover: 1, posture: 4, path: 4 });
export function createAIDecisionScheduler() {
  const counts = () => Object.fromEntries(Object.keys(limits).map(kind => [kind, 0]));
  let step = counts(), frame = counts(), total = counts();
  return {
    beginFrame() { frame = counts(); },
    beginStep() { step = counts(); },
    take(kind) {
      if (step[kind] >= limits[kind]) return false;
      step[kind]++; frame[kind]++; total[kind]++;
      return true;
    },
    forget() {},
    reset() { step = counts(); frame = counts(); total = counts(); },
    get snapshot() {
      return { stepLimits: limits, frameLimits: null, serviced: { ...frame }, totalServiced: { ...total },
        pending: counts(), oldestWaitSeconds: counts() };
    },
  };
}
export function aiDecisionPriority() { return 0; }
