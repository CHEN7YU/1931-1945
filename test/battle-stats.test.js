import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleStats, attackCategory } from '../src/battle-stats.js';
import { createCombatEvents } from '../src/combat-events.js';
import { SCORE_ICON_PATHS } from '../src/score-icons.js';

const source = kind => ({ credit: 'ally', team: 'friendly', unitId: 'friendly-0', squadId: 'infantry',
  unitName: 'First infantry squad', soldierId: 'original-thrower', weaponId: `original:${kind}`, weaponClass: kind });
const event = (id, kind, extra = {}) => ({ type: 'casualty', health: 0, time: 1, source: source(kind),
  target: { kind: 'soldier', id, team: 'enemy', unitId: 'enemy-0' }, ...extra });
test('squad kill breakdown survives copied events, delayed explosives and later squad changes without double counting', () => {
  const stats = createBattleStats(), events = createCombatEvents();
  for (const [id, kind] of ['rifle', 'sniper', 'explosive-pack', 'tank-machine-gun'].entries()) {
    const recorded = events.publish('casualty', event(`enemy-${id}`, kind), 1);
    stats.consume(recorded); stats.consume(recorded);
  }
  stats.register({ id: 'friendly-0', team: 'friendly', squadId: 'tank', scoreLabel: 'Armored squad' });
  const row = stats.snapshot.find(row => row.squadId === 'infantry');
  assert.equal(row.total, 4); assert.equal(row.kills.sniper, 1); assert.equal(row.kills['explosive-pack'], 1);
  assert.equal(stats.snapshot.find(row => row.squadId === 'tank').total, 0);
  row.kills.sniper = 999;
  assert.equal(stats.snapshot.find(row => row.squadId === 'infantry').kills.sniper, 1);
  stats.clear(); assert.deepEqual(stats.snapshot, []);
});
test('vehicle destruction is separate from individual crew kills, and friendly or environmental casualties are not enemy kills', () => {
  const stats = createBattleStats();
  stats.consume(event('crew', 'tank'));
  stats.consume(event('tank', 'tank', { type: 'damage', target: { kind: 'vehicle', id: 'hull', team: 'enemy' } }));
  stats.consume(event('friend', 'rifle', { target: { kind: 'soldier', id: 'friend', team: 'friendly' } }));
  stats.consume(event('crash', 'plane', { source: { credit: 'environment' } }));
  assert.equal(stats.snapshot[0].total, 1); assert.equal(stats.snapshot[0].vehicles, 1);
  assert.equal(attackCategory({ type: 'infantry', model: 'sniper' }), 'sniper');
  assert.equal(attackCategory({ type: 'tank', mount: 'coax' }), 'tank-machine-gun');
});

test('one player row accumulates 10 tank and 20 infantry kills including owned AI and delayed old-squad attacks', () => {
  const stats = createBattleStats();
  const player = { id: 'friendly-0', team: 'friendly', player: true, playerName: '江城守军',
    historicalName: '国民革命军第31师', squadId: 'tank', scoreLabel: '装甲小队' };
  stats.register(player);
  for (let index = 0; index < 10; index++) stats.consume(event(`tank-${index}`, 'tank', {
    source: { ...source('tank'), credit: index % 2 ? 'player' : 'ally', squadId: 'tank' },
  }));
  stats.register({ ...player, squadId: 'infantry', scoreLabel: '步兵小队' });
  for (let index = 0; index < 20; index++) stats.consume(event(`infantry-${index}`, 'rifle'));
  assert.equal(stats.snapshot.length, 1);
  assert.equal(stats.snapshot[0].name, '江城守军');
  assert.equal(stats.snapshot[0].unitName, '国民革命军第31师');
  assert.equal(stats.snapshot[0].total, 30);
  assert.equal(stats.snapshot[0].kills.tank, 10); assert.equal(stats.snapshot[0].kills.rifle, 20);
  const delayed = event('late-target', 'explosive-pack', { source: { ...source('explosive-pack'), squadId: 'tank' } });
  stats.consume(delayed); stats.consume(delayed);
  assert.equal(stats.snapshot[0].total, 31);
});

test('casualty totals retain replacements, friendly fire and accidents without treating healthy removal as death', () => {
  const stats = createBattleStats();
  for (const [id, team] of [['one', 'friendly'], ['two', 'friendly'], ['enemy-one', 'enemy']]) stats.registerSoldier({ id, team });
  const wounded = { type: 'damage', health: 65, amount: 35, source: source('rifle'),
    target: { kind: 'soldier', id: 'one', unitId: 'friendly-0', team: 'friendly' } };
  stats.consume(wounded); stats.consume(wounded);
  assert.deepEqual(stats.casualtySummary[0], { team: 'friendly', deployed: 2, killed: 0, wounded: 1, unhurt: 1 });
  stats.consume(event('one', 'rifle', { source: { credit: 'environment' }, target: wounded.target }));
  stats.consume(wounded);
  stats.registerSoldier({ id: 'replacement', team: 'friendly' });
  assert.deepEqual(stats.casualtySummary[0], { team: 'friendly', deployed: 3, killed: 1, wounded: 0, unhurt: 2 });
  assert.equal(stats.casualtySummary[1].killed, 0, 'removing or evacuating a live actor does not emit a casualty');
  stats.clear();
  assert.ok(stats.casualtySummary.every(row => row.deployed + row.killed + row.wounded === 0));
});

test('all displayed weapon classes have distinct local vector icons rather than text glyph or remote image dependencies', () => {
  const keys = ['rifle', 'sniper', 'machine-gun', 'grenade', 'explosive-pack', 'tank', 'tank-machine-gun', 'mortar', 'plane', 'total', 'destroyed'];
  assert.equal(new Set(keys.map(key => SCORE_ICON_PATHS[key])).size, keys.length);
  for (const key of keys) {
    assert.match(SCORE_ICON_PATHS[key], /^M/);
    assert.doesNotMatch(SCORE_ICON_PATHS[key], /https?:|NaN|Infinity/);
  }
});
