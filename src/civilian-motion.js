const mix = (from, to, blend) => from + (to - from) * blend;
const approach = (from, to, rate, dt) => mix(from, to, 1 - Math.exp(-rate * dt));

export function advanceCivilianMotion(person, { dt, now, moved, dx = 0, dz = 0, mode = 'route' }) {
  if (![dt, now, moved, dx, dz].every(Number.isFinite) || dt < 0 || moved < 0)
    throw new RangeError('Civilian motion requires finite movement and simulation time');
  const data = person.userData;
  const motion = data.escapeMotion ??= { speed: 0, crouch: 0, protective: 0 };
  motion.speed = approach(motion.speed, dt > 0 ? moved / dt : 0, 9, dt);
  motion.crouch = approach(motion.crouch, mode === 'cower' ? 1 : 0, 7, dt);
  motion.protective = approach(motion.protective, mode === 'cower' ? 1 : mode === 'flee' ? .35 : 0, 7, dt);
  data.walkPhase += moved * (data.ageGroup === 'child' ? 6.3 : data.ageGroup === 'elderly' ? 5.6 : 5);
  if (moved > .0001 && Math.hypot(dx, dz) > .0001) {
    const desired = Math.atan2(-dx, -dz);
    const delta = Math.atan2(Math.sin(desired - person.rotation.y), Math.cos(desired - person.rotation.y));
    person.rotation.y += Math.max(-3.8 * dt, Math.min(3.8 * dt, delta));
  }
  const active = Math.min(1, motion.speed / 1.2) * (1 - motion.crouch);
  const phase = data.walkPhase, stride = Math.sin(phase) * active * (mode === 'flee' ? .65 : .46);
  motion.stride = stride;
  motion.lean = mix(data.ageGroup === 'elderly' ? -.13 : -.06,
    -.26, Math.max(motion.protective, Math.min(1, motion.speed / 4)));
  motion.sway = Math.sin(phase) * .025 * active;
  motion.headX = .06 * motion.protective;
  motion.headY = Math.sin(now * .8 + data.civilianId) * .13 * motion.protective;
  if (mode === 'waiting') {
    motion.sway += Math.sin(now * .55 + data.civilianId) * .018;
    motion.headX += Math.sin(now * .7 + data.civilianId) * .04;
    motion.headY += Math.sin(now * .65 + data.civilianId * 2.17) * .22;
  }
  restoreCivilianMotionPose(person);
  data.escapeMode = mode;
}

export function restoreCivilianMotionPose(person) {
  const motion = person.userData.escapeMotion;
  if (!motion) return;
  const stride = motion.stride;
  person.civilianLegs[0].rotation.x = -stride;
  person.civilianLegs[1].rotation.x = stride;
  person.civilianArms[0].rotation.x = stride * .8;
  person.civilianArms[1].rotation.x = -stride * .8;
  for (const arm of person.civilianArms) arm.rotation.z = 0;
  person.civilianTorso.rotation.x = motion.lean;
  person.civilianTorso.rotation.z = motion.sway;
  person.civilianHead.rotation.x = motion.headX;
  person.civilianHead.rotation.y = motion.headY;
}

export function applyCivilianProtectivePose(person) {
  const motion = person.userData.escapeMotion;
  if (!motion) return;
  const { joints, profile } = person.civilianSkin;
  const childHeld = profile.carrying === 'child', luggage = profile.carrying === 'luggage';
  const crouch = motion.crouch * (childHeld ? .75 : 1);
  const hip = .92 * crouch, knee = -1.8 * crouch;
  const drop = .405 * (1 - Math.cos(hip)) + .395 * (1 - Math.cos(hip + knee));
  joints.root.position.y = -drop;
  for (const [index, side] of ['left', 'right'].entries()) {
    const leg = joints[`${side}Leg`], lower = joints[`${side}Knee`], foot = joints[`${side}Foot`];
    leg.rotation.x = mix(leg.rotation.x, .92, crouch);
    lower.rotation.x = mix(lower.rotation.x, -1.8, crouch);
    foot.rotation.x = mix(foot.rotation.x, .88, crouch);
    const arm = joints[`${side}Arm`], elbow = joints[`${side}Elbow`];
    const cover = childHeld || luggage && index === 0 ? 0 : motion.protective;
    arm.rotation.x = mix(arm.rotation.x, 2.15, cover);
    arm.rotation.z = mix(arm.rotation.z, index ? -.72 : .72, cover);
    elbow.rotation.x = mix(elbow.rotation.x, 1.9, cover);
  }
  joints.torso.rotation.x = mix(joints.torso.rotation.x, -.48, crouch);
  joints.head.rotation.x = mix(joints.head.rotation.x, .3, motion.protective);
}
