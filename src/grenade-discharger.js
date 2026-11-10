import { createProjectile, advanceProjectile } from './projectiles.js';
import { BLAST_PROFILES } from './blast-profiles.js';
import { sihangNorthBank, sihangBlastClearOfSouthBank } from './sihang-layout.js';

// Gameplay values; the compact model is original geometry, not a measured historical asset.
export const GRENADE_DISCHARGER = Object.freeze({
  name: '八九式掷弹筒', minRange: 18, maxRange: 210, ammo: 12, reserve: 12,
  setupSeconds: 1.2, reloadSeconds: 6, querySeconds: 1.5, spread: 18,
  closeAimRadius: 3, missMinRadius: 8, baseAccuracy: .25, movingAccuracyScale: .5, suppressedAccuracyScale: .6,
  damage: BLAST_PROFILES['grenade-discharger'].damage, radius: BLAST_PROFILES['grenade-discharger'].radius, activeLimit: 8, trajectorySegments: 24,
});

export function createGrenadeDischarger() {
  return { model: 'type89', ammo: GRENADE_DISCHARGER.ammo, reserve: GRENADE_DISCHARGER.reserve,
    phase: 'carrying', anchor: null, setupUntil: 0, nextShot: 0, queryAt: 0,
    targetId: null, aimPoint: null, priority: null, shots: 0, rejected: null, presentationActive: false };
}

export function stowGrenadeDischarger(weapon) {
  weapon.phase = 'carrying'; weapon.anchor = null; weapon.targetId = null; weapon.aimPoint = null; weapon.priority = null;
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

export function dischargerAccuracy(operator, target, now) {
  if (![operator?.position?.x, operator?.position?.z, target?.position?.x, target?.position?.z, now].every(Number.isFinite) || now < 0)
    throw new RangeError('Discharger accuracy requires finite observed positions and simulation time');
  const distance = Math.hypot(target.position.x - operator.position.x, target.position.z - operator.position.z);
  const rangePenalty = Math.max(0, Math.min(1, (distance - 40) / 160));
  let accuracy = GRENADE_DISCHARGER.baseAccuracy + .05 - rangePenalty * .15;
  if ((target.locomotion?.speed ?? 0) > .5) accuracy *= GRENADE_DISCHARGER.movingAccuracyScale;
  if (now < (operator.tactics?.suppressedUntil ?? 0)) accuracy *= GRENADE_DISCHARGER.suppressedAccuracyScale;
  return accuracy;
}

export function createDischargerShell({ id, source, start, target, firedAt, random = Math.random,
  accuracy = GRENADE_DISCHARGER.baseAccuracy }) {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) throw new RangeError('Invalid discharger accuracy probability');
  const sample = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Discharger randomness must lie in [0, 1)');
    return value;
  };
  const closeAim = sample() < accuracy, angle = sample() * Math.PI * 2;
  const minimum = closeAim ? .75 : GRENADE_DISCHARGER.missMinRadius;
  const maximum = closeAim ? GRENADE_DISCHARGER.closeAimRadius : GRENADE_DISCHARGER.spread;
  const spread = Math.sqrt(minimum ** 2 + sample() * (maximum ** 2 - minimum ** 2));
  const destination = { x: target.x + Math.sin(angle) * spread, y: target.y,
    z: target.z + Math.cos(angle) * spread };
  const distance = Math.hypot(destination.x - start.x, destination.z - start.z);
  const shell = createProjectile({ id, source, start, target: destination, firedAt,
    duration: 1.5 + distance / 55, damage: GRENADE_DISCHARGER.damage, radius: GRENADE_DISCHARGER.radius });
  shell.kind = 'grenade-discharger'; shell.blastKind = 'grenade-discharger';
  shell.aim = Object.freeze({ intended: Object.freeze({ ...target }), accuracy, closeAim, error: spread });
  shell.arcHeight = 5 + distance * .16;
  return shell;
}

export function dischargerShellDirection(shell) {
  if (!Number.isFinite(shell?.duration) || shell.duration <= 0 || !Number.isFinite(shell.elapsed) ||
    !Number.isFinite(shell.arcHeight)) throw new RangeError('Discharger visual requires a valid projectile trajectory');
  const fraction = Math.max(0, Math.min(1, shell.elapsed / shell.duration));
  const vector = { x: shell.target.x - shell.start.x,
    y: shell.target.y - shell.start.y + Math.PI * Math.cos(fraction * Math.PI) * shell.arcHeight,
    z: shell.target.z - shell.start.z };
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0) throw new Error('Discharger trajectory has no finite flight direction');
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function dischargerTrajectoryClear(shell, trace) {
  const event = dischargerTrajectoryImpact(shell, trace);
  if (!event.collided) return true;
  return Math.hypot(event.position.x - shell.target.x, event.position.z - shell.target.z,
    event.position.y - shell.target.y) < .75;
}

export function dischargerTrajectoryImpact(shell, trace) {
  const probe = { ...shell, position: { ...shell.start }, active: true, elapsed: 0 };
  for (let index = 0; index < GRENADE_DISCHARGER.trajectorySegments; index++) {
    const event = advanceProjectile(probe, shell.duration / GRENADE_DISCHARGER.trajectorySegments, trace);
    if (event) return event;
  }
  const final = advanceProjectile(probe, Math.max(1e-8, shell.duration - probe.elapsed), trace);
  if (!final) throw new Error('Discharger impact preview did not reach its bounded trajectory endpoint');
  return final;
}

export function dischargerAimTrajectory(shell) {
  if (!shell.aim?.intended) throw new Error('Discharger aim path requires the observed firing position');
  const target = shell.aim.intended;
  const distance = Math.hypot(target.x - shell.start.x, target.z - shell.start.z);
  return { ...shell, target, duration: 1.5 + distance / 55, arcHeight: 5 + distance * .16 };
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
