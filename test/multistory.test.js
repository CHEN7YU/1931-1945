import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { makeTownLayout } from '../src/town-layout.js';
import { createWalkSupport, STOREY_HEIGHT, multistoryPath, floorDestination } from '../src/multistory.js';
import { groundHeight } from '../src/ground.js';
import { circleBlocked, createNavigator } from '../src/core.js';
import { advanceLocomotion, createLocomotion } from '../src/locomotion.js';

const town = makeTownLayout(), support = createWalkSupport(town.pieces, groundHeight);
const buildings = town.buildings.filter(building => building.storeys > 1);
function walk(position, target, radius = .4) {
  for (let i = 0; i < 2000; i++) {
    const dx = target.x - position.x, dz = target.z - position.z, distance = Math.hypot(dx, dz);
    if (distance < .015) break;
    const step = Math.min(.025, distance);
    support.move(position, dx / distance * step, dz / distance * step, radius, town.obstacles);
  }
  assert.ok(Math.hypot(position.x - target.x, position.z - target.z) < .02,
    JSON.stringify({ position, target }));
}

test('the town mixes low homes, two-storey shops and accessible three/four-storey landmarks', () => {
  assert.equal(buildings.length, 7);
  assert.equal(town.buildings.filter(building => building.storeys === 1).length, 18);
  assert.equal(town.buildings.find(building => building.id === 'canal-south-depot').storeys, 4);
  for (const building of buildings) {
    assert.equal(building.stairs.length, building.storeys - 1);
    assert.equal(building.height, building.storeys * STOREY_HEIGHT);
  }
});

test('a standing capsule walks every flight to the highest floor and back without teleportation', () => {
  for (const building of buildings) {
    const position = { ...building.stairs[0].lower };
    for (const flight of building.stairs) {
      walk(position, flight.lower);
      for (const waypoint of flight.path) walk(position, waypoint);
      assert.ok(Math.abs(position.y - flight.upper.y) < 1e-6, building.id);
      walk(position, { x: building.x - 1, z: flight.upper.z + .7 });
      assert.ok(Math.abs(position.y - flight.upper.y) < 1e-6);
    }
    for (const flight of building.stairs.toReversed()) {
      walk(position, flight.upper);
      for (const waypoint of flight.path.toReversed()) walk(position, waypoint);
      assert.ok(Math.abs(position.y - flight.lower.y) < 1e-6, building.id);
    }
    assert.equal(position.y, 0);
  }
});

test('support chooses the occupied storey, never the roof or a floor above a ground-level soldier', () => {
  const building = buildings.find(item => item.storeys === 4), x = building.x - 1, z = building.z + 2;
  assert.equal(support.heightAt(x, z, 0), 0);
  for (let level = 1; level < 4; level++) {
    const y = level * STOREY_HEIGHT;
    assert.ok(Math.abs(support.heightAt(x, z, y) - y) < 1e-6);
    assert.equal(support.heightAt(x, z, y), support.heightAt(x, z, support.heightAt(x, z, y)));
  }
  assert.equal(circleBlocked(x, z, .4, town.obstacles, 9.6), false);
  assert.equal(circleBlocked(building.x + building.w / 2, building.z + 2, .4, town.obstacles, 9.6), true);
  assert.ok(Math.abs(floorDestination({ x, z, y: 30 }, { x, z }, town.buildings).y - 9.6) < 1e-6,
    'orders aimed at roofs cannot route to a nonexistent flight');
});

test('real floor slabs, window openings and upper walls stop or pass descending rifle rays', () => {
  const building = buildings.find(item => item.storeys === 4);
  const material = new MeshBasicMaterial(), geometry = new BoxGeometry();
  const solids = town.pieces.filter(piece => piece.id.startsWith(`${building.id}-`)).map(piece => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(piece.x, piece.y, piece.z); mesh.scale.set(piece.w, piece.h, piece.d);
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  const trace = (from, to) => {
    const direction = to.clone().sub(from), ray = new Raycaster(from, direction.clone().normalize(), 0, direction.length());
    return ray.intersectObjects(solids);
  };
  const floor = 3 * STOREY_HEIGHT;
  const muzzle = new Vector3(building.x - building.w / 4, floor + 1.4, building.z - building.d / 2 + .65);
  assert.equal(trace(muzzle, new Vector3(muzzle.x, 1.3, building.z - 65)).length, 0, 'fourth-floor window permits an actual downhill shot');
  const wall = muzzle.clone(); wall.x = building.x;
  assert.ok(trace(wall, new Vector3(wall.x, 1.3, building.z - 65)).length > 0, 'wall between windows blocks the same shot');
  assert.ok(trace(new Vector3(building.x - 1, floor + 1.4, building.z),
    new Vector3(building.x - 1, 1.3, building.z)).length > 0, 'floors stop downward shots');
  geometry.dispose(); material.dispose();
});

test('ordinary locomotion uses layered support and does not walk through a high window sill', () => {
  const building = buildings.find(item => item.storeys === 4), flight = building.stairs.at(-1);
  const position = { ...flight.upper }, motion = createLocomotion();
  for (let i = 0; i < 120; i++) advanceLocomotion(motion, position,
    { type: 'infantry', forward: 1, yaw: Math.PI, stance: 'standing' }, town.obstacles, 1 / 60, support.move);
  assert.equal(position.y, flight.upper.y);
  assert.ok(position.z < building.z + building.d / 2 - .45);
  assert.ok(position.z > flight.upper.z + 1);
});

test('AI routes between storeys and descends safely after a mid-stair control switch', () => {
  const navigate = createNavigator(town.obstacles);
  for (const building of buildings) {
    const position = { ...building.stairs[0].lower };
    const anchor = { x: building.x - 1, y: (building.storeys - 1) * STOREY_HEIGHT, z: building.z + 2 };
    const goal = floorDestination(anchor, { x: anchor.x + 10, z: anchor.z + 10 }, town.buildings);
    const up = multistoryPath(position, goal, town.buildings, navigate);
    assert.ok(up.length >= building.stairs.length * 3);
    for (const waypoint of up) walk(position, waypoint, .42);
    assert.ok(Math.abs(position.y - goal.y) < 1e-6);
    const down = multistoryPath(position, building.stairs[0].lower, town.buildings, navigate);
    for (const waypoint of down) walk(position, waypoint, .42);
    assert.equal(position.y, 0);
    walk(position, { ...building.stairs[0].path[1], z: building.stairs[0].path[1].z + 1.4 }, .42);
    assert.ok(position.y > 0 && position.y < STOREY_HEIGHT);
    const partial = multistoryPath(position, building.stairs[0].lower, town.buildings, navigate);
    for (const waypoint of partial) walk(position, waypoint, .42);
    assert.equal(position.y, 0);
  }
});
