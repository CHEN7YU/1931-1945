import { lowStepTarget, runningStepTarget } from './nra-gait.js';

const fraction = value => ((value % 1) + 1) % 1;

export function updateFootContacts(actor, gait, cycle, traveled) {
  const motion = actor.nativeMotion, feet = motion.profile.restFeet;
  const enabled = feet && actor.health > 0 && !actor.vehicleId && !actor.emplacementId &&
    !actor.discharger?.presentationActive && !['boarding', 'aboard'].includes(actor.tactics?.nanjingFerry?.phase) &&
    (actor.stance ?? 'standing') === 'standing' &&
    motion.weight >= .9 && traveled < .75;
  if (!enabled) {
    motion.footContacts = null;
    return;
  }
  const contacts = motion.footContacts ??= { left: null, right: null };
  const heading = actor.heading ?? 0, c = Math.cos(heading), s = Math.sin(heading);
  for (const [side, offset] of [['left', 0], ['right', .5]]) {
    const phase = fraction(cycle + offset);
    const walk = lowStepTarget(phase, gait.walkStride, gait.walkContact, gait.walkClearance);
    const run = runningStepTarget(phase, gait.runStride, gait.heelHeight, gait.runContact);
    const support = gait.jog < .05 ? phase < gait.walkContact
      : gait.jog > .95 ? phase < gait.runContact
        : phase < Math.min(gait.walkContact, gait.runContact);
    if (!support) { contacts[side] = null; continue; }
    if (contacts[side]) continue;
    const foot = feet[side], z = foot.z + walk.z + (run.z - walk.z) * gait.jog;
    contacts[side] = { x: actor.position.x + foot.x * c + z * s,
      z: actor.position.z - foot.x * s + z * c };
  }
}
