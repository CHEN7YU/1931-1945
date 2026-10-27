import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCombatPosture, postureReady } from '../src/combat-posture.js';
import { createNraMotion, advanceNraMotion, sampleNraMotion, nativeMuzzleLocal } from '../src/nra-motion.js';
import { soldierPostureHeight } from '../src/entities.js';
import { targetAimPoint, createTactics, observeVisualThreat } from '../src/tactics.js';
import { readFileSync } from 'node:fs';

const facts = overrides => ({ distance: 12, moving: false, covered: false, exposed: true, suppressed: false,
  proneClear: false, canFire: () => true, ...overrides });

test('close combat prefers a usable crouched line, not indiscriminate prone or standing fire', () => {
  assert.equal(chooseCombatPosture(facts()), 'crouched');
  assert.equal(chooseCombatPosture(facts({ suppressed: true, proneClear: true })), 'crouched');
  assert.equal(chooseCombatPosture(facts({ moving: true })), 'standing');
  assert.equal(chooseCombatPosture(facts({ covered: true, exposed: false, canFire: () => false })), 'crouched');
});

test('standing exposure is allowed when low fire is obstructed, and prone needs distance, pressure, space and an actual firing line', () => {
  assert.equal(chooseCombatPosture(facts({ canFire: stance => stance === 'standing' })), 'standing');
  assert.equal(chooseCombatPosture(facts({ distance: 35, suppressed: true, proneClear: true })), 'prone');
  for (const change of [{ proneClear: false }, { suppressed: false }, { covered: true }]) {
    assert.notEqual(chooseCombatPosture(facts({ distance: 35, suppressed: true, proneClear: true, ...change })), 'prone');
  }
  assert.equal(chooseCombatPosture(facts({ distance: 35, suppressed: true, proneClear: true, canFire: stance => stance === 'crouched' })), 'crouched');
  assert.throws(() => chooseCombatPosture(facts({ distance: NaN })), /finite tactical/);
});

test('owned posture blends lower actual eye, aim and gun height and delay firing until settled', () => {
  const source = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url), 'utf8')).motion;
  const track = height => ({ duration: 1, times: [0, 1], positions: [.13, height, -.03, .13, height, -.03], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] });
  const actor = { stance: 'standing', walkPhase: 0, position: { x: 0, y: .3, z: 0 }, locomotion: { speed: 0 } };
  actor.nativeMotion = createNraMotion({ ...source, crouched: track(.78), prone: track(.31) }, actor);
  actor.stance = 'crouched';
  assert.equal(postureReady(actor), false);
  for (let frame = 0; frame < 12; frame++) advanceNraMotion(actor, .05);
  assert.equal(postureReady(actor), true);
  assert.ok(Math.abs(soldierPostureHeight(actor) - 1.05) < .003);
  assert.ok(targetAimPoint(actor).y < 1.01 && targetAimPoint(actor).y > .99);
  assert.ok(nativeMuzzleLocal(actor).y < .79);
  actor.stance = 'prone';
  assert.equal(postureReady(actor), false);
  for (let frame = 0; frame < 12; frame++) {
    advanceNraMotion(actor, .05);
    const pose = sampleNraMotion(actor);
    assert.ok(pose.crouched + pose.prone <= 1.00001);
    assert.ok(pose.weaponPosition.every(Number.isFinite));
  }
  assert.equal(postureReady(actor), true);
  assert.ok(soldierPostureHeight(actor, 'body') < .66);
  assert.ok(nativeMuzzleLocal(actor).y < .32);
  const before = structuredClone(actor.nativeMotion);
  advanceNraMotion(actor, 0);
  assert.deepEqual(actor.nativeMotion, before);
});

test('a low wall hiding the crouched torso does not make an exposed head invisible', () => {
  const target = { id: 'crouched-person', targetKind: 'person', stance: 'crouched',
    nativeMotion: { posture: { crouched: 1, prone: 0 } }, position: { x: 2, y: 0, z: 3 } };
  const state = createTactics('observer', 0, 0), queries = [];
  const observed = observeVisualThreat(state, target, 1, point => { queries.push(point.y); return point.y > .88; });
  assert.deepEqual(queries, [.7, 1.05]);
  assert.equal(observed.y, 1.05);
  assert.equal(state.lastSeen.y, 1.05);
  target.position.x = 100;
  assert.equal(observeVisualThreat(state, target, 2, () => false), null);
  assert.equal(state.lastSeen.x, 2);
  assert.equal(state.observedAt, 1);
});
