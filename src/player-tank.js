import { shotState } from './core.js';
import { headingError } from './ai-turning.js';

export const TANK_MACHINE_GUN = Object.freeze({ magazine: 100, reload: 4, interval: .1,
  damage: 35, range: 120, spread: .006 });

function tankGunPose(vehicle, tip) {
  const { position: p, heading, turretYaw: yaw, turretPitch: pitch } = vehicle;
  if (!p || ![p.x, p.y, p.z, heading, yaw, pitch].every(Number.isFinite)) throw new RangeError('Tank machine gun needs a finite owned pose');
  const y = .37 + tip.y * Math.cos(pitch) - tip.z * Math.sin(pitch);
  const z = -.62 + tip.y * Math.sin(pitch) + tip.z * Math.cos(pitch);
  return { start: {
    x: p.x - .3 * Math.cos(heading) - .38 * Math.sin(heading) + tip.x * Math.cos(yaw) + z * Math.sin(yaw),
    y: p.y + 1.36 + y,
    z: p.z + .3 * Math.sin(heading) - .38 * Math.cos(heading) - tip.x * Math.sin(yaw) + z * Math.cos(yaw),
  }, yaw, pitch };
}
export const tankMachineGunPose = vehicle => tankGunPose(vehicle, { x: .19, y: .035, z: -.55 });
export const tankCannonPose = vehicle => tankGunPose(vehicle, { x: -.08, y: 0, z: -1.122 });

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
