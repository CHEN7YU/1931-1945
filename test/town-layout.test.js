import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTownLayout, STREET_BLOCK } from '../src/town-layout.js';
import { circleBlocked, segmentClear, createNavigator, moveGround } from '../src/core.js';
import { makeBaseSpawns, spawnBlockReason } from '../src/spawns.js';

const layout = makeTownLayout();
const navigator = createNavigator(layout.obstacles);
test('the fixed street has eleven enterable buildings and measures clearance between wall faces', () => {
  assert.deepEqual(makeTownLayout(), layout);
  assert.equal(layout.buildings.length, 11);
  const westWall = layout.pieces.find(piece => piece.id === 'west-0-east-0');
  const eastWall = layout.pieces.find(piece => piece.id === 'east-0-west-0');
  const clearWidth = eastWall.x - eastWall.w / 2 - (westWall.x + westWall.w / 2);
  assert.ok(Math.abs(clearWidth - STREET_BLOCK.streetWidth) < 1e-9);
  assert.equal(STREET_BLOCK.streetWidth, 8.76);
  for (const z of [62, 43, 10]) assert.equal(segmentClear({ x: 0, z: z - 8 }, { x: 0, z: z + 8 }, 1.9, layout.obstacles), true);
});
test('every street door and back door has actual capsule clearance, not a hidden building box', () => {
  for (const shop of layout.buildings) {
    assert.equal(segmentClear({ x: shop.x - 5, z: shop.doorZ }, { x: shop.x + 5, z: shop.doorZ }, .42, layout.obstacles), true, shop.id);
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
