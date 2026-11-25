import { circleBlocked, segmentClear } from './core.js';
import { NANJING_DOCK, NANJING_DOCK_ENTRY_X, NANJING_DOCK_SHIFT, NANJING_WEST_GATE_Z } from './nanjing-campaign.js';

// Waiting civilians and the ferry approaches are behind the landward fighting line.
export const NANJING_DOCK_BUFFER = Object.freeze({
  minX: -74 + NANJING_DOCK_SHIFT, maxX: -79.5, minZ: -91.5, maxZ: -69.5, minY: -10, height: 100,
});
const buffer = [NANJING_DOCK_BUFFER];

export function nanjingDockYardContains(point) {
  return point.x >= NANJING_DOCK.x - 7 && point.x <= NANJING_DOCK_ENTRY_X &&
    Math.abs(point.z - NANJING_DOCK.z) <= 10;
}

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
  return { x: -58 + actor.index % 3 * 1.7, y: 0,
    z: NANJING_WEST_GATE_Z + (Math.floor(actor.index % 11 / 3) - 1.5) * 2, transit: true };
}

export function nanjingDockPostOutsideBuildings(point, buildings) {
  return buildings.every(home => Math.abs(point.x - home.x) > home.width / 2 + .6 ||
    Math.abs(point.z - home.z) > home.depth / 2 + .6);
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
    const anchorZ = NANJING_WEST_GATE_Z + [-8, -4, 2, 6][sector];
    const anchorX = sector === 3 ? -61 : -64;
    const candidates = [];
    for (let x = -68; x <= -54; x += 1.7) for (let z = NANJING_WEST_GATE_Z - 10; z <= NANJING_WEST_GATE_Z + 10; z += 1.7)
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
