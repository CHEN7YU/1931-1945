import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE, groundHeight } from '../src/ground.js';

test('bridge support is its actual raised top, not the water-level ground plane', () => {
  assert.equal(groundHeight(8, -16), .45);
  assert.equal(groundHeight(8, BRIDGE.minZ), BRIDGE.height);
  assert.equal(groundHeight(8, BRIDGE.maxZ), BRIDGE.height);
  assert.equal(groundHeight(-1, -16), 0);
  assert.equal(groundHeight(17, -16), 0);
});
test('both bridge approaches are continuous ramps', () => {
  assert.equal(groundHeight(8, -24.5), .225);
  assert.equal(groundHeight(8, -7.5), .225);
  assert.equal(groundHeight(8, -26.5), 0);
  assert.equal(groundHeight(8, -5.5), 0);
  for (let z = -27; z < -5; z += .01) assert.ok(Math.abs(groundHeight(8, z) - groundHeight(8, z + .01)) < .002);
});
test('standing, crouched and prone eyes remain above bridge support and near clipping', () => {
  for (const eye of [1.67, 1.05, .45]) {
    const support = groundHeight(8, -16);
    assert.ok(support + eye - .07 > BRIDGE.height, 'even the camera near plane remains above the deck');
  }
});
