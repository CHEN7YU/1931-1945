import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ferryVisibility, updateFerryVisibility, restoreFerryPassenger, NANJING_FERRY_ROUTE } from '../src/nanjing-ferry.js';
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
