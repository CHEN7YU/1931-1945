import test from 'node:test';
import assert from 'node:assert/strict';
import { updateFootContacts } from '../src/foot-contact.js';

const gait = { jog: 0, walkStride: 1.25, runStride: 1.6, walkContact: .52,
  runContact: .4, walkClearance: .04, heelHeight: .2 };
const makeActor = () => ({ health: 100, stance: 'standing', heading: 0,
  position: { x: 0, z: 0 }, nativeMotion: { weight: 1,
    profile: { restFeet: { left: { x: -.1, z: 0 }, right: { x: .1, z: 0 } } } } });

test('a support contact remains fixed through movement and rotation, then releases during swing', () => {
  const actor = makeActor();
  updateFootContacts(actor, gait, .1, .02);
  const anchor = { ...actor.nativeMotion.footContacts.left };
  assert.ok(anchor);
  actor.position.z -= .1; actor.heading = .3;
  updateFootContacts(actor, gait, .2, .1);
  assert.deepEqual(actor.nativeMotion.footContacts.left, anchor);
  updateFootContacts(actor, gait, .6, .1);
  assert.equal(actor.nativeMotion.footContacts.left, null);
});

test('contacts clear on teleports, low stances, vehicles, moving ferries and stopping transitions', () => {
  for (const change of [{ traveled: 1 }, { stance: 'crouched' }, { vehicleId: 'tank' },
    { ferry: 'boarding' }, { ferry: 'aboard' }, { weight: .2 }]) {
    const actor = makeActor();
    updateFootContacts(actor, gait, .1, .02);
    if (change.stance) actor.stance = change.stance;
    if (change.vehicleId) actor.vehicleId = change.vehicleId;
    if (change.ferry) actor.tactics = { nanjingFerry: { phase: change.ferry } };
    if (change.weight) actor.nativeMotion.weight = change.weight;
    updateFootContacts(actor, gait, .2, change.traveled ?? .02);
    assert.equal(actor.nativeMotion.footContacts, null);
  }
});
