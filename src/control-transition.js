export const DEATH_TRANSFER = Object.freeze({ handoffSeconds: .6, durationSeconds: 2.9, fadeSeconds: .3 });

export function nearbyDeathTransferMember(members, current, eligible) {
  const origin = members[current]?.position;
  if (!origin) return -1;
  let best = -1, distance = Infinity;
  for (let offset = 1; offset < members.length; offset++) {
    const index = (current + offset) % members.length, actor = members[index];
    if (actor.health <= 0 || !actor.position || !eligible(actor)) continue;
    const gap = Math.hypot(actor.position.x - origin.x, actor.position.z - origin.z,
      (actor.position.y - origin.y) * 3);
    if (gap < distance) { best = index; distance = gap; }
  }
  return best;
}

export function createDeathTransfer() {
  return { active: false, fromId: null, reason: null, memorial: null, elapsed: 0, handedOff: false };
}
export function startDeathTransfer(state, fromId, reason, memorial = null) {
  if (state.active && state.fromId === fromId) return false;
  Object.assign(state, { active: true, fromId, reason, memorial, elapsed: 0, handedOff: false });
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
  const fadeStart = DEATH_TRANSFER.durationSeconds - DEATH_TRANSFER.fadeSeconds;
  const remaining = Math.max(0, (DEATH_TRANSFER.durationSeconds - t) / DEATH_TRANSFER.fadeSeconds);
  return { opacity: t <= fadeStart ? 1 : remaining, red: 0, dark: 1 };
}
export function resetDeathTransfer(state) { Object.assign(state, createDeathTransfer()); }
// ---模块结束---
