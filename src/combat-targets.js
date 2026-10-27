import { RIFLE } from './rifle-action.js';

export const RIFLE_HIT_DAMAGE = Object.freeze({ head: 100, torso: 100, limb: 40 });
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

export function damageForTarget(weapon, kind, damage, hitZone = null) {
  if (!Number.isFinite(damage) || damage < 0) throw new RangeError('Damage must be non-negative and finite');
  if (!canWeaponDamageTarget(weapon, kind)) return 0;
  if (weapon !== 'rifle') return damage;
  if (!Object.hasOwn(RIFLE_HIT_DAMAGE, hitZone)) throw new RangeError('Rifle person damage requires a confirmed anatomical hit zone');
  return Math.min(damage, RIFLE_HIT_DAMAGE[hitZone]);
}

export function rifleAIFireDelay(distance, suppressed, random) {
  if (!Number.isFinite(distance) || distance < 0 || typeof suppressed !== 'boolean' || !Number.isFinite(random) || random < 0 || random > 1) throw new RangeError('Invalid AI firing inputs');
  return RIFLE.cycleSeconds + (distance <= 10 ? .15 + random * .25 : .4 + random * .7) + (suppressed ? .35 : 0);
}

export function rifleAIHitChance(distance, suppressed) {
  if (!Number.isFinite(distance) || distance < 0 || typeof suppressed !== 'boolean') throw new RangeError('Invalid AI target distance or suppression');
  if (distance > 75) return 0;
  const points = [[0, .55], [10, .5], [20, .25], [40, .1], [60, .03], [75, .01]];
  for (let i = 1; i < points.length; i++) {
    if (distance > points[i][0]) continue;
    const [from, a] = points[i - 1], [to, b] = points[i];
    return (a + (b - a) * (distance - from) / (to - from)) * (suppressed ? .55 : 1);
  }
  throw new Error('AI hit chance curve does not cover its sight range');
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
