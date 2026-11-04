import { circleBlocked, segmentClear } from './core.js';
import { obstacleLookup } from './spatial.js';

export const NANJING_CIVILIAN_COUNT = 180;

const variation = (index, salt) => {
  let value = Math.imul(index + salt, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};
const openingStarts = [];
for (let candidate = 0; openingStarts.length < 60; candidate++) {
  const point = { x: -24 + (variation(candidate, 19) - .5) * 4.4,
    z: 39 + variation(candidate, 71) * 25 };
  if (openingStarts.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= .82))
    openingStarts.push(point);
}
openingStarts.sort((a, b) => a.z - b.z);
const openingReleaseTimes = [];
for (let index = 0, releaseAt = 0; index < 60; index++) {
  if (index === 48) releaseAt = 46;
  else if (index > 0) releaseAt += index < 48 ? .25 + variation(index, 103) * .55 : .8 + variation(index, 103) * .9;
  openingReleaseTimes.push(releaseAt);
}

export function nanjingOpeningCivilianStart(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 60) throw new RangeError('Invalid opening civilian');
  return { ...openingStarts[index] };
}

export function nanjingOpeningCivilianReleaseAt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 60) throw new RangeError('Invalid opening civilian');
  return openingReleaseTimes[index];
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

export function civilianWaypointReached(position, route, index, obstacles, lookup = null) {
  const target = route[index], next = route[index + 1];
  const distance = Math.hypot(target.x - position.x, target.z - position.z);
  if (!next) return distance <= .015;
  return distance <= .12 || distance <= .8 && segmentClear(position, next, .36, obstacles,
    lookup ? (x, z) => lookup.at(x, z) : undefined);
}

const waitingSlots = [];
for (let index = 0; index < NANJING_CIVILIAN_COUNT; index++) {
  for (let attempt = 0; ; attempt++) {
    const seed = index * 997 + attempt;
    const x = index < 60 ? -71.6 + variation(seed, 701) ** 1.8 * 5
      : -63.8 + variation(seed, 703) * 15;
    const z = index < 60 ? -86.5 + variation(seed, 709) * 12 : -88 + variation(seed, 709) * 15.6;
    if (waitingSlots.every(point => Math.hypot(point.x - x, point.z - z) >= .58)) {
      waitingSlots.push({ x, y: x < -59 ? .36 : 0, z }); break;
    }
  }
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
      candidates.push({ x, z, y: x < -59 ? .36 : 0 });
    }
    const point = candidates.find(point => point.x > -72.5 && point.x < -46 &&
      point.z > -91 && point.z < -71 &&
      placed.every(other => Math.hypot(point.x - other.x, point.z - other.z) >= .58) && clear(point));
    if (!point) throw new Error(`No physically clear dock waiting place for civilian ${index}`);
    placed.push(point);
  }
  return placed;
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
    value.x >= -73 && value.x <= -40 && value.z >= -94 && value.z <= -59);
  const minX = dock ? -73 : Math.floor((Math.min(position.x, target.x) - 6) / step) * step;
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

export function moveCivilianInCrowd(civilian, target, distance, peers, obstacles, navigationObstacles = obstacles, canStep = null, planner = null) {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Invalid civilian movement distance');
  const position = civilian.position, radius = .36, data = civilian.userData;
  const crowdedDock = position.x < -45 && position.z < -65;
  const spacing = crowdedDock ? .52 : radius * 2;
  const remaining = Math.hypot(target.x - position.x, target.z - position.z);
  if (!data.crowdTarget || Math.hypot(target.x - data.crowdTarget.x, target.z - data.crowdTarget.z) > .01) {
    data.crowdTarget = { x: target.x, z: target.z };
    data.crowdPath = data.crowdSearch = null; data.crowdBestDistance = remaining; data.crowdStalled = 0;
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
    const waypoint = data.crowdPath?.[0] ?? target;
    const dx = waypoint.x - position.x, dz = waypoint.z - position.z, remaining = Math.hypot(dx, dz);
    if (remaining < .01) break;
    const stride = Math.min(remaining, distance / steps);
    const heading = Math.atan2(dz, dx), preference = civilian.userData.civilianId % 2 ? 1 : -1;
    const next = [0, preference * .6, -preference * .6, preference * 1.2, -preference * 1.2,
      preference * 1.8, -preference * 1.8, preference * 2.4, -preference * 2.4, Math.PI]
      .map(angle => ({ x: position.x + Math.cos(heading + angle) * stride,
        z: position.z + Math.sin(heading + angle) * stride }))
      .find(point => (!canStep || canStep(position, point)) && !circleBlocked(point.x, point.z, radius, obstacles, 0) &&
        peers.every(other => other === civilian || Math.hypot(point.x - other.position.x, point.z - other.position.z) >= spacing));
    if (!next) break;
    position.x = next.x; position.z = next.z;
    moved += stride;
  }
  position.y = position.x >= -73 && position.x <= -59 && position.z >= -90 && position.z <= -70 ? .36 : 0;
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
