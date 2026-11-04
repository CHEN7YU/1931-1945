import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { beginTroopFerryBoarding, advanceTroopFerryBoarding, syncTroopFerryPassengers,
  troopFerryReady, completeTroopFerryCrossing } from '../src/nanjing-troop-ferry.js';

function fixture(count = 1) {
  const ferry = new Group(); ferry.position.set(-76, .05, -80);
  ferry.userData = { ferryId: 0, state: 'docked', boarding: null };
  const actors = Array.from({ length: count }, (_, index) => ({ id: `soldier-${index}`, index,
    team: 'friendly', playerUnit: false, health: 100, vehicleId: null, tactics: {}, locomotion: {},
    traversal: { kind: 'grounded' }, position: new Vector3(-71.8 + index * .01, .36, -80), walkPhase: 0 }));
  const route = (_actor, shore) => [{ ...shore, y: .36 }];
  const board = time => {
    if (!beginTroopFerryBoarding(ferry, actors, time, route)) return false;
    for (let step = 0; ferry.userData.troopBoarding && step < 200; step++) advanceTroopFerryBoarding(ferry, .05);
    assert.equal(ferry.userData.troopBoarding, null);
    return true;
  };
  return { ferry, actors, route, board };
}
test('being inside the dock does not evacuate a soldier: actual walking, boarding and a crossing are required', () => {
  const { ferry, actors, route } = fixture(), actor = actors[0];
  assert.equal(beginTroopFerryBoarding(ferry, actors, 0, route), true);
  assert.equal(actor.tactics.nanjingFerry.phase, 'boarding');
  for (let step = 0; ferry.userData.troopBoarding && step < 200; step++) {
    const before = actor.position.clone(); advanceTroopFerryBoarding(ferry, .05);
    assert.ok(actor.position.distanceTo(before) <= .160001, 'no boarding teleport or duplicate movement');
  }
  assert.equal(actor.tactics.nanjingFerry.phase, 'aboard');
  const before = actor.position.x; ferry.position.x -= 2; syncTroopFerryPassengers(ferry);
  assert.ok(Math.abs(actor.position.x - before + 2) < 1e-8);
  assert.equal(actor.stance, 'crouched'); assert.equal(actor.health, 100);
  ferry.position.x = -144;
  assert.deepEqual(completeTroopFerryCrossing(ferry), [actor]);
  assert.equal(actor.tactics.nanjingFerry.phase, 'evacuated');
});
test('troop ferries keep ten real seat slots, wait for boarding and allow a partially full final departure', () => {
  const { ferry, actors, board, route } = fixture(12);
  for (let index = 0; index < 10; index++) assert.equal(board(index), true);
  assert.equal(new Set(ferry.userData.troopPassengers.map(person => person.seat)).size, 10);
  assert.equal(beginTroopFerryBoarding(ferry, actors, 11, route), false);
  assert.equal(troopFerryReady(ferry, actors, 11), true);
  const final = fixture();
  assert.equal(beginTroopFerryBoarding(final.ferry, final.actors, 0, final.route), true);
  assert.equal(troopFerryReady(final.ferry, final.actors, 20), false, 'never sail while a person is on the gangplank');
  for (let step = 0; final.ferry.userData.troopBoarding; step++) advanceTroopFerryBoarding(final.ferry, .05);
  assert.equal(troopFerryReady(final.ferry, final.actors, 5), true);
});
test('casualties are not counted as evacuated, and neither the player nor an enemy can take an AI retreat seat', () => {
  const { ferry, actors, route } = fixture(3);
  actors[0].playerUnit = true; actors[1].team = 'enemy';
  assert.equal(beginTroopFerryBoarding(ferry, actors, 0, route), true);
  assert.equal(ferry.userData.troopBoarding.actor.id, actors[2].id);
  actors[2].health = 0; advanceTroopFerryBoarding(ferry, .05);
  assert.equal(ferry.userData.troopBoarding, null);
  assert.deepEqual(completeTroopFerryCrossing(ferry), []);
});
