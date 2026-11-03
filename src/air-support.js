import { advanceAircraftAI, aircraftMuzzle, AIRCRAFT_GUN } from './aircraft-ai.js';
import { TYPES } from './core.js';

export const AIR_SUPPORT = Object.freeze({ count: 3, altitude: 40, orbitWidth: 55, orbitLength: 110 });

export function createAirSupport(index = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= AIR_SUPPORT.count) throw new RangeError('Unknown air support aircraft');
  const phase = -Math.PI / 2 + index * Math.PI * 2 / AIR_SUPPORT.count;
  return { initialized: false, index, phase,
    heading: Math.atan2(AIR_SUPPORT.orbitWidth * Math.sin(phase), AIR_SUPPORT.orbitLength * Math.cos(phase)),
    pitch: 0, roll: -.2, elapsed: 0, passes: 0, shots: 0, targetId: null,
    weapon: { type: 'plane', ammo: TYPES.plane.magazine, nextShot: 0, reloadUntil: 0 },
    aiFlight: { phase: 'approach', until: 0, targetId: null, nextSense: 0 } };
}

export function airSupportMuzzle(state, position) {
  return aircraftMuzzle({ ...state, team: 'enemy', position });
}

export function advanceAirSupport(state, position, dt, targets, objective, visible, enabled = true,
  obstacles = [], groundHeight = () => 0) {
  if (!Number.isFinite(dt) || dt < 0 || typeof visible !== 'function') throw new TypeError('Air support requires time and a visibility query');
  if (dt === 0) return null;
  state.elapsed += dt;
  state.initialized = true;
  const previousPhase = state.aiFlight.phase;
  const vehicle = { team: 'enemy', health: TYPES.plane.health, position,
    heading: state.heading, pitch: state.pitch, roll: state.roll, weapon: state.weapon, aiFlight: state.aiFlight };
  const shot = advanceAircraftAI(vehicle, dt, state.elapsed, {
    targets, canFire: enabled, obstacles, groundHeight, patrolCenter: objective,
    visible: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) <= AIRCRAFT_GUN.range &&
      visible(from, to),
  });
  state.heading = vehicle.heading; state.pitch = vehicle.pitch; state.roll = vehicle.roll;
  state.targetId = state.aiFlight.targetId;
  if (!state.passes || previousPhase === 'egress' && state.aiFlight.phase === 'approach') state.passes++;
  if (!shot) return null;
  const start = airSupportMuzzle(state, position);
  if (!visible(start, shot.aim)) return null;
  state.shots++;
  return { start, yaw: state.heading, pitch: state.pitch };
}
