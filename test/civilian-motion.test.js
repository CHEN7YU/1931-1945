import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCivilianCharacterFactory, updateCivilianAppearance } from '../src/civilian-character.js';
import { advanceCivilianMotion } from '../src/civilian-motion.js';
import { updateCivilianStreetLife } from '../src/civilian-street-life.js';

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

test('cowering seats the body, hugs both knees and lowers the head without resizing the model', () => {
  for (const age of ['adult', 'elderly', 'child']) {
    const actor = person('none', age), geometry = actor.civilianSkin.mesh.geometry;
    const size = actor.scale.clone();
    simulate(actor, 'cower');
    const { joints } = actor.civilianSkin;
    assert.ok(joints.root.position.y < -.28);
    assert.ok(joints.leftKnee.rotation.x < -1.7);
    assert.equal(actor.userData.seatedContacts.hugging, true);
    assert.ok(joints.head.rotation.x < -.7);
    assert.equal(actor.civilianSkin.mesh.geometry, geometry);
    assert.deepEqual(actor.scale, size);
    actor.updateMatrixWorld(true);
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const palm = joints[`${side}Elbow`].localToWorld(new THREE.Vector3(sign * .002, -.285, -.005));
      assert.ok(palm.y < joints.head.getWorldPosition(new THREE.Vector3()).y);
      assert.ok(actor.userData.seatedContacts.hands[side].reachable);
      assert.ok(actor.userData.seatedContacts.hands[side].error < .008);
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
  const snapshot = () => Object.values(joints).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
  const before = snapshot();
  for (let frame = 0; frame < 30; frame++) updateCivilianAppearance([actor], camera);
  assert.deepEqual(snapshot(), before, 'rendering must not accumulate joint rotations without simulation');
  camera.position.z = 100;
  updateCivilianAppearance([actor], camera);
  assert.equal(actor.civilianSkin.level, 'far');
  assert.ok(Math.abs(joints.root.position.y - before[0][1]) < .035, 'LOD support corrections remain bounded');
  const far = snapshot(); updateCivilianAppearance([actor], camera);
  assert.deepEqual(snapshot(), far, 'the same far pose does not drift while paused');
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

test('a stopped civilian settles into a stable leg pose without marching in place', () => {
  for (const age of ['adult', 'elderly', 'child']) {
    const actor = person('none', age);
    for (let frame = 0; frame < 60; frame++)
      advanceCivilianMotion(actor, { dt: 1 / 60, now: frame / 60, moved: 2 / 60, dz: -2 / 60 });
    for (let frame = 0; frame < 60; frame++)
      advanceCivilianMotion(actor, { dt: 1 / 60, now: 1 + frame / 60, moved: 0, mode: 'waiting' });
    const phase = actor.userData.walkPhase;
    const joints = actor.civilianSkin.joints;
    const names = ['leftLeg', 'leftKnee', 'leftFoot', 'rightLeg', 'rightKnee', 'rightFoot'];
    const angles = names.map(name => joints[name].rotation.x);
    for (let frame = 0; frame < 120; frame++) {
      advanceCivilianMotion(actor, { dt: 1 / 60, now: 2 + frame / 60, moved: 0, mode: 'waiting' });
      updateCivilianAppearance([actor], camera);
      assert.equal(actor.userData.walkPhase, phase);
      for (let index = 0; index < names.length; index++)
        assert.ok(Math.abs(joints[names[index]].rotation.x - angles[index]) < .005);
    }
  }
});

test('street corner heading follows actual travel without an instantaneous half-turn', () => {
  const actor = person();
  actor.userData.streetLife = { wakeAt: 0, waypoint: 0, route: [{ x: 0, z: 100 }],
    door: { x: 100, z: 100, targetAngle: 1.7, angle: 1.7 }, movementObstacles: [], navigationObstacles: [],
    navigationLookup: { at: () => [] } };
  updateCivilianStreetLife(actor, .1, .05, [actor], { interact() {} });
  assert.ok(Math.abs(actor.rotation.y) <= .19 + 1e-8);
  assert.ok(Math.abs(actor.rotation.y) > 0);
  for (let frame = 1; frame < 60; frame++)
    updateCivilianStreetLife(actor, .1 + frame * .05, .05, [actor], { interact() {} });
  assert.ok(Math.abs(Math.abs(actor.rotation.y) - Math.PI) < .02);
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

test('ordinary street residents use the same articulated elbows before evacuation, including after appearance projection', () => {
  const actor = person(), elbows = [], geometry = actor.civilianSkin.geometry;
  actor.userData.active = false;
  actor.userData.streetLife = { wakeAt: 0, waypoint: 0, route: [{ x: 0, z: -100 }],
    door: { x: 100, z: 100, targetAngle: 1.7, angle: 1.7 }, movementObstacles: [], navigationObstacles: [],
    navigationLookup: { at: () => [] } };
  for (let frame = 0; frame < 100; frame++) {
    updateCivilianStreetLife(actor, frame / 60, 1 / 60, [actor], { interact() {} });
    const before = actor.civilianSkin.joints.leftElbow.rotation.x;
    updateCivilianAppearance([actor], camera);
    assert.equal(actor.civilianSkin.joints.leftElbow.rotation.x, before, 'the render pass must not overwrite the street gait');
    elbows.push(before);
    assert.ok(Math.abs(actor.civilianLegs[0].rotation.x) < 1, 'calm walking uses a bounded articulated stride');
  }
  assert.equal(actor.userData.escapeMode, 'street');
  assert.equal(actor.userData.active, false, 'animating the arms must not trigger evacuation');
  assert.ok(Math.max(...elbows) - Math.min(...elbows) > .08);
  assert.equal(actor.civilianSkin.geometry, geometry);
  const phase = actor.userData.walkPhase, before = actor.position.clone();
  Object.assign(actor.userData.streetLife.door, { x: actor.position.x, z: actor.position.z, targetAngle: 0, angle: 0 });
  for (let frame = 0; frame < 60; frame++)
    updateCivilianStreetLife(actor, 2 + frame / 60, 1 / 60, [actor], { interact() {} });
  assert.equal(actor.position.distanceTo(before), 0);
  assert.equal(actor.userData.walkPhase, phase, 'waiting for a door must not march in place');
  assert.ok(Math.abs(actor.civilianArms[0].rotation.x) < .001);
});

test('walking plants each foot and bends the recovering knee; running has a higher foot arc across ages and LODs', () => {
  for (const age of ['adult', 'elderly', 'child']) {
    const peaks = [];
    for (const [speed, mode] of [[1.1, 'street'], [3.2, 'flee']]) {
      const actor = person('none', age), joints = actor.civilianSkin.joints;
      let peakLift = 0, stanceSlip = 0, previous = null, minSole = Infinity, peakKnee = 0;
      const geometry = actor.civilianSkin.mesh.geometry, footVertices = [];
      for (let index = 0; index < geometry.attributes.position.count; index++)
        if (geometry.attributes.skinIndex.getX(index) === 9) footVertices.push(index);
      for (let frame = 0; frame < 180; frame++) {
        const moved = speed / 60;
        actor.position.z -= moved;
        advanceCivilianMotion(actor, { dt: 1 / 60, now: frame / 60, moved, dz: -moved, mode });
        updateCivilianAppearance([actor], camera); actor.updateMatrixWorld(true);
        const motion = actor.userData.escapeMotion, foot = joints.leftFoot.getWorldPosition(new THREE.Vector3());
        peakLift = Math.max(peakLift, motion.feet[0].lift);
        peakKnee = Math.max(peakKnee, -joints.leftKnee.rotation.x);
        if (frame > 90 && motion.feet[0].stance && previous?.stance)
          stanceSlip = Math.max(stanceSlip, Math.abs(foot.z - previous.z));
        previous = { stance: motion.feet[0].stance, z: foot.z };
        if (actor.civilianSkin.level === 'near') for (const index of footVertices) {
          const point = actor.civilianSkin.mesh.getVertexPosition(index, new THREE.Vector3());
          minSole = Math.min(minSole, actor.civilianSkin.mesh.localToWorld(point).y);
        }
      }
      assert.ok(peakKnee > .4, 'the recovering leg must fold instead of remaining a rigid pendulum');
      assert.ok(stanceSlip < .001, `${age}/${mode} steady supporting foot slips ${stanceSlip}m per frame`);
      assert.ok(minSole > -.008, `${age}/${mode} shoe penetrates ground: ${minSole}`);
      const before = Object.values(joints).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
      updateCivilianAppearance([actor], camera);
      assert.deepEqual(Object.values(joints).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]), before);
      camera.position.z = 100; updateCivilianAppearance([actor], camera);
      assert.equal(actor.civilianSkin.level, 'far');
      camera.position.z = 0;
      peaks.push(peakLift);
    }
    assert.ok(peaks[1] > peaks[0] + .1);
  }
});
