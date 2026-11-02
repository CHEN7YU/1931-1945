import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { bayonetObstructed } from '../src/bayonet-clearance.js';
import { bayonetCarry } from '../src/bayonet.js';

const actor = { heading: 0, position: new Vector3() };
const pose = extension => {
  const carry = bayonetCarry(extension);
  return { weaponPosition: carry.position,
    weaponQuaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), carry.pitch).toArray() };
};
test('the actual blade sweep detects walls at weapon height, including a thrust crossing a clear eye-level window', () => {
  const wall = { minX: -1, maxX: 1, minZ: -.9, maxZ: -.6, minY: 1.19, height: 3.2 };
  assert.equal(bayonetObstructed(actor, pose(1), () => [wall]), true);
  assert.equal(bayonetObstructed(actor, pose(1), () => []), false);
  const tucked = { weaponPosition: [.10, 1.16, .04],
    weaponQuaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.45).toArray() };
  assert.equal(bayonetObstructed(actor, tucked, () => [wall]), false);
  wall.minY = 3.2; wall.height = 6.4;
  assert.equal(bayonetObstructed(actor, pose(1), () => [wall]), false);
  assert.throws(() => bayonetObstructed({ ...actor, heading: NaN }, pose(1), () => []), RangeError);
});
test('wall clearance follows the owned soldier heading and changes immediately when a door opens', () => {
  const wall = { minX: .6, maxX: .9, minZ: -1, maxZ: 1, height: 3.2 };
  assert.equal(bayonetObstructed({ ...actor, heading: -Math.PI / 2 }, pose(1), () => [wall]), true);
  wall.minX = 3; wall.maxX = 3.3;
  assert.equal(bayonetObstructed({ ...actor, heading: -Math.PI / 2 }, pose(1), () => [wall]), false);
});
