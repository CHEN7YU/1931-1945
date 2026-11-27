import { circleBlocked, segmentClear } from './core.js';
import { obstacleLookup } from './spatial.js';
import { NANJING_DOCK_ENTRY_X, NANJING_DOCK_SHIFT, NANJING_DOCK_WEST_EXTENSION,
  NANJING_OPENING_CIVILIAN_COUNT, nanjingPierHeight } from './nanjing-campaign.js';
export { NANJING_OPENING_CIVILIAN_COUNT } from './nanjing-campaign.js';

export const NANJING_CIVILIAN_COUNT = 180;
export const NANJING_OPENING_BRIDGE_TARGET = Object.freeze({ x: -24, z: 31 });
export const NANJING_OPENING_SOURCES = Object.freeze(
  [...[40, 42, 44, 45, 50, 55, 60, 64].flatMap(z => [-27, -25, -23, -21].map(x => Object.freeze({ x, z }))),
    ...[-55, -40, -25, -10, 5].map(x => Object.freeze({ x, z: 70 }))],
);

const variation = (index, salt) => {
  let value = Math.imul(index + salt, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};
const CROWD_TURNS = Object.freeze([0, .6, -.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, Math.PI]);
const openingStarts = [];
for (let candidate = 0; openingStarts.length < NANJING_OPENING_CIVILIAN_COUNT; candidate++) {
  const point = { x: -24 + (variation(candidate, 19) - .5) * 4.4,
    z: 39 + variation(candidate, 71) * 25 };
  if (openingStarts.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= .82))
    openingStarts.push(point);
}
openingStarts.sort((a, b) => a.z - b.z);
export function nanjingOpeningCivilianStart(index) {
  if (!Number.isInteger(index) || index < 0 || index >= NANJING_OPENING_CIVILIAN_COUNT)
    throw new RangeError('Invalid opening civilian');
  return { ...openingStarts[index] };
}

export function nanjingOpeningCivilianReleaseAt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= NANJING_OPENING_CIVILIAN_COUNT)
    throw new RangeError('Invalid opening civilian');
  return 0;
}

export function civilianPaceMultiplier(index, now) {
  if (!Number.isInteger(index) || index < 0 || !Number.isFinite(now) || now < 0)
    throw new RangeError('Invalid civilian pace');
  return (.82 + variation(index, 211) * .36) *
    (1 + Math.sin(now * (.27 + variation(index, 307) * .17) + variation(index, 401) * Math.PI * 2) * .06);
}

export function releaseNanjingCivilianWave(civilians, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Invalid civilian wave time');
  const homeReleaseTimes = new Map();
  for (const civilian of civilians) {
    const data = civilian.userData;
    if (data.withdrawalWave && !data.active) {
      const desired = now + variation(data.civilianId, 503) * (data.streetLife ? 4 : 48);
      data.releaseAt = Math.max(desired, homeReleaseTimes.get(data.homeId) ?? now);
      homeReleaseTimes.set(data.homeId, data.releaseAt + 1.4 + variation(data.civilianId, 601) * 1.2);
    }
  }
}

export function activateCivilianEvacuation(civilian, now, peers) {
  const data = civilian.userData;
  if (data.active) return true;
  if (now < data.releaseAt) return false;
  if (!civilian.visible) {
    if (peers.some(other => other !== civilian &&
      Math.hypot(other.position.x - civilian.position.x, other.position.z - civilian.position.z) < .74)) return false;
    civilian.visible = true;
    peers.push(civilian);
  }
  data.active = true;
  return true;
}

export function openingSourceHiddenByCover(source, eye, groundHeight) {
  const intersects = (target, box) => {
    let near = 0, far = 1;
    for (const [axis, min, max] of [
      ['x', box.minX + .02, box.maxX - .02],
      ['y', box.minY + .02, box.height - .02],
      ['z', box.minZ + .02, box.maxZ - .02],
    ]) {
      if (min >= max) return false;
      const direction = target[axis] - eye[axis];
      if (Math.abs(direction) < 1e-9) {
        if (eye[axis] <= min || eye[axis] >= max) return false;
      } else {
        const a = (min - eye[axis]) / direction, b = (max - eye[axis]) / direction;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near >= far) return false;
      }
    }
    return near > 0 && far < 1;
  };
  const ground = groundHeight(source.x, source.z);
  return (source.cover ?? []).some(box => {
    for (const x of [-.8, .8]) for (const y of [0, 2.4]) for (const z of [-.8, .8])
      if (!intersects({ x: source.x + x, y: ground + y, z: source.z + z }, box)) return false;
    return true;
  });
}

export function prepareOpeningCivilian(civilian, sources, peers, isVisible, canSpawn, groundHeight, evacuationInProgress = false) {
  const data = civilian.userData;
  if (data.active || civilian.visible || !data.openingWave)
    throw new Error('Only an unreleased opening refugee can select a source');
  const source = [...sources].sort((a, b) =>
    Math.hypot(a.x - data.startX, a.z - data.startZ) - Math.hypot(b.x - data.startX, b.z - data.startZ))
    .find(point => !isVisible(point) && canSpawn(point) &&
      (!evacuationInProgress || !point.street ||
        !peers.some(other => other.userData.openingInside && other.userData.streetLife === point.street)) &&
      peers.every(other => Math.hypot(other.position.x - point.x, other.position.z - point.z) >= .74));
  if (!source) return false;
  const join = route => {
    const index = route.findIndex(point => Math.hypot(point.x - NANJING_OPENING_BRIDGE_TARGET.x,
      point.z - NANJING_OPENING_BRIDGE_TARGET.z) < .02);
    if (index < 0) throw new Error(`Opening refugee ${data.civilianId} has no bridge waypoint`);
    return [...source.path, ...route.slice(index + 1)];
  };
  data.homeRoute = join(data.homeRoute);
  data.refugeeRestRoute = join(data.refugeeRestRoute);
  data.route = data.fleeReleased ? data.homeRoute : data.refugeeRestRoute;
  data.waypoint = 0;
  if (source.street) {
    data.streetLife = source.street;
    data.streetEvacuating = true;
    data.openingInside = true;
  }
  civilian.position.set(source.x, groundHeight(source.x, source.z), source.z);
  return true;
}

export function civilianWaypointReached(position, route, index, obstacles, lookup = null) {
  if (!Array.isArray(route) || !Number.isInteger(index) || index < 0 || index > route.length)
    throw new RangeError('Civilian route cursor is outside its route');
  // A resting civilian may be displaced after consuming its final waypoint.
  if (index === route.length) return false;
  const target = route[index], next = route[index + 1];
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z))
    throw new RangeError('Civilian route waypoint must have finite coordinates');
  const distance = Math.hypot(target.x - position.x, target.z - position.z);
  if (!next) return distance <= .015;
  return distance <= .12 || distance <= .8 && segmentClear(position, next, .36, obstacles,
    lookup ? (x, z) => lookup.at(x, z) : undefined);
}

const waitingSlots = [];
for (let index = 0; index < NANJING_CIVILIAN_COUNT; index++) {
  const slot = index * 73 % 240;
  waitingSlots.push({ x: -89 + NANJING_DOCK_WEST_EXTENSION + slot % 10 * .78 + (variation(index, 701) - .5) * .024, y: 0,
    z: -89 + Math.floor(slot / 10) * .76 + slot % 10 * .03 + (variation(index, 709) - .5) * .012 });
}

export function civilianWaitingSlot(index) {
  if (!Number.isInteger(index) || index < 0 || index >= NANJING_CIVILIAN_COUNT) throw new RangeError('Invalid civilian waiting slot');
  return { ...waitingSlots[index] };
}

export function civilianWaitingDrift(index, now, anchor) {
  const phase = now * (.35 + variation(index, 719) * .2) + index * 2.17;
  return { x: anchor.x + Math.sin(phase) * .32, z: anchor.z + Math.sin(phase * .73 + 1.4) * .38 };
}

export function placeCivilianWaitingSlots(clear) {
  const placed = [];
  for (let index = 0; index < NANJING_CIVILIAN_COUNT; index++) {
    const anchor = civilianWaitingSlot(index), candidates = [anchor];
    for (const radius of [.6, 1.2, 1.8, 2.4, 3.6, 5]) for (let side = 0; side < 24; side++) {
      const angle = side * Math.PI / 12 + index * 2.17;
      const x = anchor.x + Math.cos(angle) * radius, z = anchor.z + Math.sin(angle) * radius;
      candidates.push({ x, z, y: 0 });
    }
    const point = candidates.find(point => point.x > -90 + NANJING_DOCK_WEST_EXTENSION && point.x < NANJING_DOCK_ENTRY_X - .5 &&
      point.z > -89.5 && point.z < -70.5 &&
      placed.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= .74) && clear(point));
    if (!point) throw new Error(`No physically clear dock waiting place for civilian ${index}`);
    placed.push(point);
  }
  return placed;
}

export function closestCivilianForBoat(queue, boat) {
  if (!queue.length) throw new RangeError('Boarding selection requires waiting civilians');
  const distance = person => (person.position.x - boat.x) ** 2 + (person.position.z - boat.z) ** 2;
  return queue.reduce((nearest, person) => distance(person) < distance(nearest) ? person : nearest);
}

export function civilianBoardingSpeed(age) {
  const speed = { adult: 3.2, elderly: 2.4, child: 2.8 }[age];
  if (!speed) throw new RangeError('Unknown boarding civilian age');
  return speed;
}

export function createCivilianCrowdPlanner() {
  const grids = new Map();
  let remaining = 1, revision = 0;
  const stats = { searches: 0, deferred: 0, grids: 0, expanded: 0, maxExpanded: 0,
    maxGridCellsPerSlice: 0, maxExpandedPerSlice: 0 };
  return {
    stats, get revision() { return revision; }, beginStep() { remaining = 1; },
    invalidate() { grids.clear(); stats.grids = 0; revision++; },
    take() { if (!remaining) { stats.deferred++; return false; } remaining--; stats.searches++; return true; },
    grid(key, obstacles, build) {
      const previous = grids.get(key);
      if (previous?.obstacles === obstacles) return previous.value;
      const value = build();
      if (grids.size >= 8) grids.delete(grids.keys().next().value);
      grids.set(key, { obstacles, value }); stats.grids = grids.size;
      return value;
    },
  };
}

export function rejoinCivilianRoute(position, target, navigate, obstacles, lookup) {
  const clear = (from, to) => segmentClear(from, to, .36, obstacles,
    lookup ? (x, z) => lookup.at(x, z) : undefined);
  const starts = [{ x: position.x, z: position.z }];
  for (const radius of [.5, 1]) for (let side = 0; side < 8; side++) {
    const angle = side * Math.PI / 4;
    starts.push({ x: position.x + Math.cos(angle) * radius, z: position.z + Math.sin(angle) * radius });
  }
  for (const start of starts) {
    if (!clear(position, start)) continue;
    const path = navigate(start, target);
    if (!path.length || Math.hypot(path.at(-1).x - target.x, path.at(-1).z - target.z) > .015) continue;
    let from = position;
    const points = [start, ...path];
    if (!points.every(point => {
      const valid = clear(from, point);
      from = point;
      return valid;
    })) continue;
    return points.filter(point => Math.hypot(point.x - position.x, point.z - position.z) > .015)
      .map(point => ({ x: point.x, z: point.z }));
  }
  return null;
}

function* dockDetour(position, target, peers, civilian, obstacles, spacing, planner) {
  position = { x: position.x, z: position.z };
  const step = .25, dock = [position, target].every(value =>
    value.x >= -73 + NANJING_DOCK_SHIFT && value.x <= -40 + NANJING_DOCK_SHIFT && value.z >= -94 && value.z <= -59);
  const minX = dock ? -73 + NANJING_DOCK_SHIFT : Math.floor((Math.min(position.x, target.x) - 6) / step) * step;
  const minZ = dock ? -94 : Math.floor((Math.min(position.z, target.z) - 6) / step) * step;
  const width = dock ? 133 : Math.ceil((Math.max(position.x, target.x) + 6 - minX) / step) + 1;
  const depth = dock ? 141 : Math.ceil((Math.max(position.z, target.z) + 6 - minZ) / step) + 1;
  const point = index => ({ x: minX + index % width * step, z: minZ + Math.floor(index / width) * step });
  const cell = value => Math.round((value.x - minX) / step) + Math.round((value.z - minZ) / step) * width;
  const from = cell(position), to = cell(target), count = width * depth;
  const maxX = minX + (width - 1) * step, maxZ = minZ + (depth - 1) * step;
  const localObstacles = obstacles.filter(obstacle => obstacle.minX < maxX + .36 && obstacle.maxX > minX - .36 &&
    obstacle.minZ < maxZ + .36 && obstacle.maxZ > minZ - .36);
  const makeGrid = () => {
    return { lookup: obstacleLookup(localObstacles, .8), blocked: new Uint8Array(count), next: 0 };
  };
  const grid = planner ? planner.grid(`${minX}:${minZ}:${width}:${depth}`, obstacles, makeGrid) : makeGrid();
  while (grid.next < count) {
    const until = Math.min(count, grid.next + 512);
    if(planner)planner.stats.maxGridCellsPerSlice=Math.max(planner.stats.maxGridCellsPerSlice,until-grid.next);
    for (; grid.next < until; grid.next++) {
      const p = point(grid.next);
      grid.blocked[grid.next] = Number(circleBlocked(p.x, p.z, .38, grid.lookup.at(p.x, p.z)));
    }
    if (grid.next < count) yield;
  }
  const lookup = grid.lookup, blocked = grid.blocked.slice();
  for (const other of peers) {
    if (other === civilian) continue;
    const x = Math.round((other.position.x - minX) / step), z = Math.round((other.position.z - minZ) / step);
    for (let row = Math.max(0, z - 3); row <= Math.min(depth - 1, z + 3); row++)
      for (let column = Math.max(0, x - 3); column <= Math.min(width - 1, x + 3); column++) {
        const index = row * width + column, p = point(index);
        if (Math.hypot(p.x - other.position.x, p.z - other.position.z) < spacing + .02) blocked[index] = 1;
      }
  }
  if (blocked[to]) return null;
  const parents = new Int32Array(count).fill(-1), costs = new Float32Array(count).fill(Infinity);
  const open = [], scores = [], closed = new Uint8Array(count);
  const heuristic = index => Math.abs(index % width - to % width) +
    Math.abs(Math.floor(index / width) - Math.floor(to / width));
  const push = index => {
    let at = open.length;
    const score = costs[index] + heuristic(index);
    open.push(index); scores.push(score);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (scores[parent] <= score) break;
      open[at] = open[parent]; scores[at] = scores[parent]; at = parent;
    }
    open[at] = index; scores[at] = score;
  };
  const pop = () => {
    const result = open[0], last = open.pop(), score = scores.pop();
    if (open.length) {
      let at = 0;
      while (at * 2 + 1 < open.length) {
        let next = at * 2 + 1;
        if (next + 1 < open.length && scores[next + 1] < scores[next]) next++;
        if (scores[next] >= score) break;
        open[at] = open[next]; scores[at] = scores[next]; at = next;
      }
      open[at] = last; scores[at] = score;
    }
    return result;
  };
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const column = from % width + dx, row = Math.floor(from / width) + dz, index = row * width + column;
    if (column < 0 || column >= width || row < 0 || row >= depth || blocked[index]) continue;
    const p = point(index), sx = p.x - position.x, sz = p.z - position.z, lengthSquared = sx * sx + sz * sz;
    if (lengthSquared > 1 || !segmentClear(position, p, .36, localObstacles, (x, z) => lookup.at(x, z))) continue;
    const clear = peers.every(other => {
      if (other === civilian) return true;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1,
        ((other.position.x - position.x) * sx + (other.position.z - position.z) * sz) / lengthSquared)) : 0;
      return Math.hypot(position.x + t * sx - other.position.x, position.z + t * sz - other.position.z) >= spacing;
    });
    if (clear) { parents[index] = index; costs[index] = Math.sqrt(lengthSquared) / step; push(index); }
  }
  let expanded = 0;
  while (open.length) {
    const current = pop();
    if (current === to) {
      const path = [{ x: target.x, z: target.z }];
      for (let index = to; ; index = parents[index]) {
        path.push(point(index));
        if (parents[index] === index) break;
      }
      return path.reverse();
    }
    if (closed[current]) continue;
    closed[current] = 1;
    expanded++;
    if (planner) { planner.stats.expanded++; planner.stats.maxExpanded = Math.max(planner.stats.maxExpanded, expanded); }
    if(planner)planner.stats.maxExpandedPerSlice=Math.max(planner.stats.maxExpandedPerSlice,
      (expanded-1)%256+1);
    if (expanded % 256 === 0) yield;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = current % width + dx, z = Math.floor(current / width) + dz, next = z * width + x;
      if (x < 0 || x >= width || z < 0 || z >= depth || blocked[next] || closed[next] ||
        costs[next] <= costs[current] + 1) continue;
      parents[next] = current; costs[next] = costs[current] + 1; push(next);
    }
  }
  return null;
}

function civilianYieldTarget(civilian, peers, obstacles, spacing) {
  const { position, userData: data } = civilian, direction = data.crowdDirection;
  const relative = other => {
    const dx = other.position.x - position.x, dz = other.position.z - position.z;
    return { ahead: dx * direction.x + dz * direction.z, across: dx * direction.z - dz * direction.x };
  };
  const moving = other => !other.userData.arrived && !other.userData.dead &&
    (!Array.isArray(other.userData.route) || other.userData.waypoint < other.userData.route.length);
  let leader = data.crowdYieldTo == null ? null : peers.find(other => other.userData.civilianId === data.crowdYieldTo);
  const finishedYield = data.crowdYieldPoint &&
    Math.hypot(position.x - data.crowdYieldPoint.x, position.z - data.crowdYieldPoint.z) < .1;
  if (leader && (!moving(leader) || relative(leader).ahead < -.85 ||
    finishedYield && relative(leader).ahead <= 0)) {
    data.crowdYieldTo = null; data.crowdYieldPoint = null; leader = null;
  }
  if (!leader) {
    data.crowdYieldTo = null; data.crowdYieldPoint = null;
    let nearest = 2.4;
    const goal = data.route?.at(-1) ?? data.crowdTarget;
    const gx = goal.x - position.x, gz = goal.z - position.z;
    for (const other of peers) {
      if (other === civilian || !moving(other) || !other.userData.crowdDirection ||
        other.userData.crowdYieldTo === data.civilianId) continue;
      const { ahead, across } = relative(other), facing = other.userData.crowdDirection;
      if (ahead <= 0 || ahead >= nearest || Math.abs(across) >= spacing + .15) continue;
      const opposite = facing.x * direction.x + facing.z * direction.z < -.5;
      const retreating = other.userData.crowdYieldTo !== null && other.userData.crowdYieldTo !== undefined;
      if (opposite) {
        if (other.userData.civilianId >= data.civilianId) continue;
        const otherGoal = other.userData.route?.at(-1) ?? other.userData.crowdTarget;
        const ox = otherGoal.x - other.position.x, oz = otherGoal.z - other.position.z;
        if (gx * ox + gz * oz >= -.3 * Math.hypot(gx, gz) * Math.hypot(ox, oz)) continue;
      } else if (!retreating) continue;
      leader = other; nearest = ahead;
    }
    if (leader) {
      data.crowdYieldTo = leader.userData.crowdYieldTo ?? leader.userData.civilianId;
      leader = peers.find(other => other.userData.civilianId === data.crowdYieldTo);
    }
  }
  if (!leader) return null;
  const right = { x: -direction.z, z: direction.x };
  if (data.crowdYieldPoint) return data.crowdYieldPoint;
  for (const sign of [1, -1]) {
    const point = { x: position.x + right.x * .9 * sign, z: position.z + right.z * .9 * sign };
    if (segmentClear(position, point, .36, obstacles)) {
      data.crowdYieldPoint = point;
      return point;
    }
  }
  return { x: position.x - direction.x, z: position.z - direction.z };
}

export function moveCivilianInCrowd(civilian, target, distance, peers, obstacles, navigationObstacles = obstacles, canStep = null, planner = null) {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Invalid civilian movement distance');
  const position = civilian.position, radius = .36, data = civilian.userData;
  const crowdedDock = position.x < -45 + NANJING_DOCK_SHIFT && position.z < -65;
  const spacing = crowdedDock ? .52 : radius * 2;
  const remaining = Math.hypot(target.x - position.x, target.z - position.z);
  if (remaining > .01) data.crowdDirection = { x: (target.x - position.x) / remaining, z: (target.z - position.z) / remaining };
  if (!data.crowdTarget || Math.hypot(target.x - data.crowdTarget.x, target.z - data.crowdTarget.z) > .01) {
    data.crowdTarget = { x: target.x, z: target.z };
    data.crowdPath = data.crowdSearch = null; data.crowdBestDistance = remaining; data.crowdStalled = 0;
    data.crowdYieldTo = null; data.crowdYieldPoint = null;
  }
  if (remaining < data.crowdBestDistance - .05) {
    data.crowdBestDistance = remaining; data.crowdStalled = 0;
  } else data.crowdStalled += distance;
  const detourPoint = data.crowdPath?.[0];
  if (detourPoint) {
    const distanceToPoint = Math.hypot(detourPoint.x - position.x, detourPoint.z - position.z);
    if (data.crowdDetourPoint !== detourPoint || distanceToPoint < data.crowdPathBestDistance - .02) {
      data.crowdDetourPoint = detourPoint;
      data.crowdPathBestDistance = distanceToPoint;
      data.crowdPathStalled = 0;
    } else data.crowdPathStalled = (data.crowdPathStalled ?? 0) + distance;
  }
  if (data.crowdSearch && data.crowdSearchRevision !== planner?.revision) data.crowdSearch = null;
  if (!canStep && (data.crowdSearch || (data.crowdStalled > 1.5 && !data.crowdPath?.length) || data.crowdPathStalled > 1.5) &&
    (!planner || planner.take())) {
    data.crowdSearch ??= dockDetour(position, target, peers, civilian, navigationObstacles, spacing, planner);
    data.crowdSearchRevision = planner?.revision;
    let result = data.crowdSearch.next();
    if (!planner) while (!result.done) result = data.crowdSearch.next();
    if (result.done) {
      data.crowdPath = result.value; data.crowdSearch = null;
      data.crowdStalled = 0;
      data.crowdPathStalled = 0;
    }
  }
  let moved = 0;
  const steps = Math.max(1, Math.ceil(distance / .15));
  for (let step = 0; step < steps; step++) {
    while (data.crowdPath?.length &&
      Math.hypot(data.crowdPath[0].x - position.x, data.crowdPath[0].z - position.z) < .1) data.crowdPath.shift();
    const yieldTarget = data.crowdDirection ? civilianYieldTarget(civilian, peers, obstacles, spacing) : null;
    const waypoint = yieldTarget ?? data.crowdPath?.[0] ?? target;
    const dx = waypoint.x - position.x, dz = waypoint.z - position.z, remaining = Math.hypot(dx, dz);
    if (remaining < .01) break;
    const stride = Math.min(remaining, distance / steps);
    const heading = Math.atan2(dz, dx), preference = 1;
    let next = null;
    for (let turn = 0; turn < CROWD_TURNS.length; turn++) {
      const angle = turn === CROWD_TURNS.length - 1 ? Math.PI : CROWD_TURNS[turn] * preference;
      const point = { x: position.x + Math.cos(heading + angle) * stride,
        z: position.z + Math.sin(heading + angle) * stride };
      if ((!canStep || canStep(position, point)) && !circleBlocked(point.x, point.z, radius, obstacles, 0) &&
        peers.every(other => {
          if (other === civilian) return true;
          const previous = Math.hypot(position.x - other.position.x, position.z - other.position.z);
          const required = Math.min(spacing, previous);
          const vx = point.x - position.x, vz = point.z - position.z, length = vx * vx + vz * vz;
          const t = length ? Math.max(0, Math.min(1, ((other.position.x - position.x) * vx +
            (other.position.z - position.z) * vz) / length)) : 0;
          return Math.hypot(position.x + vx * t - other.position.x, position.z + vz * t - other.position.z) >= required - 1e-8 &&
            (previous >= spacing || Math.hypot(point.x - other.position.x, point.z - other.position.z) > previous + 1e-6);
        })) {
        next = point; break;
      }
    }
    if (!next) break;
    position.x = next.x; position.z = next.z;
    moved += stride;
  }
  position.y = nanjingPierHeight(position.x, position.z);
  return moved;
}

export function animateCivilianWaiting(civilian, now) {
  const data = civilian.userData, phase = now * 1.4 + data.civilianId * 2.17;
  for (const leg of civilian.civilianLegs) leg.rotation.x = 0;
  civilian.rotation.y = Math.PI / 2 + Math.sin(phase * .37) * .12;
  civilian.civilianTorso.rotation.x = -.06 + Math.sin(phase) * .015;
  civilian.civilianTorso.rotation.z = Math.sin(phase * .6) * .018;
  civilian.civilianHead.rotation.set(.03 + Math.sin(phase * .8) * .04,
    Math.sin(phase * .55) * .28, 0);
  const gesture = Math.max(0, Math.sin(phase * .43)) ** 6;
  civilian.civilianArms[0].rotation.x = data.carrying === 'child' ? -.5 : -.06 - gesture * .45;
  civilian.civilianArms[1].rotation.x = data.carrying === 'none' ? -.08 - gesture * .3 : -.15;
}
