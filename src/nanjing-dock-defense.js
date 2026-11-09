import { circleBlocked, segmentClear } from './core.js';

// Waiting civilians and the ferry approaches are behind the landward fighting line.
export const NANJING_DOCK_BUFFER = Object.freeze({
  minX: -74, maxX: -58.5, minZ: -91.5, maxZ: -69.5, minY: -10, height: 100,
});
const buffer = [NANJING_DOCK_BUFFER];

export function nanjingDockBufferActive(stage) {
  return stage === 'dock-defense' || stage === 'withdrawal-to-boats';
}

export function nanjingDockInside(point, radius = .5) {
  return circleBlocked(point.x, point.z, radius, buffer);
}

export function nanjingDockPathClear(start, path, radius = .5) {
  let from = start;
  for (const point of path) {
    if (!segmentClear(from, point, radius, buffer)) return false;
    from = point;
  }
  return true;
}

export function nanjingDockOutsideGoal(point, radius = .5) {
  if (!nanjingDockInside(point, radius)) return point;
  return { ...point, x: NANJING_DOCK_BUFFER.maxX + radius + .6 };
}

export function nanjingDockAssaultGoal(actor) {
  const lane = actor.formation.index < 3 ? -92 : actor.formation.index < 6 ? -80 : -65;
  return { x: -49 + actor.index % 3 * 1.7, y: 0,
    z: lane + (Math.floor(actor.index % 11 / 3) - 1.5) * 1.5, transit: true };
}

export function assignNanjingDockDefense(actors, clear) {
  const defenders = actors.filter(actor => actor.health > 0 && actor.friendly &&
    !actor.playerUnit && !actor.vehicleId && !actor.formation.reserve);
  const claimed = [];
  const free = point => !nanjingDockInside(point, .65) && clear(point) &&
    claimed.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= 1.45);
  for (const actor of defenders) {
    const old = actor.tactics.nanjingDockDefense;
    if (old && free(old)) claimed.push(old);
    else actor.tactics.nanjingDockDefense = null;
  }
  for (const actor of defenders.filter(actor => !actor.tactics.nanjingDockDefense)) {
    const sector = (actor.formation.index - 1) % 4;
    const anchorZ = [-90, -80, -66, -79][sector];
    const anchorX = sector === 3 ? -56 : -53;
    const candidates = [];
    for (let x = -56.5; x <= -39.5; x += 1.7) for (let z = -94; z <= -63; z += 1.7)
      candidates.push({ x, y: 0, z, heading: -Math.PI / 2, transit: true });
    candidates.sort((a, b) => Math.hypot(a.x - anchorX, a.z - anchorZ) -
      Math.hypot(b.x - anchorX, b.z - anchorZ));
    const point = candidates.find(free);
    if (!point) throw new Error(`No clear outer dock defense post for ${actor.id}`);
    actor.tactics.nanjingDockDefense = point;
    claimed.push(point);
  }
  return defenders;
}
