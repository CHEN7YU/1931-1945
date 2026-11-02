export const KILL_COLUMNS = Object.freeze([
  ['rifle', '步枪'], ['sniper', '狙击枪'], ['machine-gun', '轻机枪'], ['grenade', '手雷'],
  ['explosive-pack', '炸药包'], ['melee', '近战'], ['tank', '坦克（含碾压）'], ['tank-machine-gun', '坦克机枪'],
  ['mortar', '迫击炮'], ['plane', '航空'],
].map(Object.freeze));

export function attackCategory(weapon) {
  if (weapon.type === 'infantry') return weapon.model === 'sniper' ? 'sniper' : ['zb26', 'type11'].includes(weapon.model) ? 'machine-gun' : 'rifle';
  if (weapon.type === 'tank' && weapon.mount) return 'tank-machine-gun';
  if (KILL_COLUMNS.some(([id]) => id === weapon.type)) return weapon.type;
  throw new RangeError(`Unclassified attack weapon: ${weapon.type}`);
}

export function createBattleStats() {
  const rows = new Map(), counted = new Set();
  let revision = 0;
  const keyFor = source => `${source.team}:${source.unitId}:${source.squadId ?? source.unitId}`;
  const ensure = source => {
    const key = keyFor(source);
    if (!rows.has(key)) {
      rows.set(key, { key, team: source.team, unitId: source.unitId, squadId: source.squadId ?? source.unitId,
        name: source.unitName ?? source.unitId, kills: Object.fromEntries(KILL_COLUMNS.map(([id]) => [id, 0])), total: 0, vehicles: 0 });
      revision++;
    }
    return rows.get(key);
  };
  return {
    register(unit) {
      const source = { team: unit.team, unitId: unit.id, squadId: unit.squadId ?? unit.id, unitName: unit.scoreLabel ?? unit.id };
      for (const [key, row] of rows) if (row.unitId === unit.id && row.team === unit.team &&
        key !== keyFor(source) && !row.total && !row.vehicles) rows.delete(key);
      const row = ensure(source);
      if (row.name !== source.unitName) { row.name = source.unitName; revision++; }
    },
    consume(event) {
      const casualty = event.type === 'casualty';
      const destroyed = event.type === 'damage' && event.target.kind === 'vehicle' && event.health === 0;
      if (!casualty && !destroyed || event.source.credit === 'environment' || event.source.team === event.target.team) return;
      if (!['friendly', 'enemy'].includes(event.source.team) || typeof event.source.unitId !== 'string' ||
        !KILL_COLUMNS.some(([id]) => id === event.source.weaponClass)) throw new Error('Kill statistics require the original squad and weapon class');
      const target = `${event.target.kind}:${event.target.id}`;
      if (counted.has(target)) return;
      counted.add(target);
      const row = ensure(event.source);
      if (destroyed) row.vehicles++;
      else { row.kills[event.source.weaponClass]++; row.total++; }
      revision++;
    },
    clear() { rows.clear(); counted.clear(); revision++; },
    get revision() { return revision; },
    get snapshot() { return [...rows.values()].map(row => ({ ...row, kills: { ...row.kills } })); },
  };
}
