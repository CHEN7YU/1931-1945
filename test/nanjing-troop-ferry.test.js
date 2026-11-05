import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { beginTroopFerryBoarding, advanceTroopFerryBoarding, syncTroopFerryPassengers,
  troopFerryReady, playerFerryReady, completeTroopFerryCrossing } from '../src/nanjing-troop-ferry.js';

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
  actor.nativeMotion = { position: { x: actor.position.x, z: actor.position.z }, distance: 10 };
  for (let step = 0; step < 100; step++) {
    ferry.position.x -= .14;
    syncTroopFerryPassengers(ferry);
    const seat = ferry.userData.troopPassengers[0].local;
    assert.ok(ferry.worldToLocal(actor.position.clone()).distanceTo(seat) < 1e-8);
    assert.equal(actor.nativeMotion.position.x, actor.position.x, 'boat motion must not become an artificial walking stride');
  }
  ferry.position.x = -144;
  assert.deepEqual(completeTroopFerryCrossing(ferry), [actor]);
  assert.equal(actor.tactics.nanjingFerry.phase, 'evacuated');
});

test('the controlled passenger can look independently while staying attached, and ending deck motion preserves stance and speed', () => {
  const { ferry, actors, board } = fixture();
  board(0);
  const actor = actors[0];
  actor.heading = .8;
  ferry.rotation.y = .2;
  syncTroopFerryPassengers(ferry, actor.id);
  assert.equal(actor.heading, .8);
  assert.equal(actor.stance, 'crouched');
  const passenger = ferry.userData.troopPassengers[0];
  passenger.deckControlled = true; passenger.local.z = 0;
  actor.stance = 'standing'; actor.locomotion.speed = 1.5;
  syncTroopFerryPassengers(ferry, actor.id);
  assert.equal(actor.stance, 'standing');
  assert.equal(actor.locomotion.speed, 1.5);
  assert.ok(actor.position.distanceTo(ferry.localToWorld(passenger.local.clone())) < 1e-8);
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

test('partially loaded AI boats hold spare seats for the player instead of leaving with two or three soldiers', () => {
  const { ferry, actors, board } = fixture(3);
  for (let index = 0; index < 3; index++) board(index);
  assert.equal(troopFerryReady(ferry, actors, 200, true), false, 'elapsed loading timeout cannot discard reserved player seats');
  assert.equal(troopFerryReady(ferry, actors, 200, false), true);
});

test('a player already standing at the shore point needs no extra land route before walking onto the gangplank', () => {
  const { ferry, actors } = fixture();
  const player = actors[0]; player.playerUnit = true; player.position.set(-72.2, .36, -80);
  assert.equal(beginTroopFerryBoarding(ferry, [player], 0, () => [], true), true);
  const before = player.position.clone(); advanceTroopFerryBoarding(ferry, .05);
  assert.ok(player.position.distanceTo(before) <= .160001);
  assert.ok(player.position.x < before.x);
});

test('the player boards first within their squad and the boat waits for full capacity or every surviving squadmate', () => {
  const { ferry, actors, route, board } = fixture(3);
  for (let index = 0; index < 3; index++) board(index);
  const squad = fixture(4).actors.map((actor, index) => ({ ...actor, id: `player-${index}`, playerUnit: true }));
  const boardPerson = actor => {
    assert.equal(beginTroopFerryBoarding(ferry, [actor], 10, route, true), true);
    for (let step = 0; ferry.userData.troopBoarding; step++) advanceTroopFerryBoarding(ferry, .05);
    syncTroopFerryPassengers(ferry);
  };
  boardPerson(squad[0]);
  assert.equal(playerFerryReady(ferry, squad, squad[0].id), false);
  assert.equal(ferry.userData.troopPassengers.find(person => person.actor.playerUnit).actor.id, squad[0].id);
  for (const actor of squad.slice(1)) boardPerson(actor);
  assert.equal(ferry.userData.troopPassengers.length, 7);
  assert.equal(playerFerryReady(ferry, squad, squad[0].id), true, 'the final boat may leave below capacity once all squad AI have boarded');
  const full = fixture(10);
  for (let index = 0; index < 10; index++) full.board(index);
  full.actors[0].playerUnit = true;
  assert.equal(playerFerryReady(full.ferry, [full.actors[0], squad[0]], full.actors[0].id), true, 'a completely full player boat can leave');
});
