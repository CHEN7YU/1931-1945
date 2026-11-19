import { CHI_HA } from './chi-ha.js';
import { circleBlocked } from './core.js';
import { SIHANG_RULES } from './sihang-campaign.js';
import { SIHANG_CAPTURE_AREA, SIHANG_WAREHOUSE, SIHANG_SQUAD_ORIGINS, SIHANG_ENEMY_APPROACHES, SIHANG_TANK_ORIGINS,
  SIHANG_RETREAT_TANK_ORIGINS,
  SIHANG_BRIDGE, SIHANG_EVACUATION, sihangBridgePoint, sihangBridgeCoordinates,
  sihangSouthBank, sihangRiverBounds, sihangRiverRayRange } from './sihang-layout.js';

export function sihangBattleRoster(playerType = 'infantry') {
  if (playerType !== 'infantry') throw new RangeError('四行仓库仅可选择步兵');
  const formation = (team, index, type, memberCount, extra = {}) => ({
    id: `${team}-${index}`, campaign: 'sihang', team, index, type, memberCount, player: team === 'friendly' && index === 0,
    members: [], generation: 0, respawnAt: null, spawnId: `sihang-${team}-${index}`, ...extra,
  });
  return [
    ...Array.from({ length: 4 }, (_, index) => formation('friendly', index, 'infantry', 11)),
    ...Array.from({ length: 6 }, (_, index) => formation('enemy', index, 'infantry', 11)),
    ...[0, 1].map(armorSlot => formation('enemy', armorSlot + 6, 'tank', 4, { variant: CHI_HA.id, armorSlot })),
    formation('enemy', 8, 'plane', 3, { aircraftCount: 3, aerialSupport: true }),
    formation('enemy', 9, 'infantry', 20, { sihangDemolition: true }),
  ];
}

export function replaceSihangDemolition(formation) {
  if (!formation.sihangDemolition) return false;
  formation.sihangDemolition = false;
  formation.demolitionCompleted = true;
  formation.memberCount = 11;
  return true;
}

export function sihangRetreatFormation(index) {
  if (!Number.isInteger(index) || index < 4 || index > SIHANG_RULES.retreatSquads)
    throw new RangeError('Invalid retreat formation slot');
  return { id: `friendly-${index}`, campaign: 'sihang', team: 'friendly', index, type: 'infantry',
    memberCount: 11, player: false, members: [], generation: 0, respawnAt: null,
    spawnId: `sihang-retreat-${index - 1}` };
}

const retreatArmorSpawnId = slot => `sihang-armor-retreat-${slot}`;

export function assignSihangRetreatArmorSpawns(formations) {
  for (const formation of formations) {
    if (formation.team === 'enemy' && formation.variant === CHI_HA.id)
      formation.spawnId = retreatArmorSpawnId(formation.armorSlot);
  }
}

export function sihangSpawns() {
  return [
    ...SIHANG_SQUAD_ORIGINS.map((point, index) => ({
      id: `sihang-friendly-${index}`, name: `仓库一楼 · ${index + 1}班集结地`,
      team: 'friendly', kind: 'base', x: point.x, z: point.z, altitude: point.y,
      permanent: true, allowNearbyEnemies: true, aiOnly: index !== 0,
      deploymentZone: { minX: point.x - 6, maxX: point.x + 6, minZ: point.z - 4, maxZ: point.z + 4 },
    })),
    { id: 'sihang-south-cover', name: '仓库南面 · 殿后补充点', team: 'friendly',
      kind: 'base', playerOnly: true, retreatOnly: true, x: -4, z: -4, altitude: 0, permanent: true, allowNearbyEnemies: true,
      deploymentZone: { minX: -16, maxX: 8, minZ: -6.8, maxZ: -1.2 } },
    { id: 'sihang-assembly-player', name: '仓库南面 · 集合点', team: 'friendly',
      kind: 'base', playerOnly: true, retreatOnly: true, x: -23, z: -4, altitude: 0, permanent: true,
      allowNearbyEnemies: true, deploymentZone: { minX: -33, maxX: -12, minZ: -7.4, maxZ: -1 } },
    ...Array.from({ length: SIHANG_RULES.retreatSquads }, (_, slot) => ({ id: `sihang-retreat-${slot}`,
      name: '仓库西南侧撤退补充点', team: 'friendly', kind: 'base', aiOnly: true, altitude: 0,
      x: slot < 5 ? -52 : -76, z: -4, permanent: true, allowNearbyEnemies: true,
      deploymentZone: slot < 5 ? { minX: -62, maxX: -40, minZ: -7.4, maxZ: 1.5 }
        : { minX: -94, maxX: -64, minZ: -7.4, maxZ: 1.5 } })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `sihang-enemy-${index}`, name: `日军北侧步兵集结区 ${index + 1}`,
      team: 'enemy', kind: 'base', aiOnly: true, altitude: 0,
      x: SIHANG_ENEMY_APPROACHES[index % 3].x + (index < 3 ? -7 : 7),
      z: SIHANG_ENEMY_APPROACHES[index % 3].z,
    })),
    ...SIHANG_TANK_ORIGINS.map((point, index) => ({
      id: `sihang-enemy-${index + 6}`, name: `日军装甲集结区 ${index + 1}`, team: 'enemy',
      kind: 'garage', aiOnly: true, altitude: 0, x: point.x, z: point.z,
    })),
    ...SIHANG_RETREAT_TANK_ORIGINS.map((point, index) => ({
      id: retreatArmorSpawnId(index), name: `日军西北装甲补充点 ${index + 1}`, team: 'enemy',
      kind: 'garage', aiOnly: true, altitude: 0, ...point,
    })),
    { id: 'sihang-enemy-8', name: '日军航空入场', team: 'enemy', kind: 'air', aiOnly: true, x: -24, z: -112, altitude: 45 },
    { id: 'sihang-enemy-9', name: '日军爆破队集结区', team: 'enemy', kind: 'base', aiOnly: true, x: 0, z: -72, altitude: 0 },
  ];
}

export function sihangEnemyRegroupPosts(obstacles) {
  const posts = [];
  for (let z = -48; z >= -70; z -= 2.2) for (let x = -35; x <= 27; x += 2.2) {
    if (!circleBlocked(x, z, .6, obstacles, 0)) posts.push({ x, y: 0, z, transit: true });
  }
  if (posts.length < 119) throw new Error('四行仓库北侧日军整顿区净空不足');
  return posts;
}

export function sihangObjectives() {
  return [{ id: '仓', name: '四行仓库一楼', x: -4, z: -25, radius: 34, owner: 'friendly',
    control: 1, progress: 1, enemyProgress: 0, captured: true, status: 'friendly',
    captureArea: { ...SIHANG_CAPTURE_AREA, minY: -.2 } }];
}

export const SIHANG_EMPLACEMENTS = Object.freeze([
  Object.freeze({ id: 'sihang-cover-gun', team: 'friendly', profile: 'bofors75', playerOnly: true,
    retreatCover: true, x: 53, z: -38, altitude: 0, heading: 1.16 }),
  Object.freeze({ id: 'sihang-cover-mg', team: 'friendly', profile: 'maxim24', playerOnly: true,
    retreatCover: true, x: 62, z: -39, altitude: 0, heading: .2 }),
  Object.freeze({ id: 'sihang-cover-gun-east', team: 'friendly', profile: 'bofors75', playerOnly: true,
    retreatCover: true, x: 69, z: -45, altitude: 0, heading: .39 }),
  Object.freeze({ id: 'sihang-cover-mg-east', team: 'friendly', profile: 'maxim24', playerOnly: true,
    retreatCover: true, x: 76, z: -49, altitude: 0, heading: 0 }),
  Object.freeze({ id: 'sihang-cover-aa', team: 'friendly', profile: 'maxim24aa', playerOnly: true,
    retreatCover: true, x: 84, z: -49, altitude: 0, heading: -.36 }),
  Object.freeze({ id: 'sihang-roof-aa', team: 'friendly', profile: 'maxim24aa',
    x: -14, z: -33, altitude: SIHANG_WAREHOUSE.roofY, heading: Math.PI }),
  Object.freeze({ id: 'sihang-ground-entrance-mg', team: 'friendly', profile: 'maxim24',
    x: -20, z: -39, altitude: 0, heading: 0 }),
  Object.freeze({ id: 'sihang-north-gate-west', team: 'friendly', profile: 'maxim24',
    x: -28, z: -47.5, altitude: 0, heading: 0 }),
  Object.freeze({ id: 'sihang-north-gate-east', team: 'friendly', profile: 'maxim24',
    x: -12, z: -47.5, altitude: 0, heading: 0 }),
]);

export function sihangEnemyTargetAllowed(actor, campaign = null) {
  return Boolean(actor?.position && Number.isFinite(actor.position.x) &&
    Number.isFinite(actor.position.z) && !sihangSouthBank(actor.position));
}

export function sihangEnemyRayRange(origin, direction, range, campaign = null) {
  return sihangRiverRayRange(origin, direction, range);
}

export function sihangRetreatGoal(actor) {
  const position = actor.position;
  const lane = (actor.index % 5 - 2) * 1.15;
  const approach = sihangBridgePoint(-.2, lane);
  const bridge = sihangBridgeCoordinates(position);
  if (!actor.playerUnit && actor.formation?.sihangSlot % 2 === 1 && actor.tactics &&
    position.y < .3 && !sihangSouthBank(position, 4) &&
    (bridge.along < 0 || Math.abs(bridge.across) > SIHANG_BRIDGE.width / 2 - .6)) {
    const columns = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 28, 34, 40, 46, 52, 58, 64, 70, 72];
    let waypoint = actor.tactics.sihangRiversideWaypoint;
    if (waypoint === undefined) {
      waypoint = columns.findIndex(x => x >= position.x - 1);
      if (waypoint < 0) waypoint = columns.length;
    }
    const margin = actor.index % 2 ? 3.2 : 2;
    while (waypoint < columns.length) {
      const x = columns[waypoint], z = sihangRiverBounds(x).northZ - margin;
      if (position.x <= x + 1 && Math.hypot(position.x - x, position.z - z) > 1) {
        actor.tactics.sihangRiversideWaypoint = waypoint;
        return { x, y: 0, z, transit: true, routeGroup: `sihang-river-${actor.index % 2}` };
      }
      waypoint++;
    }
    actor.tactics.sihangRiversideWaypoint = waypoint;
  }
  if (!sihangSouthBank(position, 4)) {
    if (position.y >= 3 || bridge.along < -4.5 ||
      bridge.along < SIHANG_BRIDGE.length && Math.abs(bridge.across) > SIHANG_BRIDGE.width / 2 - .6)
      return { ...approach, y: 0, transit: true };
    return { ...sihangBridgePoint(1 + 4 / SIHANG_BRIDGE.length, lane), y: 0, transit: true };
  }
  return { x: SIHANG_EVACUATION.x + lane, y: 0,
    z: SIHANG_EVACUATION.z + Math.floor(actor.index / 5) * 1.5, transit: true };
}

export function sihangRetreatVehicleBypass(position, collider, clearPoint, clearSegment) {
  if (![position?.x, position?.y, position?.z, collider?.cx, collider?.cz,
    collider?.hx, collider?.hz, collider?.cos, collider?.sin].every(Number.isFinite) ||
    typeof clearPoint !== 'function' || typeof clearSegment !== 'function')
    throw new RangeError('Bridge bypass requires finite vehicle geometry and clearance queries');
  for (const margin of [.8, 1.4, 2.2]) {
    const points = [{ x: position.x, y: position.y, z: position.z, entrance: false }];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * (collider.hx + margin), lz = sz * (collider.hz + margin);
      points.push({ x: collider.cx + collider.cos * lx + collider.sin * lz, y: position.y,
        z: collider.cz - collider.sin * lx + collider.cos * lz, entrance: false });
    }
    for (const along of [-3, -2]) for (const lateral of [-2.5, -1.25, 0, 1.25, 2.5])
      points.push({ ...sihangBridgePoint(along / SIHANG_BRIDGE.length, lateral), y: position.y, entrance: true });
    const valid = points.map((point, index) => index === 0 || clearPoint(point));
    const costs = points.map(() => Infinity), previous = points.map(() => -1), visited = new Set();
    costs[0] = 0;
    while (visited.size < points.length) {
      let current = -1;
      for (let i = 0; i < points.length; i++)
        if (valid[i] && !visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
      if (current < 0 || !Number.isFinite(costs[current])) break;
      if (points[current].entrance) {
        const path = [];
        while (current > 0) {
          const { x, y, z } = points[current];
          path.unshift({ x, y, z });
          current = previous[current];
        }
        return path;
      }
      visited.add(current);
      for (let i = 1; i < points.length; i++) {
        if (!valid[i] || visited.has(i)) continue;
        const cost = costs[current] + Math.hypot(points[i].x - points[current].x, points[i].z - points[current].z);
        if (cost < costs[i] && clearSegment(points[current], points[i])) {
          costs[i] = cost;
          previous[i] = current;
        }
      }
    }
  }
  return [];
}

const SIHANG_INTERCEPT_POSTS = [
  [-23, -2], [-22, -2], [-23, -3], [-22, -3], [-23, -4], [-22, -4], [-23, -5], [-22, -5], [-23, -6], [-22, -6],
  [-12, -18], [-12, -19], [-11, -19], [-12, -20], [-11, -20], [-10, -20], [-11, -21], [-10, -21],
  [-7, -21], [-6, -21], [-5, -21], [-6, -23], [-5, -23],
];

export function sihangArmorInterceptObjective() {
  return { id: 'sihang-bridge', x: SIHANG_BRIDGE.northX - 13, z: SIHANG_BRIDGE.northZ - 32,
    radius: 5, owner: 'friendly' };
}

export function sihangPursuitGoal(actor) {
  const position = actor.position, tactics = actor.tactics;
  if (!tactics || ![position?.x, position?.y, position?.z, actor.index].every(Number.isFinite))
    throw new Error('Sihang pursuit requires an original soldier and its finite position');
  if (position.y >= -.2 && position.y < SIHANG_WAREHOUSE.floorHeight - .5 &&
    position.x > SIHANG_WAREHOUSE.minX + 1 && position.x < SIHANG_WAREHOUSE.maxX - 1 &&
    position.z > SIHANG_WAREHOUSE.minZ + 5 && position.z < SIHANG_WAREHOUSE.maxZ - 1)
    tactics.sihangEnteredWarehouse = true;
  if (!tactics.sihangEnteredWarehouse) {
    tactics.sihangPursuit = 'enter-warehouse';
    const east = (actor.formation?.index ?? 0) % 3 === 2;
    return east ? { x: 25, y: 0, z: -14 + (actor.index % 3 - 1) * .7, transit: true }
      : { x: -20 + (actor.index % 3 - 1) * 1.15, y: 0,
        z: -35 + Math.floor(actor.index / 3) % 3 * .7, transit: true };
  }
  const approach = { x: 50 + actor.index % 11, y: 0,
    z: -55 - ((actor.formation?.index ?? 0) % 4) * 2, transit: true };
  if (!tactics.sihangInterceptStaged && Math.hypot(position.x - approach.x, position.z - approach.z) <= 1 &&
    Math.abs(position.y) < .4)
    tactics.sihangInterceptStaged = true;
  if (!tactics.sihangInterceptStaged) {
    tactics.sihangPursuit = 'approach-interception';
    return approach;
  }
  tactics.sihangPursuit = 'intercept-withdrawal';
  const post = SIHANG_INTERCEPT_POSTS[((actor.formation?.index ?? 0) * 11 + actor.index) % SIHANG_INTERCEPT_POSTS.length];
  return { x: SIHANG_BRIDGE.northX + post[0], y: 0, z: SIHANG_BRIDGE.northZ + post[1], transit: true };
}
