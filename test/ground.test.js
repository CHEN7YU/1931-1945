import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE, RIVER, groundHeight, riverBedHeight, riverSectionAt, configureWalkSupport, walkHeight } from '../src/ground.js';
import { makeTownLayout } from '../src/town-layout.js';
import { createWalkSupport } from '../src/multistory.js';
import { moveGround, createNavigator } from '../src/core.js';
import { advanceLocomotion, createLocomotion } from '../src/locomotion.js';

test('bridge support is its actual raised top, not the dry riverbed', () => {
  assert.equal(groundHeight(8, -16), .45);
  assert.equal(groundHeight(8, BRIDGE.minZ), BRIDGE.height);
  assert.equal(groundHeight(8, BRIDGE.maxZ), BRIDGE.height);
  assert.equal(groundHeight(-1, -16), RIVER.bedHeight);
  assert.equal(groundHeight(17, -16), RIVER.bedHeight);
});

test('native feet and movement share the selected stage terrain and floor support', () => {
  const pieces = [{ x: 0, z: 0, w: 4, d: 4, y: 3.1, h: .2, walkable: true }];
  const selected = configureWalkSupport(pieces, () => .95);
  assert.equal(selected.heightAt(8, -16, .95), .95);
  assert.equal(walkHeight(8, -16, .95), selected.heightAt(8, -16, .95));
  assert.equal(walkHeight(0, 0, 3.2), selected.heightAt(0, 0, 3.2));
  configureWalkSupport(makeTownLayout().pieces);
});

test('the dry riverbed has irregular continuous banks without intruding into quay streets', () => {
  assert.equal(riverBedHeight(8, -16), -.85);
  assert.equal(RIVER.dry, true);
  assert.equal(Object.hasOwn(RIVER, 'waterHeight'), false);
  const sections = [];
  for (const x of [-95, -48, -1, 17, 56, 95]) {
    const section = riverSectionAt(x);
    sections.push(section);
    assert.ok(section.centerZ - section.bankHalfWidth >= -23);
    assert.ok(section.centerZ + section.bankHalfWidth <= -9);
    assert.ok(groundHeight(x, section.centerZ) < -.8);
    assert.equal(groundHeight(x, -9), 0);
    assert.equal(groundHeight(x, -23), 0);
    for (let z = -24; z < -8; z += .01) {
      assert.ok(Math.abs(groundHeight(x, z) - groundHeight(x, z + .01)) < .004);
    }
  }
  assert.ok(new Set(sections.map(section => section.centerZ)).size > 3);
  assert.ok(new Set(sections.map(section => section.bankHalfWidth)).size > 3);
});

test('infantry and tank capsules cross the off-bridge dry riverbed in both directions', () => {
  const town = makeTownLayout(), support = createWalkSupport(town.pieces, groundHeight);
  const navigate = createNavigator(town.obstacles);
  const from = { x: -48, y: 0, z: -8 }, to = { x: -48, z: -24 };
  assert.deepEqual(navigate(from, to), [to], 'AI may use the dry bed rather than the bridge bottleneck');
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

test('the dry bed permits normal jogging and sprinting', () => {
  const position = { x: -48, y: -.85, z: -16 }, motion = createLocomotion();
  for (let i = 0; i < 120; i++) advanceLocomotion(motion, position,
    { type: 'infantry', forward: 1, yaw: Math.PI / 2, stance: 'standing',
      sprint: false }, [], 1 / 60);
  assert.ok(Math.abs(motion.speed - 2.7) < .001);
  assert.equal(motion.sprinting, false);
  for (let i = 0; i < 60; i++) advanceLocomotion(motion, position,
    { type: 'infantry', forward: 1, yaw: Math.PI / 2, stance: 'standing', sprint: true }, [], 1 / 60);
  assert.ok(Math.abs(motion.speed - 4.1) < .001);
  assert.equal(motion.sprinting, true);
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
