export const KILL_COLUMNS = Object.freeze([
  ['rifle', '步枪'], ['sniper', '狙击枪'], ['machine-gun', '机枪'], ['submachine-gun', '冲锋枪'], ['grenade', '手雷'],
  ['explosive-pack', '炸药包'], ['melee', '近战'], ['tank', '坦克（含碾压）'], ['tank-machine-gun', '坦克机枪'],
  ['mortar', '迫击炮'], ['grenade-discharger', '八九式掷弹筒'], ['field-gun', '山炮'], ['plane', '航空'],
].map(Object.freeze));

export function attackCategory(weapon) {
  if (weapon.type === 'infantry') return weapon.model === 'sigm1920' ? 'submachine-gun'
    : weapon.model === 'sniper' ? 'sniper' : ['zb26', 'type11'].includes(weapon.model) ? 'machine-gun' : 'rifle';
  if (weapon.type === 'tank' && weapon.mount) return 'tank-machine-gun';
  if (KILL_COLUMNS.some(([id]) => id === weapon.type)) return weapon.type;
  throw new RangeError(`Unclassified attack weapon: ${weapon.type}`);
}

export function createBattleStats() {
  const rows = new Map(), counted = new Set(), playerUnits = new Map();
  const personnel = new Map();
  const casualties = { friendly: { deployed: 0, killed: 0, wounded: 0 }, enemy: { deployed: 0, killed: 0, wounded: 0 } };
  let revision = 0;
  const personFor = actor => {
    if (!actor?.id || !['friendly', 'enemy'].includes(actor.team)) throw new Error('Personnel statistics require a soldier identity and team');
    let person = personnel.get(actor.id);
    if (person && person.team !== actor.team) throw new Error('A soldier cannot change team in casualty statistics');
    if (!person) {
      person = { team: actor.team, wounded: false, dead: false }; personnel.set(actor.id, person);
      casualties[actor.team].deployed++; revision++;
    }
    return person;
  };
  const playerFor = source => playerUnits.get(`${source.team}:${source.unitId}`);
  const keyFor = source => playerFor(source) ? `${source.team}:player` : `${source.team}:${source.unitId}:${source.squadId ?? source.unitId}`;
  const ensure = source => {
    const key = keyFor(source);
    if (!rows.has(key)) {
      const owner = playerFor(source);
      rows.set(key, { key, team: source.team, unitId: source.unitId, squadId: owner ? 'player' : source.squadId ?? source.unitId,
        ...(owner ? { player: true, unitName: owner.unitName } : {}), name: owner?.name ?? source.unitName ?? source.unitId,
        kills: Object.fromEntries(KILL_COLUMNS.map(([id]) => [id, 0])), total: 0, vehicles: 0 });
      revision++;
    }
    return rows.get(key);
  };
  return {
    registerSoldier(actor) { personFor(actor); },
    register(unit) {
      if (unit.player) playerUnits.set(`${unit.team}:${unit.id}`, {
        name: unit.playerName || '玩家', unitName: unit.historicalName ?? unit.scoreLabel ?? unit.id,
      });
      const source = { team: unit.team, unitId: unit.id, squadId: unit.squadId ?? unit.id, unitName: unit.scoreLabel ?? unit.id };
      for (const [key, row] of rows) if (row.unitId === unit.id && row.team === unit.team &&
        key !== keyFor(source) && !row.total && !row.vehicles) rows.delete(key);
      const row = ensure(source);
      const name = playerFor(source)?.name ?? source.unitName;
      if (row.name !== name) { row.name = name; revision++; }
      const owner = playerFor(source);
      if (owner && row.unitName !== owner.unitName) { row.unitName = owner.unitName; revision++; }
    },
    consume(event) {
      const casualty = event.type === 'casualty';
      const destroyed = event.type === 'damage' && event.target.kind === 'vehicle' && event.health === 0;
      if (casualty || event.type === 'damage' && event.target.kind === 'soldier') {
        const person = personFor(event.target), team = casualties[person.team];
        if (casualty && !person.dead) {
          person.dead = true; team.killed++;
          if (person.wounded) { person.wounded = false; team.wounded--; }
          revision++;
        } else if (!person.dead && !person.wounded && event.health > 0) {
          person.wounded = true; team.wounded++; revision++;
        }
      }
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
    clear() {
      rows.clear(); counted.clear(); personnel.clear(); playerUnits.clear();
      for (const team of Object.values(casualties)) team.deployed = team.killed = team.wounded = 0;
      revision++;
    },
    get revision() { return revision; },
    get snapshot() { return [...rows.values()].map(row => ({ ...row, kills: { ...row.kills } })); },
    get casualtySummary() {
      return Object.entries(casualties).map(([team, values]) => ({ team, ...values,
        unhurt: values.deployed - values.killed - values.wounded }));
    },
  };
}
