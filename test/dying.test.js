import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDying, dyingExpired, dyingActionAllowed, dyingMask, lastStandThrowable } from '../src/dying.js';
import { createRifleState, reloadRifle, shootRifle } from '../src/rifle-action.js';

test('dying uses 1.5 simulation seconds, cannot reset, and reserves movement and handoff', () => {
  const actor = { health: 50, grenades: {} };
  assert.equal(beginDying(actor, 10, { soldierId: 'enemy' }), true);
  assert.equal(beginDying(actor, 11, null), false);
  assert.equal(dyingExpired(actor, 11.49), false); assert.equal(dyingExpired(actor, 11.5), true);
  for (const action of ['look', 'pressFire', 'equipGrenade', 'prepareGrenade', 'releaseGrenade']) assert.equal(dyingActionAllowed(actor, action), true);
  for (const action of ['reload', 'cycleMember', 'jump', 'interact', 'crouch']) assert.equal(dyingActionAllowed(actor, action), false);
  assert.ok(dyingMask(actor, 11.4).dark > dyingMask(actor, 10.1).dark);
  assert.equal(actor.dying.source.soldierId, 'enemy');
});

test('last stand cancels existing or queued reloads without granting ammunition or starting a throwable', () => {
  for (const action of ['idle', 'cycle']) {
    const rifle = createRifleState(); rifle.ammo = 2; rifle.action = action;
    reloadRifle(rifle);
    const actor = { health: 50, rifle, grenades: { ammo: 1, packs: 1, action: null } };
    beginDying(actor, 10, {});
    assert.equal(rifle.queuedReload, false);
    assert.notEqual(rifle.action, 'reload');
    assert.equal(rifle.ammo, 2);
    assert.equal(actor.dying.action, null);
    assert.equal(lastStandThrowable(actor, 'explosive-pack'), 'explosive-pack');
    assert.equal(lastStandThrowable(actor), 'grenade');
    actor.grenades.ammo = 0;
    assert.equal(lastStandThrowable(actor), 'explosive-pack');
    actor.grenades.packs = 0;
    assert.equal(lastStandThrowable(actor), null);
    assert.equal(actor.grenades.action, null, 'selection never pulls a pin');
  }
  const actor = { health: 50, grenades: { ammo: 0, packs: 1, action: { kind: 'grenade' } } };
  beginDying(actor, 0, {});
  assert.equal(lastStandThrowable(actor), null, 'never replace a primed throwable');
  assert.equal(actor.dying.action, 'throw');
});

test('a last loaded shot or an empty trigger cannot restart a wounded soldier reload', () => {
  const rifle = createRifleState(); rifle.ammo = 1;
  assert.equal(shootRifle(rifle, false), true);
  assert.equal(rifle.queuedReload, false);
  assert.equal(rifle.ammo, 0);
  rifle.action = 'idle';
  assert.equal(shootRifle(rifle, false), false);
  assert.equal(rifle.action, 'idle');
});
