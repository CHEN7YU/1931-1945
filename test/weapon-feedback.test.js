import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponRestriction } from '../src/weapon-feedback.js';

const ready = { firearm: true, canFire: true, vaulting: false, sprinting: false, recovery: 0,
  obstruction: 0, obstructionBlend: 0, reloading: false, cycling: false, scoped: false,
  readying: false, ammo: 5, magazine: 5, shellLimit: false };
test('weapon feedback distinguishes real restrictions without inventing a blocked normal action', () => {
  assert.equal(weaponRestriction(ready), null);
  for (const [patch, code] of [
    [{ vaulting: true }, 'vault'], [{ canFire: false }, 'driver'], [{ sprinting: true }, 'sprint'],
    [{ recovery: .01 }, 'recovery'], [{ obstruction: .001 }, 'obstruction'],
    [{ obstructionBlend: .031 }, 'obstruction'], [{ reloading: true }, 'reload'],
    [{ cycling: true }, 'cycle'], [{ readying: true }, 'readying'], [{ ammo: 0 }, 'empty'],
    [{ shellLimit: true }, 'shell-limit'],
  ]) {
    const result = weaponRestriction({ ...ready, ...patch });
    assert.equal(result.code, code);
    assert.ok(result.text.length > 4);
  }
  assert.equal(weaponRestriction({ ...ready, firearm: false, obstruction: 1 }), null);
});
test('aim keeps ordinary bolt cycling and empty-magazine observation, but scoped cycling cannot aim', () => {
  assert.equal(weaponRestriction({ ...ready, ammo: 0 }, 'aim'), null);
  assert.equal(weaponRestriction({ ...ready, cycling: true }, 'aim'), null);
  assert.equal(weaponRestriction({ ...ready, cycling: true, scoped: true }, 'aim').code, 'cycle');
  assert.equal(weaponRestriction({ ...ready, reloading: true }, 'aim').code, 'reload');
});
test('reload feedback identifies full/reloading states and permits queued reload during cycling', () => {
  assert.equal(weaponRestriction(ready, 'reload').code, 'full');
  assert.equal(weaponRestriction({ ...ready, reloading: true, ammo: 2 }, 'reload').code, 'reload');
  assert.equal(weaponRestriction({ ...ready, cycling: true, ammo: 2 }, 'reload'), null);
  assert.throws(() => weaponRestriction(ready, 'invented'), RangeError);
});
