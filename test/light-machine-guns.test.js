import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRifleState, infantryWeaponProfile, advanceRifle, shootRifle, reloadRifle, riflePose } from '../src/rifle-action.js';
import { createAIRifleControl, attemptAIRifleShot } from '../src/ai-rifle.js';
import { lightMachineGunModel, configureLightMachineGunMaterials } from '../src/light-machine-gun-model.js';
import { soldierModel } from '../src/world.js';
import { soldierRifleMuzzle } from '../src/entities.js';
import { rifleModel, rifleWorldModel, syncWorldWeapon, updateRifleModel, updateRifleArms } from '../src/rifle-model.js';

for (const [model, capacity] of [['zb26', 20], ['type11', 30]]) {
  test(`${model} fires its full capacity automatically without manual bolt cues or early refill`, () => {
    const state = createRifleState(model), profile = infantryWeaponProfile(state);
    assert.equal(state.ammo, capacity);
    assert.equal(reloadRifle(state), false);
    for (let shot = 1; shot <= capacity; shot++) {
      assert.equal(shootRifle(state), true);
      assert.equal(state.ammo, capacity - shot);
      assert.equal(shootRifle(state), false, 'the cyclic rate still gates held fire');
      assert.deepEqual(advanceRifle(state, profile.cycleSeconds), []);
    }
    assert.equal(shootRifle(state), false);
    assert.equal(state.action, 'reload');
    assert.equal(riflePose(state).boltLift, 0);
    advanceRifle(state, profile.reloadSeconds - .01);
    assert.equal(state.ammo, 0);
    advanceRifle(state, .02);
    assert.equal(state.ammo, capacity);
    assert.equal(state.shots, capacity);
    assert.equal(state.action, 'idle');
  });

  test(`${model} AI fires three-round bursts but still requires aim, stationary posture and a fresh clear line`, () => {
    const actor = { health: 100, vehicleId: null, nextFire: 0, rifle: createRifleState(model),
      aiRifle: createAIRifleControl(), locomotion: { speed: 0, sprinting: false, aimRecovery: 0 } };
    const fire = (now, confirmShot = () => 20) => attemptAIRifleShot(actor, { now, targetId: 'target',
      mayFire: true, postureSettled: true, suppressed: false, confirmShot });
    for (let tick = 0; tick <= 6; tick++) assert.equal(fire(tick / 10), false);
    assert.equal(fire(.7), true);
    advanceRifle(actor.rifle, .12);
    assert.equal(fire(.82), true);
    advanceRifle(actor.rifle, .12);
    assert.equal(fire(.94), true);
    advanceRifle(actor.rifle, .12);
    assert.equal(fire(1.06), false, 'after three rounds another aim period is required');
    for (let tick = 1; tick <= 12 && actor.rifle.shots === 3; tick++) fire(1.06 + tick / 10);
    assert.equal(actor.rifle.shots, 4);
    advanceRifle(actor.rifle, .12);
    const now = actor.aiRifle.lastShot.time + .12;
    assert.equal(fire(now, () => null), false, 'burst rounds cannot bypass occlusion');
    assert.equal(fire(now + .01), false);
    assert.equal(actor.rifle.shots, 4);
    for (let tick = 1; tick <= 10 && actor.rifle.shots === 4; tick++) fire(now + tick / 10);
    assert.equal(actor.rifle.shots, 5);
    advanceRifle(actor.rifle, .12);
    actor.locomotion.speed = 1;
    const movedAt = actor.aiRifle.lastShot.time + .12;
    assert.equal(fire(movedAt), false);
    actor.locomotion.speed = 0;
    assert.equal(fire(movedAt + .01), false, 'moving breaks the burst, not just its current round');
  });

  test(`${model} model sharing, near/far procedural bodies and muzzle offsets retain faction equipment`, () => {
    const first = lightMachineGunModel(model), second = lightMachineGunModel(model);
    assert.equal(first.children[0].children[0].geometry, second.children[0].children[0].geometry);
    first.getObjectByName('feed').position.y = 1;
    assert.equal(second.getObjectByName('feed').position.y, 0);
    const profile = infantryWeaponProfile({ model });
    const bounds = new THREE.Box3().setFromObject(second);
    assert.ok(Math.abs(bounds.max.z - bounds.min.z - profile.length) < .003);
    for (const team of ['friendly', 'enemy']) for (const heading of [0, Math.PI / 2, Math.PI]) {
      const state = createRifleState(model), position = new THREE.Vector3(2, .5, 3);
      const actor = { team, heading, rifle: state, position };
      const expected = new THREE.Vector3(.13 + profile.muzzleX, 1.39, .02 + profile.muzzleZ)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(position);
      const muzzle = soldierRifleMuzzle(actor);
      assert.ok(expected.distanceTo(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z)) < 1e-8);
      for (const detail of ['near', 'far']) assert.ok(soldierModel(team === 'friendly', detail, model).children.length > 2);
    }
  });

  test(`${model} detailed contours preserve a clear sight line and use bounded shared distant geometry`, () => {
    const profile = infantryWeaponProfile({ model });
    const near = lightMachineGunModel(model), far = lightMachineGunModel(model, 'far');
    const feedBounds = new THREE.Box3().setFromObject(near.getObjectByName('feed'));
    assert.ok(model === 'zb26' ? feedBounds.min.x > .04 : feedBounds.max.x < -.04,
      'the magazine or hopper must not cover the offset iron sights');
    near.updateMatrixWorld(true);
    const hits = new THREE.Raycaster(new THREE.Vector3(0, .049, .01), new THREE.Vector3(0, 0, -1))
      .intersectObject(near, true);
    assert.ok(hits.length > 0, 'the physical front sight must be visible through the rear notch');
    assert.ok(Math.abs(hits[0].point.z - (profile.muzzleZ + .045)) < .003,
      'the first surface along the sight line must be the front post, not a receiver or feed block');
    const supportEnd = new THREE.Raycaster(new THREE.Vector3(0, -.071, -.29), new THREE.Vector3(0, 0, -1))
      .intersectObject(near, true)[0];
    assert.ok(supportEnd && Math.abs(supportEnd.point.z + .3) < .001,
      'the sculpted foregrip has a solid end, not an open wooden tube');
    assert.ok(supportEnd.face.normal.z > .8);
    const counts = [];
    for (const [detail, gun] of [['near', near], ['far', far]]) {
      let triangles = 0, batches = 0;
      gun.traverse(mesh => {
        if (!mesh.isMesh) return;
        const { position, normal, uv } = mesh.geometry.attributes;
        assert.ok([...position.array, ...normal.array, ...uv.array].every(Number.isFinite));
        triangles += position.count / 3; batches++;
      });

      assert.ok(triangles <= (detail === 'near' ? 30000 : 2500));
      assert.ok(batches <= 7, 'small details must be merged, not individual draw calls');
      assert.ok(Math.abs(new THREE.Box3().setFromObject(gun).getSize(new THREE.Vector3()).z - profile.length) < .003);
      counts.push(triangles);
    }
    assert.ok(counts[1] < counts[0] / 5);
    assert.equal(far.children[0].children[0].geometry,
      lightMachineGunModel(model, 'far').children[0].children[0].geometry);
    assert.notEqual(near.children[0].children[0].geometry, far.children[0].children[0].geometry);
  });
}

test('native pooled weapons can switch between rifle and either LMG without duplicate guns or shared reload transforms', () => {
  const gun = rifleWorldModel();
  for (const model of ['zb26', 'type11', 'rifle', 'zb26']) {
    syncWorldWeapon(gun, createRifleState(model));
    assert.equal(gun.getObjectByName('rifleBody').visible, model === 'rifle');
    assert.equal(gun.children.filter(child => child.name === 'light-machine-gun').length, model === 'rifle' ? 0 : 1);
    assert.equal(gun.userData.weaponModel, model);
  }
  assert.throws(() => createRifleState('unknown'), /Unknown infantry weapon/);
});

test('LMG hands wrap their separate grips without changing rifle hands or sharing moving transforms', () => {
  const rifle = rifleModel(), first = rifleModel(createRifleState('zb26')), second = rifleModel(createRifleState('type11'));
  for (const side of ['left', 'right']) {
    const name = `${side}Hand`;
    assert.notEqual(first.getObjectByName(name).children[0].geometry, rifle.getObjectByName(name).children[0].geometry);
    assert.equal(first.getObjectByName(name).children[0].geometry, second.getObjectByName(name).children[0].geometry);
    assert.notDeepEqual(first.getObjectByName(`${side}Sleeve`).userData.wrist,
      rifle.getObjectByName(`${side}Sleeve`).userData.wrist);
    assert.equal(first.userData.rifle[`${side}Hand`], first.getObjectByName(name));
  }
  const state = createRifleState('zb26');
  shootRifle(state); advanceRifle(state, .12); reloadRifle(state); advanceRifle(state, .5);
  updateRifleModel(first, state); updateRifleArms(first);
  assert.ok(first.getObjectByName('leftHand').position.length() > 0);
  assert.equal(second.getObjectByName('leftHand').position.length(), 0);
  assert.equal(rifle.getObjectByName('leftHand').position.length(), 0);
  for (const lengths of Object.values(first.userData.armLengths)) {
    assert.ok(Math.abs(lengths.upper - .35) < .002);
    assert.ok(Math.abs(lengths.forearm - .34) < .002);
  }
});

test('authored LMG grain and microfinish share mipmapped color, bump and roughness maps without modifying rifle materials', () => {
  const source = Object.fromEntries(['steel', 'wood', 'brass', 'edge', 'black'].map(name =>
    [name, new THREE.MeshStandardMaterial({ name, metalness: name === 'wood' ? 0 : .8 })]));
  const sourceMap = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  sourceMap.anisotropy = 4; source.wood.map = sourceMap;
  configureLightMachineGunMaterials(source);
  const materialFor = (model, name) => {
    let found;
    model.traverse(mesh => { if (mesh.isMesh && mesh.material.name === name) found = mesh.material; });
    return found;
  };
  const first = lightMachineGunModel('zb26'), second = lightMachineGunModel('type11', 'far');
  for (const name of ['steel', 'wood']) {
    const material = materialFor(first, name);
    assert.equal(material, materialFor(second, name));
    assert.notEqual(material, source[name]);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
    assert.equal(material.bumpMap.colorSpace, THREE.NoColorSpace);
    for (const map of [material.map, material.bumpMap, material.roughnessMap]) {
      assert.equal(map.image.width, 256);
      assert.equal(map.image.height, 256);
      assert.equal(map.anisotropy, 4);
      assert.equal(map.generateMipmaps, true);
      assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
      const values = new Set(map.image.data.filter((_, index) => index % 4 === 0));
      assert.ok(values.size > 5, 'surface variation must exist in the actual texture pixels');
    }
  }
  assert.equal(source.wood.map, sourceMap);
  assert.equal(source.steel.bumpMap, null);
});
