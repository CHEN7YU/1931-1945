import { CHI_HA } from './chi-ha.js';

export const TANK_INFANTRY_RULES = Object.freeze({ minimumSpeed: .35, lookAhead: .9, noticeDistance: 16 });
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const extents = tank => tank.variant === CHI_HA.id ? { x: CHI_HA.width / 2, z: CHI_HA.length / 2 }
  : { x: 1.85, z: 2.5 };
const local = (point, center, heading) => {
  const c = Math.cos(heading), s = Math.sin(heading), dx = point.x - center.x, dz = point.z - center.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};
const overlaps = (point, center, heading, bounds, radius) => {
  const p = local(point, center, heading);
  return (p.x - Math.max(-bounds.x, Math.min(bounds.x, p.x))) ** 2 +
    (p.z - Math.max(-bounds.z, Math.min(bounds.z, p.z))) ** 2 < radius ** 2;
};

export function tankSweptContact(tank, before, actor, dt, radius = .28) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(radius) || radius <= 0 ||
    ![before.x, before.y, before.z, before.heading, tank.position.x, tank.position.y, tank.position.z,
      tank.heading, actor.position.x, actor.position.y, actor.position.z].every(Number.isFinite)) {
    throw new RangeError('Tank contact requires finite owned positions, headings and elapsed time');
  }
  if (!dt || tank.type !== 'tank' || tank.health <= 0 || actor.health <= 0 || actor.vehicleId) return false;
  const bounds = extents(tank), turn = angleDelta(before.heading, tank.heading);
  const traveled = Math.hypot(tank.position.x - before.x, tank.position.z - before.z) +
    Math.abs(turn) * Math.hypot(bounds.x, bounds.z);
  if (traveled / dt < TANK_INFANTRY_RULES.minimumSpeed) return false;
  const height = actor.stance === 'prone' ? .65 : actor.stance === 'crouched' ? 1.2 : 1.75;
  const steps = Math.max(1, Math.ceil(traveled / .12));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps, center = {
      x: before.x + (tank.position.x - before.x) * t,
      y: before.y + (tank.position.y - before.y) * t,
      z: before.z + (tank.position.z - before.z) * t,
    };
    if (actor.position.y >= center.y + .9 || actor.position.y + height <= center.y - .1) continue;
    if (overlaps(actor.position, center, before.heading + turn * t, bounds, radius)) return true;
  }
  return false;
}

export function chooseTankEvasion(actor, tanks, { visible, clear }) {
  if (typeof visible !== 'function' || typeof clear !== 'function') throw new TypeError('Tank evasion needs sight and clearance queries');
  const dangers = tanks.filter(tank => tank.health > 0 && tank.type === 'tank' && tank.groundMotion &&
    Math.hypot(tank.position.x - actor.position.x, tank.position.z - actor.position.z) < TANK_INFANTRY_RULES.noticeDistance &&
    Math.abs(tank.position.y - actor.position.y) < 1 &&
    Math.hypot(tank.groundMotion.x, tank.groundMotion.z) +
      Math.abs(tank.groundMotion.turn) * 3 >= TANK_INFANTRY_RULES.minimumSpeed);
  const threats = dangers.filter(tank => {
    const predicted = { ...tank, position: {
      x: tank.position.x + tank.groundMotion.x * TANK_INFANTRY_RULES.lookAhead,
      y: tank.position.y, z: tank.position.z + tank.groundMotion.z * TANK_INFANTRY_RULES.lookAhead,
    }, heading: tank.heading + tank.groundMotion.turn * TANK_INFANTRY_RULES.lookAhead };
    return tankSweptContact(predicted, { ...tank.position, heading: tank.heading }, actor,
      TANK_INFANTRY_RULES.lookAhead, .85) && visible(tank);
  });
  const choices = [];
  for (const tank of threats) {
    const bounds = extents(tank), relative = local(actor.position, tank.position, tank.heading);
    const c = Math.cos(tank.heading), s = Math.sin(tank.heading);
    for (const side of [-1, 1]) for (const back of [0, 2]) {
      const x = side * (bounds.x + 1.6), z = relative.z + back;
      const goal = { x: tank.position.x + x * c + z * s, y: actor.position.y,
        z: tank.position.z - x * s + z * c };
      if (clear(actor.position, goal) && dangers.every(other => {
        const predicted = { ...other, position: {
          x: other.position.x + other.groundMotion.x * TANK_INFANTRY_RULES.lookAhead,
          y: other.position.y, z: other.position.z + other.groundMotion.z * TANK_INFANTRY_RULES.lookAhead,
        }, heading: other.heading + other.groundMotion.turn * TANK_INFANTRY_RULES.lookAhead };
        return !tankSweptContact(predicted, { ...other.position, heading: other.heading },
          { ...actor, position: goal }, TANK_INFANTRY_RULES.lookAhead, .65);
      })) {
        choices.push({ ...goal, vehicleId: tank.id,
          distance: Math.hypot(goal.x - actor.position.x, goal.z - actor.position.z) });
      }
    }
  }
  choices.sort((a, b) => a.distance - b.distance || a.x - b.x);
  return choices[0] ?? null;
}
