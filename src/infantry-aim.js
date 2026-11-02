export const INFANTRY_AIM_PITCH = Object.freeze({
  minimum: -.5,
  maximum: .72,
  raiseRate: 2.2,
  lowerRate: 1.6,
  minimumRange: .5,
});

export function updateInfantryAimPitch(actor, target, muzzle, dt) {
  if (!actor || !Number.isFinite(dt) || dt < 0) throw new RangeError('Infantry aim requires a finite nonnegative timestep');
  if (!muzzle || ![muzzle.x, muzzle.y, muzzle.z].every(Number.isFinite)) {
    throw new TypeError('Infantry aim requires a finite muzzle position');
  }
  const current = actor.aimPitch ?? 0;
  if (!Number.isFinite(current) || current < INFANTRY_AIM_PITCH.minimum || current > INFANTRY_AIM_PITCH.maximum) {
    throw new RangeError('Infantry aim pitch is outside its supported range');
  }

  let desired = 0;
  if (target) {
    if (![target.x, target.y, target.z].every(Number.isFinite)) throw new TypeError('Infantry aim target must be finite');
    const horizontal = Math.hypot(target.x - muzzle.x, target.z - muzzle.z);
    desired = Math.atan2(target.y - muzzle.y, Math.max(horizontal, INFANTRY_AIM_PITCH.minimumRange));
    desired = Math.max(INFANTRY_AIM_PITCH.minimum, Math.min(INFANTRY_AIM_PITCH.maximum, desired));
  }

  const rate = target ? INFANTRY_AIM_PITCH.raiseRate : INFANTRY_AIM_PITCH.lowerRate;
  const step = rate * dt;
  actor.aimPitch = current + Math.max(-step, Math.min(step, desired - current));
  return actor.aimPitch;
}
