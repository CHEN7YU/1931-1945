import { SIHANG_WAREHOUSE, SIHANG_DEFENSE_POSTS } from './sihang-layout.js';

export const SIHANG_COVER_DISTANCE = 20;

export function sihangBreachGoal(actor, campaign) {
  if (!campaign?.northWallBreached || campaign.outcome || actor.team !== 'enemy' ||
    actor.health <= 0 || actor.vehicleId || actor.formation?.sihangDemolition || actor.position.y > 2.4) return null;
  const x = ((actor.index ?? 0) % 5 - 2) * .9, z = SIHANG_WAREHOUSE.minZ - 1.6;
  const approaching = actor.position.z < z - .7 ||
    actor.position.z < SIHANG_WAREHOUSE.minZ - .5 && Math.abs(actor.position.x - x) > .7;
  return { x, y: 0, z: approaching ? z : SIHANG_WAREHOUSE.minZ + 6 + (actor.index ?? 0) % 3 * 2,
    transit: true, assault: true };
}

export function sihangAssaultFiringWindow(actor, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Assault requires simulation time');
  return (now + (actor.index ?? 0) * .53) % 5.2 < 2.6;
}

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

const upperPosts = [1, 2].flatMap(level =>
  SIHANG_DEFENSE_POSTS.filter(post => post.y === SIHANG_WAREHOUSE.floorHeight * level).slice(0, 5));

export function sihangDefenseGoal(formationIndex, index) {
  if (!Number.isInteger(formationIndex) || formationIndex < 1 || formationIndex > 3 ||
    !Number.isInteger(index) || index < 0 || index > 10) throw new RangeError('Invalid Sihang defense assignment');
  const ordinal = (formationIndex - 1) * 11 + index;
  if (ordinal < 4) return { x: -29 + ordinal * 6, y: 0, z: -45.5,
    heading: 0, duty: 'ground-intercept', transit: true };
  if (ordinal < 21) {
    const slot = ordinal - 4;
    return { x: slot < 15 ? -26 + slot % 5 * 12 : -20 + (slot - 15) * 24,
      y: 0, z: slot < 15 ? -35 + Math.floor(slot / 5) * 10 : -30,
      heading: 0, duty: 'ground-defense', transit: true };
  }
  if (ordinal < 31) return { ...upperPosts[ordinal - 21], duty: 'wall-fire', transit: true };
  return { x: ordinal === 31 ? -14 : -11, y: SIHANG_WAREHOUSE.roofY, z: -35,
    heading: 0, duty: 'roof-aa', stationId: ordinal === 31 ? 'sihang-roof-aa' : null, transit: true };
}
