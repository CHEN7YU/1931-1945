const mix = (from, to, blend) => from + (to - from) * blend;
const approach = (from, to, rate, dt) => mix(from, to, 1 - Math.exp(-rate * dt));
const clamp = value => Math.max(0, Math.min(1, value));

function civilianFootCycle(phase, running, active, height, cadence) {
  const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const stance = mix(.62, .4, running), swing = clamp((cycle - stance) / (1 - stance));
  const travel = Math.PI * 2 / cadence * stance / height * active;
  const airborne = cycle > stance;
  const roll = airborne ? -.12 * Math.sin(swing * Math.PI * 2) * active
    : mix(.16, -.2, cycle / stance) * active;
  return {
    z: airborne ? mix(travel / 2, -travel / 2, swing - Math.sin(swing * Math.PI * 2) / (Math.PI * 2))
      : mix(-travel / 2, travel / 2, cycle / stance),
    lift: (airborne ? Math.sin(Math.PI * swing) ** 2 * mix(.075, .23, running) * active : 0) +
      Math.sin(roll) * (roll > 0 ? .085 : -.17),
    roll,
    stance: !airborne,
  };
}

export function advanceCivilianMotion(person, { dt, now, moved, dx = 0, dz = 0, mode = 'route' }) {
  if (![dt, now, moved, dx, dz].every(Number.isFinite) || dt < 0 || moved < 0)
    throw new RangeError('Civilian motion requires finite movement and simulation time');
  const data = person.userData;
  const motion = data.escapeMotion ??= { speed: 0, crouch: 0, protective: 0 };
  motion.speed = approach(motion.speed, dt > 0 ? moved / dt : 0, 9, dt);
  motion.crouch = approach(motion.crouch, mode === 'cower' ? 1 : 0, 7, dt);
  if (motion.crouch > .999) motion.crouch = 1;
  else if (motion.crouch < .001) motion.crouch = 0;
  motion.protective = approach(motion.protective, mode === 'cower' ? 1 : mode === 'flee' ? .35 : 0, 7, dt);
  const cadence = data.ageGroup === 'child' ? 6.3 : data.ageGroup === 'elderly' ? 5.6 : 5;
  data.walkPhase += moved * cadence;
  if (moved > .0001 && Math.hypot(dx, dz) > .0001) {
    const desired = Math.atan2(-dx, -dz);
    const delta = Math.atan2(Math.sin(desired - person.rotation.y), Math.cos(desired - person.rotation.y));
    person.rotation.y += Math.max(-3.8 * dt, Math.min(3.8 * dt, delta));
  }
  const active = Math.min(1, motion.speed / .65) * (1 - motion.crouch);
  const phase = data.walkPhase;
  const amplitude = active * (['flee', 'boarding'].includes(mode) ? .65 : .46);
  const stride = Math.sin(phase) * amplitude;
  motion.stride = stride;
  const running = clamp((motion.speed - 1.8) / 1.6);
  motion.feet = [0, Math.PI].map(offset => civilianFootCycle(phase + offset, running, active,
    person.civilianSkin.profile.height, cadence));
  const supportReach = Math.max(...motion.feet.map(foot => foot.stance ? Math.abs(foot.z) : 0));
  motion.rootY = Math.min(-.025 * active, (Math.sqrt(.795 ** 2 - supportReach ** 2) - .795) * active);
  motion.lean = mix(data.ageGroup === 'elderly' ? -.13 : -.035, -.14,
    Math.max(motion.protective, running));
  motion.sway = Math.sin(phase) * .025 * active;
  motion.headX = .06 * motion.protective;
  motion.headY = Math.sin(now * .8 + data.civilianId) * .13 * motion.protective;
  if (mode === 'waiting') {
    motion.sway += Math.sin(now * .55 + data.civilianId) * .018;
    motion.headX += Math.sin(now * .7 + data.civilianId) * .04;
    motion.headY += Math.sin(now * .65 + data.civilianId * 2.17) * .22;
  }
  if (mode === 'street') {
    motion.lean = data.ageGroup === 'elderly' ? -.1 : -.025;
    motion.headY = Math.sin(now * .7 + data.civilianId) * .16;
  }
  restoreCivilianMotionPose(person);
  data.escapeMode = mode;
}

export function restoreCivilianMotionPose(person) {
  const motion = person.userData.escapeMotion;
  if (!motion || person.userData.dead) return;
  const stride = motion.stride;
  if (person.userData.refugeeRestPoint || person.userData.seatedContacts) for (const side of ['left', 'right'])
    for (const part of ['Leg', 'Knee', 'Foot']) {
      person.civilianSkin.joints[`${side}${part}`].rotation.y = 0;
      person.civilianSkin.joints[`${side}${part}`].rotation.z = 0;
    }
  const joints = person.civilianSkin.joints;
  joints.root.position.y = motion.rootY ?? 0;
  for (const [index, side] of ['left', 'right'].entries()) {
    if (!motion.feet) {
      person.civilianLegs[index].rotation.x = index ? stride : -stride;
      continue;
    }
    const foot = motion.feet[index], vertical = .8 + motion.rootY - foot.lift;
    const distance = Math.min(.7999, Math.hypot(vertical, foot.z));
    const hip = Math.atan2(-foot.z, vertical) +
      Math.acos(Math.max(-1, Math.min(1, (.405 ** 2 + distance ** 2 - .395 ** 2) / (.81 * distance))));
    const knee = -Math.acos(Math.max(-1, Math.min(1,
      (distance ** 2 - .405 ** 2 - .395 ** 2) / (2 * .405 * .395))));
    joints[`${side}Leg`].rotation.set(hip, 0, 0);
    joints[`${side}Knee`].rotation.set(knee, 0, 0);
    joints[`${side}Foot`].rotation.set(-hip - knee + foot.roll, 0, 0);
  }
  const active = Math.min(1, motion.speed / 1.2) * (1 - motion.crouch);
  const running = Math.max(0, Math.min(1, (motion.speed - 1.8) / 1.6));
  const ageScale = person.userData.ageGroup === 'elderly' ? .75 : 1;
  for (const [index, side] of ['left', 'right'].entries()) {
    const phase = person.userData.walkPhase + index * Math.PI, arm = person.civilianArms[index];
    arm.rotation.x = Math.sin(phase) * (.25 + running * .12) * active * ageScale;
    arm.rotation.y = Math.sin(phase - .3) * .025 * active;
    arm.rotation.z = (index ? -1 : 1) * (.025 + .02 * running) * active;
    person.civilianSkin.joints[`${side}Elbow`].rotation.set(.18 + active *
      (.08 + running * .45 + (.1 + running * .12) * (.5 + .5 * Math.sin(phase - .6))), 0, 0);
  }
  person.civilianTorso.rotation.x = motion.lean;
  person.civilianTorso.rotation.z = motion.sway;
  person.civilianHead.rotation.x = motion.headX;
  person.civilianHead.rotation.y = motion.headY;
}

export function applyCivilianProtectivePose(person) {
  const motion = person.userData.escapeMotion;
  if (!motion || person.userData.dead) return;
  const { joints, profile } = person.civilianSkin;
  const childHeld = profile.carrying === 'child', luggage = profile.carrying === 'luggage';
  const crouch = motion.crouch * (childHeld ? .75 : 1);
  const hip = .92 * crouch, knee = -1.8 * crouch;
  const drop = .405 * (1 - Math.cos(hip)) + .395 * (1 - Math.cos(hip + knee));
  joints.root.position.y = mix(motion.rootY ?? 0, -drop, crouch);
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
  if (!childHeld && !luggage && motion.crouch > 0) {
    joints.root.position.y += (-.79 - joints.root.position.y) * motion.crouch;
    for (const side of ['left', 'right']) {
      joints[`${side}Leg`].rotation.x = mix(joints[`${side}Leg`].rotation.x, 2.15, motion.crouch);
      joints[`${side}Knee`].rotation.x = mix(joints[`${side}Knee`].rotation.x, -2.8, motion.crouch);
      joints[`${side}Foot`].rotation.x = mix(joints[`${side}Foot`].rotation.x, .65, motion.crouch);
    }
    joints.torso.rotation.x = mix(joints.torso.rotation.x, -.8, motion.crouch);
    joints.head.rotation.x = mix(joints.head.rotation.x, -.85, motion.crouch);
    applyCivilianSeatedContacts(person, motion.crouch, true);
  }
}
import { applyCivilianSeatedContacts } from './civilian-refugees.js';
