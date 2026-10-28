import { circleBlocked } from './core.js';
import { obstacleLookup } from './spatial.js';

export const TOWN_STOREYS = Object.freeze({
  'east-0': 2,
  'west-2': 3,
  'east-3': 2,
  'west-4': 2,
  'courtyard-shop': 2,
  'canal-south-depot': 4,
  'canal-north-granary': 3,
});
export const STOREY_HEIGHT = 3.2;

export function upperBuilding(building) {
  const pieces = [], flights = [];
  const add = (name, x, bottom, z, w, h, d, material = 'plaster', extra = {}) => {
    pieces.push({ id: `${building.id}-${name}`, x, y: bottom + h / 2, z, w, h, d,
      material, collision: true, ...extra });
  };
  const { x, z, w, d, storeys } = building;
  const left = x + w / 2 - 3.8, right = x + w / 2 - .35;
  const back = z - d / 2 + .35, turn = back + 1.15, front = turn + 2.8;
  const laneWidth = (right - left - .15) / 2;
  const lowerX = left + laneWidth / 2, upperX = right - laneWidth / 2;
  for (let level = 1; level < storeys; level++) {
    const y = level * STOREY_HEIGHT, base = y - STOREY_HEIGHT;
    // Leave the entire stairwell open; no hidden full-floor slab over the flights.
    const minX = x - w / 2 + .12, maxX = x + w / 2 - .12;
    const minZ = z - d / 2 + .12, maxZ = z + d / 2 - .12;
    add(`floor-${level}-main`, (minX + left) / 2, y - .18, (minZ + maxZ) / 2,
      left - minX, .18, maxZ - minZ, 'floor', { walkable: true });
    add(`floor-${level}-landing`, (left + maxX) / 2, y - .18, (front + maxZ) / 2,
      maxX - left, .18, maxZ - front, 'floor', { walkable: true });
    add(`stair-${level}-turn`, (left + right) / 2, base + 1.6 - .18, (back + turn) / 2,
      right - left, .18, turn - back, 'floor', { walkable: true, stair: true });
    for (let step = 0; step < 10; step++) {
      const rise = (step + 1) * .16;
      add(`stair-${level}-lower-${step}`, lowerX, base + rise - .16, front - (step + .5) * .28,
        laneWidth, .16, .28, 'stone', { walkable: true, stair: true });
      add(`stair-${level}-upper-${step}`, upperX, base + 1.6 + rise - .16, turn + (step + .5) * .28,
        laneWidth, .16, .28, 'stone', { walkable: true, stair: true });
    }
    add(`stair-${level}-inner-wall`, left, base, (turn + front) / 2,
      .12, STOREY_HEIGHT, front - turn, 'brick');
    add(`stair-${level}-divider`, (lowerX + upperX) / 2, base, (turn + front) / 2,
      .15, STOREY_HEIGHT, front - turn, 'brick');
    add(`stair-${level}-back-rail`, (left + right) / 2, base + 1.6, back,
      right - left, 1, .12, 'timber');
    flights.push({ level, lower: { x: lowerX, y: base, z: front + .65 },
      upper: { x: upperX, y, z: front + .65 }, path: [
        { x: lowerX, y: base, z: front + .65 },
        { x: lowerX, y: base + 1.6, z: back + .58 },
        { x: upperX, y: base + 1.6, z: back + .58 },
        { x: upperX, y, z: front + .65 },
      ] });
    const wall = (name, axis, fixed, start, end, centers) => {
      let cursor = start, serial = 0;
      const segment = (a, b, bottom, height) => {
        if (b - a <= .001) return;
        add(`${name}-${serial++}`, axis === 'z' ? fixed : (a + b) / 2, bottom,
          axis === 'z' ? (a + b) / 2 : fixed,
          axis === 'z' ? .24 : b - a, height, axis === 'z' ? b - a : .24,
          'plaster', { wall: true });
      };
      for (const center of centers) {
        segment(cursor, center - .9, y, STOREY_HEIGHT);
        segment(center - .9, center + .9, y, .88);
        segment(center - .9, center + .9, y + 2.35, STOREY_HEIGHT - 2.35);
        add(`${name}-sill-${serial++}`, axis === 'z' ? fixed : center, y + .78,
          axis === 'z' ? center : fixed, axis === 'z' ? .4 : 2, .1,
          axis === 'z' ? 2 : .4, 'stone');
        cursor = center + .9;
      }
      segment(cursor, end, y, STOREY_HEIGHT);
    };
    for (const side of [-1, 1]) {
      wall(`upper-${level}-side-${side}`, 'z', x + side * w / 2, z - d / 2, z + d / 2, [z - 3.4, z + 2]);
      wall(`upper-${level}-end-${side}`, 'x', z + side * d / 2, x - w / 2, x + w / 2, [x - w / 4, x + w / 4]);
    }
  }
  add('ceiling', x, storeys * STOREY_HEIGHT - .18, z, w - .24, .18, d - .24, 'floor');
  return { pieces, flights };
}

export function createWalkSupport(pieces, terrain) {
  const surfaces = pieces.filter(piece => piece.walkable).map(piece => ({ ...piece,
    minX: piece.x - piece.w / 2, maxX: piece.x + piece.w / 2,
    minZ: piece.z - piece.d / 2, maxZ: piece.z + piece.d / 2 }));
  const lookup = obstacleLookup(surfaces, 0);
  const heightAt = (x, z, referenceY = terrain(x, z), step = .24) => {
    let height = terrain(x, z);
    for (const piece of lookup.at(x, z)) {
      const top = piece.y + piece.h / 2;
      if (top > referenceY + step + 1e-6 || top <= height ||
        Math.abs(x - piece.x) > piece.w / 2 + 1e-7 || Math.abs(z - piece.z) > piece.d / 2 + 1e-7) continue;
      height = top;
    }
    return height;
  };
  const move = (position, dx, dz, radius, obstacles, bodyHeight = 1.75) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .06));
    const attempt = (x, z) => {
      const y = heightAt(x, z, position.y);
      if (y - position.y > .25 || position.y - y > .65) return;
      const blockers = obstacles.filter(obstacle => !(obstacle.walkable && obstacle.height <= y + .5));
      if (circleBlocked(x, z, radius, blockers, y, bodyHeight)) return;
      position.x = x; position.z = z; position.y = y;
    };
    for (let i = 0; i < steps; i++) {
      attempt(position.x + dx / steps, position.z);
      attempt(position.x, position.z + dz / steps);
    }
    return position;
  };
  return { heightAt, move };
}

export function buildingAt(point, buildings) {
  return buildings.find(building => building.storeys > 1 &&
    Math.abs(point.x - building.x) < building.w / 2 && Math.abs(point.z - building.z) < building.d / 2);
}

export function floorDestination(anchor, desired, buildings) {
  const building = anchor.y > 1 ? buildingAt(anchor, buildings) : null;
  if (!building) return desired;
  return { x: Math.max(building.x - building.w / 2 + .75, Math.min(building.x + building.w / 2 - 4.5, desired.x)),
    y: Math.max(0, Math.min(building.storeys - 1, Math.round(anchor.y / STOREY_HEIGHT))) * STOREY_HEIGHT,
    z: Math.max(building.z - building.d / 2 + .75, Math.min(building.z + building.d / 2 - .75, desired.z)) };
}

export function multistoryPath(start, goal, buildings, navigate) {
  const source = start.y > .25 ? buildingAt(start, buildings) : null;
  const destination = goal.y > .25 ? buildingAt(goal, buildings) : null;
  if (!source && !destination) return navigate(start, goal);
  const path = [];
  let cursor = { ...start }, level = source ? Math.floor((start.y + .01) / STOREY_HEIGHT) : 0;
  const append = points => {
    path.push(...points.map(point => ({ ...point })));
    if (points.length) cursor = { ...points.at(-1) };
  };
  const acrossFloor = (target, building) => {
    const corridor = building.stairs[0].lower.z;
    append([{ x: cursor.x, y: cursor.y, z: corridor },
      { x: target.x, y: cursor.y, z: corridor }, target]);
  };
  if (source && Math.abs(start.y - level * STOREY_HEIGHT) > .02) {
    const down = source.stairs[level].path.toReversed();
    let nearest = 0, distance = Infinity;
    for (let i = 0; i < down.length - 1; i++) {
      const a = down[i], b = down[i + 1], delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const t = Math.max(0, Math.min(1, ((start.x - a.x) * delta.x + (start.y - a.y) * delta.y +
        (start.z - a.z) * delta.z) / (delta.x ** 2 + delta.y ** 2 + delta.z ** 2)));
      const d = Math.hypot(start.x - a.x - t * delta.x, start.y - a.y - t * delta.y, start.z - a.z - t * delta.z);
      if (d < distance) { nearest = i; distance = d; }
    }
    append(down.slice(nearest + 1));
  }
  const targetLevel = destination ? Math.max(0, Math.min(destination.storeys - 1, Math.round(goal.y / STOREY_HEIGHT))) : 0;
  const shared = source && source === destination;
  if (source) {
    const bottom = shared ? targetLevel : 0;
    while (level > bottom) {
      const flight = source.stairs[level - 1];
      acrossFloor(flight.upper, source);
      append(flight.path.toReversed().slice(1)); level--;
    }
  }
  if (!shared) {
    const groundGoal = destination ? destination.stairs[0].lower : goal;
    const groundPath = navigate(cursor, groundGoal);
    if (!groundPath.length) return [];
    append(groundPath); level = 0;
  }
  if (destination) {
    while (level < targetLevel) {
      const flight = destination.stairs[level];
      if (level > 0) acrossFloor(flight.lower, destination);
      append(flight.path.slice(1)); level++;
    }
    acrossFloor(goal, destination);
  }
  return path;
}
