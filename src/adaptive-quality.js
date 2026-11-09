export function createAdaptiveQuality({ onChange = () => {}, initialLevel = 0 } = {}) {
  if (!Number.isInteger(initialLevel) || initialLevel < 0 || initialLevel > 3)
    throw new RangeError('Invalid initial automatic graphics level');
  let level = initialLevel, peak = initialLevel, activations = 0, reductions = 0, recoveries = 0, activeSeconds = 0;
  let lastAt = null, warmUntil = 0, holdUntil = 0, slowMs = 0, goodMs = 0, severeFrames = 0, average = 16.7;
  let reason = initialLevel ? 'restored' : 'none';
  const change = (next, why) => {
    if (next === level) return;
    const previous = level;
    level = next; peak = Math.max(peak, level); reason = why;
    if (why === 'pressure' || why === 'backlog') {
      reductions++;
      if (previous === 0) activations++;
    } else if (why === 'recovery') recoveries++;
    slowMs = goodMs = 0;
    onChange({ level, previous, reason: why });
  };
  return {
    observe(frameMs, { active, visible = true, backlogSeconds = 0, now = performance.now() }) {
      if (!Number.isFinite(frameMs) || frameMs < 0 || !Number.isFinite(now) ||
        !Number.isFinite(backlogSeconds) || backlogSeconds < 0 ||
        typeof active !== 'boolean' || typeof visible !== 'boolean') throw new RangeError('Invalid automatic quality observation');
      if (!active || !visible) { lastAt = null; slowMs = goodMs = severeFrames = 0; return; }
      if (lastAt === null) {
        lastAt = now; warmUntil = now + 500; average = 16.7;
        return;
      }
      if (now < lastAt) throw new RangeError('Automatic quality time must be monotonic');
      const elapsed = now - lastAt; lastAt = now;
      if (level > 0) activeSeconds += elapsed / 1000;
      if (now < holdUntil) return;
      average += (Math.min(frameMs, 1000) - average) * (1 - Math.exp(-elapsed / 500));
      if (now < warmUntil) return;
      severeFrames = frameMs >= 250 ? severeFrames + 1 : 0;
      if (level < 3 && (severeFrames >= 2 || backlogSeconds >= .5 && frameMs >= 40)) {
        change(3, backlogSeconds >= .5 ? 'backlog' : 'pressure'); warmUntil = now + 1500;
        return;
      }
      const threshold = [40, 60, 90, Infinity][level];
      slowMs = frameMs >= threshold && average >= threshold ? slowMs + Math.min(elapsed, 250) : 0;
      const recoveryThreshold = [0, 24, 30, 35][level];
      goodMs = level > 0 && average <= recoveryThreshold && backlogSeconds < .05 ? goodMs + elapsed : 0;
      if (level < 3 && slowMs >= 750) {
        change(level + 1, 'pressure'); warmUntil = now + 1500;
      } else if (level > 0 && goodMs >= 20000) {
        change(level - 1, 'recovery'); warmUntil = now + 1500;
      }
    },
    manualChange(now = performance.now()) {
      if (!Number.isFinite(now)) throw new RangeError('Invalid manual quality timestamp');
      change(0, 'manual'); holdUntil = now + 15000; lastAt = null;
    },
    leaveBattle() { lastAt = null; slowMs = goodMs = severeFrames = 0; },
    resetStatistics() { peak = level; activations = reductions = recoveries = activeSeconds = 0; },
    get statistics() { return { level, peak, activations, reductions, recoveries, activeSeconds }; },
    get snapshot() { return { level, peak, activations, reductions, recoveries, activeSeconds,
      reason, smoothedFrameMs: average }; },
  };
}
