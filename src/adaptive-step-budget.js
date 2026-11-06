export const ADAPTIVE_STEP_BUDGET = Object.freeze({
  workMs: Object.freeze([12, 8, 5, 3]),
  reduceSeconds: .35, recoverSeconds: 4, maxSteps: 5,
});

// This only gates admission of whole simulation steps. The simulation clock owns all debt and dt.
export function createAdaptiveStepBudget() {
  let level = 0, slow = 0, smooth = 0, wasActive = false;
  let frameStart = 0, lastNow = 0, active = false, steps = 0, workMs = 0;
  let estimateMs = 0, lastStepMs = 0, totalSteps = 0, yieldedFrames = 0, yielded = false;
  const timestamp = now => {
    if (!Number.isFinite(now) || now < lastNow) throw new RangeError('Step budget requires monotonic finite timestamps');
    lastNow = now;
  };
  return {
    beginFrame(now, { frameMs, active: playing, emergencyLevel = 0, backlogSeconds = 0 }) {
      timestamp(now);
      if (!Number.isFinite(frameMs) || frameMs < 0 || typeof playing !== 'boolean' ||
        !Number.isInteger(emergencyLevel) || emergencyLevel < 0 || emergencyLevel > 3 ||
        !Number.isFinite(backlogSeconds) || backlogSeconds < 0) throw new RangeError('Invalid step budget pressure');
      frameStart = now; active = playing; steps = workMs = 0; yielded = false;
      if (playing && wasActive) {
        const elapsed = Math.min(frameMs, 250) / 1000;
        const pressure = Math.max(emergencyLevel, frameMs >= 160 ? 3 : frameMs >= 80 ? 2 : frameMs >= 32 ? 1 : 0,
          backlogSeconds >= 2 ? 2 : backlogSeconds >= .25 ? 1 : 0);
        slow = pressure > level ? slow + elapsed : 0;
        smooth = pressure < level && frameMs <= 22 && backlogSeconds < .1 ? smooth + elapsed : 0;
        if (slow >= ADAPTIVE_STEP_BUDGET.reduceSeconds && level < 3) {
          level++; slow = smooth = 0;
        } else if (smooth >= ADAPTIVE_STEP_BUDGET.recoverSeconds && level > 0) {
          level--; slow = smooth = 0;
        }
      } else slow = smooth = 0;
      wasActive = playing;
    },
    canTakeStep(now) {
      timestamp(now);
      if (!active || steps >= ADAPTIVE_STEP_BUDGET.maxSteps) return false;
      // Always allow one step: a machine slower than the budget must still make simulation progress.
      const allowed = steps === 0 || now - frameStart + Math.max(estimateMs, lastStepMs) <= ADAPTIVE_STEP_BUDGET.workMs[level];
      if (!allowed && !yielded) { yielded = true; yieldedFrames++; }
      return allowed;
    },
    recordStep(startedAt, finishedAt) {
      if (!active || !Number.isFinite(startedAt) || startedAt < frameStart || startedAt < lastNow ||
        !Number.isFinite(finishedAt) || finishedAt < startedAt) throw new RangeError('Invalid completed step timing');
      timestamp(finishedAt);
      lastStepMs = finishedAt - startedAt;
      estimateMs = totalSteps ? estimateMs + (lastStepMs - estimateMs) * .25 : lastStepMs;
      steps++; totalSteps++; workMs += lastStepMs;
    },
    reset() {
      level = slow = smooth = frameStart = lastNow = steps = workMs = estimateMs = lastStepMs = totalSteps = yieldedFrames = 0;
      wasActive = active = yielded = false;
    },
    get snapshot() {
      return { level, budgetMs: ADAPTIVE_STEP_BUDGET.workMs[level], stepsThisFrame: steps,
        workMs, estimatedStepMs: estimateMs, totalSteps, yieldedFrames };
    },
  };
}
