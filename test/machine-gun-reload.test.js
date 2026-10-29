import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createRifleState, infantryWeaponProfile, advanceRifle, reloadRifle } from '../src/rifle-action.js';
import { rifleModel, updateRifleModel, updateRifleArms, rifleWorldModel, syncWorldWeapon } from '../src/rifle-model.js';
import { machineGunReloadPose } from '../src/machine-gun-reload.js';

for (const model of ['zb26', 'type11']) {
  test(`${model} reload hand, feed and sleeves remain synchronized throughout the entire owned action`, () => {
    const state = createRifleState(model), gun = rifleModel(state), profile = infantryWeaponProfile(state);
    state.ammo = 0; reloadRifle(state);
    const stages = new Set(), feed = gun.getObjectByName('feed'), hand = gun.userData.rifle.leftHand;
    for (let frame = 0; frame < 241; frame++) {
      state.elapsed = profile.reloadSeconds * frame / 240;
      const pose = machineGunReloadPose(state); stages.add(pose.stage);
      updateRifleModel(gun, state);
      gun.position.set(.18, -.265, -.14);
      updateRifleArms(gun);
      const palm = new Vector3(-.029, -.101, -.386).applyMatrix4(hand.matrix);
      assert.ok(palm.distanceTo(new Vector3(...pose.palm)) < 1e-8, `${model}: hand must follow the actual feed contact in ${pose.stage}`);
      assert.deepEqual(feed.position.toArray(), pose.feed);
      assert.equal(state.ammo, 0, 'animation cannot refill before the owned action ends');
      assert.ok([...palm].every(Number.isFinite));
      for (const [side, lengths] of Object.entries(gun.userData.armLengths)) {
        assert.ok(Math.abs(lengths.upper - .35) < .002, `${model} ${side}: upper arm in ${pose.stage}`);
        assert.ok(Math.abs(lengths.forearm - .34) < .002, `${model} ${side}: forearm in ${pose.stage}: ${lengths.forearm}`);
      }
      if (model === 'zb26' && ['remove', 'insert'].includes(pose.stage)) {
        assert.ok(palm.distanceTo(new Vector3(.029, .13, -.25).add(feed.position)) < 1e-8,
          'magazine and gripping hand share a fixed contact while carried');
      }
      if (model === 'type11') {
        assert.deepEqual(feed.position.toArray(), [0, 0, 0], 'the fixed hopper never floats above the receiver');
        assert.equal(gun.getObjectByName('hopper-lid-pivot').rotation.z, pose.lidAngle);
        assert.ok(feed.children.every(mesh => mesh.count === pose.loadedClips));
      }
    }
    assert.ok(stages.has(model === 'zb26' ? 'press' : 'press-clip'));
    state.elapsed = profile.reloadSeconds - .01;
    advanceRifle(state, .02); updateRifleModel(gun, state);
    assert.equal(state.ammo, profile.magazine);
    assert.deepEqual(feed.position.toArray(), [0, 0, 0]);
    assert.deepEqual(hand.position.toArray(), [0, 0, 0]);
    assert.equal(gun.getObjectByName('loading-clip')?.visible ?? false, false);
  });
}

test('ZB-26 seating includes a distinct hand press after insertion and before releasing the magazine', () => {
  const state = { ...createRifleState('zb26'), action: 'reload', ammo: 0 };
  state.elapsed = 3.8 * .82;
  const pressed = machineGunReloadPose(state);
  assert.equal(pressed.stage, 'press');
  assert.ok(pressed.press > .011);
  assert.equal(pressed.palm[1], .225 - pressed.press);
  assert.equal(pressed.feed[1], -pressed.press);
});

test('separate view/world instances and paused action times never share hand or magazine transforms', () => {
  const state = { ...createRifleState('zb26'), action: 'reload', elapsed: 2, ammo: 0 };
  const first = rifleModel(state), other = rifleModel(createRifleState('zb26')), world = rifleWorldModel('near', state);
  updateRifleModel(first, state); syncWorldWeapon(world, state);
  assert.deepEqual(first.getObjectByName('feed').position, world.getObjectByName('feed').position);
  assert.equal(other.getObjectByName('feed').position.length(), 0);
  const before = first.getObjectByName('feed').position.toArray(), ammo = state.ammo;
  advanceRifle(state, 0); updateRifleModel(first, state);
  assert.deepEqual(first.getObjectByName('feed').position.toArray(), before);
  assert.equal(state.ammo, ammo);
  assert.throws(() => machineGunReloadPose(createRifleState()), RangeError);
});

test('mechanical loading cues coincide with the hand press instead of the old floating-feed phase', () => {
  const zb = { ...createRifleState('zb26'), ammo: 0 };
  reloadRifle(zb);
  assert.deepEqual(advanceRifle(zb, 3.8 * .81), []);
  assert.deepEqual(advanceRifle(zb, 3.8 * .02), ['load']);
  assert.equal(machineGunReloadPose(zb).stage, 'press');
  for (const ammo of [0, 7, 27]) {
    const hopper = { ...createRifleState('type11'), ammo };
    reloadRifle(hopper);
    const cues = advanceRifle(hopper, 5);
    assert.equal(cues.filter(cue => cue === 'load').length, Math.ceil((30 - ammo) / 5));
    assert.equal(hopper.ammo, 30);
  }
});
