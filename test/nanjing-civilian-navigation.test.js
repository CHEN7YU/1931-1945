import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { circleBlocked, segmentClear } from '../src/core.js';
import { obstacleLookup } from '../src/spatial.js';

test('dense Nanjing alleys connect all 180 residents to their real waiting places without shrinking collision clearance', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  assert.equal(world.civilianNavigate.stats.resolution, .5);
  assert.equal(world.civilianNavigate.stats.radius, .45);
  assert.equal(world.civilians.length, 180);
  const lookup = obstacleLookup(world.civilianNavigationObstacles, .8);
  for (const civilian of world.civilians) {
    const data = civilian.userData, route = data.homeRoute;
    assert.ok(route.length, `${data.homeId} has a complete evacuation route`);
    let from = { x: data.startX, z: data.startZ };
    for (const point of route) {
      assert.equal(circleBlocked(point.x, point.z, .36, lookup.at(point.x, point.z)), false,
        `${data.homeId} has no waypoint inside an obstacle`);
      assert.ok(segmentClear(from, point, .36, world.civilianNavigationObstacles, (x, z) => lookup.at(x, z)),
        `${data.homeId} has no wall-crossing shortcut`);
      from = point;
    }
    assert.ok(Math.hypot(from.x - data.waitingSlot.x, from.z - data.waitingSlot.z) < .015,
      `${data.homeId} must reach its actual waiting place, not a nearby fallback cell`);
  }
});

test('all sixty roadside rest places leave walkable gaps and connect to the unchanged city evacuation route', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  const lookup = obstacleLookup(world.civilianNavigationObstacles, .8);
  const refugees = world.civilians.filter(person => person.userData.openingWave);
  assert.equal(refugees.length, 60);
  for (const person of refugees) {
    const data = person.userData, rest = data.refugeeRestPoint;
    assert.ok(refugees.every(other => other === person ||
      Math.hypot(rest.x - other.userData.refugeeRestPoint.x, rest.z - other.userData.refugeeRestPoint.z) >= 1.25));
    for (const [route, start] of [[data.refugeeRestRoute, { x: data.startX, z: data.startZ }],
      [data.refugeeResumeRoute, rest]]) {
      let from = start;
      for (const point of route) {
        assert.ok(segmentClear(from, point, .36, world.civilianNavigationObstacles, (x, z) => lookup.at(x, z)));
        from = point;
      }
    }
    assert.deepEqual(data.refugeeRestRoute.at(-1), rest);
    assert.deepEqual(data.refugeeResumeRoute.at(-1), data.homeRoute.at(-1));
  }
  world.civilianFlight.encounterAt = 180;
  Object.assign(refugees[0].userData, { fleeReleased: true, resting: true, restPoseWeight: 1,
    route: refugees[0].userData.refugeeResumeRoute });
  world.resetCampaign();
  assert.equal(world.civilianFlight.encounterAt, null);
  assert.ok(refugees.every(person => !person.userData.fleeReleased && !person.userData.resting &&
    person.userData.restPoseWeight === 0 && person.userData.route === person.userData.refugeeRestRoute));
});
