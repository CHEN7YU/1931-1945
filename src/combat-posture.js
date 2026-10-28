export const FIRING_POSES = Object.freeze({
  crouched: { stance: 'crouched', eye: 1.05, aim: .7, body: 1.2 },
  kneeling: { stance: 'crouched', eye: 1.12, aim: .8, body: 1.3 },
  prone: { stance: 'prone', eye: .45, aim: .3, body: .65 },
  wallLeft: { stance: 'standing', eye: 1.59, aim: 1.15, body: 1.76 },
  wallRight: { stance: 'standing', eye: 1.59, aim: 1.15, body: 1.76 },
});

export function ownedFiringPose(actor) {
  const pose = actor.firingPose;
  if (pose != null && !FIRING_POSES[pose]) throw new RangeError('Unknown owned firing pose');
  return pose && FIRING_POSES[pose]?.stance === actor.stance ? pose : actor.stance ?? 'standing';
}

export function wallFiringContact(position, heading, pieces) {
  let nearest = null;
  const c = Math.cos(heading), s = Math.sin(heading);
  for (const piece of pieces) {
    if (!piece.wall || piece.y - piece.h / 2 > position.y + 1.1 || piece.y + piece.h / 2 < position.y + 1.5) continue;
    const x = Math.max(piece.x - piece.w / 2, Math.min(piece.x + piece.w / 2, position.x));
    const z = Math.max(piece.z - piece.d / 2, Math.min(piece.z + piece.d / 2, position.z));
    const dx = x - position.x, dz = z - position.z;
    if (Math.abs(dx) > .62 || Math.abs(dz) > .62) continue;
    const distance = Math.hypot(dx, dz);
    if (distance < .4 || distance > .62 || nearest && distance >= nearest.distance) continue;
    const side = dx * c - dz * s;
    if (Math.abs(side) < distance * .75) continue;
    nearest = { pose: side < 0 ? 'wallLeft' : 'wallRight', wallId: piece.id, distance };
  }
  return nearest;
}

export function chooseCombatPosture({ distance, moving, covered, exposed, suppressed, proneClear, canFire,
  preference = .5, wall = null, previousPose = null }) {
  if (!Number.isFinite(distance) || distance < 0 || ![moving, covered, exposed, suppressed, proneClear].every(value => typeof value === 'boolean') ||
    typeof canFire !== 'function' || !Number.isFinite(preference) || preference < 0 || preference >= 1 ||
    wall && !['wallLeft', 'wallRight'].includes(wall.pose)) throw new RangeError('Combat posture requires explicit finite tactical facts');
  if (moving) return 'standing';
  if (covered && !exposed) return 'crouched';
  if (wall && canFire(wall.pose)) return wall.pose;
  let choices = [
    ['standing', suppressed ? 8 : 25], ['kneeling', 45], ['crouched', 15],
    ...(!covered && distance >= 14 && proneClear ? [['prone', suppressed ? 40 : 25]] : []),
  ].filter(([pose]) => canFire(pose));
  if (choices.some(([pose]) => pose !== previousPose)) choices = choices.filter(([pose]) => pose !== previousPose);
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let draw = preference * total;
  for (const [pose, weight] of choices) { draw -= weight; if (draw < 0) return pose; }
  return 'crouched';
}

export function chooseAdvancePace({ preference, urgent, threat, distance, exhausted, stamina, catchUp = false, constrained = false }) {
  if (!Number.isFinite(preference) || preference < 0 || preference >= 1 || !Number.isFinite(distance) || distance < 0 ||
    !Number.isFinite(stamina) || stamina < 0 || stamina > 1 ||
    ![urgent, threat, exhausted, catchUp, constrained].every(value => typeof value === 'boolean')) throw new RangeError('Advance pace needs bounded personal and tactical facts');
  if (constrained) return threat && preference < .3 ? 'aim' : 'walk';
  if (urgent || catchUp && distance > 14 || !threat && distance > 10 + preference * 6) {
    return !exhausted && stamina > .2 ? 'sprint' : 'jog';
  }
  if (threat) return preference < .3 ? 'aim' : 'jog';
  return distance < 4 ? 'walk' : 'jog';
}

export function chooseShotRelocation({ position, threat, preference, blocked, heightAt, canFinish = () => true }) {
  if (![position?.x, position?.z, threat?.x, threat?.z, preference].every(Number.isFinite) ||
    preference < 0 || preference >= 1 || typeof blocked !== 'function' || typeof heightAt !== 'function' ||
    typeof canFinish !== 'function') throw new RangeError('Shot relocation requires an observed threat and spatial queries');
  const heading = Math.atan2(threat.z - position.z, threat.x - position.x), side = preference < .5 ? -1 : 1;
  for (const turn of [side * Math.PI / 2, -side * Math.PI / 2, side * 2.2, -side * 2.2, Math.PI]) {
    const length = 2.6 + preference * 1.2;
    const goal = { x: position.x + Math.cos(heading + turn) * length, z: position.z + Math.sin(heading + turn) * length };
    const steps = Math.ceil(length / .3), base = heightAt(position);
    let clear = true;
    for (let step = 1; step <= steps; step++) {
      const point = { x: position.x + (goal.x - position.x) * step / steps, z: position.z + (goal.z - position.z) * step / steps };
      if (blocked(point) || Math.abs(heightAt(point) - base) > .25) { clear = false; break; }
    }
    if (clear && canFinish(goal)) return goal;
  }
  return null;
}

export function postureReady(actor) {
  if (!actor.nativeMotion) return true;
  const pose = ownedFiringPose(actor), weights = actor.nativeMotion.posture;
  return pose === 'standing' ? Object.values(weights).reduce((sum, weight) => sum + weight, 0) < .05 : weights[pose] > .95;
}
