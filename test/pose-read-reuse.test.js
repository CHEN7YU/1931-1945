import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { createNraRiflePose } from '../src/nra-rifle-pose.js';
import { createNraMotion, sampleNraMotion } from '../src/nra-motion.js';
import { createNativeGaitProfile, applyNativeUpperBody } from '../src/nra-gait.js';
import { FIRING_POSES } from '../src/combat-posture.js';
import { grenadePose } from '../src/grenades.js';

const moduleUrl = new URL('../src/nra-rifle-pose.js', import.meta.url);
const current = readFileSync(moduleUrl, 'utf8');
const positionDeclaration = 'const position = node => new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);';
assert.ok(current.includes(positionDeclaration));
const reference = current.replace(positionDeclaration, 'const position = node => node.getWorldPosition(new THREE.Vector3());')
  .replace('node.matrixWorld.decompose(new THREE.Vector3(), result, new THREE.Vector3());',
    'node.getWorldQuaternion(result);')
  .replace('      root.updateWorldMatrix(true, false);\n', '')
  .replace('      root.updateWorldMatrix(true, true);\n', '');
const source = reference.replace(/from '([^']+)'/g, (_, specifier) =>
  `from '${specifier.startsWith('.') ? new URL(specifier, moduleUrl).href : import.meta.resolve(specifier)}'`);
const { createNraRiflePose: createReference } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fixture(create) {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const { canonical: bones, meshes } = prepareNraRig(model);
  const scene = new THREE.Group(), root = new THREE.Group(), normalized = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(model);
  normalized.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); normalized.rotation.y = Math.PI;
  model.position.y -= bounds.min.y;
  normalized.add(model); root.add(normalized); scene.add(root); scene.updateMatrixWorld(true);
  const postures = createNativePosturePoses(normalized, bones);
  const data = JSON.parse(readFileSync(new URL('../public/assets/game/nra-88/animations.json', import.meta.url)));
  const profile = { ...createNativeGaitProfile(data.motion.idle), leanPivot: [0, 1, 0],
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.carry])) };
  const mixer = new THREE.AnimationMixer(meshes[0]);
  const actions = { standing: mixer.clipAction(THREE.AnimationClip.parse(data.idle)),
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, mixer.clipAction(value.clip)])) };
  for (const action of Object.values(actions)) { action.play(); action.paused = true; }
  const rest = [...bones.values()].map(bone => ({ bone, rotation: bone.quaternion.clone(), position: bone.position.clone() }));
  const pose = create(root, bones, new THREE.Group());
  let matrixReads = 0;
  const count = node => {
    const update = node.updateWorldMatrix;
    node.updateWorldMatrix = function (...args) { matrixReads++; return update.apply(this, args); };
  };
  scene.traverse(count);
  return {
    bones, pose,
    frame(frame) {
      for (const item of rest) { item.bone.quaternion.copy(item.rotation); item.bone.position.copy(item.position); }
      const stances = ['standing', ...Object.keys(FIRING_POSES)], stance = stances[frame % stances.length];
      scene.position.set(frame * .03, .1, -2); scene.rotation.y = frame * .025;
      root.position.set(Math.sin(frame) * .2, .4, -3); root.rotation.y = frame * .07;
      root.scale.setScalar(.96 + frame % 3 * .02);
      for (const [name, action] of Object.entries(actions)) {
        action.time = name === 'standing' ? frame * .03 % data.motion.idle.duration : 0;
        action.setEffectiveWeight(name === stance ? 1 : 0);
      }
      mixer.update(0);
      const actor = { team: 'enemy', groundType: 'infantry', position: new THREE.Vector3(),
        health: 100, heading: frame * .07, walkPhase: 0, stance: FIRING_POSES[stance]?.stance ?? 'standing',
        firingPose: stance === 'standing' ? null : stance,
        rifle: { model: 'rifle', action: 'idle' }, locomotion: { speed: 0, mode: 'idle' } };
      actor.nativeMotion = createNraMotion(profile, actor);
      actor.nativeMotion.posture = Object.fromEntries(Object.keys(FIRING_POSES).map(name => [name, Number(name === stance)]));
      actor.nativeMotion.bodyLean = frame % 4 * .04;
      const carry = sampleNraMotion(actor, false);
      if (frame % 5 === 0) carry.grenade = grenadePose({ kind: frame % 2 ? 'grenade' : 'explosive-pack',
        phase: 'throwing', elapsed: .15 });
      root.updateWorldMatrix(true, true);
      applyNativeUpperBody(root, bones, carry);
      matrixReads = 0;
      pose.update(carry);
      const reads = matrixReads;
      return { reads, snapshot: pose.snapshot,
        matrices: [...bones.values()].map(bone => bone.matrixWorld.elements.slice()),
        rotations: [...bones.values()].map(bone => bone.quaternion.toArray()) };
    },
  };
}
test('synchronized pose reads match full ancestor queries on real bones, postures, parent transforms and throws', () => {
  const old = fixture(createReference), candidate = fixture(createNraRiflePose);
  let oldReads = 0, newReads = 0;
  for (let frame = 0; frame < 60; frame++) {
    const expected = old.frame(frame), actual = candidate.frame(frame);
    assert.deepEqual(actual.snapshot, expected.snapshot, `grip and muzzle at frame ${frame}`);
    assert.deepEqual(actual.matrices, expected.matrices, `actual bone matrices at frame ${frame}`);
    assert.deepEqual(actual.rotations, expected.rotations, `bone rotations at frame ${frame}`);
    oldReads += expected.reads; newReads += actual.reads;
  }
  assert.ok(newReads < oldReads * .8, JSON.stringify({ oldReads, newReads }));
});
