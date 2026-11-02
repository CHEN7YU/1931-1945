export const AIR_SUPPORT = Object.freeze({ count: 3, speed: 22, altitude: 28, interval: .12,
  range: 120, damage: 35, spread: .018, orbitWidth: 55, orbitLength: 110 });

export function createAirSupport(index = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= AIR_SUPPORT.count) throw new RangeError('Unknown air support aircraft');
  return { initialized: false, index, phase: -Math.PI / 2 + index * Math.PI * 2 / AIR_SUPPORT.count,
    heading: 0, roll: 0, cooldown: 0, passes: 0, shots: 0, targetId: null };
}

export function advanceAirSupport(state, position, dt, targets, objective, visible, enabled = true) {
  if (!Number.isFinite(dt) || dt < 0 || typeof visible !== 'function') throw new TypeError('Air support requires time and a visibility query');
  if (dt === 0) return null;
  const living = targets.filter(target => target.health > 0 && !target.vehicleId)
    .sort((a, b) => Math.hypot(a.position.x - objective.x, a.position.z - objective.z) -
      Math.hypot(b.position.x - objective.x, b.position.z - objective.z));
  const anchor = enabled && living.length ? living[state.index % living.length].position : objective;
  const desiredX = anchor.x - AIR_SUPPORT.orbitWidth, desiredZ = anchor.z;
  if (!state.initialized) {
    state.centerX = desiredX;
    state.centerZ = desiredZ;
    state.initialized = true;
    state.passes = 1;
  } else {
    const dx = desiredX - state.centerX, dz = desiredZ - state.centerZ;
    const distance = Math.hypot(dx, dz), step = Math.min(1, dt * 3 / (distance || 1));
    state.centerX += dx * step;
    state.centerZ += dz * step;
  }
  const phaseSpeed = AIR_SUPPORT.speed / Math.hypot(AIR_SUPPORT.orbitWidth * Math.sin(state.phase),
    AIR_SUPPORT.orbitLength * Math.cos(state.phase));
  const previousLap = Math.floor((state.phase + Math.PI / 2) / (Math.PI * 2));
  state.phase += phaseSpeed * dt;
  state.passes += Math.floor((state.phase + Math.PI / 2) / (Math.PI * 2)) - previousLap;
  position.x = state.centerX + AIR_SUPPORT.orbitWidth * Math.cos(state.phase);
  position.y = AIR_SUPPORT.altitude + state.index * 3;
  position.z = state.centerZ - AIR_SUPPORT.orbitLength * Math.sin(state.phase);
  const velocityX = -AIR_SUPPORT.orbitWidth * Math.sin(state.phase);
  const velocityZ = -AIR_SUPPORT.orbitLength * Math.cos(state.phase);
  state.heading = Math.atan2(-velocityX, -velocityZ);
  state.roll = -.2;
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (!enabled || state.cooldown > 0) return null;
  const target = living.find(actor => {
    const point = { x: actor.position.x, y: actor.position.y + 1, z: actor.position.z };
    const dx = point.x - position.x, dz = point.z - position.z;
    const along = -dx * Math.sin(state.heading) - dz * Math.cos(state.heading);
    const across = Math.abs(dx * Math.cos(state.heading) - dz * Math.sin(state.heading));
    return along > 18 && along < 85 && across < 12 && visible(position, point);
  });
  if (!target) return null;
  state.cooldown = AIR_SUPPORT.interval;
  state.shots++;
  state.targetId = target.id;
  const start = { x: position.x - Math.sin(state.heading) * 2.8, y: position.y + .17,
    z: position.z - Math.cos(state.heading) * 2.8 };
  const dx = target.position.x - start.x, dy = target.position.y + 1 - start.y;
  const dz = target.position.z - start.z;
  return { start, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
