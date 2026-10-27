import { Quaternion, Vector3 } from 'three';

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
  for (const track of [profile.idle, profile.run, ...[profile.walk, profile.crouched, profile.prone].filter(Boolean)]) {
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
  return { profile, posture: { crouched: 0, prone: 0 }, idleTime: seed * .7, strideScale: 1 + .035 * Math.sin(seed * 3.1), speed: 0, weight: 0, distance: seed / 2.5,
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
  for (const posture of ['crouched', 'prone']) {
    const target = stance === posture && motion.profile[posture] ? 1 : 0;
    motion.posture[posture] += (target - motion.posture[posture]) * (1 - Math.exp(-dt / .10));
    if (motion.posture[posture] < .001) motion.posture[posture] = 0;
    if (motion.posture[posture] > .999) motion.posture[posture] = 1;
  }
  motion.speed += (actor.locomotion.speed - motion.speed) * (1 - Math.exp(-dt / .1));
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
  const crouched = motion.posture.crouched, prone = motion.posture.prone, upright = 1 - crouched - prone;
  const blendedPosition = position.clone().multiplyScalar(upright);
  let quaternionWeight = upright;
  for (const [stance, weight] of [['crouched', crouched], ['prone', prone]]) {
    if (!weight) continue;
    const pose = sample(profile[stance], 0);
    blendedPosition.addScaledVector(pose.position, weight);
    quaternion.slerp(pose.quaternion, weight / (quaternionWeight + weight));
    quaternionWeight += weight;
  }
  return { idleTime, runTime, walkTime, jog, crouched, prone, weight: motion.weight, speed: motion.speed,
    weaponPosition: blendedPosition.toArray(), weaponQuaternion: quaternion.toArray() };
}

export function nativeMuzzleLocal(actor) {
  const pose = sampleNraMotion(actor);
  const result = new Vector3().fromArray(actor.nativeMotion.profile.muzzle)
    .applyQuaternion(new Quaternion().fromArray(pose.weaponQuaternion))
    .add(new Vector3().fromArray(pose.weaponPosition));
  return { x: result.x, y: result.y, z: result.z };
}
