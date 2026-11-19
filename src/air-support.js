import * as THREE from 'three';
import { advanceAircraftAI, aircraftMuzzle, AIRCRAFT_GUN } from './aircraft-ai.js';
import { TYPES } from './core.js';
import { BLAST_PROFILES } from './blast-profiles.js';

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

export const AIR_BOMB = BLAST_PROFILES['aircraft-bomb'];
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createEnemyAirFlight(now, slot) {
  return { phase: 'approach', until: 0, targetId: null, nextSense: now + slot * 1.5,
    returningToArea: false, bombAvailable: true, bombReadyAt: now + 25 };
}

export function takeAirBombDrop(flight, now, position, actors, { allowed, visible }) {
  if (flight.bombAvailable !== true || now < flight.bombReadyAt ||
    flight.avoidance || flight.returningToArea || now < (flight.nextBombCheck ?? 0)) return null;
  flight.nextBombCheck = now + .3;
  const exposed = actors.filter(actor => actor.health > 0 && !actor.vehicleId && !actor.civilian &&
    gap(actor.position, position) < 38 && position.y - actor.position.y > 10 &&
    visible(actor.position));
  let best = null, bestCount = 4;
  for (const { position: center } of exposed) {
    if (!allowed(center, AIR_BOMB.radius)) continue;
    const count = exposed.filter(({ position: other }) =>
      gap(center, other) < 9 && Math.abs(center.y - other.y) < 2).length;
    if (count > bestCount || count === bestCount && best && gap(center, position) < gap(best, position)) {
      best = center; bestCount = count;
    }

  }
  if (!best) return null;
  flight.bombAvailable = false;
  return { x: best.x, y: best.y, z: best.z };
}

const geometry = new THREE.CapsuleGeometry(.22, .9, 3, 8);
const material = new THREE.MeshStandardMaterial({ color: 0x343a2e });

export function createAirBombs(scene) {
  const active = [];
  return {
    drop(plane, now, actors, { allowed, visible, groundHeight, source }) {
      const start = plane.position.clone().add(new THREE.Vector3(0, -1.35, 0));
      const target = takeAirBombDrop(plane.aiFlight, now, start, actors, {
        allowed: (point, radius) => allowed(point, radius) &&
          !active.some(bomb => gap(point, bomb.end) < radius * 2),
        visible: point => visible(start, { x: point.x, y: point.y + 1, z: point.z }),
      });
      if (!target) return null;
      const end = new THREE.Vector3(target.x, groundHeight(target.x, target.z) - .3, target.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(start);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), end.clone().sub(start).normalize());
      scene.add(mesh);
      active.push({ start, end, mesh, elapsed: 0, source: source(), planeId: plane.id });
      return end;
    },
    update(dt, trace, impact) {
      for (let index = active.length - 1; index >= 0; index--) {
        const bomb = active[index];
        bomb.elapsed += dt;
        const progress = Math.min(1, bomb.elapsed / 1.35);
        const next = bomb.start.clone().lerp(bomb.end, progress * (.45 + progress * .55));
        const hit = trace(bomb.mesh.position, next, .22, bomb.planeId);
        if (!hit && progress < 1) {
          bomb.mesh.position.copy(next);
          continue;
        }
        scene.remove(bomb.mesh);
        active.splice(index, 1);
        impact(hit?.position ?? next, bomb.source, hit);
      }
    },
    clear() {
      for (const bomb of active) scene.remove(bomb.mesh);
      active.length = 0;
    },
  };
}
