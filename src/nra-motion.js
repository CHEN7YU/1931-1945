import { Quaternion, Vector3 } from 'three';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';
import { RIFLE_CONTACTS } from './rifle-contacts.js';
import { infantryWeaponProfile } from './rifle-action.js';
import { rifleHandAction } from './rifle-hand-action.js';
import { machineGunReloadPose } from './machine-gun-reload.js';
import { projectHeadAim, projectUnaimedEye, solveHeadAimGoal } from './head-aim.js';
import { grenadePose } from './grenades.js';
import { hasBayonet, bayonetCarry, bayonetBodyMotion } from './bayonet.js';
import { headingError } from './ai-turning.js';
import { INFANTRY_AIM_PITCH } from './infantry-aim.js';
import { advancePostureBlend } from './posture-transition.js';
import { dadaoBodyMotion } from './dadao.js';
import { updateFootContacts } from './foot-contact.js';

export function nativePoseIntent(actor) {
  if (actor.weaponBlocked) return 'travel';
  return actor.grenades?.action ? 'grenade' : actor.health > 0 && actor.dadao?.equipped ? 'dadao'
    : actor.health > 0 && hasBayonet(actor) && actor.bayonet && actor.bayonet.mode !== 'idle'
    ? 'bayonet' : actor.rifle?.action === 'reload' ? 'reload' : actor.rifleReady === true ? 'aim' : 'travel';
}

export function nativeChestFireTarget(actor) {
  return infantryWeaponProfile(actor.rifle).automatic && actor.shoulderAiming !== true &&
    actor.health > 0 && !actor.vehicleId && !actor.emplacementId && !actor.weaponMount?.active &&
    !actor.supportWeaponPose?.active && !actor.discharger?.presentationActive &&
    ['standing', 'crouched', 'kneeling'].includes(ownedFiringPose(actor)) &&
    nativePoseIntent(actor) === 'aim' ? 1 : 0;
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
const eyeSamples = new WeakMap();

const smoothSpeed = (speed, start, end) => {
  const t = Math.max(0, Math.min(1, (speed - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export function nativeTravelLean(motion) {
  const jog = smoothSpeed(motion.speed, 1.5, 3.3), fast = smoothSpeed(motion.speed, 3.2, 4.8);
  const acceleration = Math.max(0, Math.min(1, (motion.acceleration ?? 0) / 4));
  const firingLean = .045 + .17 * jog + .045 * fast + .055 * acceleration;
  const travelLean = Math.min(.74, .045 + (.6108652382 - .045) * smoothSpeed(motion.speed, 1.5, 2.7) +
    (.7330382858 - .6108652382) * smoothSpeed(motion.speed, 2.7, 4.1) + .055 * acceleration);
  const chestFire = motion.chestFire ?? 0;
  return (travelLean * (1 - chestFire) + firingLean * chestFire) * (1 - .82 * motion.gaitAim);
}

export function nativeGaitParameters(motion) {
  const { profile } = motion;
  const charge = motion.gaitCharge, aimed = motion.gaitAim;
  const transition = Math.max(0, Math.min(1, (motion.speed - 2.1) / .9));
  const jog = transition * transition * (3 - 2 * transition) * (1 - aimed);
  return { jog, charge, aimed, style: aimed > .5 ? 'aim' : jog > .5 ? charge > .5 ? 'charge' : 'short' : 'walk',
    runStride: (1.6 + .7 * charge + .35 * charge * (1 - charge)) * motion.strideScale,
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
  const compression = .012 * Math.sin(phase * Math.PI * 2) ** 2;
  const walkDrop = (.045 - .01 * gait.aimed) + compression * (1 - .7 * gait.aimed);
  const drop = walkDrop * (1 - gait.jog) + (.075 + compression - rise) * gait.jog;
  const turnDrop = .045 * (motion.turn?.weight ?? 0) * (1 - motion.weight);
  const thrustDrop = nativePoseIntent(actor) === 'bayonet'
    ? bayonetBodyMotion(actor.bayonet.mode === 'charge' ? 0 : actor.bayonet.extension).drop : 0;
  return (drop * motion.weight + turnDrop + thrustDrop) * upright;
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
  const chestFire = nativeChestFireTarget(actor);
  const fireStyle = Math.floor(seed * 17.3) % 2;
  const motion = { profile, aim: 0, lowReady: profile.lowReadyCarry && !ready ? 1 : 0,
    chestFire, fireStyle, fireTargetId: actor.target?.id ?? null,
    hipFire: Number(Boolean(chestFire && infantryWeaponProfile(actor.rifle).smg && fireStyle)),
    travelCarryStyle: Math.floor(seed * 13.7) % 3, travelCarryBlend: 0,
    cheekWeight: profile.headAim && ready && !chestFire ? 1 : 0, headGoal: null,
    bodyLean: 0, runLean: .23 + .03 * Math.sin(seed * 7.7) ** 2,
    fireLean: Math.sin(seed * 11.7) > .3 ? .035 + .07 * Math.sin(seed * 5.3) ** 2 : 0,
    legLift: .55 + .3 * Math.sin(seed * 17.3) ** 2,
    posture: Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, 0])),
    idleTime: seed * .7, strideScale: 1 + .07 * Math.sin(seed * 3.1), speed: 0, acceleration: 0, weight: 0, distance: seed / 2.5,
    gaitCharge: 0, gaitAim: 0, gaitCycles: seed / 2.5 / profile.strideMeters, phaseDistance: seed / 2.5,
    position: { x: actor.position.x, z: actor.position.z },
    turn: { heading: actor.heading ?? 0, angle: 0, direction: 1, weight: 0 } };
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
  const measuredSpeed = traveled / dt;
  const fireTargetId = actor.target?.id ?? null;
  if (fireTargetId !== motion.fireTargetId) {
    motion.fireTargetId = fireTargetId;
    if (fireTargetId) {
      let hash = Math.floor(actor.walkPhase * 17.3);
      for (const letter of fireTargetId) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
      motion.fireStyle = hash % 2;
    }
  }
  const chestTarget = nativeChestFireTarget(actor);
  motion.chestFire += (chestTarget - motion.chestFire) * (1 - Math.exp(-dt / .12));
  const hipTarget = chestTarget && infantryWeaponProfile(actor.rifle).smg && motion.fireStyle ? 1 : 0;
  motion.hipFire = (motion.hipFire ?? 0) + (hipTarget - (motion.hipFire ?? 0)) * (1 - Math.exp(-dt / .15));
  if (motion.hipFire < .001) motion.hipFire = 0;
  if (motion.hipFire > .999) motion.hipFire = 1;
  if (motion.chestFire < .001) motion.chestFire = 0;
  if (motion.chestFire > .999) motion.chestFire = 1;
  const turn = motion.turn, heading = actor.heading ?? 0;
  const angularStep = headingError(turn.heading, heading);
  turn.heading = heading;
  const stepping = actor.health > 0 && actor.tactics && !actor.emplacementId &&
    !actor.discharger?.presentationActive && actor.locomotion.speed < .2 &&
    (actor.stance ?? 'standing') !== 'prone' && Math.abs(angularStep) / dt > .12;
  const direction = Math.sign(angularStep);
  const reversingStep = stepping && turn.direction !== direction && turn.weight > .05;
  if (stepping && !reversingStep) {
    if (turn.direction !== direction) turn.angle = 0;
    turn.angle += Math.abs(angularStep);
    turn.direction = direction;
  }
  // Release the old support step before mirroring it; a direction change must not snap both planted feet.
  turn.weight += ((stepping && !reversingStep ? 1 : 0) - turn.weight) * (1 - Math.exp(-dt / .08));
  if (turn.weight < .001) { turn.weight = 0; turn.angle = 0; }
  const beforeGait = motion.profile.footCycleGait ? nativeGaitParameters(motion) : null;
  motion.distance += traveled;
  motion.position = { x: actor.position.x, z: actor.position.z };
  motion.idleTime += dt;
  const stance = actor.stance ?? 'standing';
  if (!['standing', 'crouched', 'prone'].includes(stance)) throw new Error('Unknown owned soldier stance');
  const pose = ownedFiringPose(actor);
  advancePostureBlend(motion, pose, dt);
  const acceleration = Math.max(-8, Math.min(8, (measuredSpeed - motion.speed) / .1));
  motion.acceleration += (acceleration - motion.acceleration) * (1 - Math.exp(-dt / .16));
  motion.speed += (measuredSpeed - motion.speed) * (1 - Math.exp(-dt / .1));
  motion.aim += ((actor.aimWalking ? 1 : 0) - motion.aim) * (1 - Math.exp(-dt / .15));
  const pace = actor.locomotion.mode;
  motion.gaitCharge += ((smoothSpeed(motion.speed, 3.2, 4.8) * (1 - motion.gaitAim)) - motion.gaitCharge) * (1 - Math.exp(-dt / .22));
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
  const travelCarry = nativePoseIntent(actor) === 'travel' && actor.health > 0 &&
    !actor.emplacementId && !actor.vehicleId && !actor.discharger?.presentationActive &&
    !actor.supportWeaponPose?.active && !actor.sihangShield?.active && !actor.formation?.sihangDemolition &&
    actor.engineer?.construction?.mode !== 'building'
    ? smoothSpeed(motion.speed, .7, 2.8) : 0;
  motion.travelCarryBlend += (travelCarry - motion.travelCarryBlend) * (1 - Math.exp(-dt / .22));
  const leanTarget = !motion.profile.leanPivot ? 0 : measuredSpeed > .2
    ? nativeTravelLean(motion)
    : actor.tactics?.lastSeen ? motion.fireLean : 0;
  motion.bodyLean += (leanTarget - motion.bodyLean) * (1 - Math.exp(-dt / .18));
  const target = measuredSpeed > .15 ? 1 : 0;
  motion.weight += (target - motion.weight) * (1 - Math.exp(-dt / .12));
  if (motion.weight < .001) motion.weight = 0;
  if (motion.weight > .999) motion.weight = 1;
  if (motion.profile.footCycleGait)
    updateFootContacts(actor, nativeGaitParameters(motion), motion.gaitCycles, traveled);
  if (motion.profile.headAim) {
    const target = nativePoseIntent(actor) === 'aim' && motion.lowReady < .2 ? 1 - motion.chestFire : 0;
    motion.cheekWeight += (target - motion.cheekWeight) * (1 - Math.exp(-dt / .12));
    if (motion.cheekWeight < .001) motion.cheekWeight = 0;
    if (motion.cheekWeight > .999) motion.cheekWeight = 1;
    syncNativeAimGoal(actor);
  }
}

export function syncNativeAimGoal(actor) {
  const motion = actor.nativeMotion;
  if (motion?.profile?.headAim && nativePoseIntent(actor) === 'aim' && motion.lowReady < .2 && motion.chestFire < .999) {
    motion.headGoal = solveHeadAimGoal(motion.profile.headAim, sampleNraMotion(actor, false), motion.headGoal);
  }
}

export function nativeEyeLocal(actor) {
  const motion = actor.nativeMotion;
  if (!motion?.profile?.headAim || !validPosition(actor.position)) throw new Error('Native eye requires a calibrated motion state');
  const { profile } = motion;
  const intent = nativePoseIntent(actor), swordCarry = intent === 'dadao' && Boolean(actor.dadao.pose);
  // Profiles are calibrated once; mutable simulation inputs must match exactly, even within a substep.
  const inputs = [profile, motion.idleTime, motion.distance, motion.position.x, motion.position.z,
    actor.position.x, actor.position.z, motion.gaitCycles, motion.phaseDistance, motion.speed,
    motion.strideScale, motion.gaitCharge, motion.gaitAim, motion.weight, motion.aim, motion.bodyLean,
    motion.lowReady, motion.legLift, actor.locomotion.mode, intent, swordCarry,
    actor.health, actor.weaponBlocked, actor.emplacementId, actor.discharger?.presentationActive,
    actor.dadao?.pose?.phase, actor.dadao?.pose?.progress, actor.dadao?.style, motion.travelCarryStyle,
    actor.bayonet?.mode, actor.bayonet?.extension,
    actor.rifle?.action, actor.rifle?.elapsed, actor.rifle?.ammo, actor.rifle?.model,
    actor.vehicleId, actor.engineer?.construction?.mode, actor.sihangShield?.active, actor.supportWeaponPose?.active,
    actor.formation?.sihangDemolition,
    motion.headGoal, motion.cheekWeight, motion.chestFire, motion.hipFire, actor.aimPitch,
    ...Object.keys(FIRING_POSES).map(name => motion.posture[name])];
  let retained = eyeSamples.get(motion);
  if (!retained || inputs.length !== retained.inputs.length || inputs.some((value, index) => value !== retained.inputs[index])) {
    let eye;
    if (motion.cheekWeight === 0 && !motion.chestFire) {
      // An unaimed eye needs the head skeleton, not the weapon/contact/error projections.
      const upright = Math.max(0, 1 - Object.values(motion.posture).reduce((sum, weight) => sum + weight, 0));
      const lowReady = (intent === 'bayonet' || swordCarry) && upright > .999 ? 1
        : profile.lowReadyCarry ? motion.lowReady * (1 - (motion.posture.prone ?? 0)) : 0;
      const torsoYaw = profile.rifleContacts && profile.leanPivot ? -.55 * (1 - lowReady) * (1 - (motion.posture.prone ?? 0)) *
        (1 - .5 * ((motion.posture.wallLeft ?? 0) + (motion.posture.wallRight ?? 0))) * (1 - .65 * motion.chestFire) : 0;
      eye = projectUnaimedEye(profile.headAim, { upright, postures: motion.posture,
        idleTime: motion.idleTime % profile.idle.duration, hipDrop: nativeGaitDrop(actor),
        bodyLean: motion.bodyLean * upright, torsoYaw,
        upperBody: sampleNativeUpperBody(actor, sampleNraPhase(actor)).upperBody });
    } else eye = sampleNraMotion(actor).headAim.eye;
    retained = { inputs, eye };
    eyeSamples.set(motion, retained);
  }
  return retained.eye;
}

export function sampleNraPhase(actor) {
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
  const upright = Math.max(0, 1 - Object.values(motion.posture).reduce((sum, weight) => sum + weight, 0));
  const dadao = nativePoseIntent(actor) === 'dadao' && actor.dadao.pose && upright > .999
    ? { ...actor.dadao.pose, style: actor.dadao.style ?? motion.travelCarryStyle % 2 } : null;
  return { idleTime, runTime, walkTime, jog, gait, travelStyle: gait?.style ?? (jog > .5 ? 'run' : 'walk'),
    ...motion.posture, upright, weight: motion.weight, dadao };
}

function sampleNativeUpperBody(actor, phase, operation = rifleHandAction(actor.rifle)) {
  const motion = actor.nativeMotion, { profile } = motion, { runTime, jog, upright } = phase;
  const intent = nativePoseIntent(actor);
  const travelWeight = profile.footCycleGait && actor.health > 0 && ['travel', 'aim'].includes(intent) &&
    !actor.weaponBlocked && !actor.emplacementId && !actor.discharger?.presentationActive &&
    !actor.formation?.sihangDemolition ? motion.weight * upright *
      (intent === 'aim' ? .22 + .78 * motion.lowReady : 1 - .65 * motion.gaitAim) : 0;
  const cycle = runTime / profile.run.duration * Math.PI * 2;
  if (phase.dadao && actor.health > 0) {
    return { travelWeight: 0, upperBody: dadaoBodyMotion(phase.dadao) };
  }
  if (intent === 'bayonet' && upright > .999) {
    const { drop, ...upperBody } = bayonetBodyMotion(actor.bayonet.mode === 'charge' ? 0 : actor.bayonet.extension);
    return { travelWeight: 0, upperBody };
  }
  const upperBody = travelWeight ? {
    yaw: Math.sin(cycle) * (.11 + .06 * jog) * travelWeight,
    pitch: Math.cos(cycle * 2) * (.008 + .008 * jog) * travelWeight,
    roll: Math.sin(cycle) * (.05 + .04 * jog) * travelWeight,
    lift: Math.cos(cycle * 2) * (.012 + .014 * jog) * travelWeight,
    lateral: Math.sin(cycle) * (.012 + .013 * jog) * travelWeight,
  } : { yaw: 0, pitch: 0, roll: 0, lift: 0, lateral: 0 };
  if (actor.health > 0 && operation && ['travel', 'aim', 'reload'].includes(intent) &&
    !actor.weaponBlocked && !actor.emplacementId && !actor.vehicleId &&
    actor.engineer?.construction?.mode !== 'building' && !actor.sihangShield?.active && !actor.supportWeaponPose?.active &&
    !actor.discharger?.presentationActive && !actor.formation?.sihangDemolition) {
    const weight = upright * (1 - travelWeight), hand = operation.hand ?? 0, loading = hand * (operation.loading ?? 0);
    const recoil = (1 - hand) * (operation.bodyRecoil ?? 0);
    upperBody.yaw += (.025 * hand - .02 * loading) * weight;
    upperBody.pitch += (.008 * loading + .009 * recoil) * weight;
    upperBody.roll += .015 * hand * weight;
    upperBody.lift -= (.004 * loading + .004 * recoil) * weight;
    upperBody.lateral += .004 * hand * weight;
  }
  return { travelWeight, upperBody };
}

export function sampleNraMotion(actor, includeHead = true, rifleOperationOverride = undefined) {
  const phase = sampleNraPhase(actor), motion = actor.nativeMotion, { profile } = motion;
  const { idleTime, runTime, walkTime, jog, gait, upright } = phase;
  const intent = nativePoseIntent(actor);
  const operation = rifleOperationOverride === undefined ? rifleHandAction(actor.rifle) : rifleOperationOverride;
  const { travelWeight, upperBody } = sampleNativeUpperBody(actor, phase, operation);
  const idle = sample(profile.idle, idleTime), run = sample(profile.run, runTime);
  const walk = profile.walk ? sample(profile.walk, walkTime) : run;
  const position = idle.position.lerp(walk.position.lerp(run.position, jog), motion.weight);
  const quaternion = idle.quaternion.slerp(walk.quaternion.slerp(run.quaternion, jog), motion.weight);
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
  const upperMoving = upperBody.yaw || upperBody.pitch || upperBody.roll || upperBody.lift || upperBody.lateral;
  if (upperMoving) {
    const upperRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), upperBody.roll)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -bodyLean + upperBody.pitch))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), upperBody.yaw))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bodyLean));
    quaternion.premultiply(upperRotation);
  }
  const bayonet = nativePoseIntent(actor) === 'bayonet' && upright > .999;
  const dadao = phase.dadao;
  const lowReady = actor.weaponBlocked || bayonet || dadao ? 1
    : profile.lowReadyCarry ? motion.lowReady * (1 - (motion.posture.prone ?? 0)) : 0;
  const aimPitch = actor.aimPitch ?? 0;
  if (!Number.isFinite(aimPitch) || aimPitch < INFANTRY_AIM_PITCH.minimum || aimPitch > INFANTRY_AIM_PITCH.maximum) {
    throw new RangeError('Native rifle aim pitch is outside its supported range');
  }
  const firingIntent = nativePoseIntent(actor) === 'aim' ? 1 : 0;
  if (aimPitch && firingIntent) {
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), aimPitch * (1 - lowReady)));
  }
  const torsoYaw = profile.rifleContacts && profile.leanPivot ? -.55 * (1 - lowReady) * (1 - (motion.posture.prone ?? 0)) *
    (1 - .5 * ((motion.posture.wallLeft ?? 0) + (motion.posture.wallRight ?? 0))) * (1 - .65 * motion.chestFire) : 0;
  const travelSway = new Vector3();
  if (lowReady) {
    const carry = motion.travelCarryBlend * upright * lowReady;
    const diagonal = motion.travelCarryStyle === 1 ? carry : 0;
    const compact = motion.travelCarryStyle === 2 ? carry : 0;
    const angle = .45 + .25 * jog + .10 * motion.gaitCharge + .12 * diagonal - .12 * compact;
    if (!profile.rifleContacts) {
      blendedPosition.y -= .06 * lowReady;
      blendedPosition.z += .16 * lowReady;
    }
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (.25 + .12 * diagonal - .10 * compact) * lowReady))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -angle * lowReady))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -.12 * diagonal + .10 * compact));
    const sway = carry * (1 - motion.gaitAim);
    if (sway > .001) {
      const effort = .18 + .52 * jog + .3 * motion.gaitCharge;
      const phase = runTime / profile.run.duration * Math.PI * 2;
      travelSway.set(
        Math.sin(phase) * .01 * effort,
        Math.cos(phase * 2) * .007 * effort,
        Math.cos(phase) * .007 * effort,
      ).multiplyScalar(sway);
      if (!profile.rifleContacts) blendedPosition.add(travelSway);
    }
  }
  const automaticReload = actor.health > 0 && !dadao && !bayonet && actor.rifle?.action === 'reload' &&
    infantryWeaponProfile(actor.rifle).automatic ? machineGunReloadPose(actor.rifle,
      { prone: motion.posture.prone ?? 0, supported: 1 }) : null;
  const machineGunReload = ['zb26', 'type11'].includes(actor.rifle?.model) ? automaticReload : null;
  if (machineGunReload) quaternion.slerp(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .15)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .65 * (1 - (motion.posture.prone ?? 0))))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .12 + .13 * (motion.posture.prone ?? 0))),
    machineGunReload.supportWeight);
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
    const chest = motion.chestFire * (1 - lowReady) * (1 - (motion.posture.prone ?? 0));
    if (chest) {
      const smg = infantryWeaponProfile(actor.rifle).smg;
      const down = Math.max(0, -aimPitch) / .5, up = Math.max(0, aimPitch) / .72;
      contact.add(new Vector3(.035, smg ? -.16 : -.22 + .05 * down,
        smg ? .06 : .18 - .14 * up + .04 * down).multiplyScalar(chest));
      if (smg) contact.add(new Vector3(.015, -.16 + .05 * down, .07 * down).multiplyScalar((motion.hipFire ?? 0) * chest));
    }
    if (machineGunReload && profile.rifleReloadContacts) {
      const support = new Vector3(...profile.rifleReloadContacts.standing).multiplyScalar(upright);
      for (const [stance, weight] of Object.entries(motion.posture))
        support.addScaledVector(new Vector3(...profile.rifleReloadContacts[stance]), weight);
      contact.lerp(support, machineGunReload.supportWeight * (1 - (motion.posture.prone ?? 0)));
    }
    contact.y -= hipDrop;
    if ((torsoYaw || bodyLean || upperMoving) && profile.leanPivot) {
      const pivot = new Vector3(...(profile.riflePivots?.standing ?? profile.leanPivot)).multiplyScalar(upright);
      for (const [stance, weight] of Object.entries(motion.posture)) {
        pivot.addScaledVector(new Vector3(...(profile.riflePivots?.[stance] ?? profile.leanPivot)), weight);
      }
      pivot.y -= hipDrop;
      contact.sub(pivot).applyAxisAngle(new Vector3(0, 1, 0), torsoYaw + upperBody.yaw)
        .applyAxisAngle(new Vector3(1, 0, 0), -bodyLean + upperBody.pitch)
        .applyAxisAngle(new Vector3(0, 0, 1), upperBody.roll).add(pivot);
    }
    contact.x += upperBody.lateral; contact.y += upperBody.lift;
    contact.add(travelSway);
    stockContact = contact.toArray();
    blendedPosition.copy(contact).sub(new Vector3(...RIFLE_CONTACTS.stock).applyQuaternion(quaternion));
  }
  if (!stockContact) {
    blendedPosition.x += upperBody.lateral; blendedPosition.y += upperBody.lift;
  }
  if (machineGunReload && motion.posture.prone > 0) {
    const prone = motion.posture.prone ?? 0;
    blendedPosition.add(new Vector3(-.04, .04 - .02 * prone, .10 + .10 * prone)
      .multiplyScalar(machineGunReload.handWeight * prone));
    stockContact = null;
  }
  const bayonetExtension = bayonet && actor.bayonet.mode !== 'charge' ? actor.bayonet.extension : 0;
  if (bayonet) {
    const thrust = bayonetCarry(bayonetExtension);
    blendedPosition.fromArray(thrust.position);
    blendedPosition.y -= hipDrop;
    quaternion.setFromAxisAngle(new Vector3(1, 0, 0), thrust.pitch);
    stockContact = null;
  }
  if (actor.weaponBlocked && !dadao) {
    blendedPosition.set(.10, Math.min(blendedPosition.y, 1.16 - hipDrop), .04);
    quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 1.45);
    stockContact = null;
  }
  const grenade = actor.health > 0 ? grenadePose(actor.grenades?.action,
    1.67 * upright + Object.entries(motion.posture).reduce((sum, [pose, weight]) => sum + FIRING_POSES[pose].eye * weight, 0)) : null;
  const result = { intent, upperBody, grenade, dadao, bayonet, automaticReload,
    rifleOperation: actor.health > 0 && !grenade && !dadao && !bayonet ? operation : null,
    weaponBlocked: Boolean(actor.weaponBlocked),
    idleTime, runTime, walkTime, jog, runPhase: runTime / profile.run.duration,
    walkPhase: profile.walk ? walkTime / profile.walk.duration : runTime / profile.run.duration,
    runStride: gait?.runStride ?? profile.strideMeters * motion.strideScale,
    walkStride: gait?.walkStride ?? (profile.walkStrideMeters ?? profile.strideMeters) * motion.strideScale,
    runContact: gait?.runContact ?? profile.runContact, walkContact: gait?.walkContact, heelHeight: gait?.heelHeight,
    walkClearance: gait?.walkClearance,
    travelStyle: phase.travelStyle,
    gaitCharge: motion.gaitCharge, gaitAim: motion.gaitAim,
    turn: { weight: motion.turn.weight, phase: cycleFraction(motion.turn.angle / (Math.PI / 3)), direction: motion.turn.direction },
    bodyLean, torsoYaw, hipDrop, lowReady, stockContact, chestFire: motion.chestFire, hipFire: motion.hipFire ?? 0,
    weaponModel: actor.rifle?.model ?? 'rifle',
    travelCarry: ['low-ready', 'diagonal-ready', 'compact-ready'][motion.travelCarryStyle],
    travelCarryBlend: motion.travelCarryBlend,
    strideScale: motion.strideScale, legLift: motion.legLift,
    ...motion.posture, postures: { ...motion.posture }, upright, weight: motion.weight, speed: motion.speed,
    footContacts: motion.footContacts ?? null,
    aimPitch: aimPitch * firingIntent * (1 - lowReady), weaponPosition: blendedPosition.toArray(), weaponQuaternion: quaternion.toArray() };
  if (includeHead && profile.headAim) result.headAim = projectHeadAim(profile.headAim, result, motion);
  return result;
}

export function nativeAimReady(actor) {
  if (actor.weaponBlocked) return false;
  if (!actor.nativeMotion) return true;
  const pose = sampleNraMotion(actor);
  if (nativeChestFireTarget(actor) && pose.chestFire > .98) {
    return pose.intent === 'aim' && actor.nativeMotion.lowReady < .05 &&
      (!pose.headAim || pose.headAim.gazeError < .08);
  }
  return actor.nativeMotion.lowReady < .05 && (!pose.headAim || pose.intent === 'aim' &&
    pose.headAim.weight > .98 && pose.headAim.sightError < .004 && pose.headAim.cheekError < .012 &&
    pose.headAim.gazeError < .05 && pose.headAim.eyeRelief > .04);
}

export function nativeMuzzleLocal(actor) {
  const pose = sampleNraMotion(actor, false);
  const profile = infantryWeaponProfile(actor.rifle);
  const result = (profile.automatic ? new Vector3(profile.muzzleX, 0, profile.muzzleZ) : new Vector3().fromArray(actor.nativeMotion.profile.muzzle))
    .applyQuaternion(new Quaternion().fromArray(pose.weaponQuaternion))
    .add(new Vector3().fromArray(pose.weaponPosition));
  return { x: result.x, y: result.y, z: result.z };
}
