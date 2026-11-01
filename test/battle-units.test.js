import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignUnitName, campaignUnitDescription, soldierRoleLabel } from '../src/battle-units.js';
import { infantryLoadout } from '../src/battle-roster.js';

test('the first infantry member is an explicitly labelled mortar soldier with a rifle', () => {
  const loadout = infantryLoadout('friendly', 0);
  assert.deepEqual(loadout, { role: 'mortarman', model: 'rifle' });
  assert.equal(soldierRoleLabel(loadout), '迫击炮手');
  assert.equal(infantryLoadout('friendly', 1).role, 'rifleman');
  assert.equal(infantryLoadout('friendly', 9).role, 'sniper');
  assert.equal(infantryLoadout('friendly', 10).role, 'machine-gunner');
});

test('both teams use referenced Taierzhuang formations with explicitly abstract game subdivisions', () => {
  const names = ['friendly', 'enemy'].map(team => Array.from({ length: 10 }, (_, index) =>
    campaignUnitName({ team, index, type: team === 'enemy' && index >= 8 ? 'tank' : 'infantry', player: index === 0 && team === 'friendly' })));
  for (const team of names) {
    assert.equal(new Set(team).size, 10);
    assert.ok(team.every(name => name.length <= 11));
    assert.ok(team.every(name => /游戏|不是史实|不代表/.test(campaignUnitDescription(name))));
  }
  assert.ok(names[0].some(name => name.startsWith('第31师')));
  assert.ok(names[0].some(name => name.startsWith('第27师')));
  assert.ok(names[0].some(name => name.startsWith('第20军团')));
  assert.ok(names[1].some(name => name.startsWith('第10师团·濑谷')));
  assert.ok(names[1].some(name => name.startsWith('第5师团·坂本')));
  assert.ok(names[1].slice(8).every(name => name.startsWith('装甲支援')));
  assert.notEqual(campaignUnitName({ team: 'friendly', type: 'infantry', index: 0, player: true, squadId: 'infantry' }),
    campaignUnitName({ team: 'friendly', type: 'infantry', index: 0, player: true, squadId: 'infantry-reserve' }));
});

test('prototype support is not assigned fabricated historical regiment names and invalid units fail explicitly', () => {
  for (const type of ['mortar', 'tank', 'plane']) {
    const name = campaignUnitName({ team: 'friendly', type, index: 0, player: true });
    assert.match(name, /游戏/);
    assert.match(campaignUnitDescription(name), /不代表.*实有独立部队番号或装备配属/);
  }
  assert.throws(() => campaignUnitName({ team: 'unknown', type: 'infantry', index: 0 }), RangeError);
});
