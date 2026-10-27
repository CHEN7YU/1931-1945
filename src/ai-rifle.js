import { shootRifle, reloadRifle, RIFLE } from './rifle-action.js';

export const AI_RIFLE = Object.freeze({ sightRange: 75, checkInterval: .1, maxSightGap: .2, stationarySpeed: .1 });

export function createAIRifleControl() {
  return { targetId: null, aimingSince: null, confirmedAt: null, nextCheckAt: 0, blocked: 'no-target', lastShot: null };
}

export function resetAIRifleAim(control, reason) {
  control.targetId = control.aimingSince = control.confirmedAt = null;
  control.nextCheckAt = 0;
  control.blocked = reason;
}

export function rifleAIAimSeconds(distance, suppressed) {
  if (!Number.isFinite(distance) || distance < 0 || typeof suppressed !== 'boolean') throw new RangeError('AI aim requires finite distance and explicit suppression');
  return .45 + Math.min(distance, AI_RIFLE.sightRange) / AI_RIFLE.sightRange * .65 + (suppressed ? .25 : 0);
}

export function attemptAIRifleShot(actor, { now, targetId, mayFire, postureSettled, suppressed, confirmShot }) {
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(actor.nextFire) ||
    !Number.isFinite(actor.health) || typeof actor.locomotion.sprinting !== 'boolean' ||
    !Number.isInteger(actor.rifle.ammo) || actor.rifle.ammo < 0 || actor.rifle.ammo > RIFLE.magazine ||
    !['idle', 'cycle', 'reload'].includes(actor.rifle.action) ||
    !Number.isFinite(actor.locomotion.speed) || actor.locomotion.speed < 0 ||
    !Number.isFinite(actor.locomotion.aimRecovery) || actor.locomotion.aimRecovery < 0 ||
    ![mayFire, postureSettled, suppressed].every(value => typeof value === 'boolean') ||
    targetId !== null && (typeof targetId !== 'string' || !targetId) || typeof confirmShot !== 'function') {
    throw new RangeError('AI rifle fire requires explicit simulation, target and movement facts');
  }
  const control = actor.aiRifle, rifle = actor.rifle;
  const blocked = actor.health <= 0 || actor.vehicleId ? 'inactive'
    : !mayFire || targetId === null ? 'no-fire-solution'
    : actor.locomotion.sprinting || actor.locomotion.speed > AI_RIFLE.stationarySpeed ? 'moving'
    : actor.locomotion.aimRecovery > 0 ? 'recovering'
    : !postureSettled ? 'posture'
    : rifle.action !== 'idle' || rifle.ammo <= 0 ? 'weapon'
    : now < actor.nextFire ? 'cadence' : null;
  if (blocked) { resetAIRifleAim(control, blocked); return false; }
  if (targetId !== control.targetId) resetAIRifleAim(control, 'new-target');
  if (now < control.nextCheckAt) return false;
  const distance = confirmShot();
  if (distance !== null && (!Number.isFinite(distance) || distance < 0)) throw new RangeError('AI shot confirmation must return a visible distance or null');
  if (distance === null || distance > AI_RIFLE.sightRange) {
    resetAIRifleAim(control, distance === null ? 'blocked-line' : 'range');
    control.nextCheckAt = now + AI_RIFLE.checkInterval;
    control.targetId = targetId;
    return false;
  }
  if (control.confirmedAt === null || now - control.confirmedAt > AI_RIFLE.maxSightGap + 1e-8) control.aimingSince = now;
  control.targetId = targetId;
  control.confirmedAt = now;
  control.nextCheckAt = now + AI_RIFLE.checkInterval;
  control.blocked = 'aiming';
  const required = rifleAIAimSeconds(distance, suppressed), aimed = now - control.aimingSince;
  if (aimed + 1e-8 < required) return false;
  if (!shootRifle(rifle)) throw new Error('AI rifle changed after firing readiness was validated');
  control.lastShot = Object.freeze({ time: now, targetId, distance, suppressed, aimingSince: control.aimingSince,
    aimedSeconds: aimed, requiredSeconds: required, ammo: rifle.ammo, shots: rifle.shots });
  if (rifle.ammo === 0) reloadRifle(rifle);
  resetAIRifleAim(control, 'weapon');
  return true;
}
