import test from 'node:test';
import assert from 'node:assert/strict';
import { createRifleState, rifleReloadSeconds } from '../src/rifle-action.js';
import { rifleModel, rifleWorldModel, syncWorldWeapon, updateRifleModel } from '../src/rifle-model.js';

test('near third-person loading clip and cartridges match the first-person action throughout reload', () => {
  for (const [model, ammo] of [['rifle', 0], ['rifle', 2], ['sniper', 2]]) {
    const state = createRifleState(model);
    state.ammo = ammo; state.action = 'reload';
    const first = rifleModel(state), world = rifleWorldModel('near', state);
    for (let frame = 0; frame <= 60; frame++) {
      state.elapsed = rifleReloadSeconds(state) * frame / 60;
      updateRifleModel(first, state); syncWorldWeapon(world, state);
      const a = first.getObjectByName('clip'), b = world.getObjectByName('clip');
      assert.equal(a.visible, b.visible);
      assert.equal(a.position.y, b.position.y);
      assert.equal(a.getObjectByName('charger').visible, b.getObjectByName('charger').visible);
      for (let i = 0; i < 5; i++) {
        const one = a.getObjectByName(`cartridge${i}`), two = b.getObjectByName(`cartridge${i}`);
        assert.equal(one.visible, two.visible);
        assert.equal(one.position.x, two.position.x);
      }
    }
    syncWorldWeapon(world, createRifleState('zb26'));
    assert.equal(world.getObjectByName('clip').visible, false);
  }
  assert.equal(rifleWorldModel('far', createRifleState()).getObjectByName('clip'), undefined);
});
