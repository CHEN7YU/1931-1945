import test from 'node:test';
import assert from 'node:assert/strict';
import { canWeaponDamageTarget, damageForTarget, rifleArmorResponse } from '../src/combat-targets.js';
import { createTactics, rememberThreat, expireThreat } from '../src/tactics.js';

test('ordinary rifles neither select sealed armor for firing nor damage its hull', () => {
  assert.equal(canWeaponDamageTarget('rifle', 'closed-armor'), false);
  assert.equal(damageForTarget('rifle', 'closed-armor', 100), 0);
  assert.equal(damageForTarget('rifle', 'person', 17), 17);
  assert.equal(damageForTarget('rifle', 'exposed-crew', 17), 17);
  assert.equal(damageForTarget('rifle', 'aircraft', 17), 17);
});
test('blast and cannon damage remain separate from the rifle restriction', () => {
  for (const weapon of ['explosion', 'cannon', 'aircraft-gun', 'collision']) {
    assert.equal(damageForTarget(weapon, 'closed-armor', 160), 160);
  }
});
test('armor threats remain armor in copied visual memory and expire normally', () => {
  const state = createTactics(1, 1, 0);
  rememberThreat(state, { x: 1, y: 1, z: 2 }, 0, 'closed-armor');
  assert.equal(state.threatKind, 'closed-armor');
  expireThreat(state, 6);
  assert.equal(state.threatKind, 'person');
  assert.equal(state.lastSeen, null);
});
test('close armor evasion chooses a clear point farther away, not a path towards the tank', () => {
  const position = { x: 0, z: 0 }, threat = { x: 10, z: 0 };
  const point = rifleArmorResponse(position, threat, p => p.x < -5);
  assert.ok(point && Math.hypot(point.x - threat.x, point.z - threat.z) > 11);
  assert.equal(rifleArmorResponse(position, threat, () => true), null);
  assert.equal(rifleArmorResponse(position, { x: 50, z: 0 }, () => false), null);
});
test('invalid classifications or damage values fail explicitly', () => {
  assert.throws(() => canWeaponDamageTarget('unknown', 'person'), RangeError);
  assert.throws(() => canWeaponDamageTarget('rifle', 'unknown'), RangeError);
  assert.throws(() => damageForTarget('rifle', 'person', -1), RangeError);
});
