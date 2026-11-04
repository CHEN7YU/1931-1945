import { TYPES, circleBlocked } from './core.js';
import { SPAWN_RULES, spawnBlockReason, supportsSquad, groundSpawnCandidates } from './spawns.js';
import { CHI_HA, japaneseArmorRoster } from './chi-ha.js';
import { NANJING_SPAWNS } from './nanjing-campaign.js';

export const BATTLE_RULES = Object.freeze({ unitsPerTeam: 10, infantryMembers: TYPES.infantry.members, sectionMembers: 11, vehicleLimit: 2, respawnSeconds: 17, maxSpawnDistance: 20 });
export const isVehicleUnit = type => type === 'tank' || type === 'plane';
export function infantryLoadout(team, index, type = 'infantry') {
  if (!['friendly', 'enemy'].includes(team) || !Number.isInteger(index) || index < 0 || !TYPES[type]) throw new RangeError('Invalid infantry loadout');
  if (type === 'infantry' && index % BATTLE_RULES.sectionMembers === 10) {
    return { role: 'machine-gunner', model: team === 'friendly' ? 'zb26' : 'type11' };
  }
  if (type === 'infantry' && index % BATTLE_RULES.sectionMembers === 9) {
    return { role: 'sniper', model: 'sniper' };
  }
  return { role: team === 'friendly' && type === 'infantry' && index % BATTLE_RULES.sectionMembers === 0 ? 'mortarman' : 'rifleman', model: 'rifle' };
}
const lanes = [-88, -66, -44, -22, 22, 44, 66, 88, 96];
export class FormationPlacementError extends Error {}

export function battleRoster(playerType = 'infantry') {
  if (!TYPES[playerType]) throw new RangeError(`Unknown player unit: ${playerType}`);
  const infantry = ['friendly', 'enemy'].flatMap(team => Array.from({ length: team === 'enemy' ? 8 : BATTLE_RULES.unitsPerTeam }, (_, index) => ({
    id: `${team}-${index}`, team, index, type: team === 'friendly' && index === 0 ? playerType : 'infantry',
    player: team === 'friendly' && index === 0, members: [],
    memberCount: team === 'enemy' && index === 7 ? 14 : team === 'friendly' && index === 1
      ? BATTLE_RULES.infantryMembers * 2 - TYPES[playerType].members : team === 'friendly' && index === 0
        ? TYPES[playerType].members : BATTLE_RULES.infantryMembers,
    generation: 0, respawnAt: null,
    spawnId: index === 0 ? team === 'friendly' ? 'china-base' : 'japan-base' : `${team}-staging-${index}`,
  })));
  return [...infantry, japaneseArmorRoster()[0], { id: 'enemy-9', team: 'enemy', index: 9, type: 'plane',
    player: false, memberCount: 1, members: [], generation: 0, respawnAt: null, spawnId: 'japan-air' }];
}

export function nanjingBattleRoster(playerType = 'infantry') {
  if (playerType !== 'infantry') throw new RangeError('The Nanjing campaign deploys an infantry squad');
  const friendly = Array.from({ length: 5 }, (_, index) => ({
    id: `friendly-${index}`, team: 'friendly', index, type: 'infantry', player: index === 0,
    members: [], generation: 0, respawnAt: null, reserve: index > 2,
    openingSpawnId: index < 3 ? `nanjing-gate-front-${index}` : null,
    spawnId: ['nanjing-gate', 'nanjing-gate', 'nanjing-gate',
      'nanjing-reserve-1', 'nanjing-reserve-2'][index],
  }));
  const enemyInfantry = Array.from({ length: 8 }, (_, index) => ({
    id: `enemy-${index}`, team: 'enemy', index, type: 'infantry', player: false, members: [],
    generation: 0, respawnAt: null, spawnId: `nanjing-south-${index + 1}`,
    assaultCrossing: 'bridge',
  }));
  const armor = japaneseArmorRoster()[0];
  armor.id = 'enemy-8';
  armor.index = 8;
  armor.spawnId = 'nanjing-south-armor';
  const aircraft = { id: 'enemy-9', team: 'enemy', index: 9, type: 'plane', player: false,
    aerialSupport: true, aircraftCount: 3, members: [], generation: 0, respawnAt: null, spawnId: 'nanjing-south-air' };
  if (NANJING_SPAWNS.filter(spawn => spawn.team === 'friendly').length < friendly.length ||
    NANJING_SPAWNS.filter(spawn => spawn.team === 'enemy').length < enemyInfantry.length + 2) {
    throw new Error('Nanjing campaign spawn configuration is incomplete');
  }
  return [...friendly, ...enemyInfantry, armor, aircraft];
}

export function stagingSpawns() {
  return ['friendly', 'enemy'].flatMap(team => lanes.map((x, index) => ({
    id: `${team}-staging-${index + 1}`, name: `${team === 'friendly' ? '南侧' : '北侧'}分队集结区 ${index + 1}`,
    team, kind: 'base', x, z: team === 'friendly' ? 82 : -82, altitude: 0, aiOnly: true,
  })));
}

export function formationPositions(point, count, obstacles, occupied = [], hostiles = []) {
  const candidates = [];
  const hostileClearance = point.permanent || point.allowNearbyEnemies ? 1.25 : SPAWN_RULES.enemyBlockRadius;
  if (point.layout === 'wall' || point.layout === 'cave') {
    const columns = point.layout === 'wall' ? 2 : 3;
    if (point.layout === 'wall' && point.formationZones?.length) {
      for (const zone of point.formationZones) {
        const rows = Math.floor((zone.maxZ - zone.minZ - .96) / 1.4) + 1;
        const firstZ = zone.minZ + ((zone.maxZ - zone.minZ) - (rows - 1) * 1.4) / 2;
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
          const x = point.x + (column - (columns - 1) / 2) * 1.4;
          const z = firstZ + row * 1.4;
          candidates.push({ x, z, score: (x - point.x) ** 2 + (z - point.z) ** 2 });
        }
      }
    } else {
      const rows = Math.ceil(count / columns);
      for (let index = 0; index < count; index++) {
        const column = index % columns, row = Math.floor(index / columns);
        const across = (column - (columns - 1) / 2) * 1.4;
        const along = (row - (rows - 1) / 2) * 1.4;
        candidates.push({
          x: point.x + (point.formationAxis === 'x' ? along : across),
          z: point.z + (point.formationAxis === 'x' ? across : along),
          score: column * column + row * row,
        });
      }
    }
  } else {
    candidates.push(...groundSpawnCandidates(point));
  }
  const feetY = point.altitude ?? 0;
  const clearCandidates = candidates.filter(candidate => {
    if (point.deploymentZone && (candidate.x < point.deploymentZone.minX || candidate.x > point.deploymentZone.maxX ||
      candidate.z < point.deploymentZone.minZ || candidate.z > point.deploymentZone.maxZ)) return false;
    return (
    !circleBlocked(candidate.x, candidate.z, .48, obstacles, feetY) &&
    !hostiles.some(actor => {
      const x = actor.position?.x ?? actor.x, z = actor.position?.z ?? actor.z;
      return actor.health > 0 && Math.abs((actor.position?.y ?? actor.altitude ?? 0) - feetY) < 4 &&
        Math.hypot(x - candidate.x, z - candidate.z) < hostileClearance;
    }));
  });
  candidates.length = 0;
  candidates.push(...clearCandidates);
  if (point.allowNearbyEnemies) {
    const nearbyHostiles = hostiles.filter(actor => actor.health > 0 &&
      Math.abs((actor.position?.y ?? actor.altitude ?? 0) - feetY) < 4);
    for (const candidate of candidates) {
      let nearest = Infinity;
      for (const actor of nearbyHostiles) nearest = Math.min(nearest,
        Math.hypot((actor.position?.x ?? actor.x) - candidate.x, (actor.position?.z ?? actor.z) - candidate.z));
      candidate.danger = Math.max(0, SPAWN_RULES.enemyBlockRadius - nearest);
    }
  }
  candidates.sort((a, b) => (a.danger ?? 0) - (b.danger ?? 0) || a.score - b.score || a.z - b.z || a.x - b.x);
  const placed = [];
  for (const point of candidates) {
    if ([...occupied, ...placed].some(other => Math.abs((other.y ?? feetY) - feetY) < 1.75 &&
      Math.hypot(point.x - other.x, point.z - other.z) < 1.25)) continue;
    placed.push({ x: point.x, z: point.z });
    if (placed.length === count) return placed;
  }
  throw new FormationPlacementError(`集结区 ${point.id} 无法安全容纳 ${count} 人；未凭空缩减兵力`);
}

export function validateRoster(roster, counts = { friendly: BATTLE_RULES.unitsPerTeam, enemy: BATTLE_RULES.unitsPerTeam }) {
  for (const team of ['friendly', 'enemy']) {
    const units = roster.filter(unit => unit.team === team);
    if (units.length !== counts[team]) throw new Error(`${team} must have ${counts[team]} battle units`);
    if (units.filter(unit => isVehicleUnit(unit.type)).length > BATTLE_RULES.vehicleLimit) throw new Error(`${team} exceeds the vehicle limit`);
  }
}

export function armySummary(roster, team) {
  const units = roster.filter(unit => unit.team === team && unit.active !== false);
  return { units: units.filter(unit => unit.members.some(actor => actor.health > 0)).length,
    rosterUnits: units.length, alive: units.reduce((sum, unit) => sum + unit.members.filter(actor => actor.health > 0).length, 0),
    vehicles: units.filter(unit => isVehicleUnit(unit.type) && unit.members.some(actor => actor.health > 0)).length };
}

export function sectionOffset(index) {
  const member = index % BATTLE_RULES.sectionMembers, section = Math.floor(index / BATTLE_RULES.sectionMembers);
  return member === 10 ? { x: 0, z: 2.1 + section * 3.2 }
    : { x: (member % 5 - 2) * 1.15, z: Math.floor(member / 5) * 1.4 - .7 + section * 3.2 };
}

export function holdDestination(actor) {
  const offset = actor.personalHold ? { x: 0, z: 0 } : sectionOffset(actor.index);
  return { x: actor.orderPoint.x + offset.x, z: actor.orderPoint.z + offset.z,
    ...(actor.orderPoint.y !== undefined ? { y: actor.orderPoint.y } : {}) };
}

export function reinforcementDue(formation, now) {
  if (formation.active === false || formation.respawnEnabled === false) return false;
  const readyAt = formation.respawnAt ?? (formation.variant === CHI_HA.id ? now : null);
  return !formation.player && readyAt !== null && now >= readyAt && !formation.members.some(actor => actor.health > 0);
}

export function battleSpawn(formation, points, hostiles, obstacles, initial = false) {
  const available = points.filter(point => point.team === formation.team && point.enabled !== false);
  if (initial && formation.openingSpawnId) return points.find(point => point.id === formation.openingSpawnId);
  if (!initial && !isVehicleUnit(formation.type)) {
    const rear = available.filter(point => point.permanent &&
      !spawnBlockReason(point, 'infantry', hostiles, obstacles));
    if (rear.length) return rear.find(point => point.id === formation.spawnId) ?? rear[formation.index % rear.length];
  }
  const assigned = points.find(point => point.id === formation.spawnId);
  if (assigned?.team === formation.team && assigned.enabled !== false) return assigned;
  if (!assigned || assigned.team !== formation.team || initial) return undefined;
  return available.filter(point => supportsSquad(point, formation.type) &&
    !spawnBlockReason(point, formation.type, hostiles, obstacles))
    .sort((a, b) => Math.hypot(a.x - assigned.x, a.z - assigned.z) - Math.hypot(b.x - assigned.x, b.z - assigned.z) ||
      a.id.localeCompare(b.id))[0];
}
// ---模块结束---
