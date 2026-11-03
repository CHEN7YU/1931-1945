import test from 'node:test';
import assert from 'node:assert/strict';
import { traceCivilianBullet } from '../src/civilian-hits.js';

const person = (z = -5, crouch = 0) => ({ visible: true, position: { x: 0, y: 0, z },
  userData: { escapeMotion: { crouch } } });
test('a hostile machine-gun ray can hit the nearest waiting civilian, never through an earlier wall', () => {
  const near = person(), far = person(-8), start = { x: 0, y: .9, z: 0 }, direction = { x: 0, y: 0, z: -1 };
  assert.equal(traceCivilianBullet([far, near], start, direction, 20).civilian, near);
  assert.equal(traceCivilianBullet([far, near], start, direction, 3), null);
  near.userData.dead = true;
  assert.equal(traceCivilianBullet([near, far], start, direction, 20).civilian, far);
});
test('crouching changes the body hit region rather than making a civilian invulnerable', () => {
  const actor = person(-5, 1), direction = { x: 0, y: 0, z: -1 };
  assert.equal(traceCivilianBullet([actor], { x: 0, y: 1.5, z: 0 }, direction, 20), null);
  assert.ok(traceCivilianBullet([actor], { x: 0, y: .6, z: 0 }, direction, 20));
  actor.visible = false;
  assert.equal(traceCivilianBullet([actor], { x: 0, y: .6, z: 0 }, direction, 20), null);
});
