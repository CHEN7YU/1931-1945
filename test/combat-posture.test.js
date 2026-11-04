import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRING_POSES, ownedFiringPose, chooseCombatPosture, postureReady, wallFiringContact, chooseAdvancePace, chooseShotRelocation } from '../src/combat-posture.js';
import { createNraMotion, advanceNraMotion, sampleNraMotion, nativeMuzzleLocal } from '../src/nra-motion.js';
import { soldierPostureHeight } from '../src/entities.js';
import { targetAimPoint, createTactics, observeVisualThreat } from '../src/tactics.js';
import { readFileSync } from 'node:fs';

const facts = overrides => ({ distance: 12, moving: false, covered: false, exposed: true, suppressed: false,
  proneClear: false, canFire: () => true, ...overrides });

test('stable personal draws produce varied eligible poses without prone in close quarters', () => {
  assert.equal(Object.hasOwn(FIRING_POSES, 'kneelingBoth'), false);
  assert.throws(() => ownedFiringPose({ stance: 'crouched', firingPose: 'kneelingBoth' }), /Unknown owned firing pose/);
  const poses = new Set(Array.from({ length: 100 }, (_, index) => chooseCombatPosture(facts({ preference: index / 100 }))));
  assert.deepEqual(poses, new Set(['standing', 'kneeling', 'crouched']));
  assert.notEqual(chooseCombatPosture(facts({ suppressed: true, proneClear: true })), 'prone');
  assert.equal(chooseCombatPosture(facts({ moving: true })), 'standing');
  assert.equal(chooseCombatPosture(facts({ covered: true, exposed: false, canFire: () => false })), 'crouched');
});

test('poses require actual firing lines; prone does not require waiting until already under fire', () => {
  assert.equal(chooseCombatPosture(facts({ canFire: stance => stance === 'standing' })), 'standing');
  assert.equal(chooseCombatPosture(facts({ distance: 35, preference: .99, proneClear: true })), 'prone');
  for (const change of [{ proneClear: false }, { covered: true }]) {
    assert.notEqual(chooseCombatPosture(facts({ distance: 35, preference: .99, proneClear: true, ...change })), 'prone');
  }
  assert.equal(chooseCombatPosture(facts({ distance: 35, suppressed: true, proneClear: true, canFire: stance => stance === 'crouched' })), 'crouched');
  assert.throws(() => chooseCombatPosture(facts({ distance: NaN })), /finite tactical/);
});

test('open-ground midrange fire prefers a lowered usable stance without forcing a blind pose', () => {
  for (const preference of [0, .2, .5, .9]) {
    assert.notEqual(chooseCombatPosture(facts({ distance: 30, previousPose: 'standing', preference })), 'standing');
  }
  assert.equal(chooseCombatPosture(facts({ distance: 30, canFire: pose => pose === 'standing' })), 'standing');
  assert.equal(chooseCombatPosture(facts({ distance: 30, moving: true })), 'standing');
});

test('real side-wall contact is required, not just a cover label or a wall in front of the muzzle', () => {
  const wall = { id: 'wall', wall: true, x: .6, z: 0, w: .24, d: 4, y: 1.8, h: 3.6 };
  const contact = wallFiringContact({ x: 0, y: 0, z: 0 }, 0, [wall]);
  assert.equal(contact.pose, 'wallRight');
  assert.equal(wallFiringContact({ x: 0, y: 0, z: 0 }, Math.PI / 2, [wall]), null);
  assert.equal(wallFiringContact({ x: -3, y: 0, z: 0 }, 0, [wall]), null);
  assert.equal(chooseCombatPosture(facts({ wall: contact })), 'wallRight');
  assert.notEqual(chooseCombatPosture(facts({ wall: contact, canFire: pose => pose !== 'wallRight' })), 'wallRight');
});

test('shot relocation chooses reachable ground and preserves an effective firing posture', () => {
  const origin = { x: 0, z: 0 }, threat = { x: 0, z: -30 };
  const query = { position: origin, threat, preference: .2, blocked: () => false, heightAt: () => 0 };
  const goal = chooseShotRelocation(query);
  assert.ok(Math.hypot(goal.x, goal.z) >= 2.6);
  assert.equal(chooseShotRelocation({ ...query, blocked: () => true }), null);
  assert.equal(chooseShotRelocation({ ...query, canFinish: () => false }), null);
  assert.equal(chooseShotRelocation({ ...query, heightAt: point => point === origin ? 0 : 1 }), null);
  const first = chooseCombatPosture(facts({ preference: .2 }));
  assert.equal(chooseCombatPosture(facts({ preference: .2, previousPose: first })), first);
});

test('advance pace varies by person, with aimed walking and tactical catch-up rather than per-frame rerolls', () => {
  const base = { urgent: false, threat: true, distance: 30, exhausted: false, stamina: 1 };
  assert.equal(chooseAdvancePace({ ...base, preference: .1 }), 'aim');
  assert.equal(chooseAdvancePace({ ...base, preference: .5 }), 'jog');
  assert.equal(chooseAdvancePace({ ...base, preference: .9 }), 'jog');
  assert.equal(chooseAdvancePace({ ...base, preference: .1, threat: false }), 'sprint');
  assert.equal(chooseAdvancePace({ ...base, preference: .1, catchUp: true }), 'sprint');
  assert.equal(chooseAdvancePace({ ...base, preference: .9, exhausted: true }), 'jog');
  assert.equal(chooseAdvancePace({ ...base, preference: .9, constrained: true, urgent: true }), 'walk');
  assert.equal(chooseAdvancePace({ ...base, preference: .1, constrained: true }), 'aim');
  assert.equal(chooseAdvancePace({ ...base, preference: .9, threat: false, distance: 2 }), 'walk');
  assert.equal(chooseAdvancePace({ ...base, preference: .5, urgent: true }), 'sprint');
  assert.throws(() => chooseAdvancePace({ ...base, preference: .2, constrained: 'yes' }), /tactical facts/);
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
  for (let frame = 0; frame < 20; frame++) {
    advanceNraMotion(actor, .05);
    const pose = sampleNraMotion(actor);
    assert.ok(pose.crouched + pose.prone <= 1.00001);
    assert.ok(pose.weaponPosition.every(Number.isFinite));
    if (frame === 11) assert.equal(postureReady(actor), false, 'lowering is no longer an almost-instant pose switch');
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
