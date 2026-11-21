import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTownLayout, STREET_BLOCK } from '../src/town-layout.js';
import { circleBlocked, segmentClear, createNavigator, moveGround } from '../src/core.js';
import { makeBaseSpawns, spawnBlockReason } from '../src/spawns.js';
import { makeDoors, doorCollider } from '../src/doors.js';

const layout = makeTownLayout();
const navigator = createNavigator(layout.obstacles);
test('the town has twenty-five enterable buildings and preserves main street clearance', () => {
  assert.deepEqual(makeTownLayout(), layout);
  assert.equal(layout.buildings.length, 25);
  assert.equal(layout.buildings.filter(building => building.kind === 'shop').length, 11);
  assert.equal(layout.buildings.filter(building => building.kind === 'home').length, 9);
  assert.equal(layout.buildings.filter(building => building.kind === 'warehouse').length, 5);
  const westWall = layout.pieces.find(piece => piece.id === 'west-0-east-0');
  const eastWall = layout.pieces.find(piece => piece.id === 'east-0-west-0');
  const clearWidth = eastWall.x - eastWall.w / 2 - (westWall.x + westWall.w / 2);
  assert.ok(Math.abs(clearWidth - STREET_BLOCK.streetWidth) < 1e-9);
  assert.equal(STREET_BLOCK.streetWidth, 8.76);
  for (const z of [62, 43, 10]) assert.equal(segmentClear({ x: 0, z: z - 8 }, { x: 0, z: z + 8 }, 1.9, layout.obstacles), true);
});
test('street infrastructure stays beside the road and away from troop routes', () => {
  assert.equal(layout.streetFixtures.filter(fixture => fixture.kind === 'utility').length, 4);
  assert.equal(layout.streetFixtures.filter(fixture => fixture.kind === 'streetlamp').length, 2);
  for (const fixture of layout.streetFixtures) {
    assert.ok(Math.abs(fixture.x) > STREET_BLOCK.streetWidth / 2 + 5);
    assert.ok(layout.obstacles.some(obstacle => obstacle.id === fixture.id &&
      obstacle.minX < fixture.x && obstacle.maxX > fixture.x &&
      obstacle.minZ < fixture.z && obstacle.maxZ > fixture.z));
  }
  for (const z of [62, 43, 10]) {
    assert.equal(segmentClear({ x: 0, z: z - 8 }, { x: 0, z: z + 8 }, .46, layout.obstacles), true);
  }
});
test('every street door and back door has actual capsule clearance, not a hidden building box', () => {
  for (const shop of layout.buildings) {
    assert.equal(segmentClear({ x: shop.x - shop.w / 2 - 1, z: shop.doorZ }, { x: shop.x + shop.w / 2 + 1, z: shop.doorZ }, .42, layout.obstacles), true, shop.id);
    assert.equal(circleBlocked(shop.x, shop.z - .9, .42, layout.obstacles), false, 'interior partition has a real door');
    assert.equal(circleBlocked(shop.x - 3, shop.z - .9, .42, layout.obstacles), true, 'interior wall is solid beside the opening');
  }
});
test('courtyard has two passable gates and connects three rooms to the main street', () => {
  for (const z of [55, 69]) assert.equal(segmentClear({ x: -16, z: z - 1 }, { x: -16, z: z + 1 }, .46, layout.obstacles), true);
  const route = [{ x: 0, z: 64 }, { x: -8.5, z: 64 }, { x: -16, z: 64 }, { x: -23.5, z: 64 }];
  for (let i = 1; i < route.length; i++) assert.equal(segmentClear(route[i - 1], route[i], .46, layout.obstacles), true);
});
test('fine navigation takes real doors to rooms instead of crossing partition walls', () => {
  const start = { x: -2.5, z: 65 }, goal = { x: -10, z: 58.5 };
  const path = navigator(start, goal);
  assert.ok(path.length > 2);
  let last = start;
  for (const waypoint of path) {
    assert.equal(segmentClear(last, waypoint, .46, layout.obstacles), true, JSON.stringify({ last, waypoint }));
    last = waypoint;
  }
  assert.deepEqual(path.at(-1), goal);
  const actor = { ...start };
  for (const point of path) {
    for (let i = 0; i < 2000 && Math.hypot(point.x - actor.x, point.z - actor.z) > .05; i++) {
      const d = Math.hypot(point.x - actor.x, point.z - actor.z), travel = Math.min(.035, d);
      moveGround(actor, (point.x - actor.x) / d * travel, (point.z - actor.z) / d * travel, .42, layout.obstacles);
    }
    assert.ok(Math.hypot(point.x - actor.x, point.z - actor.z) < .06, 'the capsule can physically follow each path segment');
  }
});
test('registered ground spawns stay outside the new town and retain deployment clearance', () => {
  for (const spawn of makeBaseSpawns().filter(p => p.kind !== 'air')) {
    assert.equal(spawnBlockReason(spawn, spawn.kind === 'garage' ? 'tank' : 'infantry', [], layout.obstacles), null, spawn.id);
  }
});
test('back lanes and the cross street connect both rows without narrowing the main vehicle route', () => {
  const obstacles = [...layout.obstacles, ...makeDoors(layout).map(door => doorCollider(door))];
  for (const [from, to, radius] of [
    [{ x: -44, z: 52.5 }, { x: 44, z: 52.5 }, 1.9],
    [{ x: 31.75, z: 34 }, { x: 31.75, z: 74 }, 1.9],
    [{ x: -29.5, z: 52.5 }, { x: -29.5, z: 74 }, .46],
  ]) assert.equal(segmentClear(from, to, radius, obstacles), true);
  const homes = layout.buildings.filter(building => building.kind === 'home' && !building.riverSide);
  for (const home of homes) {
    assert.ok(home.z - home.d / 2 >= 36 && home.z + home.d / 2 <= 69);
    assert.ok(home.x - home.w / 2 >= -40 && home.x + home.w / 2 <= 42);
    assert.ok(layout.pieces.some(piece => piece.id === `${home.id}-bed`));
    assert.equal(layout.pieces.some(piece => piece.id === `${home.id}-counter`), false);
  }
});
test('courtyard boundaries have real gates and screen the yard beside each opening', () => {
  for (const gate of layout.passages.filter(passage => passage.width === 2.4)) {
    assert.equal(segmentClear({ x: gate.x, z: gate.z - 1 }, { x: gate.x, z: gate.z + 1 }, .46, layout.obstacles), true, gate.id);
    assert.equal(segmentClear({ x: gate.x + 1.6, z: gate.z - 1 }, { x: gate.x + 1.6, z: gate.z + 1 }, 1.3, layout.obstacles), false, gate.id);
  }
});
test('AI reaches every new back room through connected courtyards, lanes and actual doors', () => {
  for (const home of layout.buildings.filter(building => building.kind === 'home')) {
    const start = { x: 0, z: 74 }, goal = { x: home.x, z: home.z - 3.5 };
    const path = navigator(start, goal);
    assert.ok(path.length > 1, home.id);
    assert.deepEqual(path.at(-1), goal, home.id);
    const actor = { ...start };
    for (const point of path) {
      assert.equal(segmentClear(actor, point, .46, layout.obstacles), true, home.id);
      for (let i = 0; i < 4000 && Math.hypot(point.x - actor.x, point.z - actor.z) > .05; i++) {
        const distance = Math.hypot(point.x - actor.x, point.z - actor.z), step = Math.min(.035, distance);
        moveGround(actor, (point.x - actor.x) / distance * step, (point.z - actor.z) / distance * step, .42, layout.obstacles);
      }
      assert.ok(Math.hypot(point.x - actor.x, point.z - actor.z) < .06, home.id);
    }
  }
});
test('both quay streets reach the bridge without buildings or open door leaves blocking the approaches', () => {
  const obstacles = [...layout.obstacles, ...makeDoors(layout).map(door => doorCollider(door))];
  for (const z of [-8.1, -25.5]) {
    assert.equal(segmentClear({ x: -51, z }, { x: 54, z }, 1.2, obstacles), true);
  }
  assert.equal(segmentClear({ x: 8, z: 0 }, { x: 8, z: -29 }, 2.2, obstacles), true);
  const buildings = layout.buildings.filter(building => building.riverSide);
  assert.equal(buildings.length, 8);
  assert.equal(buildings.filter(building => building.riverSide < 0).length, 4);
  assert.equal(buildings.filter(building => building.riverSide > 0).length, 4);
  assert.ok(new Set(buildings.map(building => `${building.w}:${building.d}`)).size >= 4);
  for (const building of buildings) {
    const faceZ = building.z + building.riverSide * building.d / 2;
    const passage = layout.passages.find(passage => passage.id === `${building.id}-${building.riverSide}-door`);
    assert.equal(passage.axis, 'x');
    assert.equal(passage.width, building.kind === 'warehouse' ? 2.6 : 1.9);
    assert.equal(segmentClear({ x: building.x, z: faceZ + building.riverSide * 1.4 },
      { x: building.x, z: building.z + 2 }, .46, obstacles), true, building.id);
  }
});
test('riverbank ruins retain traversable breaches and collision-backed walls', () => {
  const obstacles = [...layout.obstacles, ...makeDoors(layout).map(door => doorCollider(door))];
  for (const [from, to] of [
    [{ x: -48, z: 18 }, { x: -36, z: 18 }],
    [{ x: 26.5, z: 8 }, { x: 26.5, z: 25 }],
    [{ x: -14, z: -36 }, { x: -5.8, z: -36 }],
    [{ x: -9.5, z: -25.5 }, { x: -9.5, z: -36 }],
  ]) assert.equal(segmentClear(from, to, .46, obstacles), true);
  assert.equal(circleBlocked(-44, 14, .42, obstacles), true);
  assert.equal(circleBlocked(20, 12, .42, obstacles), true);
  assert.equal(circleBlocked(-7, -31, .42, obstacles), true);
  assert.ok(layout.pieces.some(piece => piece.id.startsWith('canal-charred-') && piece.collision));
});
test('the residential walking circuit clears real open gate leaves as well as static walls', () => {
  const obstacles = [...layout.obstacles, ...makeDoors(layout).map(door => doorCollider(door))];
  const route = [
    [-29.5, 74], [-29.5, 64], [-35.5, 64], [-35.5, 58.5], [-35.5, 64],
    [-29.5, 64], [-29.5, 52.5], [-18, 52.5], [-18, 46.5], [-29.5, 46.5],
    [-29.5, 45], [-35.5, 45], [-29.5, 45], [-29.5, 46.5], [-18, 46.5],
    [-18, 52.5], [31.75, 52.5], [31.75, 72], [31.75, 64], [25.5, 64],
    [31.75, 64], [38, 64], [31.75, 64], [31.75, 45], [25.5, 45],
    [31.75, 45], [38, 45], [31.75, 45], [31.75, 52.5], [0, 52.5],
  ].map(([x, z]) => ({ x, z }));
  for (let i = 1; i < route.length; i++) {
    assert.equal(segmentClear(route[i - 1], route[i], .46, obstacles), true,
      JSON.stringify({ from: route[i - 1], to: route[i] }));
  }
});
