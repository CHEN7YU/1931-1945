import { TYPES, circleBlocked } from './core.js';
import { spawnBlockReason } from './spawns.js';
import { CHI_HA, japaneseArmorRoster } from './chi-ha.js';

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

export function stagingSpawns() {
  return ['friendly', 'enemy'].flatMap(team => lanes.map((x, index) => ({
    id: `${team}-staging-${index + 1}`, name: `${team === 'friendly' ? '南侧' : '北侧'}分队集结区 ${index + 1}`,
    team, kind: 'base', x, z: team === 'friendly' ? 82 : -82, altitude: 0, aiOnly: true,
  })));
}

export function formationPositions(point, count, obstacles, occupied = [], hostiles = []) {
  const candidates = [];
  for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) {
    const px = point.x + x * 1.55, pz = point.z + z * 1.55;
    if (!circleBlocked(px, pz, .48, obstacles) && !hostiles.some(actor => actor.health > 0 && (actor.altitude || 0) < 4 && Math.hypot(actor.x - px, actor.z - pz) < 18)) candidates.push({ x: px, z: pz, score: x * x + z * z });
  }
  candidates.sort((a, b) => a.score - b.score || a.z - b.z || a.x - b.x);
  const placed = [];
  for (const point of candidates) {
    if ([...occupied, ...placed].some(other => Math.hypot(point.x - other.x, point.z - other.z) < 1.25)) continue;
    placed.push({ x: point.x, z: point.z });
    if (placed.length === count) return placed;
  }
  throw new FormationPlacementError(`集结区 ${point.id} 无法安全容纳 ${count} 人；未凭空缩减兵力`);
}

export function validateRoster(roster) {
  for (const team of ['friendly', 'enemy']) {
    const units = roster.filter(unit => unit.team === team);
    if (units.length !== BATTLE_RULES.unitsPerTeam) throw new Error(`${team} must have ten battle units`);
    if (units.filter(unit => isVehicleUnit(unit.type)).length > BATTLE_RULES.vehicleLimit) throw new Error(`${team} exceeds the vehicle limit`);
  }
}

export function armySummary(roster, team) {
  const units = roster.filter(unit => unit.team === team);
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
  const readyAt = formation.respawnAt ?? (formation.variant === CHI_HA.id ? now : null);
  return !formation.player && readyAt !== null && now >= readyAt && !formation.members.some(actor => actor.health > 0);
}

export function battleSpawn(formation, points, hostiles, obstacles, initial = false) {
  return points.find(point => point.id === formation.spawnId);
}
// ---模块结束---
