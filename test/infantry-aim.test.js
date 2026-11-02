import test from 'node:test';
import assert from 'node:assert/strict';
import { INFANTRY_AIM_PITCH, updateInfantryAimPitch } from '../src/infantry-aim.js';

const muzzle = { x: 0, y: 1.5, z: 0 };

test('shared infantry aim smoothly raises and lowers for targets at different elevations', () => {
  const actor = {};
  const elevated = { x: 0, y: 9.5, z: -16 };
  assert.ok(Math.abs(updateInfantryAimPitch(actor, elevated, muzzle, .1) - .22) < 1e-10);
  assert.ok(actor.aimPitch > 0);
  for (let i = 0; i < 10; i++) updateInfantryAimPitch(actor, elevated, muzzle, .1);
  assert.ok(actor.aimPitch <= INFANTRY_AIM_PITCH.maximum);
  const elevatedPitch = actor.aimPitch;
  for (let i = 0; i < 10; i++) updateInfantryAimPitch(actor, null, muzzle, .1);
  assert.ok(actor.aimPitch < elevatedPitch);
  assert.ok(Math.abs(actor.aimPitch) < 1e-10);
});

test('shared infantry aim clamps pitch and rejects invalid simulation inputs', () => {
  const actor = {};
  updateInfantryAimPitch(actor, { x: 0, y: 100, z: -.1 }, muzzle, 1);
  assert.equal(actor.aimPitch, INFANTRY_AIM_PITCH.maximum);
  assert.throws(() => updateInfantryAimPitch(actor, null, muzzle, -1), /timestep/);
  assert.throws(() => updateInfantryAimPitch(actor, { x: NaN, y: 1, z: 0 }, muzzle, .1), /target/);
});
