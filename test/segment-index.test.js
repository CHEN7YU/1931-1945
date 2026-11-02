import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentClear } from '../src/core.js';
import { obstacleLookup } from '../src/spatial.js';
import { createMovementObstacles } from '../src/movement-obstacles.js';
import { makeTownPreviewLayout } from '../src/town-preview-layout.js';

test('height-aware evasion routes include upper-floor walls and exclude surfaces below the feet', () => {
  const wall = { minX: -1, maxX: 1, minZ: -.1, maxZ: .1, minY: 3.2, height: 6.4 };
  const start = { x: 0, z: -2 }, end = { x: 0, z: 2 };
  assert.equal(segmentClear(start, end, .42, [wall], null, 3.2), false);
  assert.equal(segmentClear(start, end, .42, [wall], null, 0), true);
});

test('indexed short routes match full-map collision sampling across the real fortress', () => {
  const obstacles = makeTownPreviewLayout().obstacles;
  const lookup = obstacleLookup(obstacles, 2.5, 4);
  let candidates = 0, fullCandidates = 0;
  for (let z = -96; z <= 96; z += 16) for (let x = -96; x <= 96; x += 16) {
    for (const [dx, dz] of [[7, 3], [-3, 6], [0, 0]]) {
      const start = { x, z }, end = { x: x + dx, z: z + dz };
      const expected = segmentClear(start, end, .46, obstacles);
      const actual = segmentClear(start, end, .46, obstacles, (px, pz) => {
        const nearby = lookup.at(px, pz);
        candidates += nearby.length; fullCandidates += obstacles.length;
        return nearby;
      });
      assert.equal(actual, expected, `${x},${z} to ${end.x},${end.z}`);
    }
  }
  assert.ok(candidates < fullCandidates / 10, `${candidates} indexed candidates versus ${fullCandidates} full-map candidates`);
});

test('indexed routes still respect map edges, moving tanks, opened doors and strict tangency', () => {
  const door = { minX: -1, maxX: 1, minZ: -.1, maxZ: .1, height: 2 };
  const obstacles = [door], lookup = obstacleLookup(obstacles, 2.5, 4);
  const tank = { id: 'tank', type: 'tank', minX: 4, maxX: 6, minZ: -1, maxZ: 1, height: 2 };
  const vehicles = new Map([[tank.id, tank]]);
  const movement = createMovementObstacles(lookup, vehicles, vehicle => ({ ...vehicle }));
  const route = (start, end) => {
    const full = [...obstacles, ...vehicles.values()];
    const expected = segmentClear(start, end, .46, full);
    const actual = segmentClear(start, end, .46, obstacles, (x, z) => movement.at(x, z));
    assert.equal(actual, expected);
    return actual;
  };
  assert.equal(route({ x: 0, z: -2 }, { x: 0, z: 2 }), false);
  door.minX = 10; door.maxX = 12; lookup.rebuild();
  assert.equal(route({ x: 0, z: -2 }, { x: 0, z: 2 }), true);
  movement.beginStablePass();
  assert.equal(route({ x: 3, z: 0 }, { x: 7, z: 0 }), false);
  movement.endStablePass();
  tank.minZ = 10; tank.maxZ = 12;
  assert.equal(route({ x: 3, z: 0 }, { x: 7, z: 0 }), true);
  assert.equal(route({ x: 107, z: 0 }, { x: 108, z: 0 }), false);
  assert.equal(route({ x: 9.54, z: 0 }, { x: 9.54, z: 0 }), true);
});
