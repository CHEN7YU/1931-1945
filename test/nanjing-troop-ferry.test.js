import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { NANJING_DOCK_SHIFT } from '../src/nanjing-campaign.js';
import { ferryBoardingPoints } from '../src/nanjing-ferry.js';
import { beginTroopFerryBoarding, advanceTroopFerryBoarding, syncTroopFerryPassengers,
  troopFerryReady, troopFerryWaitPoint, playerTroopFerryReady, completeTroopFerryCrossing, startFinalBoardingFireBuffer,
  finalBoardingFireHeld, finalBoardingDamageHeld, FINAL_BOARDING_FIRE_BUFFER_SECONDS, retainTroopFerryCasualty,
  syncTroopFerryCorpses } from '../src/nanjing-troop-ferry.js';

function fixture(count = 1) {
  const ferry = new Group(); ferry.position.set(-76 + NANJING_DOCK_SHIFT, .05, -80);
  ferry.userData = { ferryId: 0, state: 'docked', boarding: null };
  const actors = Array.from({ length: count }, (_, index) => ({ id: `soldier-${index}`, index,
    team: 'friendly', playerUnit: false, health: 100, vehicleId: null, tactics: {}, locomotion: {},
    traversal: { kind: 'grounded' }, position: new Vector3(-71.8 + NANJING_DOCK_SHIFT + index * .01, .36, -80), walkPhase: 0 }));
  const route = (_actor, shore) => [{ ...shore, y: .36 }];
  const board = time => {
    if (!beginTroopFerryBoarding(ferry, actors, time, route)) return false;
    for (let step = 0; ferry.userData.troopBoarding && step < 200; step++) advanceTroopFerryBoarding(ferry, .05);
    assert.equal(ferry.userData.troopBoarding, null);
    return true;
  };
  return { ferry, actors, route, board };
}

test('a failed shore route is retried later without starving other soldiers or retrying every frame', () => {
  const { ferry, actors } = fixture(2);
  let attempts = 0;
  const route = (actor, shore) => {
    attempts++;
    return actor === actors[0] ? null : [{ ...shore, y: .36 }];
  };
  assert.equal(beginTroopFerryBoarding(ferry, actors, 0, route), false);
  assert.equal(beginTroopFerryBoarding(ferry, actors, .5, route), false);
  assert.equal(attempts, 1);
  assert.equal(beginTroopFerryBoarding(ferry, actors, 1, route), true);
  assert.equal(ferry.userData.troopBoarding.actor, actors[1]);
  assert.equal(attempts, 2);
  ferry.userData.troopBoarding = null;
  assert.equal(beginTroopFerryBoarding(ferry, [actors[0]], 9.9, route), false);
  assert.equal(beginTroopFerryBoarding(ferry, [actors[0]], 10, route), false);
  assert.equal(attempts, 3);
});

test('final boarding gives one bounded simulation-time fire buffer only after actual player boarding begins', () => {
  const campaign = { stage: 'withdrawal-to-boats', embarkFireBufferStartedAt: null, embarkFireBufferUntil: 0 };
  const actor = { health: 100, playerUnit: true, tactics: {} };
  assert.equal(startFinalBoardingFireBuffer(campaign, actor, 10), false);
  actor.tactics.nanjingFerry = { phase: 'boarding', ferryId: 0 };
  assert.equal(startFinalBoardingFireBuffer(campaign, actor, 10), true);
  assert.equal(finalBoardingFireHeld(campaign, 10), true);
  assert.equal(finalBoardingFireHeld(campaign, 10 + FINAL_BOARDING_FIRE_BUFFER_SECONDS - .001), true);
  assert.equal(finalBoardingFireHeld(campaign, 10 + FINAL_BOARDING_FIRE_BUFFER_SECONDS), false);
  const until = campaign.embarkFireBufferUntil;
  actor.tactics.nanjingFerry.phase = 'aboard';
  assert.equal(startFinalBoardingFireBuffer(campaign, actor, 11), false);
  actor.tactics.nanjingFerry.phase = 'boarding';
  assert.equal(startFinalBoardingFireBuffer(campaign, actor, 30), false);
  assert.equal(campaign.embarkFireBufferUntil, until, 'Y, another boarding or a death/redeployment cannot extend the same buffer');
  campaign.stage = 'dock-defense';
  assert.equal(finalBoardingFireHeld(campaign, 11), false);
  assert.equal(finalBoardingFireHeld(null, 11), false);
  assert.throws(() => finalBoardingFireHeld(campaign, NaN), /simulation time/);
});

test('confirmed player boarding holds enemy fire through the entire crossing and rejects in-flight hostile damage', () => {
  const campaign = { stage: 'withdrawal-to-boats', playerBoardingBoatId: null,
    embarkFireBufferStartedAt: null, embarkFireBufferUntil: 0 };
  const enemy = { team: 'enemy' }, friendly = { team: 'friendly' };
  assert.equal(finalBoardingFireHeld(campaign, 100), false, 'merely waiting at the dock is not protected');
  campaign.playerBoardingBoatId = 0;
  for (const time of [100, 116, 200, 400]) {
    assert.equal(finalBoardingFireHeld(campaign, time), true, 'ferry zero is valid and crossing has no timeout');
    assert.equal(finalBoardingDamageHeld(campaign, time, enemy, friendly), true);
    assert.equal(finalBoardingDamageHeld(campaign, time, friendly, enemy), false);
    assert.equal(finalBoardingDamageHeld(campaign, time, 'fall', friendly), false);
  }
  campaign.stage = 'dock-defense';
  assert.equal(finalBoardingFireHeld(campaign, 100), false);
  assert.equal(finalBoardingDamageHeld(campaign, 100, enemy, friendly), false);
  campaign.stage = 'withdrawal-to-boats'; campaign.playerBoardingBoatId = null;
  assert.equal(finalBoardingFireHeld(campaign, 100), false, 'redeployment clears protection with the selected boat');
  assert.equal(finalBoardingDamageHeld(null, 100, enemy, friendly), false, 'other maps retain their damage rules');
});

test('a boarded casualty keeps its actual deck support and moves with the original boat without being evacuated', () => {
  const { ferry, actors, board } = fixture();
  assert.equal(board(0), true);
  const actor = actors[0], original = actor.position.clone();
  actor.health = 0; actor.heading = .7;
  assert.equal(retainTroopFerryCasualty(ferry, actor), true);
  assert.equal(retainTroopFerryCasualty(ferry, actor), true);
  assert.equal(ferry.userData.troopCorpses.length, 1);
  syncTroopFerryPassengers(ferry);
  assert.equal(ferry.userData.troopPassengers.length, 0);
  assert.deepEqual(completeTroopFerryCrossing(ferry), []);
  const local = ferry.worldToLocal(original.clone());
  ferry.position.x -= 10; ferry.position.y += .1; ferry.rotation.y = .4;
  syncTroopFerryCorpses(ferry);
  assert.ok(ferry.worldToLocal(actor.position.clone()).distanceTo(local) < 1e-9);
  assert.ok(Math.abs(actor.heading - 1.1) < 1e-9);
  assert.equal(actor.health, 0); assert.ok(actor.tactics.corpseFerry);
  actor.corpseRemoved = true; syncTroopFerryCorpses(ferry);
  assert.equal(ferry.userData.troopCorpses.length, 0);
});

test('a dead soldier still on the shore-side boarding route is not incorrectly attached to the ferry', () => {
  const { ferry, actors, route } = fixture();
  assert.equal(beginTroopFerryBoarding(ferry, actors, 0, route), true);
  const actor = actors[0]; actor.health = 0;
  assert.equal(retainTroopFerryCasualty(ferry, actor), false);
  assert.equal(actor.tactics.corpseFerry, undefined);
});

test('a casualty on the actual boarding plank stays on that fixed support, not the moving boat or the water', () => {
  const { ferry, actors, route } = fixture();
  const plank = new Mesh(new BoxGeometry(2.4, .12, .8), new MeshBasicMaterial());
  plank.position.set(-73.2 + NANJING_DOCK_SHIFT, .42, -80); ferry.userData.gangplank = plank;
  beginTroopFerryBoarding(ferry, actors, 0, route);
  const actor = actors[0]; actor.health = 0; actor.heading = 0;
  actor.position.set(-73.2 + NANJING_DOCK_SHIFT, .45, -80);
  assert.equal(retainTroopFerryCasualty(ferry, actor), true);
  assert.equal(actor.tactics.corpseFerry.support, 'gangplank');
  assert.ok(Math.abs(actor.position.y - .48) < 1e-6);
  const original = actor.position.clone();
  ferry.position.x -= 10; syncTroopFerryCorpses(ferry);
  assert.ok(actor.position.distanceTo(original) < 1e-6);
  plank.visible = false;
  syncTroopFerryCorpses(ferry, { dt: .1, groundAt: () => -1 });
  assert.ok(actor.position.y < original.y && actor.position.y > -1, 'loss of real support falls, not teleports');
  for (let i = 0; i < 10; i++) syncTroopFerryCorpses(ferry, { dt: .1, groundAt: () => -1 });
  assert.equal(actor.position.y, -1);
  assert.equal(actor.tactics.corpseFerry, undefined);
  assert.deepEqual(completeTroopFerryCrossing(ferry), []);
});
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
  ferry.position.x = -144 + NANJING_DOCK_SHIFT;
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
  const player = actors[0], shore = ferryBoardingPoints(ferry).shore;
  player.playerUnit = true; player.position.set(shore.x, .36, shore.z);
  assert.equal(beginTroopFerryBoarding(ferry, [player], 0, () => [], true), true);
  const before = player.position.clone(); advanceTroopFerryBoarding(ferry, .05);
  assert.ok(player.position.distanceTo(before) <= .160001);
  assert.ok(player.position.x < before.x);
});

test('soldiers select an available ferry and leave the reserved player seat free', () => {
  const ferries = Array.from({ length: 5 }, (_, id) => {
    const ferry = new Group();
    ferry.position.set(-76 + NANJING_DOCK_SHIFT, .05, -86 + id * 3);
    ferry.userData = { ferryId: id, state: 'docked', troopPassengers: [] };
    return ferry;
  });
  const actor = fixture().actors[0];
  assert.deepEqual(troopFerryWaitPoint(actor, ferries, 0), { ...ferryBoardingPoints(ferries[0]).shore, transit: true });
  ferries[0].userData.troopPassengers = Array.from({ length: 9 }, () => ({}));
  assert.deepEqual(troopFerryWaitPoint(actor, ferries, 0), { ...ferryBoardingPoints(ferries[1]).shore, transit: true });
  ferries[1].userData.state = 'outbound';
  assert.deepEqual(troopFerryWaitPoint(actor, ferries, 0), { ...ferryBoardingPoints(ferries[2]).shore, transit: true });
  assert.deepEqual(troopFerryWaitPoint(actor, ferries), { ...ferryBoardingPoints(ferries[0]).shore, transit: true });
});

test('player boat leaves when the actual player finishes boarding, independent of other boats and soldiers', () => {
  const { ferry, actors, route } = fixture(2), [player, teammate] = actors;
  const campaign = { playerBoardingBoatId: 0 };
  player.playerUnit = teammate.playerUnit = true;
  assert.equal(beginTroopFerryBoarding(ferry, [player], 0, route, true), true);
  assert.equal(playerTroopFerryReady(ferry, player, campaign), false);
  while (ferry.userData.troopBoarding) advanceTroopFerryBoarding(ferry, .05);
  assert.equal(playerTroopFerryReady(ferry, player, campaign), true, 'teammate is still ashore');
  campaign.playerBoardingBoatId = 1;
  assert.equal(playerTroopFerryReady(ferry, player, campaign), false);
  campaign.playerBoardingBoatId = 0;
  ferry.userData.troopPassengers = [];
  assert.equal(playerTroopFerryReady(ferry, player, campaign), false, 'a stale aboard phase is not a real passenger');
  ferry.userData.troopPassengers = [{ actor: player }];
  ferry.userData.troopBoarding = { actor: teammate };
  assert.equal(playerTroopFerryReady(ferry, player, campaign), false, 'do not leave a person on the gangplank');
  ferry.userData.troopBoarding = null;
  player.health = 0;
  assert.equal(playerTroopFerryReady(ferry, player, campaign), false);
});
