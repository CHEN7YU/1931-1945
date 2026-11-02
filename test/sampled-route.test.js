import test from 'node:test';
import assert from 'node:assert/strict';
import { sampledRouteClear } from '../src/infantry-spacing.js';
import { circleBlocked } from '../src/core.js';
import { makeTownPreviewLayout } from '../src/town-preview-layout.js';
import { createWalkSupport } from '../src/multistory.js';
import { obstacleLookup } from '../src/spatial.js';
import { bridgeGroundHeight, BRIDGE } from '../src/ground.js';
import { makeDoors, doorCollider } from '../src/doors.js';

function reference(start, end, clear) {
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / .2));
  for (let step = 1; step <= steps; step++) {
    if (!clear(start.x + (end.x - start.x) * step / steps, start.z + (end.z - start.z) * step / steps)) return false;
  }
  return true;
}
test('clear paths retain every exact original sample once, including zero and short segments', () => {
  for (const end of [{ x: 0, z: 0 }, { x: .1, z: 0 }, { x: .31, z: .17 }, { x: 10.1, z: -13.2 }]) {
    const start = { x: 0, z: 0 }, old = [], current = [];
    assert.equal(reference(start, end, (x, z) => { old.push([x, z]); return true; }), true);
    assert.equal(sampledRouteClear(start, end, (x, z) => { current.push([x, z]); return true; }), true);
    assert.deepEqual(current.map(value => JSON.stringify(value)).sort(), old.map(value => JSON.stringify(value)).sort());
    assert.equal(new Set(current.map(value => JSON.stringify(value))).size, current.length);
  }
});
test('any single blocked original sample rejects the same route; midpoint blockage terminates early', () => {
  const start = { x: 0, z: 0 }, end = { x: 20, z: 0 };
  for (let blocked = 1; blocked <= 100; blocked++) {
    const clear = x => Math.abs(x - blocked * .2) > 1e-10;
    assert.equal(sampledRouteClear(start, end, clear), reference(start, end, clear));
  }
  let visits = 0;
  assert.equal(sampledRouteClear(start, end, x => { visits++; return x < 9.9 || x > 10.1; }), false);
  assert.equal(visits, 2);
  assert.throws(() => sampledRouteClear(start, end, () => undefined), TypeError);
  assert.throws(() => sampledRouteClear({ x: NaN, z: 0 }, end, () => true), RangeError);
});
test('sample order preserves current fortress walls, floors, doors and changed vehicle blockers', () => {
  const town = makeTownPreviewLayout(), doors = makeDoors(town), leaves = doors.map(doorCollider);
  const obstacles = [...town.obstacles, ...leaves];
  const lookup = obstacleLookup(obstacles, 2.5, 4);
  const support = createWalkSupport(town.pieces, (x, z) => bridgeGroundHeight(x, z, { ...BRIDGE, height: .95 }));
  let seed = 1938;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let round = 0; round < 4; round++) {
    doors.forEach((door, index) => {
      door.angle = (round - 1.5) * Math.PI / 3;
      Object.assign(leaves[index], doorCollider(door));
    });
    lookup.rebuild();
    const tank = { oriented: true, cx: round * 10, cz: 25, hx: 1.85, hz: 2.5, angle: round * .4, height: 2.4 };
    for (let index = 0; index < 3000; index++) {
      const start = { x: random() * 210 - 105, y: index % 5 ? 0 : 3.2, z: random() * 210 - 105 };
      const end = { x: start.x + random() * 50 - 25, z: start.z + random() * 50 - 25 };
      const clear = (x, z) => !circleBlocked(x, z, .46, [...lookup.at(x, z), tank], start.y) &&
        !(Math.abs(support.heightAt(x, z, start.y) - start.y) > .3);
      assert.equal(sampledRouteClear(start, end, clear), reference(start, end, clear), `round ${round}, sample ${index}`);
    }
  }
});
