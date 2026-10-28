import { throwableProfile, throwableStock } from './grenades.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function chooseAIThrowable(actor, targets, friends) {
  const choices = [];
  for (const target of targets) {
    const kind = target.kind === 'armor' ? 'explosive-pack' : 'grenade';
    const profile = throwableProfile(kind), range = distance(actor.position, target.position);
    if (!throwableStock(actor.grenades, kind) || range < (kind === 'grenade' ? 8 : 6) ||
      range > (kind === 'grenade' ? 26 : 17)) continue;
    if (friends.some(friend => friend !== actor && friend.health > 0 && !friend.vehicleId &&
      distance(friend.position, target.position) < profile.radius * .65 + 1)) continue;
    choices.push({ target, kind, range, priority: kind === 'explosive-pack' ? 0 : 1 });
  }
  choices.sort((a, b) => a.priority - b.priority || a.range - b.range);
  return choices[0] ?? null;
}

export function planAIThrow(origin, target, kind, trace, intendedVehicleId = null) {
  const profile = throwableProfile(kind);
  if (![origin.x, origin.y, origin.z, target.x, target.y, target.z].every(Number.isFinite) ||
    typeof trace !== 'function') throw new RangeError('Throw planning requires finite positions and a collision query');
  const dx = target.x - origin.x, dz = target.z - origin.z, range = Math.hypot(dx, dz);
  if (range < 1e-6) return null;
  const heightError = angle => {
    const t = range / (profile.speed * Math.cos(angle));
    return origin.y + (profile.speed * Math.sin(angle) + profile.lift) * t - profile.gravity * t * t / 2 - target.y;
  };
  let low = -.3, high = null, previous = heightError(low);
  for (let step = 1; step <= 28; step++) {
    const angle = -.3 + step * 1.5 / 28, next = heightError(angle);
    if (previous <= 0 && next >= 0) { high = angle; break; }
    low = angle; previous = next;
  }
  if (high === null) return null;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (heightError(middle) < 0) low = middle; else high = middle;
  }
  const pitch = (low + high) / 2, horizontal = Math.cos(pitch);
  const direction = { x: dx / range * horizontal, y: Math.sin(pitch), z: dz / range * horizontal };
  const duration = range / (profile.speed * horizontal);
  let before = { ...origin };
  for (let time = Math.min(.06, duration);; time = Math.min(time + .06, duration)) {
    const point = { x: origin.x + direction.x * profile.speed * time,
      y: origin.y + (direction.y * profile.speed + profile.lift) * time - profile.gravity * time * time / 2,
      z: origin.z + direction.z * profile.speed * time };
    const hit = trace(before, point, profile.size);
    if (hit) {
      if (hit.vehicleId && hit.vehicleId === intendedVehicleId || distance(hit.position, target) < .8) {
        return { direction, pitch, duration: time, landing: { ...hit.position } };
      }
      return null;
    }
    if (time >= duration) return { direction, pitch, duration, landing: { ...point } };
    before = point;
  }
}
