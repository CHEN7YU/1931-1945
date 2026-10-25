const kinds = new Set(['person', 'exposed-crew', 'closed-armor', 'aircraft']);
const weapons = new Set(['rifle', 'explosion', 'cannon', 'aircraft-gun', 'collision']);

export function canWeaponDamageTarget(weapon, kind) {
  if (!weapons.has(weapon) || !kinds.has(kind)) throw new RangeError(`Unknown weapon/target classification: ${weapon}/${kind}`);
  return weapon !== 'rifle' || kind !== 'closed-armor';
}

export function damageForTarget(weapon, kind, damage) {
  if (!Number.isFinite(damage) || damage < 0) throw new RangeError('Damage must be non-negative and finite');
  return canWeaponDamageTarget(weapon, kind) ? damage : 0;
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
