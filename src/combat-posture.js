export function chooseCombatPosture({ distance, moving, covered, exposed, suppressed, proneClear, canFire }) {
  if (!Number.isFinite(distance) || distance < 0 || ![moving, covered, exposed, suppressed, proneClear].every(value => typeof value === 'boolean') ||
    typeof canFire !== 'function') throw new RangeError('Combat posture requires explicit finite tactical facts');
  if (moving) return 'standing';
  if (covered && !exposed) return 'crouched';
  if (!covered && suppressed && distance >= 22 && proneClear && canFire('prone')) return 'prone';
  if (canFire('crouched')) return 'crouched';
  return canFire('standing') ? 'standing' : 'crouched';
}

export function postureReady(actor) {
  if (!actor.nativeMotion) return true;
  const { crouched, prone } = actor.nativeMotion.posture;
  return actor.stance === 'crouched' ? crouched > .95 : actor.stance === 'prone' ? prone > .95 : crouched + prone < .05;
}
