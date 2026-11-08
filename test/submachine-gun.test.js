import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { INFANTRY_WEAPONS, createRifleState, shootRifle, advanceRifle, reloadRifle } from '../src/rifle-action.js';
import { machineGunReloadPose } from '../src/machine-gun-reload.js';
import { infantryLoadout } from '../src/battle-roster.js';
import { submachineGunModel } from '../src/submachine-gun-model.js';
import { attackCategory } from '../src/battle-stats.js';
import { SOLDIER_ROLE_PATHS } from '../src/soldier-role-icons.js';

test('one original Chinese rifle slot becomes an assault weapon without replacing engineer, sniper, machine gun or unarmed demolition slots', () => {
  assert.deepEqual(infantryLoadout('friendly', 4), { role: 'assault', model: 'sigm1920' });
  assert.equal(infantryLoadout('friendly', 1).role, 'engineer');
  assert.equal(infantryLoadout('friendly', 9).role, 'sniper');
  assert.equal(infantryLoadout('friendly', 10).role, 'machine-gunner');
  assert.equal(infantryLoadout('enemy', 4).model, 'rifle');
  assert.equal(infantryLoadout('friendly', 4, 'infantry', { sihangDemolition: true }).unarmed, true);
  assert.equal(attackCategory({ type: 'infantry', model: 'sigm1920' }), 'submachine-gun');
  assert.ok(SOLDIER_ROLE_PATHS.assault);
});
test('the submachine gun has its own magazine and cycle, and reload cues do not treat it as a Type 11 hopper', () => {
  const rifle = createRifleState('sigm1920'); assert.equal(rifle.ammo, 50);
  assert.equal(shootRifle(rifle), true); assert.equal(shootRifle(rifle), false);
  advanceRifle(rifle, .1); assert.equal(shootRifle(rifle), true);
  advanceRifle(rifle, .1); reloadRifle(rifle);
  const cues = advanceRifle(rifle, 3.2);
  assert.equal(rifle.ammo, 50); assert.equal(cues.filter(event => event === 'load').length, 1);
  const pose = machineGunReloadPose({ ...rifle, action: 'reload', elapsed: 3.2 * .25 });
  assert.equal(pose.stage, 'remove'); assert.ok(pose.feed[0] < 0); assert.equal(pose.lidAngle, 0);
  assert.equal(pose.clipVisible, false);
});
test('near and far gun models retain the original vented shroud, side magazine and actual 810mm length', () => {
  for (const detail of ['near', 'far']) {
    const model = submachineGunModel(detail), bounds = new THREE.Box3().setFromObject(model);
    assert.ok(model.getObjectByName('feed')); assert.equal(model.userData.model, 'sigm1920');
    assert.equal(model.userData.referenceLength, INFANTRY_WEAPONS.sigm1920.length);
    assert.ok(Math.abs(bounds.max.z - bounds.min.z - .81) < .015);
  }
});
