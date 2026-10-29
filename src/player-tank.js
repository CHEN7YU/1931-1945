import { shotState, TYPES } from './core.js';
import { headingError } from './ai-turning.js';

export const TANK_MACHINE_GUN = Object.freeze({ magazine: 100, reload: 4, interval: .1,
  damage: 35, range: 120, spread: .006 });

export const TANK_GUN_MOUNT = Object.freeze({
  turret: Object.freeze([-.3, 1.36, -.38]), pivot: Object.freeze([0, .37, -.62]),
  coax: Object.freeze([.19, .035, -.55]), cannon: Object.freeze([-.08, 0, -1.122]),
  sight: Object.freeze([0, .15, .4]),
});

export const TANK_OBSERVATION = Object.freeze({
  commander: Object.freeze({ eyeHeight: 1.88, fov: 66, aimFov: 48, aperture: 'slit' }),
  gunner: Object.freeze({ eyeHeight: 1.88, fov: 40, aimFov: 24, aperture: 'scope' }),
  driver: Object.freeze({ eyeHeight: 1.3, fov: 72, aimFov: 72, aperture: 'driver',
    yawLimit: 35 * Math.PI / 180, pitchLimit: .2 }),
});

export function tankObservationPose(vehicle, role, aiming) {
  const view = TANK_OBSERVATION[role], p = vehicle?.position;
  if (!view || vehicle.type !== 'tank' || typeof aiming !== 'boolean' || !p ||
    ![p.x, p.y, p.z, vehicle.heading].every(Number.isFinite)) throw new RangeError('Tank observation needs a finite vehicle and supported crew role');
  const c = Math.cos(vehicle.heading), s = Math.sin(vehicle.heading);
  if (role === 'gunner') return { ...tankGunPose(vehicle, TANK_GUN_MOUNT.sight).start,
    fov: aiming ? view.aimFov : view.fov, aperture: view.aperture };
  return { x: p.x + (role === 'driver' ? 0 : -.3 * c - .38 * s), y: p.y + view.eyeHeight,
    z: p.z + (role === 'driver' ? 0 : .3 * s - .38 * c),
    fov: aiming ? view.aimFov : view.fov, aperture: view.aperture };
}

function tankGunPose(vehicle, tip) {
  const { position: p, heading, turretYaw: yaw, turretPitch: pitch } = vehicle;
  if (!p || ![p.x, p.y, p.z, heading, yaw, pitch].every(Number.isFinite)) throw new RangeError('Tank machine gun needs a finite owned pose');
  const [x, y0, z0] = tip, [tx, ty, tz] = TANK_GUN_MOUNT.turret, [, gy, gz] = TANK_GUN_MOUNT.pivot;
  const y = gy + y0 * Math.cos(pitch) - z0 * Math.sin(pitch);
  const z = gz + y0 * Math.sin(pitch) + z0 * Math.cos(pitch);
  return { start: {
    x: p.x + tx * Math.cos(heading) + tz * Math.sin(heading) + x * Math.cos(yaw) + z * Math.sin(yaw),
    y: p.y + ty + y,
    z: p.z - tx * Math.sin(heading) + tz * Math.cos(heading) - x * Math.sin(yaw) + z * Math.cos(yaw),
  }, yaw, pitch };
}
export const tankMachineGunPose = vehicle => tankGunPose(vehicle, TANK_GUN_MOUNT.coax);
export const tankCannonPose = vehicle => tankGunPose(vehicle, TANK_GUN_MOUNT.cannon);

export function tankConvergedDirection(shot, target) {
  if (!shot?.start || ![shot.start.x, shot.start.y, shot.start.z, shot.yaw, shot.pitch,
    target?.x, target?.y, target?.z].every(Number.isFinite)) throw new RangeError('Tank convergence requires a physical muzzle and finite sight target');
  const bore = { x: -Math.sin(shot.yaw) * Math.cos(shot.pitch), y: Math.sin(shot.pitch), z: -Math.cos(shot.yaw) * Math.cos(shot.pitch) };
  const dx = target.x - shot.start.x, dy = target.y - shot.start.y, dz = target.z - shot.start.z;
  if (dx * bore.x + dy * bore.y + dz * bore.z <= 0) return bore;
  const length = Math.hypot(dx, dy, dz);
  return { x: dx / length, y: dy / length, z: dz / length };
}

export function advanceTankCannon(vehicle, now, firing = false) {
  if (vehicle?.type !== 'tank' || vehicle.variant !== null || !Number.isFinite(now) || now < 0 ||
    typeof firing !== 'boolean') throw new RangeError('Automatic crew loading requires a supported tank and simulation time');
  const gun = vehicle.weapon;
  if (gun?.ownerId !== vehicle.id || gun.type !== 'tank') throw new Error('Tank cannon has broken ownership');
  if (vehicle.health <= 0) return false;
  shotState(gun, now, false);
  const fired = firing && shotState(gun, now, true);
  if (gun.ammo === 0 && !gun.reloadUntil) gun.reloadUntil = now + TYPES.tank.reload;
  return fired;
}

export function advanceTankMachineGun(vehicle, operator, dt, now, trigger) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0 || typeof trigger !== 'boolean' ||
    vehicle.type !== 'tank' || vehicle.variant !== null) throw new RangeError('Player tank gun requires its supported vehicle and finite simulation time');
  const gun = vehicle.machineGuns.find(gun => gun.mount === 'coax');
  if (!gun || gun.ownerId !== vehicle.id) throw new Error('Tank has no owned coaxial machine gun');
  if (!dt || vehicle.health <= 0) return null;
  shotState(gun, now, false);
  const seat = vehicle.seats.find(seat => seat.id === operator?.seatId && seat.occupantId === operator?.id);
  if (!operator || operator.health <= 0 || operator.vehicleId !== vehicle.id || !seat?.canFire) {
    gun.mode = 'disabled'; return null;
  }
  gun.mode = gun.reloadUntil ? 'reloading' : 'idle';
  if (!trigger || !shotState(gun, now, true)) return null;
  gun.mode = 'firing'; gun.shots++;
  return { gun, operator, ...tankMachineGunPose(vehicle) };
}

export function tankHeading(vehicle, viewYaw) {
  if (!vehicle || ![vehicle.heading, vehicle.turretYaw, viewYaw].every(Number.isFinite)) throw new RangeError('Heading display needs finite hull, turret and view headings');
  const degrees = yaw => -headingError(viewYaw, yaw) * 180 / Math.PI;
  return { hull: degrees(vehicle.heading), turret: degrees(vehicle.turretYaw), north: degrees(0) };
}
