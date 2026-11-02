import { battleRoster, BATTLE_RULES, formationPositions } from './battle-roster.js';
import { makeObjectives } from './core.js';
import { makeBaseSpawns } from './spawns.js';
import { PREVIEW_BASES, PREVIEW_OBJECTIVES } from './town-preview-layout.js';
import { japaneseArmorSpawns } from './chi-ha.js';

export const ENCIRCLEMENT_RULES = Object.freeze({ initialFriendly: 6, enemySquads: 8, maxFriendly: 10, reinforcements: 2,
  reinforcementTimes: Object.freeze([45, 90]), normalEnemyDelay: BATTLE_RULES.respawnSeconds,
  cutEnemyDelay: 35, supplyObjective: 'A', supplyGuardSquads: 2, defeatGraceSeconds: 90 });
export const REAR_SPAWNS = Object.freeze([
  Object.freeze({ id: 'china-rear-A', objectiveId: 'A', name: '敌后永久重生点 · 10点方向', x: -82, z: -82 }),
  Object.freeze({ id: 'china-rear-B', objectiveId: 'B', name: '敌后永久重生点 · 12点方向', x: 8, z: -65 }),
  Object.freeze({ id: 'china-rear-C', objectiveId: 'C', name: '敌后永久重生点 · 2点方向', x: 82, z: -82 }),
].map(point => Object.freeze({ ...point, team: 'friendly', kind: 'base', altitude: 0, permanent: true })));

export function encirclementRoster(playerType) {
  return battleRoster(playerType).filter(formation => formation.team !== 'enemy' ||
    formation.index < ENCIRCLEMENT_RULES.enemySquads - 2 || formation.type !== 'infantry').map(formation => ({ ...formation,
    active: formation.team === 'enemy' || formation.index < ENCIRCLEMENT_RULES.initialFriendly,
    fixedObjectiveId: formation.team === 'enemy' && formation.index < ENCIRCLEMENT_RULES.supplyGuardSquads ? 'A' : null,
    supplyGarrison: formation.team === 'enemy' && formation.index < ENCIRCLEMENT_RULES.supplyGuardSquads,
    reinforcementStartedAt: null, spawnRetryAt: null,
    respawnEnabled: true }));
}

export function encirclementObjectives() {
  const points = makeObjectives(PREVIEW_OBJECTIVES);
  Object.assign(points.find(point => point.id === 'A'), { owner: 'enemy', control: -1, enemyProgress: 1, status: 'held' });
  return points;
}

export function supplyGarrisonPositions(count, obstacles, occupied = [], hostiles = []) {
  const area = PREVIEW_OBJECTIVES.find(point => point.id === 'A').captureArea;
  // Keep initial defenders inside the ground-floor room and out of the stairwell.
  const region = { minX: area.minX + .2, maxX: -32.5, minZ: area.minZ + .2, maxZ: area.maxZ - .2 };
  const boundary = [
    { minX: -108, maxX: region.minX, minZ: -108, maxZ: 108 },
    { minX: region.maxX, maxX: 108, minZ: -108, maxZ: 108 },
    { minX: -108, maxX: 108, minZ: -108, maxZ: region.minZ },
    { minX: -108, maxX: 108, minZ: region.maxZ, maxZ: 108 },
  ];
  return formationPositions({ id: 'japan-supply-A', x: -37.8, z: 12 }, count, [...obstacles, ...boundary], occupied, hostiles);
}

export function encirclementSpawns() {
  const bases = makeBaseSpawns().map(point => {
    const base = PREVIEW_BASES.find(base => point.id === (base.team === 'friendly' ? 'china-base' : 'japan-base'));
    return base ? { ...point, x: base.x, z: base.z } : point;
  });
  const staging = ['friendly', 'enemy'].flatMap(team => Array.from({ length: team === 'enemy' ? 7 : 9 }, (_, index) => ({
    id: `${team}-staging-${index + 1}`, team, kind: 'base', altitude: 0, aiOnly: true,
    name: `${team === 'friendly' ? '我军' : '日军'}分队集结区 ${index + 1}`,
    x: [-88, -66, -44, -22, 22, 44, 66, 88, 96][index], z: team === 'friendly' ? 82 : -82,
  })));
  const assigned = new Set(encirclementRoster('infantry').map(unit => unit.spawnId));
  return [...bases, ...staging, japaneseArmorSpawns()[0]].filter(point =>
    point.team !== 'enemy' || assigned.has(point.id));
}

export function createEncirclement() {
  return { phase: 1, captures: 0, unlocked: [], disabledEnemySpawns: [], winner: null,
    supplyInterrupted: false, reinforcementWaves: 0, enemyControlSeconds: 0 };
}

export function captureEncirclement(match, formations, objectiveId, now) {
  if (!PREVIEW_OBJECTIVES.some(point => point.id === objectiveId) || !Number.isFinite(now) || now < 0) {
    throw new RangeError('Encirclement capture requires a known objective and simulation time');
  }
  if (match.phase !== 1 || match.winner) return { spawn: null, added: [], withdrawn: null, disabled: [] };
  match.captures++;
  const rear = REAR_SPAWNS.find(point => point.objectiveId === objectiveId);
  const spawn = match.unlocked.includes(rear.id) ? null : { ...rear };
  if (spawn) match.unlocked.push(spawn.id);
  return { spawn, added: [], withdrawn: null, disabled: [] };
}

export function scheduleEncirclementRespawn(match, unit, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Reinforcement scheduling requires simulation time');
  if (unit.team !== 'enemy' || unit.active === false || unit.respawnEnabled === false || match.winner) return;
  if (unit.members.some(actor => actor.health > 0)) { unit.reinforcementStartedAt = null; return; }
  unit.reinforcementStartedAt ??= now;
  const delay = match.supplyInterrupted ? ENCIRCLEMENT_RULES.cutEnemyDelay : ENCIRCLEMENT_RULES.normalEnemyDelay;
  const due = unit.reinforcementStartedAt + delay;
  unit.respawnAt = Math.max(unit.spawnRetryAt ?? due, due);
}

export function advanceEncirclementSupport(match, points, formations, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Encirclement support requires simulation time');
  const supply = points.find(point => point.id === ENCIRCLEMENT_RULES.supplyObjective);
  if (!supply) throw new Error('Encirclement supply objective is missing');
  const previous = match.supplyInterrupted;
  if (supply.owner === 'friendly') match.supplyInterrupted = true;
  else if (supply.owner === 'enemy') match.supplyInterrupted = false;
  const added = [];
  if (!match.winner) {
    for (const unit of formations) scheduleEncirclementRespawn(match, unit, now);
    while (match.reinforcementWaves < ENCIRCLEMENT_RULES.reinforcementTimes.length &&
      now >= ENCIRCLEMENT_RULES.reinforcementTimes[match.reinforcementWaves]) {
      const active = formations.filter(unit => unit.team === 'friendly' && unit.active).length;
      const wave = formations.filter(unit => unit.team === 'friendly' && !unit.active)
        .slice(0, Math.max(0, Math.min(ENCIRCLEMENT_RULES.reinforcements, ENCIRCLEMENT_RULES.maxFriendly - active)));
      for (const unit of wave) {
        unit.active = true; unit.respawnAt = now;
        if (match.unlocked.length) unit.spawnId = match.unlocked[unit.index % match.unlocked.length];
      }
      added.push(...wave); match.reinforcementWaves++;
    }
  }
  return { added, supplyChanged: previous !== match.supplyInterrupted };
}
export function advanceEncirclement(match, points, formations, dt = 0) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Encirclement defeat requires non-negative simulation time');
  if (match.winner) return match.winner;
  const enemyControlsAll = points.length === 3 && points.every(point => point.owner === 'enemy');
  match.enemyControlSeconds = enemyControlsAll
    ? Math.min(ENCIRCLEMENT_RULES.defeatGraceSeconds, match.enemyControlSeconds + dt) : 0;
  if (enemyControlsAll && match.enemyControlSeconds + 1e-8 >= ENCIRCLEMENT_RULES.defeatGraceSeconds) {
    match.winner = 'enemy';
    return match.winner;
  }
  if (match.phase === 1 && points.length === 3 && points.every(point => point.owner === 'friendly')) {
    match.phase = 2;
    for (const unit of formations.filter(unit => unit.team === 'enemy')) {
      unit.respawnEnabled = false; unit.respawnAt = null;
      unit.spawnRetryAt = unit.reinforcementStartedAt = null;
    }
  }
  if (match.phase === 2 && !formations.some(unit => unit.team === 'enemy' &&
    unit.active && unit.members.some(actor => actor.health > 0))) match.winner = 'friendly';
  return match.winner;
}
