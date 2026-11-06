export const SIHANG_COVER_DISTANCE = 20;

export function sihangCoverContext(members) {
  if (!Array.isArray(members)) throw new TypeError('Sihang cover requires a member array');
  if (!members.length) return null;
  for (const member of members) if (![member.x, member.z].every(Number.isFinite))
    throw new RangeError('Sihang cover requires finite sapper positions');
  const center = { x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
    z: members.reduce((sum, member) => sum + member.z, 0) / members.length };
  const spread = Math.max(...members.map(member => Math.hypot(member.x - center.x, member.z - center.z)));
  return { center, minimumDistance: SIHANG_COVER_DISTANCE + 2,
    radius: SIHANG_COVER_DISTANCE + spread + 4, members };
}

export function sihangOutsideCover(position, context) {
  if (!context) return true;
  if (![position?.x, position?.z].every(Number.isFinite)) throw new RangeError('Invalid support position');
  return context.members.every(member =>
    (position.x - member.x) ** 2 + (position.z - member.z) ** 2 >=
      (context.minimumDistance ?? SIHANG_COVER_DISTANCE) ** 2);
}

export function sihangCoverMovementAllowed(from, to, context) {
  if (!context || sihangOutsideCover(to, context)) return true;
  const nearest = point => Math.min(...context.members.map(member =>
    (point.x - member.x) ** 2 + (point.z - member.z) ** 2));
  return nearest(to) > nearest(from) + 1e-8;
}

export function sihangCoverCandidates(actor, context) {
  if (!context) return [];
  const origin = actor.spawnPosition ?? actor.position;
  if (![origin?.x, origin?.z].every(Number.isFinite)) throw new RangeError('Invalid cover origin');
  const side = Math.abs(origin.x - context.center.x) < 12 ? 0 : Math.sign(origin.x - context.center.x);
  const base = side * .7 + ((actor.index ?? 0) % 5 - 2) * .055;
  const points = [];
  for (const extra of [0, 4, 8]) for (const angleOffset of [0, -.15, .15, -.3, .3]) {
    const angle = base + angleOffset, radius = context.radius + extra + Math.floor((actor.index ?? 0) / 5) * 1.4;
    points.push({ x: context.center.x + Math.sin(angle) * radius,
      y: 0, z: context.center.z - Math.cos(angle) * radius, transit: true });
  }
  return points;
}

export function sihangGroundGuardGoal(index) {
  if (!Number.isInteger(index) || index < 0) throw new RangeError('Invalid ground defender index');
  return { x: -24 + index % 5 * 2, y: 0, z: -46 - Math.floor(index / 5) * 2, transit: true };
}
