import { Quaternion, Vector3 } from 'three';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';

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

export function createNraMotion(profile, actor) {
  if (!Number.isFinite(actor?.walkPhase) || actor.walkPhase < 0 || !validPosition(actor.position) ||
    !Number.isFinite(profile?.strideMeters) || profile.strideMeters <= 0 ||
    !Array.isArray(profile.muzzle) || profile.muzzle.length !== 3 || !profile.muzzle.every(Number.isFinite)) {
    throw new Error('Invalid native motion profile');
  }
  if (profile.walk && (!Number.isFinite(profile.walkStrideMeters) || profile.walkStrideMeters <= 0)) throw new Error('Invalid walking stride');
  if (profile.leanPivot && (!Array.isArray(profile.leanPivot) || profile.leanPivot.length !== 3 ||
    !profile.leanPivot.every(Number.isFinite))) throw new Error('Invalid owned torso pivot');
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
  return { profile, aim: 0, bodyLean: 0, runLean: .11 + .12 * Math.sin(seed * 7.7) ** 2,
    fireLean: Math.sin(seed * 11.7) > .3 ? .035 + .07 * Math.sin(seed * 5.3) ** 2 : 0,
    legLift: .55 + .3 * Math.sin(seed * 17.3) ** 2,
    posture: Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, 0])),
    idleTime: seed * .7, strideScale: 1 + .07 * Math.sin(seed * 3.1), speed: 0, weight: 0, distance: seed / 2.5,
    position: { x: actor.position.x, z: actor.position.z } };
}

export function advanceNraMotion(actor, dt) {
  const motion = actor.nativeMotion;
  if (!motion || !Number.isFinite(dt) || dt < 0 || !validPosition(actor.position) ||
    !Number.isFinite(actor.locomotion?.speed) || actor.locomotion.speed < 0) {
    throw new Error('Native motion requires owned finite gait, speed and simulation time');
  }
  if (dt === 0) return;
  motion.distance += Math.hypot(actor.position.x - motion.position.x, actor.position.z - motion.position.z);
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
  const leanTarget = !motion.profile.leanPivot ? 0 : actor.locomotion.speed > .2
    ? motion.runLean * (actor.aimWalking ? .2 : pace === 'sprint' ? 1.25 : pace === 'walk' ? .3 : Math.min(1, actor.locomotion.speed / 3.15))
    : actor.tactics?.lastSeen ? motion.fireLean : 0;
  motion.bodyLean += (leanTarget - motion.bodyLean) * (1 - Math.exp(-dt / .18));
  const target = motion.speed > .15 ? 1 : 0;
  motion.weight += (target - motion.weight) * (1 - Math.exp(-dt / .12));
  if (motion.weight < .001) motion.weight = 0;
  if (motion.weight > .999) motion.weight = 1;
}

export function sampleNraMotion(actor) {
  const motion = actor.nativeMotion;
  if (!motion || !validPosition(actor.position)) throw new Error('Native motion state is missing');
  const { profile } = motion;
  const idleTime = motion.idleTime % profile.idle.duration;
  const distance = motion.distance + Math.hypot(actor.position.x - motion.position.x, actor.position.z - motion.position.z);
  const runTime = ((distance / (profile.strideMeters * motion.strideScale)) % 1) * profile.run.duration;
  const walkTime = profile.walk ? ((distance / (profile.walkStrideMeters * motion.strideScale)) % 1) * profile.walk.duration : runTime;
  const transition = Math.max(0, Math.min(1, (motion.speed - 2.1) / .9));
  const jog = profile.walk ? transition * transition * (3 - 2 * transition) : 1;
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
  if (bodyLean && profile.leanPivot) {
    const lean = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -bodyLean);
    const pivot = new Vector3().fromArray(profile.leanPivot);
    blendedPosition.sub(pivot).applyQuaternion(lean).add(pivot);
    quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), motion.speed > .2 && motion.aim < .5 ? -bodyLean * .35 : 0));
  }
  return { idleTime, runTime, walkTime, jog, bodyLean, legLift: motion.legLift, ...motion.posture, postures: { ...motion.posture }, upright, weight: motion.weight, speed: motion.speed,
    weaponPosition: blendedPosition.toArray(), weaponQuaternion: quaternion.toArray() };
}

export function nativeMuzzleLocal(actor) {
  const pose = sampleNraMotion(actor);
  const result = new Vector3().fromArray(actor.nativeMotion.profile.muzzle)
    .applyQuaternion(new Quaternion().fromArray(pose.weaponQuaternion))
    .add(new Vector3().fromArray(pose.weaponPosition));
  return { x: result.x, y: result.y, z: result.z };
}
