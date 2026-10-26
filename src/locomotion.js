import { moveGround } from './core.js';

// Prototype tuning in metres and seconds, not measured Enlisted parameters.
export const FOOT_SPEEDS = Object.freeze({
  infantry: Object.freeze({ walk: 1.75, jog: 3.15, sprint: 4.8, crouch: 1.35, prone: .55, aim: 1.5, load: 1 }),
  mortar: Object.freeze({ walk: 1.4, jog: 2.45, sprint: 3.7, crouch: 1.05, prone: .42, aim: 1.2, load: 1.3 }),
});
const approach = (value, target, rate, dt) => target + (value - target) * Math.exp(-rate * dt);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createLocomotion() {
  return {
    vx: 0, vz: 0, speed: 0, targetSpeed: 0, stamina: 1, exhausted: false, regenDelay: 0,
    mode: 'idle', sprinting: false, sprintBlend: 0, aimRecovery: 0,
    distance: 0, groundDistance: 0, stride: 0, phase: 0, steps: 0, gait: 0,
    cameraX: 0, cameraY: 0, cameraRoll: 0, weaponX: 0, weaponY: 0, weaponPitch: 0,
    turn: 0, landing: 0, landingVelocity: 0, previousYaw: null,
  };
}

export function stopLocomotion(motion) {
  motion.vx = motion.vz = motion.speed = motion.targetSpeed = 0;
  motion.sprinting = false;
  motion.mode = 'idle';
  motion.gait = motion.sprintBlend = 0;
  motion.cameraX = motion.cameraY = motion.cameraRoll = 0;
  motion.weaponX = motion.weaponY = motion.weaponPitch = motion.turn = 0;
  motion.landing = motion.landingVelocity = 0;
  motion.previousYaw = null;
}

export function recoverLocomotion(motion, dt, rate = .1) {
  const available = Math.max(0, dt - motion.regenDelay);
  motion.regenDelay = Math.max(0, motion.regenDelay - dt);
  motion.stamina = Math.min(1, motion.stamina + available * rate);
  if (motion.exhausted && motion.stamina >= .35) motion.exhausted = false;
  motion.aimRecovery = Math.max(0, motion.aimRecovery - dt);
}

export function advanceStamina(motion, dt, sprinting, load = 1, recoveryRate = .1) {
  if (!Number.isFinite(dt) || dt < 0 || typeof sprinting !== 'boolean' ||
      !Number.isFinite(load) || load <= 0 || !Number.isFinite(recoveryRate) || recoveryRate < 0) {
    throw new RangeError('Stamina requires finite non-negative time/rate and a positive load');
  }
  if (dt === 0) return;
  if (sprinting) {
    motion.stamina = Math.max(0, motion.stamina - dt * .14 * load);
    motion.regenDelay = 1.4;
    motion.aimRecovery = .45;
    if (motion.stamina === 0) motion.exhausted = true;
  } else recoverLocomotion(motion, dt, recoveryRate);
}

export function landLocomotion(motion, impactSpeed) {
  motion.landingVelocity -= Math.min(.6, Math.abs(impactSpeed) * .065);
}

export function advanceLocomotion(motion, position, input, obstacles, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Locomotion requires a non-negative finite timestep');
  if (dt === 0) return 0;
  const profile = FOOT_SPEEDS[input.type];
  if (!profile) throw new Error(`No foot movement profile for ${input.type}`);
  const forward = input.forward || 0, sideways = input.sideways || 0;
  const magnitude = Math.max(1, Math.hypot(forward, sideways));
  const moving = Math.hypot(forward, sideways) > 0;
  const grounded = input.grounded !== false;
  const stepsBefore = motion.steps;
  const divisions = Math.ceil(dt * 120);
  const h = dt / divisions;
  let distance = 0;
  let sprintDistance = 0;
  let mode = 'idle';
  for (let i = 0; i < divisions; i++) {
    const sprint = moving && forward > 0 && input.sprint && !input.aiming && !input.walking &&
      !input.busy && input.stance === 'standing' && grounded && !motion.exhausted && motion.stamina > 0;
    mode = !moving ? 'idle' : input.stance === 'prone' ? 'prone' : input.stance === 'crouched' ? 'crouch' :
      input.aiming ? 'aim' : input.walking ? 'walk' : sprint ? 'sprint' : 'jog';
    let targetSpeed = mode === 'idle' ? 0 : profile[mode];
    if (forward < 0) targetSpeed *= .8;
    const targetX = (-Math.sin(input.yaw) * forward + Math.cos(input.yaw) * sideways) / magnitude * targetSpeed;
    const targetZ = (-Math.cos(input.yaw) * forward - Math.sin(input.yaw) * sideways) / magnitude * targetSpeed;
    const deltaX = targetX - motion.vx, deltaZ = targetZ - motion.vz;
    const delta = Math.hypot(deltaX, deltaZ);
    const acceleration = (!moving ? 13 : input.aiming || input.stance !== 'standing' ? 15 : 8) / profile.load;
    const fraction = delta ? Math.min(1, acceleration * h / delta) : 0;
    const nextX = motion.vx + deltaX * fraction, nextZ = motion.vz + deltaZ * fraction;
    const dx = (motion.vx + nextX) * .5 * h, dz = (motion.vz + nextZ) * .5 * h;
    const x = position.x, z = position.z;
    moveGround(position, dx, dz, .4, obstacles);
    const actualX = position.x - x, actualZ = position.z - z;
    const travelled = Math.hypot(actualX, actualZ);
    distance += travelled;
    motion.vx = Math.abs(actualX - dx) < .00001 ? nextX : 0;
    motion.vz = Math.abs(actualZ - dz) < .00001 ? nextZ : 0;
    motion.targetSpeed = targetSpeed;
    const effort = sprint && travelled / h > profile.jog + .1;
    motion.sprinting = Boolean(effort);
    if (effort) {
      sprintDistance += travelled;
    }
    advanceStamina(motion, h, Boolean(effort), profile.load, mode === 'idle' ? .2 : mode === 'walk' || mode === 'crouch' ? .14 : .065);
    motion.sprintBlend = approach(motion.sprintBlend, effort ? 1 : 0, effort ? 7 : 12, h);
    if (grounded) {
      const strideLength = mode === 'prone' ? .85 : mode === 'crouch' ? 1.3 : effort ? 2.7 : mode === 'walk' || mode === 'aim' ? 1.55 : 2.1;
      motion.stride += travelled / strideLength;
      motion.groundDistance += travelled;
    }
    motion.landingVelocity += (-110 * motion.landing - 17 * motion.landingVelocity) * h;
    motion.landing += motion.landingVelocity * h;
  }
  motion.distance += distance;
  motion.speed = distance / dt;
  motion.mode = motion.speed < .06 ? 'idle' : mode;
  const sprintWeight = distance ? sprintDistance / distance : 0;
  const gaitTarget = grounded ? Math.min(1, motion.speed / (mode === 'prone' ? .5 : mode === 'crouch' ? 1.1 : 2)) : 0;
  motion.gait = approach(motion.gait, gaitTarget, 15, dt);
  const phase = motion.stride * Math.PI * 2;
  motion.phase = phase % (Math.PI * 2);
  motion.steps = Math.floor(motion.stride * 2);
  const stanceScale = input.stance === 'prone' ? .22 : input.stance === 'crouched' ? .55 : 1;
  const aimScale = input.aiming ? .18 : 1;
  const amplitude = motion.gait * stanceScale * aimScale * (1 + sprintWeight * .55);
  const turnDelta = motion.previousYaw === null ? 0 : Math.atan2(Math.sin(input.yaw - motion.previousYaw), Math.cos(input.yaw - motion.previousYaw));
  motion.previousYaw = input.yaw;
  motion.turn = approach(motion.turn, clamp(turnDelta / dt, -3, 3), 9, dt);
  motion.cameraX = Math.sin(phase) * .018 * amplitude;
  motion.cameraY = -Math.cos(phase * 2) * .026 * amplitude;
  motion.cameraRoll = Math.sin(phase) * .004 * amplitude;
  motion.weaponX = approach(motion.weaponX, Math.sin(phase + .5) * .027 * amplitude - motion.turn * .012 * aimScale, 14, dt);
  motion.weaponY = approach(motion.weaponY, -Math.cos(phase * 2 + .7) * .022 * amplitude - motion.sprintBlend * .07, 14, dt);
  motion.weaponPitch = approach(motion.weaponPitch, motion.sprintBlend * -.19 + motion.landing * .6, 14, dt);
  return motion.steps - stepsBefore;
}
