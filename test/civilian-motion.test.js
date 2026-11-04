import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCivilianCharacterFactory, updateCivilianAppearance } from '../src/civilian-character.js';
import { advanceCivilianMotion } from '../src/civilian-motion.js';

const factory = createCivilianCharacterFactory();
function person(carrying = 'none', age = 'adult') {
  const actor = factory.create(4, age, 'woman', carrying);
  Object.assign(actor.userData, { civilianId: 4, ageGroup: age, carrying, walkPhase: 0 });
  new THREE.Scene().add(actor);
  return actor;
}
const camera = new THREE.PerspectiveCamera();
function simulate(actor, mode, seconds = 1) {
  for (let frame = 0; frame < 60 * seconds; frame++)
    advanceCivilianMotion(actor, { dt: 1 / 60, now: frame / 60, moved: 0, mode });
  updateCivilianAppearance([actor], camera);
}

test('cowering bends the knees, lowers the pelvis and brings both free arms above the head without resizing the model', () => {
  for (const age of ['adult', 'elderly', 'child']) {
    const actor = person('none', age), geometry = actor.civilianSkin.mesh.geometry;
    const size = actor.scale.clone();
    simulate(actor, 'cower');
    const { joints } = actor.civilianSkin;
    assert.ok(joints.root.position.y < -.28);
    assert.ok(joints.leftKnee.rotation.x < -1.7);
    assert.ok(joints.leftArm.rotation.x > 1.9 && joints.rightArm.rotation.x > 1.9);
    assert.ok(joints.leftElbow.rotation.x > 1.7);
    assert.equal(actor.civilianSkin.mesh.geometry, geometry);
    assert.deepEqual(actor.scale, size);
    actor.updateMatrixWorld(true);
    const head = joints.head.localToWorld(new THREE.Vector3(0, .075, 0));
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const palm = joints[`${side}Elbow`].localToWorld(new THREE.Vector3(sign * .002, -.285, -.005));
      const distance = palm.distanceTo(head) / (actor.scale.y * actor.civilianSkin.profile.height);
      assert.ok(distance > .09 && distance < .16, `palms must cover the head, not hover like raised hands: ${distance}`);
    }
    const foot = joints.leftFoot.getWorldPosition(new THREE.Vector3());
    assert.ok(foot.y > .025 && foot.y < .12, `feet remain at the original support height: ${foot.y}`);
  }
});

test('protecting a child keeps both holding arms; a luggage carrier only raises the free arm', () => {
  const parent = person('child'), carrier = person('luggage');
  simulate(parent, 'cower'); simulate(carrier, 'cower');
  assert.ok(parent.civilianArms.every(arm => arm.rotation.x === .25));
  assert.equal(parent.civilianSkin.joints.leftElbow.rotation.x, 1.05);
  assert.equal(carrier.civilianArms[0].rotation.x, -.04);
  assert.ok(carrier.civilianArms[1].rotation.x > 1.9);
});

test('pose projection is repeatable while paused, preserves far LOD and smoothly returns to the standing pose', () => {
  const actor = person();
  simulate(actor, 'cower');
  const joints = actor.civilianSkin.joints;
  const snapshot = () => Object.values(joints).map(bone => [...bone.position.toArray(), ...bone.rotation.toArray()]);
  const before = snapshot();
  for (let frame = 0; frame < 30; frame++) updateCivilianAppearance([actor], camera);
  assert.deepEqual(snapshot(), before, 'rendering must not accumulate joint rotations without simulation');
  camera.position.z = 100;
  updateCivilianAppearance([actor], camera);
  assert.equal(actor.civilianSkin.level, 'far');
  assert.deepEqual(snapshot(), before);
  simulate(actor, 'route', 2);
  assert.ok(joints.root.position.y > -.001);
  assert.ok(Math.abs(joints.leftArm.rotation.x) < .001);
  camera.position.z = 0;
});

test('gait uses real displacement and turns toward actual motion at a bounded speed', () => {
  const actor = person();
  advanceCivilianMotion(actor, { dt: .1, now: .1, moved: .2, dx: 1, dz: 0, mode: 'flee' });
  assert.ok(Math.abs(actor.rotation.y) <= .38);
  assert.ok(actor.rotation.y < 0);
  const phase = actor.userData.walkPhase;
  simulate(actor, 'cower');
  assert.equal(actor.userData.walkPhase, phase, 'a stationary sheltered person cannot march in place');
});

test('free arms swing from their shoulders with relaxed, phase-lagged elbow flexion; running bends more without adding geometry', () => {
  for (const age of ['adult', 'elderly', 'child']) {
    const actor = person('none', age), joints = actor.civilianSkin.joints, bends = [];
    const geometry = actor.civilianSkin.geometry;
    for (let frame = 0; frame < 60; frame++) {
      advanceCivilianMotion(actor, { dt: 1 / 60, now: frame / 60, moved: 1.5 / 60, mode: 'route' });
      updateCivilianAppearance([actor], camera);
      bends.push(joints.leftElbow.rotation.x);
      assert.ok(joints.leftElbow.rotation.x >= .18 && joints.rightElbow.rotation.x >= .18);
      assert.ok(Math.abs(joints.leftArm.rotation.x) <= .26);
    }
    assert.ok(Math.max(...bends) - Math.min(...bends) > .07, 'elbows must articulate, not stay fixed');
    let runningBend = 0;
    for (let frame = 0; frame < 60; frame++) {
      advanceCivilianMotion(actor, { dt: 1 / 60, now: 1 + frame / 60, moved: 3.2 / 60, mode: 'boarding' });
      updateCivilianAppearance([actor], camera);
      runningBend = Math.max(runningBend, joints.leftElbow.rotation.x);
    }
    assert.ok(runningBend > Math.max(...bends) + .2);
    assert.equal(actor.civilianSkin.geometry, geometry);
  }
});
