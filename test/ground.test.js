import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE, RIVER, groundHeight, riverBedHeight, waterDepth } from '../src/ground.js';
import { makeTownLayout } from '../src/town-layout.js';
import { createWalkSupport } from '../src/multistory.js';
import { moveGround, createNavigator } from '../src/core.js';
import { advanceLocomotion, createLocomotion } from '../src/locomotion.js';

test('bridge support is its actual raised top, not the water-level ground plane', () => {
  assert.equal(groundHeight(8, -16), .45);
  assert.equal(groundHeight(8, BRIDGE.minZ), BRIDGE.height);
  assert.equal(groundHeight(8, BRIDGE.maxZ), BRIDGE.height);
  assert.equal(groundHeight(-1, -16), RIVER.bedHeight);
  assert.equal(groundHeight(17, -16), RIVER.bedHeight);
});

test('the shallow river lies below the streets with continuous, walkable banks on both sides', () => {
  assert.equal(riverBedHeight(-16), -.85);
  assert.equal(waterDepth(-48, -16), .5);
  assert.ok(RIVER.waterHeight < groundHeight(-48, -8));
  assert.equal(waterDepth(8, -16), 0, 'bridge occupants stay dry');
  for (const x of [-95, -48, -1, 17, 56, 95]) {
    assert.equal(groundHeight(x, -9), 0);
    assert.equal(groundHeight(x, -23), 0);
    for (let z = -24; z < -8; z += .01) {
      assert.ok(Math.abs(groundHeight(x, z) - groundHeight(x, z + .01)) <= .002126);
      assert.ok(waterDepth(x, z) <= .500001);
    }
  }
});

test('infantry and tank capsules cross a real off-bridge ford in both directions', () => {
  const town = makeTownLayout(), support = createWalkSupport(town.pieces, groundHeight);
  const navigate = createNavigator(town.obstacles);
  const from = { x: -48, y: 0, z: -8 }, to = { x: -48, z: -24 };
  assert.deepEqual(navigate(from, to), [to], 'AI may use the ford rather than the bridge bottleneck');
  for (const tank of [false, true]) {
    const position = { ...from };
    for (const direction of [-1, 1]) {
      for (let i = 0; i < 320; i++) {
        if (tank) {
          moveGround(position, 0, direction * .05, 1.9, town.obstacles);
          position.y = groundHeight(position.x, position.z);
        } else support.move(position, 0, direction * .05, .4, town.obstacles);
        assert.ok(Math.abs(position.y - groundHeight(position.x, position.z)) < 1e-6);
      }
      assert.ok(Math.abs(position.z - (direction < 0 ? -24 : -8)) < 1e-6);
      assert.ok(Math.abs(position.y) < 1e-6);
    }
  }
});

test('wading reduces infantry speed and cannot turn into a dry sprint', () => {
  const position = { x: -48, y: -.85, z: -16 }, motion = createLocomotion();
  for (let i = 0; i < 120; i++) advanceLocomotion(motion, position,
    { type: 'infantry', forward: 1, yaw: Math.PI / 2, stance: 'standing',
      sprint: false, speedScale: RIVER.infantrySpeed }, [], 1 / 60);
  assert.ok(Math.abs(motion.speed - 3.15 * RIVER.infantrySpeed) < .001);
  assert.equal(motion.sprinting, false);
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
