import { TYPES, shotState } from './core.js';
import { headingError } from './ai-turning.js';

export const AIRCRAFT_TURN = Object.freeze({ rate: .6, headingGain: 1.8, bankRate: .65, bankResponse: .25 });

export function advanceAircraftAI(vehicle, dt, now, { targets, canFire, visible }) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 ||
    ![vehicle.position.x, vehicle.position.y, vehicle.position.z, vehicle.heading, vehicle.pitch, vehicle.roll].every(Number.isFinite) ||
    typeof canFire !== 'boolean' || typeof visible !== 'function') throw new RangeError('Aircraft AI requires owned finite state and visibility');
  if (dt === 0 || vehicle.health <= 0) return null;
  const state = vehicle.aiFlight;
  if (!state) throw new Error('Aircraft requires an autonomous flight state');
  const p = vehicle.position;
  const start = { x: p.x - Math.sin(vehicle.heading) * 3, y: p.y,
    z: p.z - Math.cos(vehicle.heading) * 3 };
  const aimPoint = actor => ({ x: actor.position.x, y: actor.position.y + (actor.vehicleId ? 0 : 1.2), z: actor.position.z });
  if (now >= state.nextSense) {
    state.nextSense = now + .6;
    const retained = targets.find(actor => actor.id === state.targetId && actor.health > 0);
    const candidates = targets.filter(actor => actor.health > 0 && actor.team !== vehicle.team &&
      (!actor.vehicleId || actor.targetKind === 'aircraft') &&
      Math.hypot(actor.position.x - p.x, actor.position.y - p.y, actor.position.z - p.z) <= 220);
    const bearingCost = actor => Math.abs(headingError(vehicle.heading,
      Math.atan2(p.x - actor.position.x, p.z - actor.position.z))) * 60 +
      Math.hypot(actor.position.x - p.x, actor.position.z - p.z);
    candidates.sort((a, b) => Number(b.targetKind === 'aircraft') - Number(a.targetKind === 'aircraft') ||
      bearingCost(a) - bearingCost(b));
    const retainedVisible = retained && candidates.includes(retained) && visible(start, aimPoint(retained));
    state.targetId = retainedVisible ? retained.id : candidates.find(actor => visible(start, aimPoint(actor)))?.id ?? null;
  }
  const target = targets.find(actor => actor.id === state.targetId && actor.health > 0);
  const aim = target ? aimPoint(target) : null;
  const horizontal = aim ? Math.hypot(aim.x - p.x, aim.z - p.z) : Infinity;
  if (state.phase !== 'egress' && (horizontal < 30 || p.y < 12)) { state.phase = 'egress'; state.until = now + 5; }
  if (state.phase === 'egress' && now >= state.until) state.phase = 'approach';
  const edgeDistance = Math.max(Math.abs(p.x), Math.abs(p.z));
  state.returningToArea = state.returningToArea ? edgeDistance > 105 : edgeDistance > 125;
  const nearEdge = state.returningToArea;
  let desiredHeading, desiredPitch;
  if (state.phase === 'egress' && !nearEdge) {
    desiredHeading = vehicle.heading + .55;
    desiredPitch = p.y < 50 ? .22 : 0;
  } else if (aim && !nearEdge) {
    desiredHeading = Math.atan2(p.x - aim.x, p.z - aim.z);
    desiredPitch = Math.max(-.55, Math.min(.3, Math.atan2(aim.y - p.y, horizontal)));
  } else {
    desiredHeading = Math.atan2(p.x, p.z) + (nearEdge ? 0 : .75);
    desiredPitch = Math.max(-.12, Math.min(.22, (40 - p.y) * .015));
  }
  const yawDelta = headingError(vehicle.heading, desiredHeading);
  const turnRate = Math.max(-AIRCRAFT_TURN.rate, Math.min(AIRCRAFT_TURN.rate, yawDelta * AIRCRAFT_TURN.headingGain));
  const turn = Math.sign(yawDelta) * Math.min(Math.abs(yawDelta), Math.abs(turnRate) * dt);
  vehicle.heading = headingError(0, vehicle.heading + turn);
  vehicle.pitch += Math.max(-.4 * dt, Math.min(.4 * dt, desiredPitch - vehicle.pitch));
  const desiredRoll = -Math.max(-.4, Math.min(.4, turn / dt * .6));
  const bankStep = (desiredRoll - vehicle.roll) * (1 - Math.exp(-dt / AIRCRAFT_TURN.bankResponse));
  vehicle.roll += Math.max(-AIRCRAFT_TURN.bankRate * dt, Math.min(AIRCRAFT_TURN.bankRate * dt, bankStep));
  vehicle.speed = TYPES.plane.speed;
  vehicle.throttle = 1;
  p.x -= Math.sin(vehicle.heading) * vehicle.speed * dt * Math.cos(vehicle.pitch);
  p.z -= Math.cos(vehicle.heading) * vehicle.speed * dt * Math.cos(vehicle.pitch);
  p.y += Math.sin(vehicle.pitch) * vehicle.speed * dt;
  const aimHeading = aim ? Math.atan2(p.x - aim.x, p.z - aim.z) : vehicle.heading;
  const aimPitch = aim ? Math.atan2(aim.y - p.y, Math.hypot(aim.x - p.x, aim.z - p.z)) : vehicle.pitch;
  if (!canFire || !aim || state.phase === 'egress' || nearEdge ||
    Math.abs(headingError(vehicle.heading, aimHeading)) > .08 || Math.abs(vehicle.pitch - aimPitch) > .08 ||
    !visible(start, aim) || !shotState(vehicle.weapon, now, true)) return null;
  state.shots = (state.shots ?? 0) + 1;
  return { start, aim };
}
