import { CHI_HA, chiHaMuzzle } from './chi-ha.js';
import { headingError } from './ai-turning.js';
import { shotState } from './core.js';

const turn = (from, to, step) => from + Math.max(-step, Math.min(step, headingError(from, to)));
const aimPoint = actor => ({ x: actor.position.x, y: actor.position.y + (actor.aimHeight ?? 1), z: actor.position.z });

export function advanceChiHaAI(vehicle, dt, now, context) {
  if (vehicle.variant !== CHI_HA.id || !Number.isFinite(dt) || dt < 0 || !Number.isFinite(now)) {
    throw new RangeError('Chi-Ha AI requires its owned model and finite simulation time');
  }
  if (dt === 0 || vehicle.health <= 0) return null;
  if (!vehicle.ai) vehicle.ai = { targetId: null, scanAt: 0, pathAt: 0, path: [], shots: 0, mode: 'advance',
    goal: null, objectiveId: null, distanceToObjective: null, firePauseUntil: 0, firePauseReadyAt: 0 };
  const ai = vehicle.ai;
  vehicle.speed = 0;
  if (!context.crew.some(actor => actor.health > 0)) return null;
  const position = vehicle.position;
  const eligible = actor => actor.health > 0 && actor.team !== vehicle.team && actor.targetKind !== 'aircraft' &&
    Math.hypot(actor.position.x - position.x, actor.position.z - position.z) <= CHI_HA.range;
  let target = context.targets.find(actor => actor.id === ai.targetId && eligible(actor));
  if (now >= ai.scanAt) {
    ai.scanAt = now + .6;
    const muzzle = chiHaMuzzle(vehicle);
    target = context.targets.filter(eligible).sort((a, b) =>
      Math.hypot(a.position.x - position.x, a.position.z - position.z) -
      Math.hypot(b.position.x - position.x, b.position.z - position.z))
      .find(actor => context.visible(muzzle, aimPoint(actor))) ?? null;
    ai.targetId = target?.id ?? null;
  }
  const visible = Boolean(target && context.visible(chiHaMuzzle(vehicle), aimPoint(target)));
  const objective = context.objective, goal = context.destination ?? objective;
  if (!goal) { ai.mode = 'hold'; return null; }
  if (ai.objectiveId !== (goal.id ?? null) || !ai.goal || ai.goal.x !== goal.x || ai.goal.z !== goal.z) {
    ai.objectiveId = goal.id ?? null;
    ai.goal = { x: goal.x, z: goal.z };
    ai.pathAt = now;
    ai.path = [];
    ai.firePauseUntil = 0;
  }
  const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
  ai.distanceToObjective = Math.hypot(objective.x - position.x, objective.z - position.z);
  const arrived = distance <= CHI_HA.arrivalDistance;
  if (arrived && visible) {
    vehicle.heading = turn(vehicle.heading,
      Math.atan2(position.x - target.position.x, position.z - target.position.z), CHI_HA.turnRate * dt);
  }
  const muzzle = chiHaMuzzle(vehicle), point = visible ? aimPoint(target) : { ...goal, y: position.y + 1.7 };
  const yaw = Math.atan2(muzzle.x - point.x, muzzle.z - point.z);
  const actualPitch = Math.atan2(point.y - muzzle.y, Math.hypot(point.x - muzzle.x, point.z - muzzle.z));
  const pitch = Math.max(-.16, Math.min(.35, actualPitch));
  vehicle.turretYaw = turn(vehicle.turretYaw, yaw, CHI_HA.turretRate * dt);
  vehicle.turretPitch = turn(vehicle.turretPitch, pitch, .25 * dt);
  shotState(vehicle.weapon, now, false);
  if (context.canFire && vehicle.weapon.ammo === 0) shotState(vehicle.weapon, now, true);
  const firing = visible && Math.hypot(target.position.x - position.x, target.position.z - position.z) >= 9 &&
    actualPitch >= -.16 && actualPitch <= .35 && context.canFire;
  const ready = vehicle.weapon.ammo > 0 && !vehicle.weapon.reloadUntil && now >= vehicle.weapon.nextShot;
  const safe = firing && context.safeToFire(chiHaMuzzle(vehicle), point);
  const nearlyAimed = Math.abs(headingError(vehicle.turretYaw, yaw)) < .12 && Math.abs(vehicle.turretPitch - pitch) < .08;
  if (!arrived && safe && ready && nearlyAimed && now >= ai.firePauseReadyAt) {
    ai.firePauseUntil = now + CHI_HA.firePause;
    ai.firePauseReadyAt = now + CHI_HA.firePauseInterval;
  }
  const firePause = now < ai.firePauseUntil && safe && ready;
  ai.mode = arrived ? visible ? 'engage' : 'hold' : firePause ? 'aim' : 'advance';
  if (!arrived && !firePause) {
    if (now >= ai.pathAt) {
      ai.path = context.pathTo(position, goal);
      ai.pathAt = now + 3;
      if (ai.path.length > 1 && context.canTravel?.(position, ai.path[1])) ai.path.shift();
    }
    while (ai.path.length && Math.hypot(ai.path[0].x - position.x, ai.path[0].z - position.z) < .3) ai.path.shift();
    const next = ai.path[0];
    if (next) {
      const desired = Math.atan2(position.x - next.x, position.z - next.z);
      vehicle.heading = turn(vehicle.heading, desired, CHI_HA.turnRate * dt);
      if (Math.abs(headingError(vehicle.heading, desired)) < .08) {
        const x = position.x, z = position.z;
        const step = Math.min(CHI_HA.speed * dt, Math.hypot(next.x - x, next.z - z));
        const movement = context.move(position, -Math.sin(vehicle.heading) * step, -Math.cos(vehicle.heading) * step);
        const travelled = Math.hypot(position.x - x, position.z - z);
        vehicle.speed = travelled / dt;
        vehicle.trackDistance += movement?.reversing ? -travelled : travelled;
        if (movement?.yielding) ai.mode = 'yield';
        if (travelled < step * .1) {
          if (!movement?.yielding) ai.mode = 'blocked';
          ai.pathAt = Math.min(ai.pathAt, now + .5);
        }
      }
    } else ai.mode = 'blocked';
  }
  ai.distanceToObjective = Math.hypot(objective.x - position.x, objective.z - position.z);
  if (!firing || vehicle.speed > .1 || Math.abs(headingError(vehicle.turretYaw, yaw)) > .025 ||
    Math.abs(vehicle.turretPitch - pitch) > .025 || !context.visible(chiHaMuzzle(vehicle), point)) return null;
  // The shortened barrel sits over the glacis; only fire inside its real elevation limits.
  if (!safe || !shotState(vehicle.weapon, now, true)) return null;
  ai.shots++;
  ai.firePauseUntil = now;
  return { targetId: target.id, start: chiHaMuzzle(vehicle), end: point };
}
