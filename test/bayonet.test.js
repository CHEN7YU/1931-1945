import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BAYONET, hasBayonet, createBayonetState, bayonetDistance, advanceBayonet } from '../src/bayonet.js';
import { createRifleState } from '../src/rifle-action.js';
import { rifleWorldModel, syncWorldWeapon } from '../src/rifle-model.js';
import { damageForTarget } from '../src/combat-targets.js';
import { attemptAIRifleShot, createAIRifleControl } from '../src/ai-rifle.js';
import { createLocomotion } from '../src/locomotion.js';

function pair(distance = 6) {
  const actor = { id: 'enemy', team: 'enemy', groundType: 'infantry', position: new THREE.Vector3(),
    heading: 0, health: 100, rifle: createRifleState(), bayonet: createBayonetState() };
  const target = { id: 'friendly', team: 'friendly', targetKind: 'person', health: 100, position: new THREE.Vector3(0, 0, -distance) };
  return { actor, target };
}
const step = (actor, target, now, facts = {}) => advanceBayonet(actor, target,
  { now, visible: true, facing: true, settled: true, ...facts });

test('only Japanese ordinary infantry rifles carry bayonets; armor, aircraft and other floors are excluded', () => {
  const { actor, target } = pair();
  assert.equal(hasBayonet(actor), true);
  for (const change of [{ team: 'friendly' }, { groundType: 'mortar' }, { rifle: createRifleState('sniper') },
    { rifle: createRifleState('type11') }]) assert.equal(hasBayonet({ ...actor, ...change }), false);
  for (const change of [{ health: 0 }, { vehicleId: 'tank' }, { team: 'enemy' },
    { targetKind: 'closed-armor' }, { targetKind: 'aircraft' }, { position: new THREE.Vector3(0, 3, -1) }]) {
    assert.equal(bayonetDistance(actor, { ...target, ...change }), null);
  }
  assert.equal(bayonetDistance({ ...actor, vehicleId: 'tank' }, target), null);
  assert.equal(bayonetDistance({ ...actor, grenades: { action: {} } }, target), null);
});

test('charge entry is eight metres, continuation has hysteresis and lost sight cancels immediately', () => {
  const { actor, target } = pair(8.01);
  assert.equal(step(actor, target, 0).active, false);
  target.position.z = -BAYONET.chargeRange;
  assert.equal(step(actor, target, 0).active, true);
  assert.equal(actor.bayonet.mode, 'charge');
  target.position.z = -10;
  assert.equal(step(actor, target, .1).active, true);
  assert.equal(step(actor, target, .2, { visible: false }).active, false);
  assert.equal(actor.bayonet.mode, 'idle');
  assert.equal(step(actor, target, .3).active, false);
  target.position.z = -6;
  step(actor, target, .4);
  target.position.z = -11.01;
  assert.equal(step(actor, target, .5).active, false);
});

test('a thrust has a windup, hits once, observes cooldown and never consumes ammunition', () => {
  const { actor, target } = pair(BAYONET.reach);
  const rifle = { ...actor.rifle };
  assert.equal(step(actor, target, 0).hit, false);
  assert.equal(actor.bayonet.mode, 'thrust');
  assert.equal(step(actor, target, BAYONET.windup / 2).hit, false);
  assert.equal(actor.bayonet.extension, .5);
  assert.equal(step(actor, target, BAYONET.windup).hit, true);
  assert.equal(actor.bayonet.extension, 1);
  for (const now of [.23, .3, .44, .6, 1]) assert.equal(step(actor, target, now).hit, false);
  assert.equal(actor.bayonet.strikes, 1);
  step(actor, target, BAYONET.cooldown);
  assert.equal(actor.bayonet.strikes, 2);
  assert.equal(step(actor, target, BAYONET.cooldown + BAYONET.windup).hit, true);
  assert.equal(actor.bayonet.hits, 2);
  assert.deepEqual(actor.rifle, rifle);
  assert.equal(damageForTarget('bayonet', 'person', BAYONET.damage), 65);
  assert.equal(damageForTarget('bayonet', 'closed-armor', BAYONET.damage), 0);
  assert.equal(damageForTarget('bayonet', 'aircraft', BAYONET.damage), 0);
});

test('range, facing, posture, death, target changes and occlusion are rechecked at impact', () => {
  for (const condition of ['range', 'facing', 'posture', 'death', 'switch', 'wall']) {
    const { actor, target } = pair(1);
    step(actor, target, 0);
    if (condition === 'range') target.position.z = -2;
    if (condition === 'death') target.health = 0;
    if (condition === 'switch') target.id = 'replacement';
    const result = step(actor, target, BAYONET.windup, { facing: condition !== 'facing',
      settled: condition !== 'posture', visible: condition !== 'wall' });
    assert.equal(result.hit, false, condition);
    assert.equal(actor.bayonet.hits, 0);
  }
  const { actor, target } = pair(1);
  step(actor, target, 0);
  step(actor, target, .1, { visible: false });
  step(actor, target, .3);
  assert.equal(actor.bayonet.strikes, 1, 'reacquisition cannot bypass the attack cooldown');
});

test('unsettled or turned-away soldiers cannot initiate a thrust; empty rifles can still stab', () => {
  const { actor, target } = pair(1);
  actor.rifle.ammo = 0;
  step(actor, target, 0, { settled: false });
  step(actor, target, .1, { facing: false });
  assert.equal(actor.bayonet.strikes, 0);
  step(actor, target, .2);
  assert.equal(actor.bayonet.strikes, 1);
  assert.throws(() => step(actor, target, NaN), /explicit time/);
});

test('near and far ordinary enemy rifles share a pointed blade beyond the muzzle, not the scope or machine gun', () => {
  for (const detail of ['near', 'far']) {
    const gun = rifleWorldModel(detail, createRifleState(), { bayonet: true });
    const attachment = gun.getObjectByName('fixed-bayonet');
    assert.ok(attachment.visible);
    const box = new THREE.Box3().setFromObject(attachment);
    assert.ok(box.min.z < -1.34 && box.max.z > -.8);
    assert.ok(box.max.x - box.min.x > .05);
    syncWorldWeapon(gun, createRifleState('sniper'));
    assert.equal(attachment.visible, false);
    syncWorldWeapon(gun, createRifleState('type11'));
    assert.equal(attachment.visible, false);
    syncWorldWeapon(gun, createRifleState());
    assert.equal(attachment.visible, true);
  }
  assert.equal(rifleWorldModel().getObjectByName('fixed-bayonet'), undefined);
});

test('a bayonet charge cannot accidentally pass rifle firing readiness', () => {
  const { actor, target } = pair();
  Object.assign(actor, { nextFire: 0, aiRifle: createAIRifleControl(), locomotion: createLocomotion() });
  step(actor, target, 0);
  for (const now of [0, 1, 2]) {
    assert.equal(attemptAIRifleShot(actor, { now, targetId: target.id, mayFire: true, postureSettled: true,
      suppressed: false, confirmShot: () => { throw new Error('A bayonet charge must not fire'); } }), false);
  }
  assert.equal(actor.rifle.shots, 0);
});
