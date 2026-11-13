import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ferryVisibility, updateFerryVisibility, restoreFerryPassenger, NANJING_FERRY_ROUTE,
  shouldDepartNanjingFerry, selectCivilianBoarding } from '../src/nanjing-ferry.js';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { rejoinCivilianRoute } from '../src/civilian-crowd.js';
import { segmentClear } from '../src/core.js';

test('ferries fade at a distant water horizon rather than the old visible opposite bank', () => {
  assert.equal(ferryVisibility(-98), 1);
  assert.equal(ferryVisibility(NANJING_FERRY_ROUTE.visibleStartX), 1);
  assert.equal(ferryVisibility((NANJING_FERRY_ROUTE.visibleStartX + NANJING_FERRY_ROUTE.hiddenX) / 2), .5);
  assert.equal(ferryVisibility(NANJING_FERRY_ROUTE.hiddenX), 0);
  assert.throws(() => ferryVisibility(NaN), RangeError);
});

test('partly loaded boats stop waiting for distant civilians but never leave during a physical boarding action', () => {
  const ferry = { userData: { boarding: null, loadedAt: 10 } }, boat = { passengers: 2, returning: false };
  assert.equal(shouldDepartNanjingFerry(ferry, boat, 24.9, false, 8), false);
  assert.equal(shouldDepartNanjingFerry(ferry, boat, 25, false, 8), true);
  ferry.userData.boarding = { civilian: {} };
  assert.equal(shouldDepartNanjingFerry(ferry, boat, 30, true, 0), false);
  ferry.userData.boarding = null;
  assert.equal(shouldDepartNanjingFerry(ferry, boat, 11, true, 0), true);
  boat.passengers = 0;
  assert.equal(shouldDepartNanjingFerry(ferry, boat, 30, true, 0), false);
  boat.passengers = 2; boat.returning = true;
  assert.equal(shouldDepartNanjingFerry(ferry, boat, 30, true, 0), false);
});

test('waiting civilians are distributed across available boats and an unreachable candidate can be retried later', () => {
  const ferries = Array.from({ length: 5 }, (_, id) => ({
    position: { x: -76, z: -86 + id * 3 },
    userData: { ferryId: id, state: 'docked', boarding: null },
  }));
  const campaign = { dockActivated: true, boardingClock: 1,
    boats: ferries.map((_, id) => ({ id, passengers: 0, returning: false })) };
  const queue = ferries.map((ferry, id) => ({
    position: { x: -71, z: ferry.position.z }, userData: { civilianId: id },
  }));
  for (let id = 0; id < 5; id++) {
    campaign.boardingClock = 1;
    const selected = selectCivilianBoarding(campaign, ferries, queue, id);
    assert.equal(selected.ferry, ferries[id]);
    assert.equal(selected.civilian.userData.civilianId, id);
    ferries[id].userData.boarding = { civilian: selected.civilian };
    queue.splice(queue.indexOf(selected.civilian), 1);
  }
  assert.equal(selectCivilianBoarding(campaign, ferries, queue, 5), null);
  ferries[0].userData.boarding = null;
  const blocked = { position: { x: -71, z: -86 }, userData: { civilianId: 10 } };
  const alternate = { position: { x: -70, z: -86 }, userData: { civilianId: 11 } };
  queue.push(blocked, alternate);
  ferries[0].userData.civilianRouteRetry = new Map([[10, 15]]);
  campaign.boardingClock = 1;
  assert.equal(selectCivilianBoarding(campaign, ferries, queue, 6).civilian, alternate);
  campaign.boardingClock = 1;
  assert.equal(selectCivilianBoarding(campaign, ferries, queue, 15).civilian, blocked);
  campaign.boats[0].returning = true;
  campaign.boardingClock = 1;
  assert.equal(selectCivilianBoarding(campaign, ferries, queue, 16), null);
});

test('boat and passenger fades never change shared city or civilian materials and restore the original passenger resources', () => {
  const shared = new THREE.MeshStandardMaterial(), ferry = new THREE.Group(), passenger = new THREE.Group();
  const boat = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  const body = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  passenger.add(body); ferry.add(boat, passenger);
  ferry.position.x = -128;
  updateFerryVisibility(ferry);
  assert.equal(shared.opacity, 1);
  assert.equal(shared.transparent, false);
  assert.equal(boat.material.opacity, .5);
  assert.equal(body.material.opacity, .5);
  assert.notEqual(body.material, shared);
  restoreFerryPassenger(passenger);
  assert.equal(body.material, shared);
  ferry.position.x = NANJING_FERRY_ROUTE.hiddenX; passenger.removeFromParent();
  updateFerryVisibility(ferry);
  assert.equal(ferry.visible, false);
  ferry.position.x = -128; updateFerryVisibility(ferry);
  assert.equal(ferry.visible, true); assert.equal(boat.material.opacity, .5);
  ferry.position.x = -76; updateFerryVisibility(ferry);
  assert.equal(boat.material.opacity, 1); assert.equal(boat.material.transparent, false);
});

test('the real river view has no western land or embankment and the reported 87th civilian has a collision-safe boarding connection', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const water = scene.children.filter(object => object.userData.nanjingFeature === 'river-water');
  for (const [x, z] of [[-98,-80],[-150,-80],[-500,-80],[-100,52],[-500,200]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0),0,20);
    assert.ok(ray.intersectObjects(water,false).length,`actual visible water at ${x},${z}`);
    const land = scene.children.filter(object => ['dry-ground-surface','river-stone-bank']
      .includes(object.userData.nanjingFeature));
    assert.equal(ray.intersectObjects(land,false).length,0,`no opposite land at ${x},${z}`);
  }
  const start = {x:-72.63022417191681,z:-86.82845379539327}, target={x:-72.2,z:-86};
  assert.deepEqual(world.civilianNavigate(start,target),[]);
  assert.equal(world.civilianNavigate.stats.reason,'blocked-start');
  const path = rejoinCivilianRoute(start,target,world.civilianNavigate,world.civilianNavigationObstacles);
  assert.ok(path?.length);
  let from=start;
  for(const point of path){
    assert.ok(segmentClear(from,point,.36,world.civilianNavigationObstacles));
    from=point;
  }
  assert.deepEqual(from,target);
});
