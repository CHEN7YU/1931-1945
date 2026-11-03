import { NANJING_GATE_HEIGHT } from './nanjing-layout.js';
import { FOOT_SPEEDS } from './locomotion.js';

const maxim24 = { type: 'infantry', model: 'zb26', magazine: 200, reserve: 1000, reload: 5,
  interval: .1, range: 220, damage: 100, spread: .006, barrel: 1.25 };
export const EMPLACEMENT_PROFILES = Object.freeze({
  maxim24: Object.freeze({ ...maxim24, name: '民二四式重机枪',
    traverse: 1.3, minPitch: -.28, maxPitch: .6, muzzleHeight: 1.05 }),
  maxim24aa: Object.freeze({ ...maxim24, name: '民二四式高射架重机枪', antiAircraft: true,
    traverse: Math.PI, minPitch: .05, maxPitch: 1.45, muzzleHeight: 1.5 }),
  bofors75: Object.freeze({ name: '75毫米博福斯山炮', type: 'field-gun',
    magazine: 1, reserve: 24, reload: 5.5, interval: .3, range: 350, damage: 180, radius: 9,
    traverse: .85, minPitch: -.12, maxPitch: .55, muzzleHeight: 1.1, barrel: 1.8 }),
});

export const NANJING_EMPLACEMENTS = Object.freeze([
  { id: 'bridge-mg', profile: 'maxim24', x: -29, z: 26, heading: Math.PI },
  { id: 'bridge-gun', profile: 'bofors75', x: -31, z: 23, heading: -2.84 },
  { id: 'dock-mg', profile: 'maxim24', x: -53.5, z: -92, heading: -Math.PI / 2 },
  { id: 'dock-gun', profile: 'bofors75', x: -63, z: -94, heading: -Math.PI / 2 },
  { id: 'gate-aa', profile: 'maxim24aa', x: 13.5, z: 20, altitude: NANJING_GATE_HEIGHT, heading: Math.PI },
  { id: 'dock-aa', profile: 'maxim24aa', x: -68, z: -71, altitude: .36, heading: -Math.PI / 2 },
].map(Object.freeze));

export function createEmplacement(spec) {
  const profile = EMPLACEMENT_PROFILES[spec.profile];
  if (!profile || ![spec.x, spec.z, spec.heading].every(Number.isFinite)) throw new RangeError('Invalid fixed weapon position');
  return { ...spec, position: 'gunner',
    yaw: spec.heading, pitch: Math.max(0, profile.minPitch), operatorId: null, crewId: null, heat: 0, overheated: false, shots: 0,
    weapon: { type: profile.type, model: profile.model, ammo: profile.magazine, reserve: profile.reserve,
      nextShot: 0, reloadUntil: 0, settings: profile } };
}

export const ARTILLERY_MARCH = Object.freeze({
  speed: Math.min(.85, ...Object.values(FOOT_SPEEDS).map(profile => profile.walk)), turnRate: .55,
});

export function setArtilleryPosition(point, position) {
  if (point.profile !== 'bofors75' || !point.operatorId || !['gunner', 'march'].includes(position)) return false;
  point.position = position;
  if (position === 'march') { point.yaw = point.heading; point.pitch = 0; }
  return true;
}

export function moveArtillery(point, forward, turn, dt, clear) {
  if (![forward, turn, dt].every(Number.isFinite) || Math.abs(forward) > 1 || Math.abs(turn) > 1 ||
    dt < 0 || typeof clear !== 'function') throw new RangeError('Invalid artillery marching input');
  if (point.profile !== 'bofors75' || point.position !== 'march' || !point.operatorId) return false;
  const steps = Math.max(1, Math.ceil(dt * ARTILLERY_MARCH.speed / .08));
  let changed = false;
  for (let step = 0; step < steps; step++) {
    const heading = point.heading - turn * ARTILLERY_MARCH.turnRate * dt / steps;
    const x = point.x - Math.sin(heading) * forward * ARTILLERY_MARCH.speed * dt / steps;
    const z = point.z - Math.cos(heading) * forward * ARTILLERY_MARCH.speed * dt / steps;
    const candidate = { x, z, heading };
    if (!clear(candidate)) break;
    changed ||= x !== point.x || z !== point.z || heading !== point.heading;
    Object.assign(point, candidate); point.yaw = heading;
  }
  return changed;
}

export function aimEmplacement(point, target, dt, floor = 0) {
  const profile = EMPLACEMENT_PROFILES[point.profile];
  const desiredYaw = Math.atan2(point.x - target.x, point.z - target.z);
  const desiredPitch = Math.atan2(target.y - floor - profile.muzzleHeight,
    Math.hypot(target.x - point.x, target.z - point.z));
  const yawDelta = Math.atan2(Math.sin(desiredYaw - point.yaw), Math.cos(desiredYaw - point.yaw));
  emplacementLook(point, point.yaw + Math.max(-1.1 * dt, Math.min(1.1 * dt, yawDelta)),
    point.pitch + Math.max(-.8 * dt, Math.min(.8 * dt, desiredPitch - point.pitch)));
  return Math.abs(Math.atan2(Math.sin(desiredYaw - point.yaw), Math.cos(desiredYaw - point.yaw))) < .045 &&
    Math.abs(desiredPitch - point.pitch) < .045;
}

export function emplacementCanAimAt(point, target, floor = 0) {
  const profile = EMPLACEMENT_PROFILES[point.profile];
  const yaw = Math.atan2(point.x - target.x, point.z - target.z);
  const pitch = Math.atan2(target.y - floor - profile.muzzleHeight,
    Math.hypot(target.x - point.x, target.z - point.z));
  const delta = Math.atan2(Math.sin(yaw - point.heading), Math.cos(yaw - point.heading));
  return Math.abs(delta) <= profile.traverse && pitch >= profile.minPitch && pitch <= profile.maxPitch;
}

export function emplacementLook(point, yaw, pitch) {
  const profile = EMPLACEMENT_PROFILES[point.profile];
  const delta = Math.atan2(Math.sin(yaw - point.heading), Math.cos(yaw - point.heading));
  point.yaw = point.heading + Math.max(-profile.traverse, Math.min(profile.traverse, delta));
  point.pitch = Math.max(profile.minPitch, Math.min(profile.maxPitch, pitch));
  return { yaw: point.yaw, pitch: point.pitch };
}

export function emplacementPose(point, floor = 0) {
  const profile = EMPLACEMENT_PROFILES[point.profile], c = Math.cos(point.yaw), s = Math.sin(point.yaw);
  return {
    operator: { x: point.x + Math.sin(point.heading) * 1.5, y: floor, z: point.z + Math.cos(point.heading) * 1.5 },
    eye: { x: point.x + s * .75, y: floor + profile.muzzleHeight + .25, z: point.z + c * .75 },
    muzzle: { x: point.x - s * Math.cos(point.pitch) * profile.barrel,
      y: floor + profile.muzzleHeight + Math.sin(point.pitch) * profile.barrel,
      z: point.z - c * Math.cos(point.pitch) * profile.barrel },
  };
}

export function emplacementObstacles(point) {
  const bounds = [{ minX: -.65, maxX: .65, minZ: -.65, maxZ: .65,
    height: EMPLACEMENT_PROFILES[point.profile].antiAircraft ? 1.8 : 1.4 }];
  if (point.profile === 'maxim24') bounds.push(
    { minX: -1.32, maxX: 1.32, minZ: -.98, maxZ: -.32, height: .85 },
    { minX: -1.48, maxX: -.72, minZ: -.3, maxZ: 1.05, height: .85 },
    { minX: .72, maxX: 1.48, minZ: -.3, maxZ: 1.05, height: .85 });
  const c = Math.cos(point.heading), s = Math.sin(point.heading);
  return bounds.map((box, index) => {
    const corners = [[box.minX, box.minZ], [box.minX, box.maxZ], [box.maxX, box.minZ], [box.maxX, box.maxZ]]
      .map(([x, z]) => ({ x: point.x + x * c + z * s, z: point.z - x * s + z * c }));
    return { id: `${point.id}:obstacle-${index}`, minX: Math.min(...corners.map(p => p.x)),
      maxX: Math.max(...corners.map(p => p.x)), minZ: Math.min(...corners.map(p => p.z)),
      maxZ: Math.max(...corners.map(p => p.z)), minY: point.altitude ?? 0, height: (point.altitude ?? 0) + box.height };
  });
}

export function reloadEmplacement(point, now) {
  const weapon = point.weapon, profile = weapon.settings;
  if (weapon.reloadUntil || weapon.ammo === profile.magazine || weapon.reserve === 0) return false;
  weapon.reloadUntil = now + profile.reload;
  return true;
}

export function advanceEmplacement(point, dt, now) {
  point.heat = Math.max(0, point.heat - dt * .12);
  if (point.heat < .35) point.overheated = false;
  const weapon = point.weapon;
  if (weapon.reloadUntil > 0 && now >= weapon.reloadUntil) {
    const rounds = Math.min(weapon.settings.magazine - weapon.ammo, weapon.reserve);
    weapon.ammo += rounds; weapon.reserve -= rounds; weapon.reloadUntil = 0;
  }
}

export function fireEmplacement(point, now) {
  const weapon = point.weapon;
  if (!point.operatorId || point.position === 'march' || point.overheated || weapon.reloadUntil || now < weapon.nextShot) return false;
  if (weapon.ammo <= 0) { reloadEmplacement(point, now); return false; }
  weapon.ammo--; weapon.nextShot = now + weapon.settings.interval; point.shots++;
  if (point.weapon.type !== 'field-gun') {
    point.heat = Math.min(1, point.heat + .022);
    point.overheated = point.heat >= 1;
  } else reloadEmplacement(point, now);
  return true;
}
