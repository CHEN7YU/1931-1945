import { CHI_HA, CHI_HA_MG, CHI_HA_MG_MOUNTS, chiHaMachineGunPose } from './chi-ha.js';
import { headingError } from './ai-turning.js';
import { shotState } from './core.js';

const turn = (from, to, step) => from + Math.max(-step, Math.min(step, to - from));

export function advanceChiHaMachineGuns(vehicle, dt, now, context) {
  if (vehicle.variant !== CHI_HA.id || !Number.isFinite(dt) || dt < 0 || !Number.isFinite(now) || now < 0) {
    throw new RangeError('Chi-Ha machine guns require finite simulation time and their owned vehicle');
  }
  const shots = [];
  if (dt === 0 || vehicle.health <= 0) return shots;
  for (const gun of vehicle.machineGuns) {
    const mount = CHI_HA_MG_MOUNTS.find(item => item.id === gun.mount);
    const seat = vehicle.seats.find(item => item.role === mount.role);
    const operator = context.crew.find(actor => actor.id === seat.occupantId && actor.health > 0);
    gun.targetId = null;
    if (!operator) { gun.mode = 'disabled'; continue; }
    shotState(gun, now, false);
    if (gun.ammo === 0) shotState(gun, now, true);
    if (gun.reloadUntil > 0) { gun.mode = 'reloading'; continue; }
    const pose = chiHaMachineGunPose(vehicle, gun);
    const baseYaw = pose.yaw - gun.yaw;
    const solutions = context.targets.filter(actor => actor.health > 0 && actor.team !== vehicle.team &&
      !actor.vehicleId && (actor.targetKind == null || actor.targetKind === 'person')).map(actor => {
      const point = context.aimPoint(actor), p = pose.pivot;
      const distance = Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z);
      const yaw = headingError(baseYaw, Math.atan2(p.x - point.x, p.z - point.z));
      const pitch = Math.atan2(point.y - p.y, Math.hypot(point.x - p.x, point.z - p.z));
      return { actor, point, distance, yaw, pitch };
    }).filter(item => item.distance >= 4 && item.distance <= CHI_HA_MG.range &&
      Math.abs(item.yaw) <= CHI_HA_MG.traverse && item.pitch >= CHI_HA_MG.minPitch &&
      item.pitch <= CHI_HA_MG.maxPitch).sort((a, b) => a.distance - b.distance);
    const target = solutions.find(item => context.visible(pose.start, item.point));
    if (!target) { gun.mode = 'search'; continue; }
    gun.targetId = target.actor.id;
    gun.yaw = turn(gun.yaw, target.yaw, CHI_HA_MG.turnRate * dt);
    gun.pitch = turn(gun.pitch, target.pitch, CHI_HA_MG.turnRate * dt);
    if (now < gun.cooldownUntil) { gun.mode = 'cooling'; continue; }
    gun.mode = 'aiming';
    const aimed = chiHaMachineGunPose(vehicle, gun);
    if (Math.abs(gun.yaw - target.yaw) > .02 || Math.abs(gun.pitch - target.pitch) > .02 ||
      context.busyCrewIds.includes(operator.id) || !context.visible(aimed.start, target.point) ||
      !context.safeToFire(aimed.start, target.point) || !shotState(gun, now, true)) continue;
    gun.mode = 'firing';
    gun.shots++;
    gun.burstLeft--;
    if (gun.burstLeft === 0) {
      gun.burstLeft = CHI_HA_MG.burst;
      gun.cooldownUntil = now + CHI_HA_MG.cooldown;
    }
    shots.push({ gun, operator, targetId: target.actor.id, start: aimed.start, yaw: aimed.yaw, pitch: aimed.pitch });
  }
  return shots;
}
