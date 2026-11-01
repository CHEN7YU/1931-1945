export const BATTLE_AREA = Object.freeze({ minX: -100, maxX: 100, minZ: -96, maxZ: 96 });
export const AIR_BATTLE_AREA = Object.freeze({ minX: -600, maxX: 600, minZ: -600, maxZ: 600 });
export const BOUNDARY_RULES = Object.freeze({ graceSeconds: 8, damagePerSecond: 10 });

export function createBoundaryState() {
  return { outside: false, outsideSeconds: 0, remaining: BOUNDARY_RULES.graceSeconds,
    damaging: false, returnX: 0, returnZ: 0 };
}

export function advanceBoundary(state, position, dt, area = BATTLE_AREA) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(position?.x) || !Number.isFinite(position?.z)) {
    throw new RangeError('Battle boundary requires a finite position and non-negative simulation time');
  }
  const outside = position.x < area.minX || position.x > area.maxX || position.z < area.minZ || position.z > area.maxZ;
  if (!outside) {
    Object.assign(state, createBoundaryState());
    return 0;
  }
  const previous = state.outsideSeconds;
  state.outside = true;
  state.outsideSeconds += dt;
  state.remaining = Math.max(0, BOUNDARY_RULES.graceSeconds - state.outsideSeconds);
  state.damaging = state.outsideSeconds > BOUNDARY_RULES.graceSeconds;
  state.returnX = Math.max(area.minX + 1, Math.min(area.maxX - 1, position.x)) - position.x;
  state.returnZ = Math.max(area.minZ + 1, Math.min(area.maxZ - 1, position.z)) - position.z;
  return (Math.max(0, state.outsideSeconds - BOUNDARY_RULES.graceSeconds) -
    Math.max(0, previous - BOUNDARY_RULES.graceSeconds)) * BOUNDARY_RULES.damagePerSecond;
}
