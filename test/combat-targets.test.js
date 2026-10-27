import test from 'node:test';
import assert from 'node:assert/strict';
import { canWeaponDamageTarget, canRiflemanTrackTarget, damageForTarget, rifleArmorResponse, rifleAIFireDelay, rifleAIHitChance } from '../src/combat-targets.js';
import { createTactics, rememberThreat, expireThreat } from '../src/tactics.js';

test('ordinary rifles neither select sealed armor for firing nor damage its hull', () => {
  assert.equal(canWeaponDamageTarget('rifle', 'closed-armor'), false);
  assert.equal(damageForTarget('rifle', 'closed-armor', 100), 0);
  assert.equal(damageForTarget('rifle', 'person', 17, 'limb'), 17);
  assert.equal(damageForTarget('rifle', 'exposed-crew', 17, 'torso'), 17);
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
test('confirmed rifle head/torso hits incapacitate while first limb hits are survivable for both sides', () => {
  for (const target of ['person', 'exposed-crew']) {
    for (const zone of ['head', 'torso']) assert.equal(damageForTarget('rifle', target, 100, zone), 100);
    assert.equal(damageForTarget('rifle', target, 100, 'limb'), 40);
    assert.equal(100 - 2 * damageForTarget('rifle', target, 100, 'limb'), 20);
    assert.throws(() => damageForTarget('rifle', target, 100), /confirmed anatomical/);
    for (const gear of ['helmet', 'rifle', 'backpack']) assert.throws(() => damageForTarget('rifle', target, 100, gear), /confirmed anatomical/);
  }
  assert.equal(damageForTarget('rifle', 'closed-armor', 100), 0);
});
test('AI fire is not guaranteed at close range and respects the bolt cycle', () => {
  assert.ok(rifleAIHitChance(5, false) >= .4 && rifleAIHitChance(5, false) <= .55);
  assert.ok(rifleAIHitChance(5, true) < rifleAIHitChance(5, false));
  assert.ok(rifleAIFireDelay(5, false, 0) >= .65);
  assert.ok(rifleAIFireDelay(5, false, 1) <= 1.05);
  assert.ok(rifleAIFireDelay(5, true, .5) > rifleAIFireDelay(5, false, .5));
  assert.ok(rifleAIHitChance(50, true) < rifleAIHitChance(50, false));
});
test('the approved distance anchors are continuous, monotone and have no far-distance hit floor', () => {
  for (const [distance, expected] of [[10, .5], [20, .25], [40, .1], [60, .03], [75, .01]]) {
    assert.ok(Math.abs(rifleAIHitChance(distance, false) - expected) < 1e-12);
    assert.ok(Math.abs(rifleAIHitChance(distance, true) - expected * .55) < 1e-12);
  }
  for (let distance = .25; distance <= 75; distance += .25) {
    assert.ok(rifleAIHitChance(distance, false) <= rifleAIHitChance(distance - .25, false));
  }
  assert.equal(rifleAIHitChance(75.01, false), 0);
  assert.equal(rifleAIHitChance(180, false), 0);
  assert.throws(() => rifleAIHitChance(20, 'yes'), RangeError);
});
