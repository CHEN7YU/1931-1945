import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDying, dyingExpired, dyingActionAllowed, dyingMask } from '../src/dying.js';

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
