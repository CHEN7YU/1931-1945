import { SPAWN_RULES } from './spawns.js';

const point = value => {
  if (!value || !['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]))) throw new RangeError('Construction positions must be finite');
  return { x: value.x, y: value.y, z: value.z };
};
const requireBuilder = id => {
  if (typeof id !== 'string' || !id) throw new Error('Construction requires a builder identity');
};

export function createConstructionState() {
  return { builderId: null, blueprint: false, site: null, anchor: null, progress: 0, preview: null, blockedReason: null, mode: 'choose' };
}

export function resetConstructionState(state) {
  Object.assign(state, createConstructionState());
}

export function selectConstructionBlueprint(state, builderId) {
  requireBuilder(builderId);
  if (!state.blueprint || state.builderId !== builderId) resetConstructionState(state);
  state.builderId = builderId;
  state.blueprint = true;
}

export function constructionCandidate(position, yaw, groundHeight) {
  const origin = point(position);
  if (!Number.isFinite(yaw) || typeof groundHeight !== 'function') throw new RangeError('Construction requires finite heading and ground support');
  const x = origin.x - Math.sin(yaw) * SPAWN_RULES.buildRange, z = origin.z - Math.cos(yaw) * SPAWN_RULES.buildRange;
  return point({ x, z, y: groundHeight(x, z) });
}

export function advanceConstruction(state, input, dt, validate) {
  requireBuilder(input.builderId);
  const position = point(input.position), candidate = point(input.candidate);
  if (!Number.isFinite(dt) || dt < 0 || typeof input.holding !== 'boolean' ||
    typeof input.allowed !== 'boolean' || typeof validate !== 'function') throw new RangeError('Invalid construction step');
  if (!input.allowed || (state.blueprint && state.builderId !== input.builderId)) {
    const notice = state.blueprint ? input.allowed ? 'owner-changed' : 'unavailable' : null;
    resetConstructionState(state);
    return { completed: null, notice };
  }
  if (!state.blueprint) return { completed: null, notice: null };
  let notice = null;
  if (state.site && Math.hypot(position.x - state.anchor.x, position.y - state.anchor.y, position.z - state.anchor.z) > .7) {
    state.site = state.anchor = null;
    state.progress = 0;
    notice = 'moved';
  }
  const placement = state.site || candidate, reason = validate(placement);
  if (reason !== null && (typeof reason !== 'string' || !reason)) throw new Error('Construction validation must return a reason or null');
  state.preview = point(placement);
  state.blockedReason = reason;
  if (input.holding && !reason) {
    if (!state.site) { state.site = point(candidate); state.anchor = point(position); }
    state.mode = 'building';
    state.progress = Math.min(SPAWN_RULES.buildSeconds, state.progress + dt);
    if (state.progress >= SPAWN_RULES.buildSeconds) {
      const completed = Object.freeze({ builderId: state.builderId, position: Object.freeze(point(state.site)) });
      resetConstructionState(state);
      return { completed, notice: null };
    }
  } else {
    state.site = state.anchor = null;
    state.progress = 0;
    state.mode = reason ? 'blocked' : 'ready';
  }
  return { completed: null, notice };
}
