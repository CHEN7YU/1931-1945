import { circleBlocked, canDeploySquad } from './core.js';
import { BATTLE_AREA } from './battle-boundary.js';

// Distances and timings are scaled for this small prototype, not Enlisted values.
export const SPAWN_RULES = Object.freeze({
  buildSeconds: 6,
  rallyHealth: 120,
  enemyBlockRadius: 18,
  objectiveClearance: 18,
  placementRadius: 2.8,
  buildRange: 5,
  waveInterval: 17,
});

export const SQUADS = Object.freeze({
  infantry: { type: 'infantry', name: '步兵小队' },
  tank: { type: 'tank', name: '装甲车组' },
  plane: { type: 'plane', name: '航空小队' },
});

export function makeBaseSpawns() {
  return [
    { id: 'china-base', name: '南侧步兵集结地', team: 'friendly', kind: 'base', x: 0, z: 78, altitude: 0 },
    { id: 'china-garage', name: '南侧装甲出发点', team: 'friendly', kind: 'garage', x: 0, z: 83, altitude: 0 },
    { id: 'china-air', name: '南侧空中入场点', team: 'friendly', kind: 'air', x: 0, z: 102, altitude: 60 },
    { id: 'japan-base', name: '北侧日军集结地', team: 'enemy', kind: 'base', x: 9, z: -81, altitude: 0 },
    { id: 'japan-air', name: '日军空中入场点', team: 'enemy', kind: 'air', x: 0, z: -102, altitude: 35, aiOnly: true },
  ];
}

function requireRally(point) {
  if (!point || point.kind !== 'rally' || !['id', 'builderId'].every(field => typeof point[field] === 'string' && point[field]) ||
    !['friendly', 'enemy'].includes(point.team) || !['x', 'z', 'altitude', 'health'].every(field => Number.isFinite(point[field])) ||
    point.health < 0) throw new Error('Invalid rally simulation state');
}

export function createRallyPoint({ id, team, builderId, position }) {
  const point = { id, team, builderId, kind: 'rally', name: team === 'friendly' ? '工兵前线集结点' : '日军前线集结点',
    x: position?.x, z: position?.z, altitude: position?.y, health: SPAWN_RULES.rallyHealth };
  requireRally(point);
  return point;
}

export function replaceTeamRally(points, point) {
  requireRally(point);
  if (point.health <= 0 || points.some(existing => existing.id === point.id)) throw new Error('A replacement rally requires a new live identity');
  return [...points.filter(existing => existing.kind !== 'rally' || existing.team !== point.team), point];
}

export function damageRallyPoint(point, amount) {
  requireRally(point);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Rally damage must be non-negative and finite');
  const previous = point.health;
  point.health = Math.max(0, previous - amount);
  return { damage: previous - point.health, destroyed: previous > 0 && point.health === 0 };
}

export function deploymentBlockReason(state, members, squadId, previousSquadId) {
  if (!Object.hasOwn(SQUADS, squadId)) return '未知的小队';
  if (!canDeploySquad(state, members)) return '当前小队尚有存活队员，整队阵亡后才能更换小队';
  return null;
}

export function supportsSquad(point, type) {
  if (type === 'tank') return point.kind === 'garage';
  if (type === 'plane') return point.kind === 'air';
  return (type === 'infantry' || type === 'mortar') && (point.kind === 'base' || point.kind === 'objective');
}

export function recommendedSpawn(points, type, objectives, safe) {
  if (typeof safe !== 'function' || !Array.isArray(objectives)) throw new RangeError('Spawn recommendation requires objective and safety queries');
  const active = objectives.filter(point => point.owner !== 'friendly' || point.status === 'contested');
  const targets = active.length ? active : objectives;
  const distance = point => targets.length ? Math.min(...targets.map(target => Math.hypot(target.x - point.x, target.z - point.z))) : 0;
  return points.filter(point => point.team === 'friendly' && !point.aiOnly && supportsSquad(point, type) && safe(point))
    .sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id))[0] ?? null;
}

export function capturedSpawnPoints(objectives, base, type, safe) {
  if (!['infantry', 'tank'].includes(type) || typeof safe !== 'function' ||
    ![base?.x, base?.z].every(Number.isFinite)) throw new RangeError('Captured spawns require a base, ground squad and safety query');
  if (type === 'tank') return [];
  const result = [];
  for (const objective of objectives) {
    if (objective.owner !== 'friendly') continue;
    const dx = base.x - objective.x, dz = base.z - objective.z, distance = Math.hypot(dx, dz);
    if (!distance) continue;
    const anchor = { x: objective.x + dx / distance * 50, z: objective.z + dz / distance * 50 };
    let selected = null;
    for (const radius of [0, 4, 8, 12, 16, 20, 24]) {
      for (let side = 0; side < (radius ? 16 : 1); side++) {
        const angle = side * Math.PI / 8;
        const point = { id: `captured-${objective.id}-${type}`, name: `${objective.id} · ${objective.name}后方`,
          team: 'friendly', kind: type === 'tank' ? 'objective-tank' : 'objective', objectiveId: objective.id,
          x: anchor.x + Math.cos(angle) * radius, z: anchor.z + Math.sin(angle) * radius, altitude: 0 };
        const margin = type === 'tank' ? 4 : SPAWN_RULES.placementRadius;
        if (point.x - margin < BATTLE_AREA.minX || point.x + margin > BATTLE_AREA.maxX ||
          point.z - margin < BATTLE_AREA.minZ || point.z + margin > BATTLE_AREA.maxZ) continue;
        if (safe(point)) { selected = point; break; }
      }
      if (selected) break;
    }
    if (selected) result.push(selected);
  }
  return result;
}

export function groundSpawnCandidates(point) {
  const candidates = [];
  for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) {
    const px = point.x + x * 1.55, pz = point.z + z * 1.55, zone = point.deploymentZone;
    if (zone && (px < zone.minX || px > zone.maxX || pz < zone.minZ || pz > zone.maxZ)) continue;
    candidates.push({ x: px, z: pz, score: x * x + z * z });
  }
  return candidates;
}

export function spawnBlockReason(point, type, hostiles, obstacles) {
  if (point.enabled === false) return '重生点已被合围部队永久关闭';
  if (!supportsSquad(point, type)) return '该重生点不支持此小队';
  if (point.kind === 'rally' && point.health <= 0) return '集结点已被摧毁';
  const floor = point.altitude ?? 0;
  if (!point.permanent && !point.allowNearbyEnemies && point.kind !== 'air' && hostiles.some(actor => {
    const x = actor.position?.x ?? actor.x, z = actor.position?.z ?? actor.z;
    const height = actor.position?.y ?? actor.altitude ?? 0;
    return actor.health > 0 && Math.abs(height - floor) < 4 &&
      Math.hypot(x - point.x, z - point.z) < SPAWN_RULES.enemyBlockRadius;
  })) return '附近有敌军，暂时无法部署';
  const radius = type === 'tank' ? 2.2 : point.kind === 'air' ? 0
    : point.layout === 'wall' || point.layout === 'cave' ? .8 : SPAWN_RULES.placementRadius;
  if (point.allowNearbyEnemies && !groundSpawnCandidates(point)
    .some(candidate => !circleBlocked(candidate.x, candidate.z, .48, obstacles, floor))) return '重生区域受阻';
  if (point.allowNearbyEnemies) return null;
  if (radius && circleBlocked(point.x, point.z, radius, obstacles, point.altitude ?? 0)) return '重生区域受阻';
  return null;
}

export function rallyBuildBlockReason(point, objectives, hostiles, obstacles, team = 'friendly') {
  if (!['friendly', 'enemy'].includes(team)) throw new RangeError('Rally construction requires a valid team');
  const margin = SPAWN_RULES.placementRadius;
  if (point.x - margin < BATTLE_AREA.minX || point.x + margin > BATTLE_AREA.maxX ||
    point.z - margin < BATTLE_AREA.minZ || point.z + margin > BATTLE_AREA.maxZ) return '过于靠近战区边界，无法安全部署，请返回战区内建造';
  if (circleBlocked(point.x, point.z, SPAWN_RULES.placementRadius, obstacles)) return '地面或出入口受阻，请换一个位置';
  if (objectives.some(objective => objective.owner !== team && Math.hypot(objective.x - point.x, objective.z - point.z) < objective.radius + SPAWN_RULES.objectiveClearance)) return '距离未占领据点过近，不能建造';
  if (hostiles.some(actor => actor.health > 0 && (actor.altitude || 0) < 4 && Math.hypot(actor.x - point.x, actor.z - point.z) < SPAWN_RULES.enemyBlockRadius)) return '附近有敌军，不能建造';
  return null;
}

export function spawnPositions(point, count) {
  return Array.from({ length: count }, (_, index) => ({
    x: point.x + ((index % 3) - 1) * 1.6,
    z: point.z + Math.floor(index / 3) * 1.6,
  }));
}
