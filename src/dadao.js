export const DADAO = Object.freeze({
  reach: 1.75, halfArc: .65, heightTolerance: .65, diagonalSlope: 1,
  draw: .35, windup: .28, active: .2, recovery: .4, cooldown: .95,
  damage: 100, stamina: .12,
});

export const DADAO_GRIP = Object.freeze({ length: .19, radiusX: .0145, radiusZ: .0165,
  centerY: -.03, palmDepth: .0225, fingerPad: .006 });

export function createDadaoState() {
  return { equipped: false, readyAt: 0, startedAt: null, nextAttackAt: 0,
    connected: false, swings: 0, hits: 0, mode: 'idle', targetId: null, pose: { phase: 'stowed', progress: 0 } };
}

export function stowDadao(state) {
  state.equipped = false;
  state.startedAt = null;
  state.connected = false;
  state.mode = 'idle'; state.targetId = null; state.pose = { phase: 'stowed', progress: 0 };
}

export function drawDadao(state, now) {
  if (state.equipped) return;
  state.equipped = true;
  state.readyAt = now + DADAO.draw;
}

export function startDadaoSwing(state, now, stamina) {
  if (!state.equipped || now < state.readyAt || now < state.nextAttackAt ||
    state.startedAt !== null || stamina < DADAO.stamina) return false;
  state.startedAt = now; state.nextAttackAt = now + DADAO.cooldown;
  state.connected = false; state.swings++;
  return true;
}

export function dadaoPhase(state, now) {
  if (!state.equipped) return { phase: 'stowed', progress: 0 };
  if (now < state.readyAt) return { phase: 'draw', progress: Math.max(0, 1 - (state.readyAt - now) / DADAO.draw) };
  if (state.startedAt === null) return { phase: 'ready', progress: 0 };
  const age = Math.max(0, now - state.startedAt);
  if (age < DADAO.windup) return { phase: 'windup', progress: age / DADAO.windup };
  if (age < DADAO.windup + DADAO.active) return { phase: 'cut', progress: (age - DADAO.windup) / DADAO.active };
  return { phase: 'recover', progress: Math.min(1, (age - DADAO.windup - DADAO.active) / DADAO.recovery) };
}

export function advanceDadao(state, now) {
  if (state.startedAt !== null && now - state.startedAt >= DADAO.windup + DADAO.active + DADAO.recovery) {
    state.startedAt = null;
  }
  return dadaoPhase(state, now);
}

export function dadaoStroke(pose) {
  const progress = Math.max(0, Math.min(1, pose.progress));
  const eased = progress * progress * (3 - 2 * progress);
  return {
    raise: pose.phase === 'windup' ? eased : pose.phase === 'cut' ? 1 : 0,
    cut: pose.phase === 'cut' ? eased : pose.phase === 'recover' ? 1 - eased : 0,
  };
}

export function dadaoBodyMotion(pose) {
  const { raise, cut } = dadaoStroke(pose);
  const windup = raise * (1 - cut);
  return {
    yaw: -.10 * windup + .12 * cut,
    pitch: .009 * windup - .012 * cut,
    roll: -.025 * windup + .035 * cut,
    lift: -.006 * windup - .004 * cut,
    lateral: .008 * windup - .012 * cut,
  };
}

export function dadaoSweepDirection(progress, forward) {
  const length = Math.hypot(forward.x, forward.y, forward.z), horizontal = Math.hypot(forward.x, forward.z);
  if (horizontal < .1) return null;
  const fx = forward.x / length, fy = forward.y / length, fz = forward.z / length;
  const rightX = -forward.z / horizontal, rightZ = forward.x / horizontal;
  const upX = -fy * forward.x / horizontal, upY = horizontal / length, upZ = -fy * forward.z / horizontal;
  const sweep = DADAO.halfArc * (1 - 2 * dadaoStroke({ phase: 'cut', progress }).cut);
  const side = Math.sin(sweep) / Math.hypot(1, DADAO.diagonalSlope), ahead = Math.cos(sweep);
  return {
    x: fx * ahead + (rightX + upX * DADAO.diagonalSlope) * side,
    y: fy * ahead + upY * DADAO.diagonalSlope * side,
    z: fz * ahead + (rightZ + upZ * DADAO.diagonalSlope) * side,
  };
}

export function selectDadaoTarget(state, now, actor, origin, forward, targets, aimPoint, clear) {
  const pose = dadaoPhase(state, now);
  if (pose.phase !== 'cut' || state.connected) return null;
  const sweep = dadaoSweepDirection(pose.progress, forward);
  if (!sweep) return null;
  const horizontal = Math.hypot(forward.x, forward.z);
  const fx = forward.x / horizontal, fz = forward.z / horizontal;
  const sweepHorizontal = Math.hypot(sweep.x, sweep.z);
  const sx = sweep.x / sweepHorizontal, sz = sweep.z / sweepHorizontal;
  const candidates = [];
  for (const target of targets) {
    if (target.health <= 0 || target.team === actor.team || target.vehicleId ||
      !['person', 'exposed-crew'].includes(target.targetKind) ||
      Math.abs(target.position.y - actor.position.y) > .6) continue;
    const point = aimPoint(target), dx = point.x - origin.x, dz = point.z - origin.z;
    const distance = Math.hypot(dx, dz), dy = point.y - origin.y;
    const along = dx * sx + dz * sz;
    if (distance > DADAO.reach || Math.abs(dy - along * sweep.y / sweepHorizontal) > DADAO.heightTolerance) continue;
    // Sample a narrow part of the blade's sweep, rather than damaging the whole cone at once.
    if (dx * fx + dz * fz <= 0 || (dx * sx + dz * sz) / Math.max(distance, .01) < Math.cos(.27)) continue;
    if (clear(origin, point)) candidates.push({ target, distance });
  }
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.target ?? null;
}
