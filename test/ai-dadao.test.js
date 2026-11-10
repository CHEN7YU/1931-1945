import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BAYONET } from '../src/bayonet.js';
import { DADAO, createDadaoState, stowDadao } from '../src/dadao.js';
import { dadaoCombatDistance, advanceAIDadao } from '../src/ai-dadao.js';
import { createRifleState } from '../src/rifle-action.js';
import { createLocomotion } from '../src/locomotion.js';
import { attemptAIRifleShot, createAIRifleControl } from '../src/ai-rifle.js';
import { nativePoseIntent } from '../src/nra-motion.js';

function pair(distance = 1.4) {
  const actor = { id: 'friendly', team: 'friendly', groundType: 'infantry', position: new THREE.Vector3(),
    heading: 0, health: 100, rifle: createRifleState(), dadao: createDadaoState(),
    locomotion: createLocomotion(), nextFire: 0, aiRifle: createAIRifleControl() };
  const target = { id: 'enemy', team: 'enemy', targetKind: 'person', health: 100, position: new THREE.Vector3(0, 0, -distance) };
  return { actor, target };
}
const step = (actor, target, now, facts = {}) => advanceAIDadao(actor, target, { now, visible: true, facing: true, settled: true,
  origin: new THREE.Vector3(0, 1.1, 0), forward: new THREE.Vector3(0, 0, -1),
  aimPoint: target => target.position.clone().add(new THREE.Vector3(0, 1.1, 0)), clear: () => true, ...facts });

test('friendly owned swords use Japanese entry/disengagement ranges without equipping enemies or attacking protected targets', () => {
  const { actor, target } = pair(BAYONET.chargeRange + .01);
  assert.equal(step(actor, target, 0).active, false);
  target.position.z = -BAYONET.chargeRange;
  assert.equal(step(actor, target, 0).active, true);
  step(actor, target, DADAO.draw);
  assert.equal(actor.dadao.mode, 'charge');
  target.position.z = -10;
  assert.equal(step(actor, target, .4).active, true);
  assert.equal(step(actor, target, .5, { visible: false }).active, false);
  assert.equal(actor.dadao.equipped, false);
  assert.equal(step(actor, target, .6).active, false);
  for (const change of [{ team: 'enemy' }, { dadao: null }, { health: 0 }, { vehicleId: 'tank' }, { grenades: { action: {} } }]) {
    assert.equal(dadaoCombatDistance({ ...actor, ...change }, target), null);
  }
  for (const change of [{ team: 'friendly' }, { health: 0 }, { vehicleId: 'tank' },
    { targetKind: 'closed-armor' }, { targetKind: 'aircraft' }, { position: new THREE.Vector3(0, 3, -1) }]) {
    assert.equal(dadaoCombatDistance(actor, { ...target, ...change }), null);
  }
});

test('AI draws, winds up and cuts once with owned cooldown, without spending stamina or rifle ammo', () => {
  const { actor, target } = pair();
  const rifle = { ...actor.rifle }, stamina = actor.locomotion.stamina;
  step(actor, target, 0);
  assert.equal(actor.dadao.mode, 'draw');
  step(actor, target, DADAO.draw);
  assert.equal(actor.dadao.mode, 'windup');
  assert.equal(actor.dadao.swings, 1);
  assert.ok(Math.abs(actor.locomotion.stamina - (stamina - DADAO.stamina)) < 1e-10);
  const contact = DADAO.draw + DADAO.windup + DADAO.active / 2;
  assert.equal(step(actor, target, contact).hit, true);
  assert.equal(step(actor, target, contact + .01).hit, false);
  assert.equal(actor.dadao.hits, 1);
  step(actor, target, DADAO.draw + DADAO.cooldown);
  assert.equal(actor.dadao.swings, 2);
  assert.deepEqual(actor.rifle, rifle);
  const cooldown = actor.dadao.nextAttackAt;
  stowDadao(actor.dadao);
  assert.equal(actor.dadao.nextAttackAt, cooldown);
  assert.equal(nativePoseIntent(actor), 'travel');
});

test('AI cuts recheck target, sight, actual sweep, floor, facing and posture at contact', () => {
  for (const condition of ['range', 'wall', 'sight', 'facing', 'posture', 'death', 'switch', 'floor']) {
    const { actor, target } = pair();
    step(actor, target, 0); step(actor, target, DADAO.draw);
    if (condition === 'range') target.position.z = -2;
    if (condition === 'death') target.health = 0;
    if (condition === 'switch') target.id = 'replacement';
    if (condition === 'floor') target.position.y = 3;
    assert.equal(step(actor, target, DADAO.draw + DADAO.windup + DADAO.active / 2,
      { clear: () => condition !== 'wall', visible: condition !== 'sight',
        facing: condition !== 'facing', settled: condition !== 'posture' }).hit, false, condition);
  }
});

test('empty rifles and exhausted soldiers can use swords without bypassing facing and posture readiness', () => {
  const { actor, target } = pair();
  actor.rifle.ammo = 0; actor.locomotion.stamina = 0;
  step(actor, target, 0); step(actor, target, 1, { settled: false });
  assert.equal(actor.dadao.swings, 0);
  step(actor, target, 1.1, { settled: false }); step(actor, target, 1.2, { facing: false });
  assert.equal(actor.dadao.swings, 0);
  step(actor, target, 1.3);
  assert.equal(actor.dadao.swings, 1);
  assert.equal(actor.locomotion.stamina, 0);
  assert.equal(nativePoseIntent(actor), 'dadao');
  assert.equal(attemptAIRifleShot(actor, { now: 2, targetId: target.id, mayFire: true, postureSettled: true,
    suppressed: false, confirmShot: () => { throw new Error('Dadao must exclude gunfire'); } }), false);
  assert.equal(actor.aiRifle.blocked, 'dadao');
  assert.throws(() => step(actor, target, NaN), /explicit time/);
});
