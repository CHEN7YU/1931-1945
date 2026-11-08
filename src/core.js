import { RIFLE, INFANTRY_WEAPONS } from './rifle-action.js';
import { obstacleLookup } from './spatial.js';

export const MAP_LIMIT = 108;
export const MATCH_SECONDS = 600;
export const CAPTURE_SECONDS = 12;
export const DOMINATION_SECONDS = 20;
export const TYPES = Object.freeze({
  infantry: { name: '步兵班', weapon: INFANTRY_WEAPONS.rifle.name, members: 11, magazine: RIFLE.magazine, reload: RIFLE.reloadSeconds, interval: RIFLE.cycleSeconds, speed: 2.7, health: 100, damage: 100 },
  tank: { name: '装甲小队', weapon: '维克斯B型 · 47毫米炮', members: 3, magazine: 1, reload: 3.8, interval: .5, speed: 8, health: 360, damage: 160 },
  mortar: { name: '迫击炮组', weapon: '轻型迫击炮', members: 3, magazine: 1, reload: 3.2, interval: .5, speed: 2.45, health: 100, damage: 160 },
  plane: { name: '航空小队', weapon: '伊-15bis · 7.62毫米机枪', members: 1, magazine: 60, reload: 3, interval: .1, speed: 24, health: 180, damage: 65 },
});
export const OBJECTIVES = Object.freeze([
  { id: 'A', name: '南街路口', x: -12, z: 30, radius: 13 },
  { id: 'B', name: '运河石桥', x: 8, z: -7, radius: 13 },
  { id: 'C', name: '北城街垒', x: -10, z: -51, radius: 14 },
]);

export function makeObjectives(layout = OBJECTIVES) {
  return layout.map(point => ({ ...point, owner: null, control: 0, progress: 0, enemyProgress: 0, captured: false, status: 'empty' }));
}

export function objectiveContainsPosition(point, position) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) throw new RangeError('Objective position must be finite');
  const area = point.captureArea;
  if (!area) return Math.hypot(position.x - point.x, position.z - point.z) < point.radius;
  if (!['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY'].every(key => Number.isFinite(area[key])) ||
    area.minX >= area.maxX || area.minZ >= area.maxZ || area.minY >= area.maxY) {
    throw new RangeError('Indoor capture bounds must be finite and ordered');
  }
  if (!Number.isFinite(position.y)) throw new RangeError('Indoor capture requires a finite height');
  return position.x > area.minX && position.x < area.maxX && position.z > area.minZ && position.z < area.maxZ &&
    position.y >= area.minY && position.y < area.maxY;
}

export function advanceCapture(point, dt, friendly, hostile) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Capture requires a finite non-negative step');
  if (friendly && hostile) return point.status = 'contested';
  const direction = friendly ? 1 : hostile ? -1 : 0;
  if (direction) {
    point.control = Math.max(-1, Math.min(1, point.control + direction * dt / CAPTURE_SECONDS));
    if (point.owner === 'friendly' && point.control <= 0 || point.owner === 'enemy' && point.control >= 0) point.owner = null;
    if (point.control === 1) point.owner = 'friendly';
    if (point.control === -1) point.owner = 'enemy';
  } else {
    const home = point.owner === 'friendly' ? 1 : point.owner === 'enemy' ? -1 : 0;
    point.control += Math.sign(home - point.control) * Math.min(Math.abs(home - point.control), dt / (CAPTURE_SECONDS * 2));
  }
  point.progress = Math.max(0, point.control);
  point.enemyProgress = Math.max(0, -point.control);
  point.captured = point.owner === 'friendly';
  return point.status = direction ? point.control === direction ? 'captured' : 'capturing' : point.owner ? 'held' : 'empty';
}

export function createConquest() {
  return { friendly: 0, enemy: 0, dominationTeam: null, dominationTime: 0, winner: null };
}

export function advanceConquest(match, points, dt, remaining) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(remaining) || remaining < 0 || !points.length) {
    throw new RangeError('Conquest requires objectives and finite non-negative time');
  }
  if (match.winner) return match.winner;
  for (const team of ['friendly', 'enemy']) match[team] += points.filter(point => point.owner === team).length * dt;
  const dominant = ['friendly', 'enemy'].find(team => points.every(point => point.owner === team &&
    point.control === (team === 'friendly' ? 1 : -1) && point.status !== 'contested'));
  match.dominationTime = dominant ? match.dominationTeam === dominant ? match.dominationTime + dt : dt : 0;
  match.dominationTeam = dominant ?? null;
  if (match.dominationTime >= DOMINATION_SECONDS) match.winner = dominant;
  else if (!remaining) {
    const owned = team => points.filter(point => point.owner === team).length;
    const difference = owned('friendly') - owned('enemy') || match.friendly - match.enemy;
    match.winner = difference > 0 ? 'friendly' : difference < 0 ? 'enemy' : 'draw';
  }
  return match.winner;
}

let collisionDiagnostics = null;
export function setCollisionDiagnostics(diagnostics) {
  collisionDiagnostics = diagnostics;
}

export function circleBlocked(x, z, radius, obstacles, feetY = 0, bodyHeight = 1.75) {
  const probe = collisionDiagnostics?.current;
  if (probe) {
    probe.circleCalls++; probe.candidates += obstacles.length;
    const count = obstacles.length;
    probe.candidateHistogram[count === 0 ? 0 : count <= 8 ? 1 : count <= 32 ? 2 : count <= 128 ? 3 : count <= 512 ? 4 : 5]++;
  }
  if (Math.abs(x) > MAP_LIMIT - radius || Math.abs(z) > MAP_LIMIT - radius) {
    if (probe) { probe.boundaryHits++; probe.blocked++; }
    return true;
  }
  // Match Array.some: snapshot length, skip holes, and still visit inherited entries.
  for (let i = 0, length = obstacles.length; i < length; i++) {
    if (!(i in obstacles)) continue;
    const b = obstacles[i];
    if (probe) probe.checked++;
    if ((b.minY ?? -Infinity) >= feetY + bodyHeight ||
      (b.height ?? Infinity) <= feetY + .025) continue;
    let blocked;
    if (b.circular) blocked = (x - b.cx) ** 2 + (z - b.cz) ** 2 < (radius + b.radius) ** 2;
    else if (b.door || b.oriented) {
      const c = b.cos ?? Math.cos(b.angle), s = b.sin ?? Math.sin(b.angle);
      const dx = x - b.cx, dz = z - b.cz;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      const nx = Math.max(-b.hx, Math.min(b.hx, lx)), nz = Math.max(-b.hz, Math.min(b.hz, lz));
      blocked = (lx - nx) ** 2 + (lz - nz) ** 2 < radius ** 2;
    } else {
      const nx = Math.max(b.minX, Math.min(b.maxX, x));
      const nz = Math.max(b.minZ, Math.min(b.maxZ, z));
      blocked = (x - nx) ** 2 + (z - nz) ** 2 < radius ** 2;
    }
    if (blocked) {
      if (probe) probe.blocked++;
      return true;
    }
  }
  return false;
}

export function moveGround(position, dx, dz, radius, obstacles) {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / Math.max(radius * .7, .2)));
  for (let i = 0; i < steps; i++) {
    if (!circleBlocked(position.x + dx / steps, position.z, radius, obstacles)) position.x += dx / steps;
    if (!circleBlocked(position.x, position.z + dz / steps, radius, obstacles)) position.z += dz / steps;
  }
  return position;
}

export function segmentClear(start, end, radius, obstacles, candidatesAt = null, feetY = 0, bodyHeight = 1.75) {
  const distance = Math.hypot(end.x - start.x, end.z - start.z);
  const steps = Math.max(1, Math.ceil(distance / .2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = start.x + (end.x - start.x) * t, z = start.z + (end.z - start.z) * t;
    if (circleBlocked(x, z, radius, candidatesAt ? candidatesAt(x, z) : obstacles, feetY, bodyHeight)) return false;
  }
  return true;
}

export function createNavigator(obstacles, step = .75, radius = .46) {
  if (!(step > 0) || !(radius > 0)) throw new RangeError('Navigation resolution and clearance must be positive');
  const half = Math.floor((MAP_LIMIT - 1) / step);
  const width = half * 2 + 1;
  const count = width * width;
  const blocked = new Uint8Array(count);
  const links = new Uint8Array(count);
  const lookup = obstacleLookup(obstacles, Math.max(radius, .6));
  const blockedAt = (x, z, clearance = radius) => circleBlocked(x, z, clearance, lookup.at(x, z));
  const clear = (start, end, clearance = radius) => {
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(distance / .2));
    for (let i = 0; i <= steps; i++) if (blockedAt(start.x + (end.x - start.x) * i / steps, start.z + (end.z - start.z) * i / steps, clearance)) return false;
    return true;
  };
  const parents = new Int32Array(count), costs = new Float32Array(count), closed = new Uint8Array(count);
  const heapNodes = [], heapScores = [];
  const point = index => ({ x: (index % width - half) * step, z: (Math.floor(index / width) - half) * step });
  const linkPairs = (minX = 0, maxX = width - 1, minZ = 0, maxZ = width - 1) => {
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const index = z * width + x, a = point(index);
      if (x + 1 < width) {
        const other = index + 1;
        links[index] &= ~2; links[other] &= ~1;
        if (!blocked[index] && !blocked[other] && clear(a, point(other))) { links[index] |= 2; links[other] |= 1; }
      }
      if (z + 1 < width) {
        const other = index + width;
        links[index] &= ~8; links[other] &= ~4;
        if (!blocked[index] && !blocked[other] && clear(a, point(other))) { links[index] |= 8; links[other] |= 4; }
      }
    }
  };
  const rebuild = () => {
    lookup.rebuild();
    for (let index = 0; index < count; index++) {
      const p = point(index);
      blocked[index] = Number(blockedAt(p.x, p.z));
    }
    links.fill(0);
    linkPairs();
  };
  rebuild();
  const nearest = target => {
    let best = -1;
    let distance = Infinity;
    const tx = Math.max(0, Math.min(width - 1, Math.round(target.x / step) + half));
    const tz = Math.max(0, Math.min(width - 1, Math.round(target.z / step) + half));
    const targetClear = !blockedAt(target.x, target.z);
    const connectionRadius = targetClear ? radius : .42;
    const physicalClear = !blockedAt(target.x, target.z, connectionRadius);
    for (let z = Math.max(0, tz - 8); z <= Math.min(width - 1, tz + 8); z++) for (let x = Math.max(0, tx - 8); x <= Math.min(width - 1, tx + 8); x++) {
      const index = z * width + x;
      if (blocked[index]) continue;
      const p = point(index);
      const d = (target.x - p.x) ** 2 + (target.z - p.z) ** 2;
      if (d < distance && (!physicalClear || clear(target, p, connectionRadius))) { best = index; distance = d; }
    }
    return best;
  };
  const stats = { resolution: step, radius, expanded: 0, reason: 'ready' };
  const findPath = (start, goal) => {
    stats.expanded = 0;
    if (blockedAt(start.x, start.z, Math.min(radius, .42))) { stats.reason = 'blocked-start'; return []; }
    if (clear(start, goal)) {
      stats.reason = 'direct';
      return [{ x: goal.x, z: goal.z }];
    }
    const from = nearest(start);
    const to = nearest(goal);
    if (from < 0 || to < 0) { stats.reason = 'no-clear-cell'; return []; }
    parents.fill(-1); costs.fill(Infinity); closed.fill(0);
    heapNodes.length = heapScores.length = 0;
    const targetX = to % width, targetZ = Math.floor(to / width);
    const heuristic = index => Math.abs(index % width - targetX) + Math.abs(Math.floor(index / width) - targetZ);
    const push = (index, score) => {
      let i = heapNodes.length;
      heapNodes.push(index); heapScores.push(score);
      while (i) {
        const p = (i - 1) >> 1;
        if (heapScores[p] <= score) break;
        heapNodes[i] = heapNodes[p]; heapScores[i] = heapScores[p]; i = p;
      }
      heapNodes[i] = index; heapScores[i] = score;
    };
    const pop = () => {
      const first = heapNodes[0], lastNode = heapNodes.pop(), lastScore = heapScores.pop();
      if (heapNodes.length) {
        let i = 0;
        while (i * 2 + 1 < heapNodes.length) {
          let child = i * 2 + 1;
          if (child + 1 < heapNodes.length && heapScores[child + 1] < heapScores[child]) child++;
          if (lastScore <= heapScores[child]) break;
          heapNodes[i] = heapNodes[child]; heapScores[i] = heapScores[child]; i = child;
        }
        heapNodes[i] = lastNode; heapScores[i] = lastScore;
      }
      return first;
    };
    parents[from] = from;
    costs[from] = 0;
    push(from, heuristic(from));
    while (heapNodes.length) {
      const index = pop();
      if (closed[index]) continue;
      closed[index] = 1;
      stats.expanded++;
      if (index === to) break;
      for (let side = 0; side < 4; side++) {
        if (!(links[index] & (1 << side))) continue;
        const neighbor = index + (side === 0 ? -1 : side === 1 ? 1 : side === 2 ? -width : width);
        if (closed[neighbor] || costs[index] + 1 >= costs[neighbor]) continue;
        parents[neighbor] = index;
        costs[neighbor] = costs[index] + 1;
        push(neighbor, costs[neighbor] + heuristic(neighbor));
      }
    }
    if (!closed[to]) { stats.reason = 'unreachable'; return []; }
    const path = [];
    let index = to;
    while (index !== from) {
      path.push(point(index));
      index = parents[index];
    }
    path.push(point(from));
    path.reverse();
    if (!blockedAt(goal.x, goal.z) && clear(path.at(-1), goal)) path.push({ x: goal.x, z: goal.z });
    const smooth = [];
    let anchor = point(from);
    if (Math.hypot(start.x - anchor.x, start.z - anchor.z) > .05) smooth.push(anchor);
    // Probe longer clear segments geometrically instead of rechecking every prefix.
    let begin = 0;
    while (begin < path.length) {
      let last = begin, reach = 1, fail = path.length;
      while (begin + reach < path.length) {
        const candidate = begin + reach;
        if (!clear(anchor, path[candidate])) { fail = candidate; break; }
        last = candidate; reach *= 2;
      }
      if (fail === path.length && last < path.length - 1 && clear(anchor, path.at(-1))) last = path.length - 1;
      else while (fail - last > 1) {
        const candidate = (last + fail) >> 1;
        if (clear(anchor, path[candidate])) last = candidate;
        else fail = candidate;
      }
      smooth.push(path[last]); anchor = path[last]; begin = last + 1;
    }
    stats.reason = 'path';
    return smooth;
  };
  findPath.rebuild = rebuild;
  const refreshRegion = bounds => {
    const minX = Math.max(0, Math.floor((bounds.minX - radius) / step) + half);
    const maxX = Math.min(width - 1, Math.ceil((bounds.maxX + radius) / step) + half);
    const minZ = Math.max(0, Math.floor((bounds.minZ - radius) / step) + half);
    const maxZ = Math.min(width - 1, Math.ceil((bounds.maxZ + radius) / step) + half);
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const index = z * width + x, p = point(index);
      blocked[index] = Number(blockedAt(p.x, p.z));
    }
    linkPairs(Math.max(0, minX - 1), Math.min(width - 1, maxX + 1), Math.max(0, minZ - 1), Math.min(width - 1, maxZ + 1));
  };
  findPath.refreshMany = regions => {
    if (!Array.isArray(regions) || !regions.length) throw new RangeError('Navigation refresh requires changed regions');
    for (const bounds of regions) if (!bounds || !['minX', 'maxX', 'minZ', 'maxZ'].every(key => Number.isFinite(bounds[key])) ||
      bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) throw new RangeError('Invalid navigation refresh region');
    lookup.rebuild();
    for (const bounds of regions) refreshRegion(bounds);
  };
  findPath.refresh = bounds => findPath.refreshMany([bounds]);
  Object.defineProperty(findPath, 'stats', { get: () => ({ ...stats }) });
  return findPath;
}

export function blastDamage(distance, radius, damage) {
  return distance >= radius ? 0 : Math.round(damage * (1 - distance / radius));
}

export function nextAlive(members, current) {
  for (let offset = 1; offset <= members.length; offset++) {
    const index = (current + offset) % members.length;
    if (members[index].health > 0) return index;
  }
  return -1;
}

export function canDeploySquad(state, members) {
  return state === 'menu' || (state === 'dead' && members.length > 0 && members.every(member => member.health <= 0));
}

export function shotState(unit, now, firing) {
  const settings = unit.settings ?? TYPES[unit.type];
  if (unit.reloadUntil > 0 && now >= unit.reloadUntil) {
    unit.ammo = settings.magazine;
    unit.reloadUntil = 0;
  }
  if (!firing || unit.reloadUntil > 0 || now < unit.nextShot) return false;
  if (unit.ammo <= 0) {
    unit.reloadUntil = now + settings.reload;
    return false;
  }
  unit.ammo--;
  unit.nextShot = now + settings.interval;
  if (unit.type === 'tank' && settings.magazine === 1 && unit.ammo === 0) unit.reloadUntil = now + settings.reload;
  return true;
}
