import { TYPES, shotState } from './core.js';
import { headingError } from './ai-turning.js';

export const AIRCRAFT_TURN = Object.freeze({ rate: .6, headingGain: 1.8, bankRate: .65, bankResponse: .25 });
export const AIRCRAFT_AVOIDANCE = Object.freeze({ lookAhead: 4, sampleStep: .2, halfSpan: 5.2,
  clearance: 6, pullUpAltitude: 22, climbPitch: .38, holdSeconds: 2 });
export const AIRCRAFT_GUN = Object.freeze({ range: 220, spread: .012 });

export function aircraftMuzzle(vehicle) {
  const forward = vehicle.team === 'enemy' ? 3.55 : 2.8, height = vehicle.team === 'enemy' ? .17 : .1;
  const x = -height * Math.sin(vehicle.roll);
  const y = height * Math.cos(vehicle.roll) * Math.cos(vehicle.pitch) + forward * Math.sin(vehicle.pitch);
  const z = height * Math.cos(vehicle.roll) * Math.sin(vehicle.pitch) - forward * Math.cos(vehicle.pitch);
  return { x: vehicle.position.x + x * Math.cos(vehicle.heading) + z * Math.sin(vehicle.heading),
    y: vehicle.position.y + y, z: vehicle.position.z - x * Math.sin(vehicle.heading) + z * Math.cos(vehicle.heading) };
}

function headingStep(heading, desired, dt) {
  const delta = headingError(heading, desired);
  const rate = Math.max(-AIRCRAFT_TURN.rate, Math.min(AIRCRAFT_TURN.rate, delta * AIRCRAFT_TURN.headingGain));
  return Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(rate) * dt);
}

function rectangleContact(from, to, obstacle) {
  let entry = 0, exit = 1;
  for (const axis of ['x', 'z']) {
    const min = obstacle[axis === 'x' ? 'minX' : 'minZ'] - AIRCRAFT_AVOIDANCE.halfSpan;
    const max = obstacle[axis === 'x' ? 'maxX' : 'maxZ'] + AIRCRAFT_AVOIDANCE.halfSpan;
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-8) {
      if (from[axis] < min || from[axis] > max) return null;
    } else {
      const a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
      entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) return null;
    }
  }
  return { entry, exit };
}

function flightThreat(vehicle, desiredHeading, desiredPitch, obstacles, groundHeight) {
  const point = { ...vehicle.position };
  let heading = vehicle.heading, pitch = vehicle.pitch, threat = null, recovering = false;
  const step = AIRCRAFT_AVOIDANCE.sampleStep;
  for (let elapsed = step; elapsed <= AIRCRAFT_AVOIDANCE.lookAhead + 1e-8; elapsed += step) {
    const previous = { ...point };
    const previousFloor = groundHeight(point.x, point.z);
    if (!Number.isFinite(previousFloor)) throw new RangeError('Aircraft avoidance requires finite terrain heights');
    if (desiredPitch < 0 && point.y < previousFloor + AIRCRAFT_AVOIDANCE.pullUpAltitude) recovering = true;
    const headingGoal = recovering ? heading + .55 : desiredHeading;
    const pitchGoal = recovering ? .22 : desiredPitch;
    heading = headingError(0, heading + headingStep(heading, headingGoal, step));
    pitch += Math.max(-.4 * step, Math.min(.4 * step, pitchGoal - pitch));
    point.x -= Math.sin(heading) * TYPES.plane.speed * step * Math.cos(pitch);
    point.z -= Math.cos(heading) * TYPES.plane.speed * step * Math.cos(pitch);
    point.y += Math.sin(pitch) * TYPES.plane.speed * step;
    const floor = groundHeight(point.x, point.z);
    if (!Number.isFinite(floor)) throw new RangeError('Aircraft avoidance requires finite terrain heights');
    if (point.y < floor + AIRCRAFT_AVOIDANCE.clearance) {
      threat ??= { time: elapsed, altitude: floor + AIRCRAFT_AVOIDANCE.clearance, reason: 'terrain' };
      threat.altitude = Math.max(threat.altitude, floor + AIRCRAFT_AVOIDANCE.clearance);
    }
    for (const obstacle of obstacles) {
      if (Math.min(previous.y, point.y) >= obstacle.height + AIRCRAFT_AVOIDANCE.clearance) continue;
      const contact = rectangleContact(previous, point, obstacle);
      if (!contact) continue;
      const minY = Math.min(previous.y + (point.y - previous.y) * contact.entry,
        previous.y + (point.y - previous.y) * contact.exit);
      const altitude = obstacle.height + AIRCRAFT_AVOIDANCE.clearance;
      if (minY >= altitude) continue;
      threat ??= { time: elapsed, altitude, reason: 'building' };
      threat.altitude = Math.max(threat.altitude, altitude);
    }
  }
  return threat;
}

export function advanceAircraftAI(vehicle, dt, now, { targets, canFire, visible, obstacles = [], groundHeight = () => 0,
  patrolCenter = { x: 0, z: 0 }, preferredUnitId = null }) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 ||
    ![vehicle.position.x, vehicle.position.y, vehicle.position.z, vehicle.heading, vehicle.pitch, vehicle.roll].every(Number.isFinite) ||
    typeof canFire !== 'boolean' || typeof visible !== 'function' || typeof groundHeight !== 'function' ||
    !Number.isFinite(patrolCenter.x) || !Number.isFinite(patrolCenter.z) ||
    !Array.isArray(obstacles) || obstacles.some(obstacle =>
      !['minX', 'maxX', 'minZ', 'maxZ', 'height'].every(key => Number.isFinite(obstacle[key])) ||
      obstacle.minX > obstacle.maxX || obstacle.minZ > obstacle.maxZ)) {
    throw new RangeError('Aircraft AI requires owned finite state, visibility and obstacle geometry');
  }
  if (dt === 0 || vehicle.health <= 0) return null;
  const state = vehicle.aiFlight;
  if (!state) throw new Error('Aircraft requires an autonomous flight state');
  const p = vehicle.position;
  const start = aircraftMuzzle(vehicle);
  const aimPoint = actor => ({ x: actor.position.x, y: actor.position.y + (actor.vehicleId ? 0 : actor.aimHeight??1.2), z: actor.position.z });
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
    const preferred = preferredUnitId ? candidates.filter(actor => actor.unitId === preferredUnitId) : [];
    const retainedVisible = retained && candidates.includes(retained) && visible(start, aimPoint(retained));
    const exposedCivilian=candidates.find(actor=>actor.civilian&&visible(start,aimPoint(actor)));
    const preferredTarget=retainedVisible&&retained.unitId===preferredUnitId?retained:
      preferred.find(actor=>visible(start,aimPoint(actor)));
    const militaryTarget=preferredTarget??(retainedVisible&&!retained.civilian?retained:
      candidates.find(actor=>!actor.civilian&&visible(start,aimPoint(actor))));
    const priority=preferredTarget??(exposedCivilian
      ? !militaryTarget||bearingCost(exposedCivilian)+15<bearingCost(militaryTarget)?exposedCivilian:militaryTarget
      :null);
    state.targetId = priority?.id ?? (retainedVisible ? retained.id : candidates.find(actor => visible(start, aimPoint(actor)))?.id ?? null);
  }
  const target = targets.find(actor => actor.id === state.targetId && actor.health > 0);
  const aim = target ? aimPoint(target) : null;
  const horizontal = aim ? Math.hypot(aim.x - p.x, aim.z - p.z) : Infinity;
  const floor = groundHeight(p.x, p.z);
  if (!Number.isFinite(floor)) throw new RangeError('Aircraft AI requires a finite terrain height');
  if (state.phase !== 'egress' && (horizontal < 30 || p.y < floor + AIRCRAFT_AVOIDANCE.pullUpAltitude)) {
    state.phase = 'egress'; state.until = now + 5;
  }
  if (state.phase === 'egress' && now >= state.until) state.phase = 'approach';
  const edgeDistance = Math.max(Math.abs(p.x - patrolCenter.x), Math.abs(p.z - patrolCenter.z));
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
    desiredHeading = Math.atan2(p.x - patrolCenter.x, p.z - patrolCenter.z) + (nearEdge ? 0 : .75);
    desiredPitch = Math.max(-.12, Math.min(.22, (40 - p.y) * .015));
  }
  if (state.avoidance && now >= state.avoidance.until && p.y >= state.avoidance.altitude) state.avoidance = null;
  if (state.avoidance) {
    desiredHeading = state.avoidance.heading; desiredPitch = AIRCRAFT_AVOIDANCE.climbPitch;
  }
  const threat = flightThreat(vehicle, desiredHeading, desiredPitch, obstacles, groundHeight);
  if (threat) {
    if (!state.avoidance) {
      const options = [0, -.8, .8].map(offset => {
        const heading = headingError(0, vehicle.heading + offset);
        const risk = flightThreat(vehicle, heading, AIRCRAFT_AVOIDANCE.climbPitch, obstacles, groundHeight);
        return { heading, risk: risk?.time ?? Infinity, turn: Math.abs(offset) };
      }).sort((a, b) => b.risk - a.risk || a.turn - b.turn);
      state.avoidance = { heading: options[0].heading, altitude: threat.altitude,
        until: now + AIRCRAFT_AVOIDANCE.holdSeconds, reason: threat.reason };
    } else {
      state.avoidance.altitude = Math.max(state.avoidance.altitude, threat.altitude);
      state.avoidance.until = now + AIRCRAFT_AVOIDANCE.holdSeconds;
    }
    state.phase = 'egress'; state.until = Math.max(state.until, now + 5);
    desiredHeading = state.avoidance.heading; desiredPitch = AIRCRAFT_AVOIDANCE.climbPitch;
  }
  const turn = headingStep(vehicle.heading, desiredHeading, dt);
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
  if (!canFire || !aim || state.avoidance || state.phase === 'egress' || nearEdge ||
    Math.abs(headingError(vehicle.heading, aimHeading)) > .08 || Math.abs(vehicle.pitch - aimPitch) > .08 ||
    !visible(aircraftMuzzle(vehicle), aim) || !shotState(vehicle.weapon, now, true)) return null;
  state.shots = (state.shots ?? 0) + 1;
  return { start: aircraftMuzzle(vehicle), aim };
}
