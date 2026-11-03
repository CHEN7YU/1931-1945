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
