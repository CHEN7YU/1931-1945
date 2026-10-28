import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { grenadeModel, explosivePackModel, grenadeHand, poseGrenadeHand } from '../src/grenade-model.js';

test('throwing uses five articulated fingers, nails and a cuff rather than a sphere hand', () => {
  for (const side of ['left', 'right']) {
    const hand = grenadeHand(side), other = grenadeHand(side), before = new Box3().setFromObject(hand).getSize(new Vector3());
    assert.ok(before.x > .06 && before.x < .14 && before.y > .15 && before.y < .25);
    assert.notEqual(hand.getObjectByName('joint-1-0'), other.getObjectByName('joint-1-0'));
    assert.equal(hand.getObjectByName('palm').geometry.type, 'BufferGeometry');
    assert.ok(hand.getObjectByName('woven-cuff'));
    for (let finger = 0; finger < 4; finger++) assert.ok(hand.getObjectByName(`nail-${finger}`));
    assert.ok(hand.getObjectByName('thumbnail'));
    poseGrenadeHand(hand, .85); const closed = hand.getObjectByName('joint-1-1').rotation.x;
    poseGrenadeHand(hand, 0); assert.notEqual(hand.getObjectByName('joint-1-1').rotation.x, closed);
    assert.ok(Math.abs(other.getObjectByName('joint-1-1').rotation.x) < 1e-12);
    assert.throws(() => poseGrenadeHand(hand, NaN), RangeError);
  }
  const model = grenadeModel();
  for (const name of ['safety-ring', 'safety-lever', 'fuse-neck', 'cast-shell-ridges']) assert.ok(model.getObjectByName(name));
});

test('explosive pack is a shared original paper bundle with two separate bindings and a carrying loop', () => {
  const model = explosivePackModel(), second = explosivePackModel();
  for (const name of ['paper-bundle-0', 'binding-strap-0', 'binding-strap-1', 'carrying-loop', 'pull-handle']) {
    assert.ok(model.getObjectByName(name));
    assert.equal(model.getObjectByName(name).geometry, second.getObjectByName(name).geometry);
  }
  const dimensions = new Box3().setFromObject(model).getSize(new Vector3());
  assert.ok(dimensions.z > .30 && dimensions.z < .4);
  assert.ok(dimensions.x < .15 && dimensions.y < .13);
  assert.notEqual(model.getObjectByName('binding-strap-0'), second.getObjectByName('binding-strap-0'));
});
