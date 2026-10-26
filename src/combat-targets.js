import { RIFLE } from './rifle-action.js';

const kinds = new Set(['person', 'exposed-crew', 'closed-armor', 'aircraft']);
const weapons = new Set(['rifle', 'explosion', 'cannon', 'aircraft-gun', 'collision']);

export function canWeaponDamageTarget(weapon, kind) {
  if (!weapons.has(weapon) || !kinds.has(kind)) throw new RangeError(`Unknown weapon/target classification: ${weapon}/${kind}`);
  return weapon !== 'rifle' || (kind !== 'closed-armor' && kind !== 'aircraft');
}

export function canRiflemanTrackTarget(kind) {
  if (!kinds.has(kind)) throw new RangeError(`Unknown target classification: ${kind}`);
  return kind !== 'aircraft';
}

export function damageForTarget(weapon, kind, damage) {
  if (!Number.isFinite(damage) || damage < 0) throw new RangeError('Damage must be non-negative and finite');
  if (!canWeaponDamageTarget(weapon, kind)) return 0;
  return weapon === 'rifle' && ['person', 'exposed-crew'].includes(kind) ? Math.min(damage, RIFLE.personDamage) : damage;
}

export function rifleAIFireDelay(distance, suppressed, random) {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(random) || random < 0 || random > 1) throw new RangeError('Invalid AI firing inputs');
  return RIFLE.cycleSeconds + (distance <= 10 ? .15 + random * .25 : .4 + random * .7) + (suppressed ? .35 : 0);
}

export function rifleAIHitChance(distance, suppressed) {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Invalid AI target distance');
  if (distance <= 10) return 1;
  return .45 * Math.max(.25, 1 - distance / 100) * (suppressed ? .55 : 1);
}
export function rifleArmorResponse(position, threat, blocked) {
  const dx = position.x - threat.x, dz = position.z - threat.z, distance = Math.hypot(dx, dz);
  if (distance >= 28) return null;
  const forward = distance > .01 ? Math.atan2(dz, dx) : Math.PI / 2;
  for (const offset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const point = { x: position.x + Math.cos(forward + offset) * 6, z: position.z + Math.sin(forward + offset) * 6 };
    if (!blocked(point) && Math.hypot(point.x - threat.x, point.z - threat.z) > distance + 1) return point;
  }
  return null;
}
// ---模块结束---
