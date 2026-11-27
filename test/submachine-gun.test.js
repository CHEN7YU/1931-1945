import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { INFANTRY_WEAPONS, createRifleState, shootRifle, advanceRifle, reloadRifle } from '../src/rifle-action.js';
import { machineGunReloadPose } from '../src/machine-gun-reload.js';
import { infantryLoadout } from '../src/battle-roster.js';
import { SMG_MAGAZINE, submachineGunModel } from '../src/submachine-gun-model.js';
import { attackCategory } from '../src/battle-stats.js';
import { SOLDIER_ROLE_PATHS } from '../src/soldier-role-icons.js';
import { isNativeOfficer } from '../src/officer-appearance.js';

test('one original Chinese rifle slot becomes an assault weapon without replacing engineer, sniper, machine gun or unarmed demolition slots', () => {
  assert.deepEqual(infantryLoadout('friendly', 2), { role: 'assault', model: 'sigm1920' });
  assert.deepEqual(infantryLoadout('friendly', 4), { role: 'rifleman', model: 'rifle' });
  assert.equal(isNativeOfficer({ team: 'friendly', index: 2, formation: { memberCount: 11 } }), true);
  for (const memberCount of [11, 14, 19, 22]) {
    const formation = { type: 'infantry', memberCount };
    const loadouts = Array.from({ length: memberCount }, (_, index) => infantryLoadout('friendly', index, 'infantry', formation));
    assert.equal(loadouts.filter(loadout => loadout.model === 'sigm1920').length, 1);
    assert.ok(isNativeOfficer({ team: 'friendly', index: loadouts.findIndex(loadout => loadout.model === 'sigm1920'), formation }));
  }
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

test('the side magazine clears and seats along its actual axis without changing the reload clock', () => {
  const state = { ...createRifleState('sigm1920'), ammo: 0 };
  reloadRifle(state);
  let previous = null;
  for (let frame = 0; frame <= 1000; frame++) {
    const fraction = frame / 1000;
    state.elapsed = 3.2 * fraction;
    const pose = machineGunReloadPose(state, { firstPerson: true });
    const activeMagazine = pose.spareVisible ? pose.spareFeed : pose.feed;
    if (previous) assert.ok(new THREE.Vector3(...activeMagazine).distanceTo(previous) < .003);
    previous = new THREE.Vector3(...activeMagazine);
    if (fraction >= .15 && fraction <= .24 || fraction >= .68 && fraction <= .8) {
      if (fraction <= .24) {
        assert.equal(pose.feed[1], 0);
        assert.equal(pose.feed[2], 0);
      }
    }
    if (fraction >= .15 && fraction <= .8) {
      const contact = new THREE.Vector3(...pose.palm).sub(new THREE.Vector3(...activeMagazine));
      const expected = new THREE.Vector3(SMG_MAGAZINE.center[0] - .025,
        SMG_MAGAZINE.center[1] - SMG_MAGAZINE.size[1] / 2 - .007, SMG_MAGAZINE.center[2]);
      if (fraction > .75 && fraction < .8) {
        expected.y += .012 * Math.sin((fraction - .75) / .05 * Math.PI);
      }
      assert.ok(contact.distanceTo(expected) < 1e-10);
    }
  }
  state.elapsed = 3.2 * .39;
  const removed = machineGunReloadPose(state, { firstPerson: true });
  assert.equal(removed.feedVisible, true);
  assert.equal(removed.spareVisible, false);
  state.elapsed = 3.2 * .41;
  const transfer = machineGunReloadPose(state, { firstPerson: true });
  assert.equal(transfer.feedVisible, false);
  assert.equal(transfer.spareVisible, true);
  assert.equal(transfer.stage, 'retrieve');
  state.elapsed = 3.2 * .7;
  const seating = machineGunReloadPose(state, { firstPerson: true });
  assert.equal(seating.stage, 'seat');
  assert.equal(seating.spareVisible, true);
  state.elapsed = 3.2 - .001;
  advanceRifle(state, .0005);
  assert.equal(state.action, 'reload');
  assert.equal(state.ammo, 0);
  advanceRifle(state, .001);
  assert.equal(state.action, 'idle');
  assert.equal(state.ammo, 50);
});
test('near and far gun models retain the original vented shroud, side magazine and actual 810mm length', () => {
  for (const detail of ['near', 'far']) {
    const model = submachineGunModel(detail), bounds = new THREE.Box3().setFromObject(model);
    assert.ok(model.getObjectByName('feed')); assert.equal(model.userData.model, 'sigm1920');
    assert.ok(model.getObjectByName('spare-magazine'));
    assert.equal(model.getObjectByName('spare-magazine').visible, false);
    assert.equal(model.userData.referenceLength, INFANTRY_WEAPONS.sigm1920.length);
    assert.ok(Math.abs(bounds.max.z - bounds.min.z - .81) < .015);
  }
});
