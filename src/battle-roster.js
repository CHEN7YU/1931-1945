import { TYPES, circleBlocked } from './core.js';
import { spawnBlockReason } from './spawns.js';

export const BATTLE_RULES = Object.freeze({ unitsPerTeam: 10, infantryMembers: TYPES.infantry.members, sectionMembers: 10, vehicleLimit: 2, respawnSeconds: 17, maxSpawnDistance: 20 });
export const isVehicleUnit = type => type === 'tank' || type === 'plane';
const lanes = [-88, -66, -44, -22, 22, 44, 66, 88, 96];
export class FormationPlacementError extends Error {}

export function battleRoster(playerType = 'infantry') {
  if (!TYPES[playerType]) throw new RangeError(`Unknown player unit: ${playerType}`);
  return ['friendly', 'enemy'].flatMap(team => Array.from({ length: BATTLE_RULES.unitsPerTeam }, (_, index) => ({
    id: `${team}-${index}`, team, index, type: team === 'friendly' && index === 0 ? playerType : 'infantry',
    player: team === 'friendly' && index === 0, members: [], generation: 0, respawnAt: null,
    spawnId: index === 0 ? team === 'friendly' ? 'china-base' : 'japan-base' : `${team}-staging-${index}`,
  })));
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
  const sections = Math.ceil(TYPES.infantry.members / 10);
  return { x: (index % 5 - 2) * 1.15, z: Math.floor(index % 10 / 5) * 1.4 - .7 + (Math.floor(index / 10) - (sections - 1) / 2) * 3.2 };
}

export function holdDestination(actor) {
  const offset = actor.personalHold ? { x: 0, z: 0 } : sectionOffset(actor.index);
  return { x: actor.orderPoint.x + offset.x, z: actor.orderPoint.z + offset.z };
}

export function reinforcementDue(formation, now) {
  return !formation.player && formation.respawnAt !== null && now >= formation.respawnAt && !formation.members.some(actor => actor.health > 0);
}

export function battleSpawn(formation, points, hostiles, obstacles, initial = false) {
  if (!initial) {
    const rally = points.find(point => point.team === formation.team && point.kind === 'rally' && !spawnBlockReason(point, 'infantry', hostiles, obstacles));
    if (rally) return rally;
  }
  return points.find(point => point.id === formation.spawnId);
}
// ---模块结束---
