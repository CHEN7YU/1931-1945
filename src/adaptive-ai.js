export const ADAPTIVE_AI_RULES = Object.freeze({
  nearDistance: 40, warmupSeconds: 1.5, recoverSeconds: 4,
  reduceFrameMs: 26, severeFrameMs: 40, recoverFrameMs: 21,
});
const INTERVALS = Object.freeze([
  Object.freeze({ sensor: 0, path: 0, cover: 0, posture: 0 }),
  Object.freeze({ sensor: 1.4, path: 3, cover: 2, posture: 1.5 }),
  Object.freeze({ sensor: 2.8, path: 6, cover: 4, posture: 3 }),
]);

export function createAdaptiveAI() {
  let level = 0, active = false, warmup = 0, slow = 0, smooth = 0, average = 1000 / 60, transitions = 0;
  return {
    observeFrame(frameMs, playing) {
      if (!Number.isFinite(frameMs) || frameMs < 0 || typeof playing !== 'boolean') {
        throw new RangeError('Adaptive AI requires finite frame timing and explicit activity');
      }
      if (!playing) { active = false; slow = smooth = 0; return; }
      if (!active) {
        active = true; warmup = ADAPTIVE_AI_RULES.warmupSeconds; average = 1000 / 60; return;
      }
      const elapsed = Math.min(frameMs / 1000, .25);
      if (warmup > 0) { warmup = Math.max(0, warmup - elapsed); return; }
      average += (Math.min(frameMs, 250) - average) * (1 - Math.exp(-elapsed / .35));
      const threshold = level === 0 ? ADAPTIVE_AI_RULES.reduceFrameMs : ADAPTIVE_AI_RULES.severeFrameMs;
      const overloaded = frameMs >= threshold && average >= threshold;
      slow = overloaded ? slow + elapsed : 0;
      smooth = average <= ADAPTIVE_AI_RULES.recoverFrameMs ? smooth + elapsed : 0;
      if (level < 2 && slow >= (level === 0 ? .5 : .8)) {
        level++; transitions++; slow = smooth = 0;
      } else if (level > 0 && smooth >= ADAPTIVE_AI_RULES.recoverSeconds) {
        level--; transitions++; slow = smooth = 0;
      }
    },
    intervalFor(kind, position, observer, inView, threatensPlayer = false) {
      if (!(kind in INTERVALS[0]) || typeof inView !== 'boolean' || typeof threatensPlayer !== 'boolean' ||
        ![position.x, position.y, position.z, observer.x, observer.y, observer.z].every(Number.isFinite)) {
        throw new RangeError('Adaptive AI requires a known decision and finite view relevance');
      }
      if (level === 0 || inView || threatensPlayer ||
        Math.hypot(position.x - observer.x, position.y - observer.y, position.z - observer.z) <= ADAPTIVE_AI_RULES.nearDistance) return 0;
      return INTERVALS[level][kind];
    },
    reset() {
      level = transitions = 0; active = false; warmup = slow = smooth = 0; average = 1000 / 60;
    },
    get snapshot() {
      return { level, smoothedFrameMs: average, transitions, intervals: { ...INTERVALS[level] },
        nearDistance: ADAPTIVE_AI_RULES.nearDistance };
    },
  };
}
