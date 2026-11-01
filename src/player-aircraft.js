import { headingError } from './ai-turning.js';

export const FLIGHT = Object.freeze({ cruiseSpeed: 48, poweredMin: 26, poweredMax: 68, maxSpeed: 82,
  stallSpeed: 24, pitchLimit: .65, diveLimit: -.7, bankLimit: .95, rollRate: 1.2, pitchRate: .6 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, rate, dt) => value + clamp(target - value, -rate * dt, rate * dt);

export function createAircraftControl(vehicle) {
  if (![vehicle.heading, vehicle.pitch].every(Number.isFinite)) throw new RangeError('Aircraft controls require a finite attitude');
  vehicle.speed = FLIGHT.cruiseSpeed;
  vehicle.throttle = .65;
  return { targetHeading: vehicle.heading, targetPitch: vehicle.pitch, pitchRate: 0, rollRate: 0,
    lookYaw: 0, lookPitch: 0, stalling: false, turnRate: 0 };
}

export function aircraftMouseLook(vehicle, x, y, sensitivity, freeLook = false) {
  if (![x, y, sensitivity].every(Number.isFinite) || sensitivity <= 0 || typeof freeLook !== 'boolean') {
    throw new RangeError('Aircraft mouse control requires finite input and sensitivity');
  }
  const control = vehicle.flightControl;
  if (!control) throw new Error('Aircraft mouse input requires its control owner');
  if (freeLook) {
    control.lookYaw = clamp(control.lookYaw - x * sensitivity, -1.8, 1.8);
    control.lookPitch = clamp(control.lookPitch - y * sensitivity, -.8, .8);
  } else {
    control.targetHeading = headingError(0, control.targetHeading - x * sensitivity);
    control.targetPitch = clamp(control.targetPitch - y * sensitivity, FLIGHT.diveLimit, FLIGHT.pitchLimit);
  }
}

export function advancePlayerAircraft(vehicle, dt, input) {
  if (!Number.isFinite(dt) || dt < 0 ||
    ![vehicle.heading, vehicle.pitch, vehicle.roll, vehicle.speed, vehicle.throttle,
      vehicle.position.x, vehicle.position.y, vehicle.position.z].every(Number.isFinite) ||
    ![input.roll, input.pitch, input.rudder, input.throttle].every(value => Number.isFinite(value) && Math.abs(value) <= 1) ||
    typeof input.freeLook !== 'boolean') throw new RangeError('Aircraft flight requires finite owned state and bounded controls');
  const control = vehicle.flightControl;
  if (!control) throw new Error('Player flight requires an aircraft control state');
  if (dt === 0 || vehicle.health <= 0) return;
  vehicle.throttle = clamp(vehicle.throttle + input.throttle * dt * .3, 0, 1);
  if (input.pitch) control.targetPitch = clamp(vehicle.pitch + input.pitch * .35, FLIGHT.diveLimit, FLIGHT.pitchLimit);
  const headingDelta = headingError(vehicle.heading, control.targetHeading);
  const bank = input.roll ? input.roll * FLIGHT.bankLimit : clamp(headingDelta * 1.5, -FLIGHT.bankLimit, FLIGHT.bankLimit);
  const desiredRollRate = clamp((bank - vehicle.roll) * 3, -FLIGHT.rollRate, FLIGHT.rollRate);
  control.rollRate = approach(control.rollRate, desiredRollRate, 3, dt);
  vehicle.roll = clamp(vehicle.roll + control.rollRate * dt, -FLIGHT.bankLimit, FLIGHT.bankLimit);
  const desiredPitchRate = clamp((control.targetPitch - vehicle.pitch) * 2.5, -FLIGHT.pitchRate, FLIGHT.pitchRate);
  control.pitchRate = approach(control.pitchRate, desiredPitchRate, 1.4, dt);
  vehicle.pitch = clamp(vehicle.pitch + control.pitchRate * dt, FLIGHT.diveLimit, FLIGHT.pitchLimit);
  const powerSpeed = FLIGHT.poweredMin + vehicle.throttle * (FLIGHT.poweredMax - FLIGHT.poweredMin);
  const drag = 4 * Math.sin(vehicle.roll) ** 2 + (1 - vehicle.throttle) * 2;
  const acceleration = clamp((powerSpeed - vehicle.speed) * .3 - Math.sin(vehicle.pitch) * 9.81 - drag, -10, 8);
  vehicle.speed = clamp(vehicle.speed + acceleration * dt, 10, FLIGHT.maxSpeed);
  const stall = clamp((FLIGHT.stallSpeed - vehicle.speed) / FLIGHT.stallSpeed, 0, 1);
  control.stalling = vehicle.speed < FLIGHT.stallSpeed;
  control.turnRate = 9.81 * Math.tan(vehicle.roll) / Math.max(vehicle.speed, FLIGHT.stallSpeed) + input.rudder * .045;
  vehicle.heading = headingError(0, vehicle.heading + control.turnRate * dt);
  if (input.roll || input.rudder) control.targetHeading = vehicle.heading;
  const horizontal = vehicle.speed * Math.cos(vehicle.pitch);
  vehicle.position.x -= Math.sin(vehicle.heading) * horizontal * dt;
  vehicle.position.z -= Math.cos(vehicle.heading) * horizontal * dt;
  vehicle.position.y += (Math.sin(vehicle.pitch) * vehicle.speed - stall * 14) * dt;
  if (!input.freeLook) {
    control.lookYaw *= Math.exp(-dt * 8); control.lookPitch *= Math.exp(-dt * 8);
    if (Math.abs(control.lookYaw) < .001) control.lookYaw = 0;
    if (Math.abs(control.lookPitch) < .001) control.lookPitch = 0;
  }
}
