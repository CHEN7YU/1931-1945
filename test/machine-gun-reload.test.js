import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createRifleState, infantryWeaponProfile, advanceRifle, reloadRifle } from '../src/rifle-action.js';
import { rifleModel, updateRifleModel, updateRifleArms, rifleWorldModel, syncWorldWeapon } from '../src/rifle-model.js';
import { machineGunReloadPose, ZB26_HAND } from '../src/machine-gun-reload.js';
import { BOLT_HANDLE } from '../src/rifle-contacts.js';

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
        assert.ok(palm.distanceTo(new Vector3(...ZB26_HAND.grip).add(feed.position)) < 1e-8,
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
  assert.equal(pressed.palm[1], ZB26_HAND.press[1] - pressed.press);
  assert.equal(pressed.feed[1], -pressed.press);
});

test('body-supported reload establishes support before full release and keeps retrieval closer without moving the fixed hopper', () => {
  for (const model of ['zb26', 'type11']) {
    const state = { ...createRifleState(model), action: 'reload', ammo: 0 };
    const seconds = infantryWeaponProfile(state).reloadSeconds;
    state.elapsed = seconds * .08;
    const early = machineGunReloadPose(state, { supported: 1 });
    assert.equal(early.supportWeight, 1);
    assert.ok(early.handWeight < 1);
    state.elapsed = seconds * .34;
    const ordinary = machineGunReloadPose(state), supported = machineGunReloadPose(state, { supported: 1 });
    assert.ok(new Vector3(...supported.palm).length() < new Vector3(...ordinary.palm).length());
    if (model === 'type11') assert.deepEqual(supported.feed, [0, 0, 0]);
    state.elapsed = seconds;
    assert.equal(machineGunReloadPose(state, { supported: 1 }).supportWeight, 0);
    assert.throws(() => machineGunReloadPose(state, { supported: 2 }), RangeError);
  }
});

test('ZB-26 uses opposed finger/thumb contacts and a separate downward seating palm', () => {
  const state = { ...createRifleState('zb26'), action: 'reload', ammo: 0 };
  const gun = rifleModel(state);
  for (const fraction of [.14, .2, .28, .45, .6, .69, .8, .83]) {
    state.elapsed = 3.8 * fraction;
    updateRifleModel(gun, state);
    const contact = gun.userData.handContact, offset = gun.getObjectByName('feed').position;
    assert.equal(contact.pose, fraction < .7 ? 'magazine-grip' : 'magazine-press');
    const points = contact.points.map(point => new Vector3(...point).sub(offset));
    if (fraction < .7) {
      assert.equal(points.length, 5);
      assert.ok(points.slice(0, 4).every(point => point.x > .081 && point.x < .085 && point.z > -.23));
      assert.ok(points[4].z < -.289, 'thumb opposes the four fingers across the magazine depth');
    } else {
      assert.ok(points.every(point => Math.abs(point.y - .207) < .002));
    }
  }
});

test('rifle cycling grips the actual moving bolt sphere rather than a free-floating generic hand', () => {
  for (const model of ['rifle', 'sniper']) {
    const state = { ...createRifleState(model), action: 'cycle' }, gun = rifleModel(state);
    for (const elapsed of [.2, .27, .34, .4, .49, .54]) {
      state.elapsed = elapsed;
      updateRifleModel(gun, state);
      updateRifleArms(gun);
      const contact = gun.userData.handContact;
      assert.equal(contact.pose, 'bolt-grip');
      assert.equal(contact.weight, 1);
      assert.equal(contact.points.length, 4, 'three curled fingers and the opposing thumb contact the knob');
      for (const point of contact.points) {
        const distance = new Vector3(...point).distanceTo(new Vector3(...contact.target));
        assert.ok(distance >= BOLT_HANDLE.radius && distance < BOLT_HANDLE.radius + .002);
      }
      for (const lengths of Object.values(gun.userData.armLengths)) {
        assert.ok(Math.abs(lengths.upper - .35) < .002);
        assert.ok(Math.abs(lengths.forearm - .34) < .002);
      }
    }
    state.action = 'idle'; state.elapsed = 0;
    updateRifleModel(gun, state);
    assert.equal(gun.userData.handContact.pose, 'normal-grip');
    assert.equal(gun.getObjectByName('bolt-grip').visible, false);
  }
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

test('third-person automatic weapons expose the same owned hand and feeding pose', () => {
  for (const model of ['zb26', 'type11', 'sigm1920']) {
    const state = { ...createRifleState(model), ammo: 0 };
    reloadRifle(state);
    const gun = rifleWorldModel('near', state);
    for (let frame = 0; frame <= 240; frame++) {
      state.elapsed = infantryWeaponProfile(state).reloadSeconds * frame / 240;
      const pose = machineGunReloadPose(state, { prone: .7 });
      syncWorldWeapon(gun, state, pose);
      assert.equal(gun.userData.automaticReload, pose);
      assert.deepEqual(gun.getObjectByName('feed').position.toArray(), pose.feed);
      if (frame === 0 || frame === 240) assert.equal(pose.handWeight, 0);
      else assert.ok(pose.handWeight >= 0 && pose.handWeight <= 1);
    }
    state.action = 'idle'; state.elapsed = 0;
    syncWorldWeapon(gun, state);
    assert.equal(gun.userData.automaticReload.handWeight, 0);
    syncWorldWeapon(gun, createRifleState());
    assert.equal(gun.userData.automaticReload, null);
  }
});

test('hopper lid, clip retrieval and prone feeding paths remain continuous', () => {
  for (const model of ['zb26', 'type11']) for (const prone of [0, .5, 1]) {
    const state = { ...createRifleState(model), ammo: 0, action: 'reload' };
    let previous = null;
    for (let frame = 0; frame <= 2000; frame++) {
      state.elapsed = infantryWeaponProfile(state).reloadSeconds * frame / 2000;
      const pose = machineGunReloadPose(state, { prone });
      if (previous) assert.ok(new Vector3(...pose.palm).distanceTo(new Vector3(...previous.palm)) < .018,
        `${model}/${prone}/${frame}: no hand teleport between loading stages`);
      assert.ok([...pose.palm, ...pose.feed, ...pose.clip, pose.handWeight, pose.pressWeight].every(Number.isFinite));
      previous = pose;
    }
  }
  assert.throws(() => machineGunReloadPose(createRifleState('zb26'), { prone: NaN }), RangeError);
});
