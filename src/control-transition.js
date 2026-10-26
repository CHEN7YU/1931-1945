export const DEATH_TRANSFER = Object.freeze({ handoffSeconds: .6, durationSeconds: .9 });
export function createDeathTransfer() { return { active: false, fromId: null, reason: null, elapsed: 0, handedOff: false }; }
export function startDeathTransfer(state, fromId, reason) {
  if (state.active && state.fromId === fromId) return false;
  Object.assign(state, { active: true, fromId, reason, elapsed: 0, handedOff: false });
  return true;
}
export function advanceDeathTransfer(state, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Death transfer timestep must be non-negative and finite');
  if (!state.active) return null;
  state.elapsed += dt;
  if (!state.handedOff && state.elapsed >= DEATH_TRANSFER.handoffSeconds) {
    state.handedOff = true;
    return 'handoff';
  }
  if (state.handedOff && state.elapsed >= DEATH_TRANSFER.durationSeconds) {
    state.active = false;
    return 'complete';
  }
  return null;
}
export function deathTransferMask(state) {
  if (!state.active) return { opacity: 0, red: 0, dark: 0 };
  const t = state.elapsed;
  if (!state.handedOff) return { opacity: 1, red: Math.min(.55, .2 + t), dark: Math.min(1, t / DEATH_TRANSFER.handoffSeconds) };
  const remaining = Math.max(0, (DEATH_TRANSFER.durationSeconds - t) / (DEATH_TRANSFER.durationSeconds - DEATH_TRANSFER.handoffSeconds));
  return { opacity: remaining, red: 0, dark: 1 };
}
export function resetDeathTransfer(state) { Object.assign(state, createDeathTransfer()); }
// ---模块结束---
