import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerIdentityStore, playerUnitOptions, validatePlayerIdentity, PLAYER_IDENTITY_KEY } from '../src/player-identity.js';

test('real unit cards are campaign-specific and custom naming is always the last option', () => {
  const nanjing = playerUnitOptions('nanjing'), taierzhuang = playerUnitOptions('taierzhuang-fort');
  assert.equal(playerUnitOptions('sihang')[0].name, '国民革命军第88师524团');
  assert.equal(nanjing[0].name, '国民革命军第88师');
  assert.match(nanjing[0].description, /四行仓库/);
  assert.ok(!taierzhuang.some(unit => unit.id === '88'));
  for (const options of [nanjing, taierzhuang]) {
    assert.ok(options.length >= 4);
    assert.equal(options.at(-1).id, 'custom');
    assert.ok(options.slice(0, -1).every(unit => unit.description.length > 20 && unit.source.startsWith('https://')));
  }
});

test('identity persists only its own nickname and per-campaign unit choices and rejects invalid or foreign selections', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = createPlayerIdentityStore({ storage: () => storage });
  store.update({ nickname: '江城守军', customName: '铁血小队', selections: { nanjing: 'custom' } });
  assert.equal(values.size, 1); assert.ok(values.has(PLAYER_IDENTITY_KEY));
  const reloaded = createPlayerIdentityStore({ storage: () => storage });
  assert.equal(reloaded.snapshot.nickname, '江城守军');
  assert.equal(reloaded.snapshot.selections.nanjing, 'custom');
  assert.equal(reloaded.snapshot.selections['taierzhuang-fort'], '31');
  assert.throws(() => store.update({ nickname: ' ' }), /昵称/);
  assert.throws(() => store.update({ selections: { 'taierzhuang-fort': '88' } }), /该战役/);
  assert.throws(() => validatePlayerIdentity({ ...store.snapshot, nickname: 'x\nname' }), /控制字符/);
});

test('storage failures are reported while the local session keeps a valid usable identity', () => {
  const warnings = [], store = createPlayerIdentityStore({
    storage: () => ({ getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Full'); } }),
    warn: message => warnings.push(message),
  });
  assert.equal(store.snapshot.nickname, '玩家');
  assert.equal(store.status.problem, true);
  store.update({ nickname: '本机玩家' });
  assert.equal(store.snapshot.nickname, '本机玩家');
  assert.equal(store.status.problem, true);
  assert.equal(warnings.length, 2);
});
