import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNraForceRenderer } from '../src/nra-force-renderer.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';
import { SUPPORT_WEAPON_BANKS } from '../src/support-weapon-pose.js';

test('all shared support banks allocate morph rows before count becomes zero and handle first use/loading', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1.5, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0],
    quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { idle: track, run: track, crouched: track, kneeling: track, prone: track,
    strideMeters: 2, muzzle: [0, 1.3, -.8] };
  function template() {
    const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.7, .3), new THREE.MeshStandardMaterial());
    const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(mesh, gun);
    return { root, supportWeaponPoses: true, motionProfile: profile, createView: template, issue: null,
      bind() {}, update(actor) {
        root.position.copy(actor.position);
        mesh.position.y = actor.supportWeaponPose?.phase === 'loading' ? .05 : 0;
        root.updateMatrixWorld(true);
      } };
  }
  const force = createNraForceRenderer(scene, camera, template(), 20);
  const people = SUPPORT_WEAPON_BANKS.map((bank, index) => {
    const actor = { id: `support-${index}`, index, unitId: 'test', team: 'friendly', health: 100,
      position: new THREE.Vector3(index - 2, 0, -40), heading: 0, walkPhase: 0,
      locomotion: { speed: 0 }, rifle: createRifleState(),
      supportWeaponPose: { active: true, kind: bank.kind, phase: 'operate', pitch: bank.neutralPitch } };
    actor.nativeMotion = createNraMotion(profile, actor); return actor;
  });
  force.update(people, 0, null, 'low', { detailLimit: 0 });
  assert.equal(force.counts.near, 0); assert.equal(force.counts.far, 4);
  const active = force.root.children.filter(mesh => mesh.geometry?.attributes.nraSkinTint && mesh.count > 0);
  assert.equal(active.length, 4);
  for (const mesh of active) {
    assert.ok(mesh.morphTexture.image.height >= 20);
    assert.ok(mesh.morphTexture.image.width > 1);
    assert.ok([...mesh.morphTexture.image.data].every(Number.isFinite));
  }
  people.forEach(actor => { actor.supportWeaponPose.phase = 'loading'; });
  assert.doesNotThrow(() => force.update(people, .1, null, 'low', { detailLimit: 0 }));
  people[3].supportWeaponPose.phase = 'march';
  assert.doesNotThrow(() => force.update(people, .15, null, 'low', { detailLimit: 0 }));
  people.forEach(actor => { actor.supportWeaponPose = null; });
  force.update(people, .2, null, 'low', { detailLimit: 0 });
  assert.equal(force.counts.far, 4);
});
