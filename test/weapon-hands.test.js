import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNraGrenadeHand } from '../src/nra-hand.js';
import { createWeaponHands } from '../src/weapon-hands.js';
import { rifleModel, updateRifleModel } from '../src/rifle-model.js';
import { createRifleState, infantryWeaponProfile } from '../src/rifle-action.js';

const manager = new T.LoadingManager();
manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
prepareNraRig(model);
const source = new T.Group(), bounds = new T.Box3().setFromObject(model);
source.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); source.rotation.y = Math.PI;
model.position.y -= bounds.min.y; source.add(model); source.updateMatrixWorld(true);

test('native weapon hands preserve distinct finger bones and source skin while sharing one reusable pair', () => {
  const sourceSkin = source.getObjectByName('\u624b\u90e8').material;
  const originalMaterial = Array.isArray(sourceSkin) ? sourceSkin[0] : sourceSkin;
  const originalColor = originalMaterial.color.clone();
  let created = 0;
  const view = createWeaponHands(side => { created++; return createNraGrenadeHand(source, side, { fullArm: true, weaponRig: true }); });
  const positions = [];
  view.root.traverse(node => { if (node.isBone) positions.push([node, node.position.clone(), node.scale.clone()]); });
  for (const weapon of ['rifle', 'sniper', 'zb26', 'type11']) {
    const state = createRifleState(weapon), gun = rifleModel(state);
    gun.position.set(.18, -.265, -.14);
    for (const action of ['idle', 'cycle', 'reload']) for (let frame = 0; frame <= 40; frame++) {
      state.action = action; state.ammo = action === 'reload' ? 0 : 4;
      state.elapsed = infantryWeaponProfile(state)[action === 'cycle' ? 'cycleSeconds' : 'reloadSeconds'] * frame / 40;
      updateRifleModel(gun, state); view.update(gun, state);
      assert.equal(view.root.parent, gun);
      for (const side of ['left', 'right']) {
        const sample = view.snapshot[side];
        assert.ok(sample.arm.reachable && sample.arm.error < .002);
        assert.equal(Object.keys(sample.grip.joints).length, 5);
        for (const [finger, chain] of Object.entries(sample.grip.joints)) for (let joint = 1; joint < chain.length; joint++) {
          const length = new T.Vector3(...chain[joint]).distanceTo(new T.Vector3(...chain[joint - 1]));
          assert.ok(Math.abs(length - sample.grip.fingerLengths[finger][joint - 1]) < 1e-6);
        }
        for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
          const curls = sample.grip.curls[finger];
          assert.ok(curls.every((angle, joint) => angle >= 0 && angle <= [1.25, 1.5, 1.05][joint] + 1e-6),
            `${finger} must flex within hinge limits instead of chasing arbitrary endpoints`);
        }
        if (action === 'idle' && weapon === 'rifle') {
          assert.ok(sample.wristAngle < 35 * Math.PI / 180,
            `${side}: stable forearm/palm alignment must stay below 35 degrees, got ${sample.wristAngle * 180 / Math.PI}`);
          if (side === 'left') {
            assert.ok(sample.palmNormal[1] > .8, 'support palm must face upward rather than pinch sideways');
            assert.equal(sample.elbowConstraint.limited, false, 'stable support must satisfy its elbow clearance without limiting');
            assert.ok(sample.arm.elbow[1] <= sample.arm.wrist[1] - .05 + 1e-5,
              `support elbow stays below the wrist: ${JSON.stringify(sample.arm)}`);
          }
        }
      }
      if (weapon === 'zb26' && action === 'reload' && frame === 24) {
        const joints = view.snapshot.left.grip.joints;
        assert.ok(joints.Index.at(-1)[2] < joints.Thumb.at(-1)[2] - .01,
          `thumb opposes the curled fingers: ${JSON.stringify({ index: joints.Index.at(-1), thumb: joints.Thumb.at(-1) })}`);
        for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
          const points = joints[finger].map(point => new T.Vector3(...point));
          const first = points[1].clone().sub(points[0]).normalize(), second = points[2].clone().sub(points[1]).normalize();
          const last = points[3].clone().sub(points[2]).normalize();
          assert.ok(Math.min(first.dot(second), second.dot(last)) < .95, `${finger} needs a real knuckle bend, not a straight rod`);
        }
      }
    }
    assert.equal(gun.getObjectByName('leftHand').visible, false);
    assert.equal(gun.getObjectByName('rightHand').visible, false);
  }
  assert.equal(created, 2, 'weapon/member changes reuse the two native hand rigs');
  const rifle = createRifleState(), stableGun = rifleModel(rifle);
  for (const placement of [[0, -.05, -.2], [.18, -.22, -.14], [.18, -.265, -.14]]) {
    stableGun.position.fromArray(placement);
    updateRifleModel(stableGun, rifle); view.update(stableGun, rifle);
    for (const side of ['left', 'right']) {
      const hand = view.snapshot[side];
      assert.ok(hand.wristAngle < 35 * Math.PI / 180, `${side}: wrist alignment at ${placement}`);
      if (side === 'left') {
        assert.ok(hand.palmNormal[1] > .8);
        assert.equal(hand.elbowConstraint.limited, false);
        assert.ok(hand.arm.elbow[1] <= hand.arm.wrist[1] - .05 + 1e-5);
      }
    }
  }
  view.root.traverseVisible(mesh => {
    if (!mesh.isSkinnedMesh || !['\u8863\u670d', '\u81c2\u7ae0'].includes(mesh.name)) return;
    const weights = mesh.geometry.attributes.skinWeight, joints = mesh.geometry.attributes.skinIndex;
    assert.ok(mesh.geometry.attributes.uv);
    for (let vertex = 0; vertex < weights.count; vertex++) {
      let total = 0;
      for (let slot = 0; slot < 4; slot++) {
        const weight = weights.getComponent(vertex, slot);
        total += weight;
        if (weight > .001) assert.match(mesh.skeleton.bones[joints.getComponent(vertex, slot)].name,
          /^(Left|Right)(Arm|ForeArm|Hand)$/, 'cloth cannot follow individual thumb/finger joints');
      }
      assert.ok(Math.abs(total - 1) < 1e-5, 'cut-edge weights stay normalized');
    }
  });
  const lowered = rifleModel();
  view.update(lowered, createRifleState());
  lowered.position.y = -.55;
  view.update(lowered, createRifleState(), { stowed: true });
  assert.equal(view.root.visible, false, 'traversal stows the native arms instead of stretching them');
  lowered.position.y = -.22;
  view.update(lowered, createRifleState());
  assert.equal(view.root.visible, true);
  view.update(lowered, createRifleState(), { appearance: { key: 'test-complexion', skin: '#d7b797' } });
  view.root.traverseVisible(mesh => {
    if (mesh.name !== '\u624b\u90e8') return;
    assert.notEqual(mesh.material, originalMaterial);
    assert.equal(mesh.material.map, originalMaterial.map);
    assert.equal(mesh.material.color.getHexString(), 'd7b797');
  });
  assert.deepEqual(originalMaterial.color, originalColor, 'first-person tint cannot recolor characters or throwable hands');
  for (const [bone, position, scale] of positions) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale); }
  const middle = view.snapshot.left.grip.fingerLengths.Middle.reduce((sum, value) => sum + value, 0);
  const pinky = view.snapshot.left.grip.fingerLengths.Pinky.reduce((sum, value) => sum + value, 0);
  assert.ok(middle - pinky > .01, 'real middle and pinky fingers cannot become equal-length rods');
});
