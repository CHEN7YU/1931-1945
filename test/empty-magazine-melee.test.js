import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMagazineMeleeCandidate, createBayonetState, meleeEngagementRange } from '../src/bayonet.js';
import { createDadaoState } from '../src/dadao.js';
import { createRifleState, cancelEmptyRifleReload, advanceRifle, shootRifle } from '../src/rifle-action.js';
const fixture = team => ({ id: team, team, health: 100, groundType: 'infantry',
  position: { x: 0, y: 0, z: 0 }, rifle: { ...createRifleState(), ammo: 0 },
  dadao: team === 'friendly' ? createDadaoState() : null, bayonet: createBayonetState() });
test('both sides prioritize an available blade at 12 metres only when empty and on the same accessible floor', () => {
  for (const team of ['friendly', 'enemy']) {
    const actor = fixture(team), target = { id: 'target', team: team === 'friendly' ? 'enemy' : 'friendly',
      targetKind: 'person', health: 100, position: { x: 0, y: 0, z: -12 } };
    assert.equal(emptyMagazineMeleeCandidate(actor, target), true);
    actor.rifle.ammo = 1; assert.equal(emptyMagazineMeleeCandidate(actor, target), false);
    assert.equal(meleeEngagementRange(actor, target), 8);
    actor.rifle.ammo = 0;
    for (const patch of [{ health: 0 }, { vehicleId: 'tank' }, { team }, { targetKind: 'closed-armor' },
      { position: { x: 0, y: 3, z: -2 } }, { position: { x: 0, y: 0, z: -12.01 } }])
      assert.equal(emptyMagazineMeleeCandidate(actor, { ...target, ...patch }), false);
  }
});
test('interrupting an empty queued or active reload never refills ammo, refunds shots or skips the firing cycle', () => {
  for (const model of ['rifle', 'sigm1920', 'zb26', 'type11']) {
    const rifle = createRifleState(model); rifle.ammo = 1; shootRifle(rifle);
    const shots = rifle.shots;
    cancelEmptyRifleReload(rifle);
    assert.equal(rifle.action, 'cycle'); assert.equal(rifle.queuedReload, false);
    advanceRifle(rifle, .7); assert.equal(rifle.action, 'idle'); assert.equal(rifle.ammo, 0);
    Object.assign(rifle, { action: 'reload', elapsed: .6, reloadUntil: 5 });
    assert.equal(cancelEmptyRifleReload(rifle), true);
    advanceRifle(rifle, 10); assert.equal(rifle.ammo, 0); assert.equal(rifle.shots, shots);
    assert.equal(rifle.reloadUntil, 0);
  }
});
