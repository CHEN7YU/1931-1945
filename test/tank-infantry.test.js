import test from 'node:test';
import assert from 'node:assert/strict';
import { tankSweptContact, chooseTankEvasion } from '../src/tank-infantry.js';
import { CHI_HA } from '../src/chi-ha.js';

const tank = (team = 'friendly') => ({ id: 'tank', type: 'tank', team, health: 100,
  position: { x: 0, y: 0, z: -6 }, heading: 0, groundMotion: { x: 0, z: -4, turn: 0 } });
const soldier = (team = 'enemy') => ({ id: 'soldier', team, health: 100,
  position: { x: 0, y: 0, z: -3 }, stance: 'standing', vehicleId: null });
test('moving hulls sweep both factions, reverse and turn without tunneling, but stationary contact is not lethal', () => {
  for (const team of ['friendly', 'enemy']) for (const variant of [null, CHI_HA.id]) {
    const vehicle = { ...tank(team), variant }, start = { x: 0, y: 0, z: 0, heading: 0 };
    for (const targetTeam of ['friendly', 'enemy']) {
      assert.equal(tankSweptContact(vehicle, start, soldier(targetTeam), .5), true);
    }
    assert.equal(tankSweptContact(vehicle, { ...vehicle.position, heading: 0 }, soldier(), .5), false);
    vehicle.position.z = 6;
    assert.equal(tankSweptContact(vehicle, start, { ...soldier(), position: { x: 0, y: 0, z: 3 } }, .5), true);
    vehicle.position.z = 0; vehicle.heading = Math.PI / 2;
    assert.equal(tankSweptContact(vehicle, start, { ...soldier(), position: { x: 2.4, y: 0, z: 0 } }, .5), true);
  }
});
test('crushing respects crew, casualties, bridge levels, lateral clearance and timestep zero', () => {
  const vehicle = tank(), start = { x: 0, y: 0, z: 0, heading: 0 };
  assert.equal(tankSweptContact(vehicle, start, { ...soldier(), vehicleId: 'tank' }, 1), false);
  assert.equal(tankSweptContact(vehicle, start, { ...soldier(), health: 0 }, 1), false);
  assert.equal(tankSweptContact(vehicle, start, { ...soldier(), position: { x: 0, y: 3.2, z: -3 } }, 1), false);
  assert.equal(tankSweptContact(vehicle, start, { ...soldier(), position: { x: 4, y: 0, z: -3 } }, 1), false);
  assert.equal(tankSweptContact(vehicle, start, soldier(), 0), false);
  assert.throws(() => tankSweptContact(vehicle, start, soldier(), NaN), RangeError);
});
test('both factions dodge approaching tanks of either team but not unseen tanks behind walls or stationary hulls', () => {
  for (const vehicleTeam of ['friendly', 'enemy']) for (const team of ['friendly', 'enemy']) {
    const vehicle = tank(vehicleTeam); vehicle.position.z = 0;
    const actor = soldier(team); actor.position.z = -5;
    const goal = chooseTankEvasion(actor, [vehicle], { visible: () => true, clear: () => true });
    assert.ok(goal);
    assert.ok(Math.abs(goal.x) > 3);
    assert.equal(chooseTankEvasion(actor, [vehicle], { visible: () => false, clear: () => true }), null);
    assert.equal(chooseTankEvasion(actor, [vehicle], { visible: () => true, clear: () => false }), null);
    vehicle.groundMotion = { x: 0, z: 0, turn: 0 };
    assert.equal(chooseTankEvasion(actor, [vehicle], { visible: () => true, clear: () => true }), null);
  }
});
test('evasion supports reversing tanks and rejects a different-floor hazard', () => {
  const vehicle = tank(); vehicle.position.z = 0; vehicle.groundMotion.z = 4;
  const actor = soldier(); actor.position.z = 5;
  assert.ok(chooseTankEvasion(actor, [vehicle], { visible: () => true, clear: () => true }));
  actor.position.y = 3.2;
  assert.equal(chooseTankEvasion(actor, [vehicle], { visible: () => true, clear: () => true }), null);
});
