import { CHI_HA } from './chi-ha.js';
import { SIHANG_CAPTURE_AREA, SIHANG_WAREHOUSE, SIHANG_SQUAD_ORIGINS, SIHANG_ENEMY_APPROACHES, SIHANG_TANK_ORIGINS,
  SIHANG_BRIDGE, SIHANG_EVACUATION, sihangBridgePoint, sihangSouthBank, sihangRiverRayRange } from './sihang-layout.js';

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

export function sihangSpawns() {
  return [
    ...SIHANG_SQUAD_ORIGINS.map((point, index) => ({
      id: `sihang-friendly-${index}`, name: `仓库二楼 · ${index + 1}班集结地`,
      team: 'friendly', kind: 'base', x: point.x, z: point.z, altitude: point.y,
      permanent: true, allowNearbyEnemies: true, aiOnly: index !== 0,
      deploymentZone: { minX: point.x - 6, maxX: point.x + 6, minZ: point.z - 4, maxZ: point.z + 4 },
    })),
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
    { id: 'sihang-enemy-8', name: '日军航空入场', team: 'enemy', kind: 'air', aiOnly: true, x: -24, z: -112, altitude: 45 },
    { id: 'sihang-enemy-9', name: '日军爆破队集结区', team: 'enemy', kind: 'base', aiOnly: true, x: 0, z: -72, altitude: 0 },
  ];
}

export function sihangObjectives() {
  return [{ id: '仓', name: '四行仓库一楼', x: -4, z: -25, radius: 34, owner: 'friendly',
    control: 1, progress: 1, enemyProgress: 0, captured: true, status: 'friendly',
    captureArea: { ...SIHANG_CAPTURE_AREA, minY: -.2 } }];
}

export const SIHANG_EMPLACEMENTS = Object.freeze([
  Object.freeze({ id: 'sihang-roof-aa', team: 'friendly', profile: 'maxim24aa',
    x: -14, z: -33, altitude: SIHANG_WAREHOUSE.roofY, heading: Math.PI }),
  Object.freeze({ id: 'sihang-north-gate-west', team: 'friendly', profile: 'maxim24',
    x: -28, z: -47.5, altitude: 0, heading: 0 }),
  Object.freeze({ id: 'sihang-north-gate-east', team: 'friendly', profile: 'maxim24',
    x: -12, z: -47.5, altitude: 0, heading: 0 }),
]);

export function sihangEnemyTargetAllowed(actor) {
  return Boolean(actor?.position && Number.isFinite(actor.position.x) &&
    Number.isFinite(actor.position.z) && !sihangSouthBank(actor.position));
}

export function sihangEnemyRayRange(origin, direction, range) {
  return sihangRiverRayRange(origin, direction, range);
}

export function sihangRetreatGoal(actor) {
  const position = actor.position;
  const lane = (actor.index % 5 - 2) * 1.15;
  if (position.y >= 3 || position.x < SIHANG_BRIDGE.northX - 4 || position.z < SIHANG_BRIDGE.northZ - 3)
    return { x: SIHANG_BRIDGE.northX + lane, y: 0, z: SIHANG_BRIDGE.northZ - 1.3, transit: true };
  if (!sihangSouthBank(position, 4))
    return { ...sihangBridgePoint(1 + 4 / SIHANG_BRIDGE.length, lane), y: 0, transit: true };
  return { x: SIHANG_EVACUATION.x + lane, y: 0,
    z: SIHANG_EVACUATION.z + Math.floor(actor.index / 5) * 1.5, transit: true };
}
