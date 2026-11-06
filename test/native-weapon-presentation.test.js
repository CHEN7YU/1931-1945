import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSupportWeaponPresentation } from '../src/native-weapon-presentation.js';

test('support operation hides the owned rifle but release, casualties and ordinary infantry restore it', () => {
  const actor = { health: 100, emplacementId: 'fixed-mg' };
  assert.equal(nativeSupportWeaponPresentation(actor), true);
  assert.equal(nativeSupportWeaponPresentation({ ...actor, emplacementId: null }), false);
  assert.equal(nativeSupportWeaponPresentation({ ...actor, health: 0 }), false);
  assert.equal(nativeSupportWeaponPresentation({ ...actor, vehicleId: 'tank' }), false);
  assert.equal(nativeSupportWeaponPresentation({ health: 100 }), false);
  assert.equal(nativeSupportWeaponPresentation({ health: 100,
    discharger: { presentationActive: true }, tactics: { mode: 'operate-grenade-discharger' } }), true);
});
