import { createProjectile, advanceProjectile } from './projectiles.js';
import { sihangNorthBank, sihangBlastClearOfSouthBank } from './sihang-layout.js';

// Gameplay values; the compact model is original geometry, not a measured historical asset.
export const GRENADE_DISCHARGER = Object.freeze({
  name: '八九式掷弹筒', minRange: 18, maxRange: 210, ammo: 12, reserve: 12,
  setupSeconds: 1.2, reloadSeconds: 6, querySeconds: 1.5, spread: 3,
  damage: 180, radius: 7, activeLimit: 8, trajectorySegments: 24,
});

export function createGrenadeDischarger() {
  return { model: 'type89', ammo: GRENADE_DISCHARGER.ammo, reserve: GRENADE_DISCHARGER.reserve,
    phase: 'carrying', anchor: null, setupUntil: 0, nextShot: 0, queryAt: 0,
    targetId: null, priority: null, shots: 0, rejected: null, presentationActive: false };
}

export function stowGrenadeDischarger(weapon) {
  weapon.phase = 'carrying'; weapon.anchor = null; weapon.targetId = null; weapon.priority = null;
  weapon.presentationActive = false;
}

export function dischargerTargetAllowed(operator, target, { sihang = false, nanjingStage = null,
  eastAssembly = false } = {}) {
  if (eastAssembly || operator.team !== 'enemy' || operator.health <= 0 || operator.vehicleId ||
    operator.formation?.sihangDemolition || !target?.position || target.team !== 'friendly' ||
    target.health <= 0 || target.vehicleId || target.targetKind === 'aircraft' ||
    target.targetKind === 'closed-armor') return false;
  const range = Math.hypot(target.position.x - operator.position.x, target.position.z - operator.position.z);
  if (range < GRENADE_DISCHARGER.minRange || range > GRENADE_DISCHARGER.maxRange) return false;
  // Leave a blast/spread margin in front of the neutral bank, not merely a legal centre point.
  if (sihang && (!sihangNorthBank(operator.position) ||
    !sihangBlastClearOfSouthBank(target.position, GRENADE_DISCHARGER.radius + GRENADE_DISCHARGER.spread))) return false;
  if (nanjingStage === 'withdrawal' && !(target.position.z > -12 &&
    Math.hypot(target.position.x, target.position.z - 27) < 40)) return false;
  return true;
}

export function dischargerPriority(target, emplacements) {
  const point = target.emplacementId && emplacements.get(target.emplacementId);
  if (point?.operatorId === target.id && point.team === 'friendly') return 0;
  if (target.mortar?.phase === 'ready' || target.mortar?.phase === 'setting-up') return 1;
  if (['zb26', 'type11'].includes(target.rifle?.model) &&
    (target.weaponMount?.active || target.stance === 'crouched' ||
      target.stance === 'prone' || (target.locomotion?.speed ?? Infinity) < .15)) return 2;
  return target.playerUnit ? 3 : 4;
}

export function selectDischargerTargets(operator, candidates, emplacements, context) {
  const ranked = candidates.filter(target => dischargerTargetAllowed(operator, target, context))
    .map(target => ({ target, priority: dischargerPriority(target, emplacements),
      distance: Math.hypot(target.position.x - operator.position.x, target.position.z - operator.position.z) }))
    .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  const selected = ranked.slice(0, 3);
  // Keep a bounded fallback when all high-priority positions are occluded.
  for (const fallback of [ranked.find(item => item.target.playerUnit), ranked.find(item => item.priority === 4)]) {
    if (fallback && !selected.includes(fallback)) selected.push(fallback);
  }
  return selected;
}

export function createDischargerShell({ id, source, start, target, firedAt, random = Math.random }) {
  const angle = random() * Math.PI * 2, spread = Math.sqrt(random()) * GRENADE_DISCHARGER.spread;
  const destination = { x: target.x + Math.sin(angle) * spread, y: target.y,
    z: target.z + Math.cos(angle) * spread };
  const distance = Math.hypot(destination.x - start.x, destination.z - start.z);
  const shell = createProjectile({ id, source, start, target: destination, firedAt,
    duration: 1.5 + distance / 55, damage: GRENADE_DISCHARGER.damage, radius: GRENADE_DISCHARGER.radius });
  shell.kind = 'grenade-discharger'; shell.blastKind = 'grenade';
  shell.arcHeight = 5 + distance * .16;
  return shell;
}

export function dischargerTrajectoryClear(shell, trace) {
  const probe = { ...shell, position: { ...shell.start }, active: true, elapsed: 0 };
  for (let index = 0; index < GRENADE_DISCHARGER.trajectorySegments; index++) {
    const event = advanceProjectile(probe, shell.duration / GRENADE_DISCHARGER.trajectorySegments, trace);
    if (event?.collided) {
      const distance = Math.hypot(event.position.x - shell.target.x, event.position.z - shell.target.z,
        event.position.y - shell.target.y);
      return distance < .75;
    }
  }
  return true;
}

export function loadDischargerRound(weapon, now, activeCount) {
  if (weapon.phase !== 'ready' || now < weapon.nextShot ||
    activeCount >= GRENADE_DISCHARGER.activeLimit || !weapon.ammo && !weapon.reserve) return false;
  if (!weapon.ammo) { weapon.ammo = weapon.reserve; weapon.reserve = 0; }
  weapon.ammo--; weapon.shots++; weapon.nextShot = now + GRENADE_DISCHARGER.reloadSeconds;
  return true;
}

export function advanceDischargerShell(shell, dt, trace) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid discharger timestep');
  let remaining = dt;
  while (remaining > 1e-8 && shell.active) {
    const step = Math.min(remaining, .04);
    const event = advanceProjectile(shell, step, trace);
    if (event) return event;
    remaining -= step;
  }
  return null;
}
