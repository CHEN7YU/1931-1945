import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeTownLayout } from '../src/town-layout.js';
import { SHOP_ART_STYLES, SHOP_ART_VIEWS, shopAwningGeometry, shopAwningFrame,
  shopNoticeGeometry, shopContactPatches } from '../src/shop-art.js';
import { benchmarkConfig, diagnosticRoster, diagnosticSpawns } from '../src/benchmark.js';

test('one-person art entry is development-only, directly between both first-street samples', () => {
  assert.equal(benchmarkConfig('?benchmark=shop-art', false), null);
  assert.equal(benchmarkConfig('?benchmark=shop-art', true).diagnostic, true);
  const roster = diagnosticRoster('shop-art'), points = diagnosticSpawns('shop-art');
  assert.equal(roster.length, 1); assert.equal(roster[0].memberCount, 1);
  assert.equal(roster[0].spawnId, points[0].id);
  assert.deepEqual([points[0].x, points[0].z], [0, 64]);
  assert.equal(SHOP_ART_VIEWS.grain.yaw, Math.PI / 2);
  assert.equal(SHOP_ART_VIEWS.cloth.yaw, -Math.PI / 2);
  assert.ok(SHOP_ART_VIEWS.ground.pitch < -.4);
});

test('cloth canopy sags, folds and hangs without consuming the passage headroom', () => {
  const geometry = shopAwningGeometry(), box = geometry.boundingBox;
  assert.ok(box.min.y >= 2.16 && box.max.y <= 2.67);
  assert.ok(Math.abs(box.max.x - 1.4) < 1e-6 && Math.abs(box.min.x + 1.4) < 1e-6);
  assert.ok(geometry.index.count / 3 < 1800);
  for (const name of ['position', 'normal', 'uv', 'color']) {
    assert.ok(geometry.attributes[name].array.every(Number.isFinite));
  }
  const p = geometry.attributes.position;
  const at = (row, column) => row * 41 + column;
  assert.ok(p.getY(at(8, 10)) < p.getY(at(8, 0)) - .05, 'fabric droops between the side and center rails');
  assert.equal(p.getY(at(8, 0)), p.getY(at(8, 20)), 'center and side rails carry the same tension line');
  const frame = shopAwningFrame();
  assert.equal(frame.length, 7);
  for (const [index, column] of [[0, 0], [1, 20], [2, 40]]) {
    const part = frame[index];
    for (const [row, point] of [[0, part.start], [16, part.end]]) {
      const vertex = at(row, column);
      assert.ok(Math.abs(p.getX(vertex) - point[0]) < 1e-6);
      assert.ok(Math.abs(p.getZ(vertex) - point[2]) < 1e-6);
      assert.ok(Math.abs(p.getY(vertex) - point[1] - .018) < 1e-6, 'cloth rests just above its wooden frame');
    }
  }
  assert.ok(box.min.z >= .139, 'rear fixing sits outside the actual wall face');
  const valanceStart = 17 * 41;
  for (let column = 0; column <= 40; column++) {
    assert.ok(p.getZ(valanceStart + 41 + column) > 1.136, 'cloth wraps around the front pole instead of exposing a rigid top bar');
  }
  const sideVertices = Array.from({ length: 68 }, (_, index) => p.count - 68 + index);
  assert.ok(sideVertices.every(index => Math.abs(Math.abs(p.getX(index)) - 1.4) < 1e-6), 'both side curtains have real geometry');
  assert.ok(geometry.attributes.color.array.some(value => value < .75), 'restrained repair patch is part of the same cloth batch');
  const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, at(8, 20));
  assert.ok(normal.length() > .99);
  geometry.dispose();
});

test('notice has irregular edges and a restrained curled corner without leaving its solid-wall footprint', () => {
  const geometry = shopNoticeGeometry(), box = geometry.boundingBox;
  assert.ok(box.min.x >= -.31 && box.max.x <= .31);
  assert.ok(box.min.y >= -.3875 && box.max.y <= .3875);
  assert.ok(box.min.z >= -.001 && box.max.z > .02 && box.max.z < .03);
  assert.ok(geometry.index.count / 3 <= 400);
  for (const name of ['position', 'normal', 'uv']) {
    assert.ok(geometry.attributes[name].array.every(Number.isFinite));
  }
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  const top = [];
  for (let i = 0; i < p.count; i++) if (uv.getY(i) === 1) top.push(p.getY(i));
  assert.ok(Math.max(...top) - Math.min(...top) > .003, 'top edge is not a perfect printed rectangle');
  assert.ok(Array.from({ length: p.count }, (_, i) => p.getZ(i) + .13).every(z => z > .12), 'paper does not intersect the wall');
  geometry.dispose();
});
test('four local contact marks and wall notices leave the town collision layout untouched', () => {
  const town = makeTownLayout(), before = structuredClone(town);
  const patches = shopContactPatches(town);
  assert.equal(patches.length, 4);
  assert.deepEqual(new Set(patches.map(patch => patch.buildingId)), new Set(['west-0', 'east-0']));
  for (const patch of patches) {
    assert.ok(patch.w > 0 && patch.d > 0);
    assert.ok(patch.z >= 60 && patch.z <= 68 && Math.abs(patch.x) < 4.5);
  }
  for (const shop of town.buildings.filter(shop => Object.hasOwn(SHOP_ART_STYLES, shop.id))) {
    const z = shop.doorZ + shop.facing * 1.85;
    const front = shop.x + shop.facing * shop.w / 2;
    const walls = town.pieces.filter(piece => piece.wall && piece.id.startsWith(`${shop.id}-`) && Math.abs(piece.x - front) < .01);
    assert.ok(walls.some(wall => z - .31 >= wall.z - wall.d / 2 && z + .31 <= wall.z + wall.d / 2 &&
      1.5 - .775 / 2 >= wall.y - wall.h / 2 && 1.5 + .775 / 2 <= wall.y + wall.h / 2), 'notice fits actual solid wall, not a window or doorway');
  }
  assert.deepEqual(town, before);
  assert.deepEqual(shopContactPatches(town), patches);
});
