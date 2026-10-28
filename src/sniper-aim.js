export const BREATH = Object.freeze({ holdSeconds: 6, recoverSeconds: 4, recoverThreshold: .35 });

export function createBreathState() {
  return { remaining: 1, holding: false, exhausted: false };
}

export function advanceBreath(state, dt, requested, available) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(state.remaining) ||
    state.remaining < 0 || state.remaining > 1 || typeof requested !== 'boolean' || typeof available !== 'boolean') {
    throw new RangeError('Breath requires finite simulation time, capacity and explicit input/aim facts');
  }
  if (dt === 0) return;
  if (state.exhausted && !requested && state.remaining >= BREATH.recoverThreshold) state.exhausted = false;
  state.holding = requested && available && !state.exhausted && state.remaining > 0;
  state.remaining = Math.max(0, Math.min(1, state.remaining + dt *
    (state.holding ? -1 / BREATH.holdSeconds : 1 / BREATH.recoverSeconds)));
  if (state.remaining === 0) { state.holding = false; state.exhausted = true; }
}

export function aimSway(time, { scoped, holding, moving, stance }) {
  if (!Number.isFinite(time) || ![scoped, holding, moving].every(value => typeof value === 'boolean') ||
    !['standing', 'crouched', 'prone'].includes(stance)) throw new RangeError('Aim sway requires explicit simulation and posture facts');
  const support = stance === 'prone' ? .4 : stance === 'crouched' ? .65 : 1;
  const amplitude = (holding ? .00025 : scoped ? .0022 : .0016) * (scoped ? support * (moving ? 2.5 : 1) : 1);
  return { pitch: Math.sin(time * 2.1) * amplitude, yaw: scoped ? Math.sin(time * 1.37) * amplitude * .65 : 0 };
}
