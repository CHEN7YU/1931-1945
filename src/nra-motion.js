import { Quaternion, Vector3 } from 'three';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';
import { RIFLE_CONTACTS } from './rifle-contacts.js';
import { infantryWeaponProfile } from './rifle-action.js';
import { projectHeadAim, solveHeadAimGoal } from './head-aim.js';

export function nativePoseIntent(actor) {
  return actor.rifle?.action === 'reload' ? 'reload' : actor.rifleReady === true ? 'aim' : 'travel';
}

function sample(track, time) {
  const local = ((time % track.duration) + track.duration) % track.duration;
  let index = 0;
  while (index < track.times.length - 2 && track.times[index + 1] <= local) index++;
  const weight = (local - track.times[index]) / (track.times[index + 1] - track.times[index]);
  const position = new Vector3().fromArray(track.positions, index * 3)
    .lerp(new Vector3().fromArray(track.positions, (index + 1) * 3), weight);
  const quaternion = new Quaternion().fromArray(track.quaternions, index * 4)
    .slerp(new Quaternion().fromArray(track.quaternions, (index + 1) * 4), weight);
  return { position, quaternion };
}

const validPosition = position => position && ['x', 'y', 'z'].every(axis => Number.isFinite(position[axis]));
const cycleFraction = phase => ((phase % 1) + 1) % 1;

export function nativeGaitParameters(motion) {
  const { profile } = motion;
  const charge = motion.gaitCharge, aimed = motion.gaitAim;
  const transition = Math.max(0, Math.min(1, (motion.speed - 2.1) / .9));
  const jog = transition * transition * (3 - 2 * transition) * (1 - aimed);
  return { jog, charge, aimed, style: aimed > .5 ? 'aim' : jog > .5 ? charge > .5 ? 'charge' : 'short' : 'walk',
    runStride: (1.7 + .85 * charge) * motion.strideScale,
    walkStride: profile.walkStrideMeters * (1 - .25 * aimed) * motion.strideScale,
    runContact: .40 - .13 * charge, walkContact: .52 + .10 * aimed,
    heelHeight: .10 + .025 * motion.legLift + .12 * charge,
    walkClearance: (.03 + .02 * motion.legLift) * (1 - .6 * aimed) };
}

function nativeCycle(actor, gait) {
  const motion = actor.nativeMotion;
  const distance = motion.distance + Math.hypot(actor.position.x - motion.position.x, actor.position.z - motion.position.z);
  const stride = gait.walkStride + (gait.runStride - gait.walkStride) * gait.jog;
  return motion.gaitCycles + (distance - motion.phaseDistance) / stride;
}

export function nativeGaitDrop(actor) {
  const motion = actor.nativeMotion;
  if (!motion?.profile?.footCycleGait) return 0;
  const upright = Math.max(0, 1 - Object.values(motion.posture).reduce((sum, weight) => sum + weight, 0));
  const gait = nativeGaitParameters(motion), phase = nativeCycle(actor, gait);
  const half = cycleFraction(phase * 2), contact = gait.runContact * 2;
  const flight = Math.max(0, (half - contact) / (1 - contact));
  const flightTime = gait.runStride * (.5 - gait.runContact) / Math.max(2.1, motion.speed);
  const rise = Math.min(.04, 9.81 * flightTime * flightTime / 8) * Math.sin(Math.PI * flight) ** 2;
  const walkDrop = (.09 - .02 * gait.aimed) + .005 * (1 - .7 * gait.aimed) * Math.sin(phase * Math.PI * 4);
  const drop = walkDrop * (1 - gait.jog) + (.105 - rise) * gait.jog;
  return drop * motion.weight * upright;
}

export function createNraMotion(profile, actor) {
  if (!Number.isFinite(actor?.walkPhase) || actor.walkPhase < 0 || !validPosition(actor.position) ||
    !Number.isFinite(profile?.strideMeters) || profile.strideMeters <= 0 ||
    !Array.isArray(profile.muzzle) || profile.muzzle.length !== 3 || !profile.muzzle.every(Number.isFinite)) {
    throw new Error('Invalid native motion profile');
  }
  if (profile.walk && (!Number.isFinite(profile.walkStrideMeters) || profile.walkStrideMeters <= 0)) throw new Error('Invalid walking stride');
  if (profile.footCycleGait && (!profile.walk || !Number.isFinite(profile.runContact) || profile.runContact <= 0 ||
    profile.runContact >= .5)) throw new Error('Foot-cycle gait requires its own walking and running contact profiles');
  if (profile.leanPivot && (!Array.isArray(profile.leanPivot) || profile.leanPivot.length !== 3 ||
    !profile.leanPivot.every(Number.isFinite))) throw new Error('Invalid owned torso pivot');
  if (profile.rifleContacts && ['standing', ...Object.keys(FIRING_POSES)].some(pose =>
    !Array.isArray(profile.rifleContacts[pose]) || profile.rifleContacts[pose].length !== 3 ||
    !profile.rifleContacts[pose].every(Number.isFinite))) throw new Error('Invalid rifle shoulder contact profile');
  if (profile.riflePivots && ['standing', ...Object.keys(FIRING_POSES)].some(pose =>
    !Array.isArray(profile.riflePivots[pose]) || profile.riflePivots[pose].length !== 3 ||
    !profile.riflePivots[pose].every(Number.isFinite))) throw new Error('Invalid rifle torso pivot profile');
  if (profile.rifleShoulderContacts && ['standing', ...Object.keys(FIRING_POSES)].some(pose =>
    !Array.isArray(profile.rifleShoulderContacts[pose]) || profile.rifleShoulderContacts[pose].length !== 3 ||
    !profile.rifleShoulderContacts[pose].every(Number.isFinite))) throw new Error('Invalid shoulder pocket profile');
  for (const track of [profile.idle, profile.run, ...[profile.walk, ...Object.keys(FIRING_POSES).map(pose => profile[pose])].filter(Boolean)]) {
    if (!track || !Number.isFinite(track.duration) || track.duration <= 0 || !Array.isArray(track.times) || track.times.length < 2 ||
      track.positions?.length !== track.times.length * 3 || track.quaternions?.length !== track.times.length * 4 ||
      ![...track.times, ...track.positions, ...track.quaternions].every(Number.isFinite) ||
      track.times[0] !== 0 || Math.abs(track.times.at(-1) - track.duration) > 1e-6 ||
      track.times.some((value, index) => index > 0 && value <= track.times[index - 1])) {
      throw new Error('Invalid native carry animation track');
    }
    for (let index = 0; index < track.quaternions.length; index += 4) {
      if (Math.abs(Math.hypot(...track.quaternions.slice(index, index + 4)) - 1) > 1e-4) throw new Error('Native carry rotations must be normalized');
    }
  }
  const seed = actor.walkPhase;
  const ready = nativePoseIntent(actor) === 'aim';
  const motion = { profile, aim: 0, lowReady: profile.lowReadyCarry && !ready ? 1 : 0,
    cheekWeight: profile.headAim && ready ? 1 : 0, headGoal: null,
    bodyLean: 0, runLean: .11 + .12 * Math.sin(seed * 7.7) ** 2,
    fireLean: Math.sin(seed * 11.7) > .3 ? .035 + .07 * Math.sin(seed * 5.3) ** 2 : 0,
    legLift: .55 + .3 * Math.sin(seed * 17.3) ** 2,
    posture: Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, 0])),
    idleTime: seed * .7, strideScale: 1 + .07 * Math.sin(seed * 3.1), speed: 0, weight: 0, distance: seed / 2.5,
    gaitCharge: 0, gaitAim: 0, gaitCycles: seed / 2.5 / profile.strideMeters, phaseDistance: seed / 2.5,
    position: { x: actor.position.x, z: actor.position.z } };
  if (profile.headAim && ready) syncNativeAimGoal({ ...actor, nativeMotion: motion });
  return motion;
}

export function advanceNraMotion(actor, dt) {
  const motion = actor.nativeMotion;
  if (!motion || !Number.isFinite(dt) || dt < 0 || !validPosition(actor.position) ||
    !Number.isFinite(actor.locomotion?.speed) || actor.locomotion.speed < 0) {
    throw new Error('Native motion requires owned finite gait, speed and simulation time');
  }
  if (dt === 0) return;
  const traveled = Math.hypot(actor.position.x - motion.position.x, actor.position.z - motion.position.z);
  const beforeGait = motion.profile.footCycleGait ? nativeGaitParameters(motion) : null;
  motion.distance += traveled;
  motion.position = { x: actor.position.x, z: actor.position.z };
  motion.idleTime += dt;
  const stance = actor.stance ?? 'standing';
  if (!['standing', 'crouched', 'prone'].includes(stance)) throw new Error('Unknown owned soldier stance');
  const pose = ownedFiringPose(actor);
  for (const posture of Object.keys(FIRING_POSES)) {
    const target = pose === posture && motion.profile[posture] ? 1 : 0;
    motion.posture[posture] += (target - motion.posture[posture]) * (1 - Math.exp(-dt / .10));
    if (motion.posture[posture] < .001) motion.posture[posture] = 0;
    if (motion.posture[posture] > .999) motion.posture[posture] = 1;
  }
  motion.speed += (actor.locomotion.speed - motion.speed) * (1 - Math.exp(-dt / .1));
  motion.aim += ((actor.aimWalking ? 1 : 0) - motion.aim) * (1 - Math.exp(-dt / .15));
  const pace = actor.locomotion.mode;
  motion.gaitCharge += ((pace === 'sprint' ? 1 : 0) - motion.gaitCharge) * (1 - Math.exp(-dt / .22));
  motion.gaitAim += ((actor.aimWalking || pace === 'aim' ? 1 : 0) - motion.gaitAim) * (1 - Math.exp(-dt / .18));
  if (motion.profile.footCycleGait) {
    const afterGait = nativeGaitParameters(motion);
    const stride = gait => gait.walkStride + (gait.runStride - gait.walkStride) * gait.jog;
    motion.gaitCycles += traveled * (.5 / stride(beforeGait) + .5 / stride(afterGait));
    motion.phaseDistance = motion.distance;
  }
  if (motion.profile.lowReadyCarry) {
    motion.lowReady += ((nativePoseIntent(actor) === 'aim' ? 0 : 1) - motion.lowReady) * (1 - Math.exp(-dt / .1));
    if (motion.lowReady < .001) motion.lowReady = 0;
    if (motion.lowReady > .999) motion.lowReady = 1;
  }
  const leanTarget = !motion.profile.leanPivot ? 0 : actor.locomotion.speed > .2
    ? motion.runLean * (pace === 'walk' ? .3 : (.65 + .60 * motion.gaitCharge) * (1 - .8 * motion.gaitAim))
    : actor.tactics?.lastSeen ? motion.fireLean : 0;
  motion.bodyLean += (leanTarget - motion.bodyLean) * (1 - Math.exp(-dt / .18));
  const target = motion.speed > .15 ? 1 : 0;
  motion.weight += (target - motion.weight) * (1 - Math.exp(-dt / .12));
  if (motion.weight < .001) motion.weight = 0;
  if (motion.weight > .999) motion.weight = 1;
  if (motion.profile.headAim) {
    const target = nativePoseIntent(actor) === 'aim' && motion.lowReady < .2 ? 1 : 0;
    motion.cheekWeight += (target - motion.cheekWeight) * (1 - Math.exp(-dt / .12));
    if (motion.cheekWeight < .001) motion.cheekWeight = 0;
    if (motion.cheekWeight > .999) motion.cheekWeight = 1;
    syncNativeAimGoal(actor);
  }
}

export function syncNativeAimGoal(actor) {
  const motion = actor.nativeMotion;
  if (motion?.profile?.headAim && nativePoseIntent(actor) === 'aim' && motion.lowReady < .2) {
    motion.headGoal = solveHeadAimGoal(motion.profile.headAim, sampleNraMotion(actor, false), motion.headGoal);
  }
}

export function sampleNraMotion(actor, includeHead = true) {
  const motion = actor.nativeMotion;
  if (!motion || !validPosition(actor.position)) throw new Error('Native motion state is missing');
  const { profile } = motion;
  const idleTime = motion.idleTime % profile.idle.duration;
  const distance = motion.distance + Math.hypot(actor.position.x - motion.position.x, actor.position.z - motion.position.z);
  const gait = profile.footCycleGait ? nativeGaitParameters(motion) : null;
  const cycle = gait ? nativeCycle(actor, gait) : null;
  const runTime = cycleFraction(cycle ?? distance / (profile.strideMeters * motion.strideScale)) * profile.run.duration;
  const walkTime = profile.walk ? cycleFraction(cycle ?? distance / (profile.walkStrideMeters * motion.strideScale)) * profile.walk.duration : runTime;
  const transition = Math.max(0, Math.min(1, (motion.speed - 2.1) / .9));
  const jog = gait ? gait.jog : profile.walk ? transition * transition * (3 - 2 * transition) : 1;
  const idle = sample(profile.idle, idleTime), run = sample(profile.run, runTime);
  const walk = profile.walk ? sample(profile.walk, walkTime) : run;
  const position = idle.position.lerp(walk.position.lerp(run.position, jog), motion.weight);
  const quaternion = idle.quaternion.slerp(walk.quaternion.slerp(run.quaternion, jog), motion.weight);
  const upright = Math.max(0, 1 - Object.values(motion.posture).reduce((sum, weight) => sum + weight, 0));
  const blendedPosition = position.clone().multiplyScalar(upright);
  let quaternionWeight = upright;
  for (const [stance, weight] of Object.entries(motion.posture)) {
    if (!weight) continue;
    const pose = sample(profile[stance], 0);
    blendedPosition.addScaledVector(pose.position, weight);
    quaternion.slerp(pose.quaternion, weight / (quaternionWeight + weight));
    quaternionWeight += weight;
  }
  blendedPosition.lerp(new Vector3(.13, 1.54, .04), motion.aim * upright);
  quaternion.slerp(new Quaternion(), motion.aim * upright);
  const bodyLean = motion.bodyLean * upright;
  const hipDrop = nativeGaitDrop(actor);
  blendedPosition.y -= hipDrop;
  if (bodyLean && profile.leanPivot) {
    const lean = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -bodyLean);
    const pivot = new Vector3().fromArray(profile.leanPivot);
    pivot.y -= hipDrop;
    blendedPosition.sub(pivot).applyQuaternion(lean).add(pivot);
    quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), motion.speed > .2 && motion.aim < .5 ? -bodyLean * .35 : 0));
  }
  const lowReady = profile.lowReadyCarry ? motion.lowReady * (1 - (motion.posture.prone ?? 0)) : 0;
  const torsoYaw = profile.rifleContacts && profile.leanPivot ? -.55 * (1 - lowReady) * (1 - (motion.posture.prone ?? 0)) *
    (1 - .5 * ((motion.posture.wallLeft ?? 0) + (motion.posture.wallRight ?? 0))) : 0;
  if (lowReady) {
    const angle = .45 + .25 * jog + (actor.locomotion.mode === 'sprint' ? .10 : 0);
    if (!profile.rifleContacts) {
      blendedPosition.y -= .06 * lowReady;
      blendedPosition.z += .16 * lowReady;
    }
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .25 * lowReady))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -angle * lowReady));
  }
  let stockContact = null;
  if (profile.rifleContacts) {
    const contact = new Vector3(...profile.rifleContacts.standing).multiplyScalar(upright);
    for (const [stance, weight] of Object.entries(motion.posture)) contact.addScaledVector(new Vector3(...profile.rifleContacts[stance]), weight);
    if (profile.rifleShoulderContacts) {
      const raised = new Vector3(...profile.rifleShoulderContacts.standing).multiplyScalar(upright);
      for (const [stance, weight] of Object.entries(motion.posture)) raised.addScaledVector(new Vector3(...profile.rifleShoulderContacts[stance]), weight);
      contact.add(new Vector3(...RIFLE_CONTACTS.armpit));
      contact.lerp(raised, 1 - lowReady);
    } else contact.add(new Vector3(...RIFLE_CONTACTS.shoulder).lerp(new Vector3(...RIFLE_CONTACTS.armpit), lowReady));
    contact.y -= hipDrop;
    if ((torsoYaw || bodyLean) && profile.leanPivot) {
      const pivot = new Vector3(...(profile.riflePivots?.standing ?? profile.leanPivot)).multiplyScalar(upright);
      for (const [stance, weight] of Object.entries(motion.posture)) {
        pivot.addScaledVector(new Vector3(...(profile.riflePivots?.[stance] ?? profile.leanPivot)), weight);
      }
      pivot.y -= hipDrop;
      contact.sub(pivot).applyAxisAngle(new Vector3(0, 1, 0), torsoYaw)
        .applyAxisAngle(new Vector3(1, 0, 0), -bodyLean).add(pivot);
    }
    stockContact = contact.toArray();
    blendedPosition.copy(contact).sub(new Vector3(...RIFLE_CONTACTS.stock).applyQuaternion(quaternion));
  }
  const result = { intent: nativePoseIntent(actor), idleTime, runTime, walkTime, jog, runPhase: runTime / profile.run.duration,
    walkPhase: profile.walk ? walkTime / profile.walk.duration : runTime / profile.run.duration,
    runStride: gait?.runStride ?? profile.strideMeters * motion.strideScale,
    walkStride: gait?.walkStride ?? (profile.walkStrideMeters ?? profile.strideMeters) * motion.strideScale,
    runContact: gait?.runContact ?? profile.runContact, walkContact: gait?.walkContact, heelHeight: gait?.heelHeight,
    walkClearance: gait?.walkClearance,
    travelStyle: gait?.style ?? (jog > .5 ? 'run' : 'walk'),
    gaitCharge: motion.gaitCharge, gaitAim: motion.gaitAim,
    bodyLean, torsoYaw, hipDrop, lowReady, stockContact, strideScale: motion.strideScale, legLift: motion.legLift,
    ...motion.posture, postures: { ...motion.posture }, upright, weight: motion.weight, speed: motion.speed,
    weaponPosition: blendedPosition.toArray(), weaponQuaternion: quaternion.toArray() };
  if (includeHead && profile.headAim) result.headAim = projectHeadAim(profile.headAim, result, motion);
  return result;
}

export function nativeAimReady(actor) {
  if (!actor.nativeMotion) return true;
  const pose = sampleNraMotion(actor);
  return actor.nativeMotion.lowReady < .05 && (!pose.headAim || pose.intent === 'aim' &&
    pose.headAim.weight > .98 && pose.headAim.sightError < .004 && pose.headAim.cheekError < .012 &&
    pose.headAim.gazeError < .05 && pose.headAim.eyeRelief > .04);
}

export function nativeMuzzleLocal(actor) {
  const pose = sampleNraMotion(actor);
  const profile = infantryWeaponProfile(actor.rifle);
  const result = (profile.automatic ? new Vector3(profile.muzzleX, 0, profile.muzzleZ) : new Vector3().fromArray(actor.nativeMotion.profile.muzzle))
    .applyQuaternion(new Quaternion().fromArray(pose.weaponQuaternion))
    .add(new Vector3().fromArray(pose.weaponPosition));
  return { x: result.x, y: result.y, z: result.z };
}
