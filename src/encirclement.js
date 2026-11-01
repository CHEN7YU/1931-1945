import { battleRoster } from './battle-roster.js';
import { makeBaseSpawns } from './spawns.js';
import { PREVIEW_BASES, PREVIEW_OBJECTIVES } from './town-preview-layout.js';

export const ENCIRCLEMENT_RULES = Object.freeze({ initialFriendly: 4, maxFriendly: 10, minEnemy: 5, reinforcements: 2 });
export const REAR_SPAWNS = Object.freeze([
  Object.freeze({ id: 'china-rear-A', objectiveId: 'A', name: '敌后永久重生点 · 10点方向', x: -82, z: -82 }),
  Object.freeze({ id: 'china-rear-B', objectiveId: 'B', name: '敌后永久重生点 · 12点方向', x: 8, z: -65 }),
  Object.freeze({ id: 'china-rear-C', objectiveId: 'C', name: '敌后永久重生点 · 2点方向', x: 82, z: -82 }),
].map(point => Object.freeze({ ...point, team: 'friendly', kind: 'base', altitude: 0, permanent: true })));

export function encirclementRoster(playerType) {
  return battleRoster(playerType).map(formation => ({ ...formation,
    active: formation.team === 'enemy' || formation.index < ENCIRCLEMENT_RULES.initialFriendly,
    respawnEnabled: true }));
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
  return [...bases, ...staging];
}

export function createEncirclement() {
  return { phase: 1, captures: 0, unlocked: [], disabledEnemySpawns: [], winner: null };
}

export function captureEncirclement(match, formations, objectiveId, now, points = []) {
  if (!PREVIEW_OBJECTIVES.some(point => point.id === objectiveId) || !Number.isFinite(now) || now < 0) {
    throw new RangeError('Encirclement capture requires a known objective and simulation time');
  }
  if (match.phase !== 1) return { spawn: null, added: [], withdrawn: null, disabled: [] };
  match.captures++;
  const rear = REAR_SPAWNS.find(point => point.objectiveId === objectiveId);
  const spawn = match.unlocked.includes(rear.id) ? null : { ...rear };
  if (spawn) match.unlocked.push(spawn.id);
  const disabled = spawn ? points.filter(point => point.team === 'enemy' && point.enabled !== false &&
    ['base', 'garage', 'rally'].includes(point.kind) && (point.kind !== 'rally' || point.health > 0))
    .sort((a, b) => Math.hypot(a.x - rear.x, a.z - rear.z) - Math.hypot(b.x - rear.x, b.z - rear.z) ||
      a.id.localeCompare(b.id)).slice(0, 2) : [];
  for (const point of disabled) {
    point.enabled = false; point.disabledBy = rear.id;
    match.disabledEnemySpawns.push(point.id);
  }
  const added = formations.filter(unit => unit.team === 'friendly' && !unit.active)
    .slice(0, ENCIRCLEMENT_RULES.reinforcements);
  for (const unit of added) {
    unit.active = true; unit.spawnId = rear.id; unit.respawnAt = now;
  }
  const enemy = formations.filter(unit => unit.team === 'enemy' && unit.active);
  const withdrawn = enemy.length > ENCIRCLEMENT_RULES.minEnemy
    ? enemy.filter(unit => unit.type === 'infantry').sort((a, b) => b.index - a.index)[0] : null;
  if (withdrawn) {
    withdrawn.active = false; withdrawn.respawnEnabled = false; withdrawn.respawnAt = null;
  }
  return { spawn, added, withdrawn, disabled };
}

export function advanceEncirclement(match, points, formations) {
  if (match.winner) return match.winner;
  if (match.phase === 1 && points.length === 3 && points.every(point => point.owner === 'friendly')) {
    match.phase = 2;
    for (const unit of formations.filter(unit => unit.team === 'enemy')) {
      unit.respawnEnabled = false; unit.respawnAt = null;
    }
  }
  if (match.phase === 2 && !formations.some(unit => unit.team === 'enemy' &&
    unit.active && unit.members.some(actor => actor.health > 0))) match.winner = 'friendly';
  return match.winner;
}
