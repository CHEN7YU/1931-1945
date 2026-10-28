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

test('all displayed weapon classes have distinct local vector icons rather than text glyph or remote image dependencies', () => {
  const keys = ['rifle', 'sniper', 'machine-gun', 'grenade', 'explosive-pack', 'tank', 'tank-machine-gun', 'mortar', 'plane', 'total', 'destroyed'];
  assert.equal(new Set(keys.map(key => SCORE_ICON_PATHS[key])).size, keys.length);
  for (const key of keys) {
    assert.match(SCORE_ICON_PATHS[key], /^M/);
    assert.doesNotMatch(SCORE_ICON_PATHS[key], /https?:|NaN|Infinity/);
  }
});
