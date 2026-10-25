import { RIFLE } from './rifle-action.js';

export const MAP_LIMIT = 108;
export const MATCH_SECONDS = 600;
export const CAPTURE_SECONDS = 12;
export const TYPES = Object.freeze({
  infantry: { name: '步兵小队', weapon: '中正式风格步枪 · 比例样枪', members: 4, magazine: RIFLE.magazine, reload: RIFLE.reloadSeconds, interval: RIFLE.cycleSeconds, speed: 3.15, health: 100, damage: 100 },
  tank: { name: '装甲小队', weapon: '坦克主炮', members: 3, magazine: 1, reload: 3.8, interval: .5, speed: 8, health: 360, damage: 160 },
  mortar: { name: '迫击炮组', weapon: '轻型迫击炮', members: 3, magazine: 1, reload: 3.2, interval: .5, speed: 2.45, health: 100, damage: 160 },
  plane: { name: '航空小队', weapon: '对地机炮', members: 1, magazine: 60, reload: 3, interval: .1, speed: 24, health: 180, damage: 65 },
});
export const OBJECTIVES = Object.freeze([
  { id: 'A', name: '南街路口', x: -12, z: 30, radius: 13 },
  { id: 'B', name: '运河石桥', x: 8, z: -7, radius: 13 },
  { id: 'C', name: '北城街垒', x: -10, z: -51, radius: 14 },
]);

export function makeObjectives() {
  return OBJECTIVES.map(point => ({ ...point, progress: 0, captured: false }));
}

export function advanceCapture(point, dt, friendly, hostile) {
  if (point.captured) return 'captured';
  if (friendly && hostile) return 'contested';
  if (friendly) {
    point.progress = Math.min(1, point.progress + dt / CAPTURE_SECONDS);
    point.captured = point.progress >= 1;
    return point.captured ? 'captured' : 'capturing';
  }
  point.progress = Math.max(0, point.progress - dt / (CAPTURE_SECONDS * 2));
  return 'empty';
}

export function circleBlocked(x, z, radius, obstacles) {
  if (Math.abs(x) > MAP_LIMIT - radius || Math.abs(z) > MAP_LIMIT - radius) return true;
  return obstacles.some(b => {
    if (b.door) {
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      const dx = x - b.cx, dz = z - b.cz;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      const nx = Math.max(-b.hx, Math.min(b.hx, lx)), nz = Math.max(-b.hz, Math.min(b.hz, lz));
      return (lx - nx) ** 2 + (lz - nz) ** 2 < radius ** 2;
    }
    const nx = Math.max(b.minX, Math.min(b.maxX, x));
    const nz = Math.max(b.minZ, Math.min(b.maxZ, z));
    return (x - nx) ** 2 + (z - nz) ** 2 < radius ** 2;
  });
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

export function segmentClear(start, end, radius, obstacles) {
  const distance = Math.hypot(end.x - start.x, end.z - start.z);
  const steps = Math.max(1, Math.ceil(distance / .2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (circleBlocked(start.x + (end.x - start.x) * t, start.z + (end.z - start.z) * t, radius, obstacles)) return false;
  }
  return true;
}

export function createNavigator(obstacles, step = .75, radius = .46) {
  if (!(step > 0) || !(radius > 0)) throw new RangeError('Navigation resolution and clearance must be positive');
  const half = Math.floor((MAP_LIMIT - 1) / step);
  const width = half * 2 + 1;
  const count = width * width;
  const blocked = new Uint8Array(count);
  const point = index => ({ x: (index % width - half) * step, z: (Math.floor(index / width) - half) * step });
  const rebuild = () => {
    for (let index = 0; index < count; index++) {
      const p = point(index);
      blocked[index] = Number(circleBlocked(p.x, p.z, radius, obstacles));
    }
  };
  rebuild();
  const nearest = target => {
    let best = -1;
    let distance = Infinity;
    const tx = Math.max(0, Math.min(width - 1, Math.round(target.x / step) + half));
    const tz = Math.max(0, Math.min(width - 1, Math.round(target.z / step) + half));
    const targetClear = !circleBlocked(target.x, target.z, radius, obstacles);
    const connectionRadius = targetClear ? radius : .42;
    const physicalClear = !circleBlocked(target.x, target.z, connectionRadius, obstacles);
    for (let z = Math.max(0, tz - 8); z <= Math.min(width - 1, tz + 8); z++) for (let x = Math.max(0, tx - 8); x <= Math.min(width - 1, tx + 8); x++) {
      const index = z * width + x;
      if (blocked[index]) continue;
      const p = point(index);
      const d = (target.x - p.x) ** 2 + (target.z - p.z) ** 2;
      if (d < distance && (!physicalClear || segmentClear(target, p, connectionRadius, obstacles))) { best = index; distance = d; }
    }
    return best;
  };
  const stats = { resolution: step, radius, expanded: 0, reason: 'ready' };
  const findPath = (start, goal) => {
    stats.expanded = 0;
    if (circleBlocked(start.x, start.z, Math.min(radius, .42), obstacles)) { stats.reason = 'blocked-start'; return []; }
    if (segmentClear(start, goal, radius, obstacles)) {
      stats.reason = 'direct';
      return [{ x: goal.x, z: goal.z }];
    }
    const from = nearest(start);
    const to = nearest(goal);
    if (from < 0 || to < 0) { stats.reason = 'no-clear-cell'; return []; }
    const parents = new Int32Array(count).fill(-1);
    const costs = new Float32Array(count).fill(Infinity);
    const closed = new Uint8Array(count);
    const heap = [];
    const targetX = to % width, targetZ = Math.floor(to / width);
    const heuristic = index => Math.abs(index % width - targetX) + Math.abs(Math.floor(index / width) - targetZ);
    const push = (index, score) => {
      let i = heap.length;
      heap.push({ index, score });
      while (i) {
        const p = (i - 1) >> 1;
        if (heap[p].score <= score) break;
        [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
      }
    };
    const pop = () => {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
          if (heap[i].score <= heap[child].score) break;
          [heap[i], heap[child]] = [heap[child], heap[i]]; i = child;
        }
      }
      return first.index;
    };
    parents[from] = from;
    costs[from] = 0;
    push(from, heuristic(from));
    while (heap.length) {
      const index = pop();
      if (closed[index]) continue;
      closed[index] = 1;
      stats.expanded++;
      if (index === to) break;
      for (const neighbor of [index - 1, index + 1, index - width, index + width]) {
        if (neighbor < 0 || neighbor >= count || blocked[neighbor] || closed[neighbor]) continue;
        if (Math.abs(index % width - neighbor % width) > 1) continue;
        const a = point(index);
        const b = point(neighbor);
        if (costs[index] + 1 >= costs[neighbor] || !segmentClear(a, b, radius, obstacles)) continue;
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
    if (!circleBlocked(goal.x, goal.z, radius, obstacles) && segmentClear(path.at(-1), goal, radius, obstacles)) path.push({ x: goal.x, z: goal.z });
    const smooth = [];
    let anchor = point(from);
    if (Math.hypot(start.x - anchor.x, start.z - anchor.z) > .05) smooth.push(anchor);
    for (let i = 0; i < path.length; i++) {
      if (i > 0 && !segmentClear(anchor, path[i], radius, obstacles)) {
        smooth.push(path[i - 1]); anchor = path[i - 1];
      }
    }
    smooth.push(path.at(-1));
    stats.reason = 'path';
    return smooth;
  };
  findPath.rebuild = rebuild;
  findPath.refresh = bounds => {
    const minX = Math.max(0, Math.floor((bounds.minX - radius) / step) + half);
    const maxX = Math.min(width - 1, Math.ceil((bounds.maxX + radius) / step) + half);
    const minZ = Math.max(0, Math.floor((bounds.minZ - radius) / step) + half);
    const maxZ = Math.min(width - 1, Math.ceil((bounds.maxZ + radius) / step) + half);
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const index = z * width + x, p = point(index);
      blocked[index] = Number(circleBlocked(p.x, p.z, radius, obstacles));
    }
  };
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
  if (unit.reloadUntil > 0 && now >= unit.reloadUntil) {
    unit.ammo = TYPES[unit.type].magazine;
    unit.reloadUntil = 0;
  }
  if (!firing || unit.reloadUntil > 0 || now < unit.nextShot) return false;
  if (unit.ammo <= 0) {
    unit.reloadUntil = now + TYPES[unit.type].reload;
    return false;
  }
  unit.ammo--;
  unit.nextShot = now + TYPES[unit.type].interval;
  return true;
}
