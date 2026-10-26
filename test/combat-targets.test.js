import test from 'node:test';
import assert from 'node:assert/strict';
import { canWeaponDamageTarget, canRiflemanTrackTarget, damageForTarget, rifleArmorResponse, rifleAIFireDelay, rifleAIHitChance } from '../src/combat-targets.js';
import { createTactics, rememberThreat, expireThreat } from '../src/tactics.js';

test('ordinary rifles neither select sealed armor for firing nor damage its hull', () => {
  assert.equal(canWeaponDamageTarget('rifle', 'closed-armor'), false);
  assert.equal(damageForTarget('rifle', 'closed-armor', 100), 0);
  assert.equal(damageForTarget('rifle', 'person', 17), 17);
  assert.equal(damageForTarget('rifle', 'exposed-crew', 17), 17);
  assert.equal(damageForTarget('rifle', 'aircraft', 17), 0);
});
test('riflemen ignore aircraft before ranking candidates without losing ground targets or armor warning', () => {
  assert.equal(canRiflemanTrackTarget('aircraft'), false);
  assert.equal(canWeaponDamageTarget('rifle', 'aircraft'), false);
  for (const kind of ['person', 'exposed-crew', 'closed-armor']) assert.equal(canRiflemanTrackTarget(kind), true);
  const candidates = [...Array.from({ length: 9 }, () => ({ kind: 'aircraft', distance: 1 })),
    { kind: 'person', distance: 10 }, { kind: 'closed-armor', distance: 12 }];
  const eligible = candidates.filter(target => canRiflemanTrackTarget(target.kind))
    .sort((a, b) => a.distance - b.distance).slice(0, 8);
  assert.deepEqual(eligible.map(target => target.kind), ['person', 'closed-armor']);
  assert.throws(() => canRiflemanTrackTarget('unknown'), RangeError);
});
test('blast and cannon damage remain separate from the rifle restriction', () => {
  for (const weapon of ['explosion', 'cannon', 'aircraft-gun', 'collision']) {
    assert.equal(damageForTarget(weapon, 'closed-armor', 160), 160);
    assert.equal(damageForTarget(weapon, 'aircraft', 160), 160);
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
test('standard rifle body hits kill a 100HP soldier in two effective hits for both sides', () => {
  for (const target of ['person', 'exposed-crew']) {
    let health = 100;
    health -= damageForTarget('rifle', target, 100);
    assert.equal(health, 50);
    health -= damageForTarget('rifle', target, 50);
    assert.equal(health, 0);
  }
  assert.equal(damageForTarget('rifle', 'closed-armor', 100), 0);
});
test('close visible rifle fire does not reroll misses and respects the bolt cycle', () => {
  assert.equal(rifleAIHitChance(5, false), 1);
  assert.equal(rifleAIHitChance(5, true), 1);
  assert.ok(rifleAIFireDelay(5, false, 0) >= .65);
  assert.ok(rifleAIFireDelay(5, false, 1) <= 1.05);
  assert.ok(rifleAIFireDelay(5, true, .5) > rifleAIFireDelay(5, false, .5));
  assert.ok(rifleAIHitChance(50, true) < rifleAIHitChance(50, false));
});
