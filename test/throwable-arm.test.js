import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createNraGrenadeHand } from '../src/nra-hand.js';
import { createGrenadeRenderer, throwableViewPose } from '../src/grenade-renderer.js';
import { grenadePose, throwableProfile } from '../src/grenades.js';
import { createNraRiflePose, solveArm } from '../src/nra-rifle-pose.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createNativePosturePoses } from '../src/nra-posture-pose.js';
import { FIRING_POSES } from '../src/combat-posture.js';
import { DADAO_DIMENSIONS, dadaoViewModel, updateDadaoView } from '../src/dadao-model.js';
import { loadDadaoSurfaces } from '../src/dadao-surface.js';
import { createNraDadaoPose } from '../src/nra-dadao-pose.js';

await loadDadaoSurfaces(1, { async loadAsync(url) { return new T.Texture({ src: url }); } });

const manager = new T.LoadingManager();
manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const rig = prepareNraRig(model), source = new T.Group(), bounds = new T.Box3().setFromObject(model);
source.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); source.rotation.y = Math.PI;
model.position.y -= bounds.min.y; source.add(model); source.updateMatrixWorld(true);

test('dadao uses the authorized skin, reachable original arm bones and the actual solved wrist attachment', () => {
  const view = dadaoViewModel((side, options) => createNraGrenadeHand(source, side, { fullArm: true, ...options }));
  const camera = new T.PerspectiveCamera(72, 1.6, .025, 20);
  camera.position.set(1, 2, 3); camera.rotation.set(.3, -.5, .2); camera.add(view); camera.updateMatrixWorld(true);
  const hand = view.userData.dadaoArm, sword = view.userData.dadaoHand, bones = [];
  hand.traverse(node => { if (node.isBone) bones.push([node, node.position.clone(), node.scale.clone()]); });
  assert.equal(view.userData.handSource, 'nra-authorized-skinned-hand');
  for (const phase of ['draw', 'ready', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 40; frame++) {
    updateDadaoView(view, { phase, progress: frame / 40 }, { weaponX: .005, weaponY: -.004 });
    const wrist = new T.Vector3(...hand.armSnapshot.frame);
    assert.ok(hand.armSnapshot.reachable && hand.armSnapshot.error < 1e-6, `${phase}/${frame}: ${JSON.stringify(hand.armSnapshot)}`);
    const expected = hand.attachmentFrame.localToWorld(new T.Vector3(...hand.userData.throwableGrips.dadao));
    const actual = sword.localToWorld(new T.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0));
    assert.ok(actual.distanceTo(expected) < 1e-6, 'grip remains attached to the real wrist, even under a rotated camera');
    assert.equal(hand.gripSnapshot.kind, 'dadao');
    const index = sword.worldToLocal(hand.getObjectByName('RightHandIndex1').getWorldPosition(new T.Vector3()));
    const pinky = sword.worldToLocal(hand.getObjectByName('RightHandPinky1').getWorldPosition(new T.Vector3()));
    assert.ok(index.y > pinky.y + .05, 'index and thumb must face the guard, not the pommel');
    assert.ok(.023 - index.y < .025 && index.y < .023, 'the upper hand sits just below the guard');
    assert.ok(wrist.z < -.15, 'wrist stays in front of the camera');
    for (const [bone, position, scale] of bones) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale); }
  }
});

test('dadao fingers wrap back around the grip and the thumb opposes the curled index and middle fingers', () => {
  const arm = createNraGrenadeHand(source, 'right', { fullArm: true });
  arm.poseGrip(1, 0, 'dadao');
  const point = name => arm.worldToLocal(arm.getObjectByName(`RightHand${name}`).getWorldPosition(new T.Vector3()));
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
    const [base, pip, dip, tip] = [1, 2, 3, 4].map(index => point(finger + index));
    const proximal = pip.clone().sub(base).normalize(), middle = dip.clone().sub(pip).normalize();
    assert.ok(proximal.dot(middle) < .8, `${finger}: proximal joint must visibly bend, not form a straight bar`);
    assert.ok(tip.y < dip.y - .005, `${finger}: fingertip turns back around the handle`);
  }
  const opposed = point('Index2').add(point('Middle2')).multiplyScalar(.5);
  assert.ok(point('Thumb4').distanceTo(opposed) < .02, 'thumb pad closes across the curled upper fingers');
});

test('dadao shows the whole carry fist and keeps its right elbow outboard without wrist folding or pole flips', () => {
  for (const aspect of [1.6, 450 / 1100, 360 / 1000]) {
    const camera = new T.PerspectiveCamera(72, aspect, .07, 20), view = dadaoViewModel((side, options) =>
      createNraGrenadeHand(source, side, { fullArm: true, ...options }));
    camera.add(view); camera.updateMatrixWorld(true);
    const arm = view.userData.dadaoArm;
    let previousElbow = null;
    for (const phase of ['draw', 'ready', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 100; frame++) {
      updateDadaoView(view, { phase, progress: frame / 100 }, { weaponX: 0, weaponY: 0 }, camera);
      assert.ok(arm.armSnapshot.reachable && arm.armSnapshot.error < 1e-6, `${aspect}/${phase}/${frame}: ${JSON.stringify(arm.armSnapshot)}`);
      const wrist = new T.Vector3(...arm.armSnapshot.wrist), elbow = new T.Vector3(...arm.armSnapshot.elbow);
      if (previousElbow) assert.ok(elbow.distanceTo(previousElbow) < .025, `${aspect}/${phase}/${frame}: elbow snaps between IK solutions`);
      previousElbow = elbow.clone();
      assert.ok(elbow.z < -.12, `${aspect}/${phase}/${frame}: elbow approaches the camera near plane`);
      const forward = new T.Vector3(0, 1, 0).applyQuaternion(arm.attachmentFrame.getWorldQuaternion(new T.Quaternion()));
      const wristAlignment = wrist.clone().sub(elbow).normalize().dot(forward);
      assert.ok(wristAlignment > .65, `${aspect}/${phase}/${frame}: wrist flexes too far ` +
        JSON.stringify({ wristAlignment, wrist: wrist.toArray(), elbow: elbow.toArray(), forward: forward.toArray() }));
      if (['windup', 'cut', 'recover'].includes(phase)) {
        assert.ok(elbow.x > wrist.x + .03, `${aspect}/${phase}/${frame}: right elbow folds inward across the grip`);
        assert.ok(elbow.x / -elbow.z > wrist.x / -wrist.z + .025,
          `${aspect}/${phase}/${frame}: elbow must appear to the right of the wrist, not just be farther away`);
      }
      if (phase === 'ready') {
        for (const name of ['RightHand', ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap(finger =>
          [1, 2, 3, 4].map(index => `RightHand${finger}${index}`))]) {
          const projected = arm.getObjectByName(name).getWorldPosition(new T.Vector3()).project(camera);
          assert.ok(Math.abs(projected.x) < .95 && Math.abs(projected.y) < .95, `${aspect}/${name}: fist is clipped ${projected.toArray()}`);
        }
        const project = point => {
          const value = point.project(camera);
          return new T.Vector2(value.x * aspect, value.y);
        };
        const fistSpan = project(arm.getObjectByName('RightHandIndex1').getWorldPosition(new T.Vector3()))
          .distanceTo(project(arm.getObjectByName('RightHandPinky1').getWorldPosition(new T.Vector3())));
        const sword = view.userData.dadaoHand;
        const bladeSpan = project(sword.localToWorld(new T.Vector3(.071, .62, 0)))
          .distanceTo(project(sword.localToWorld(new T.Vector3(0, .045, 0))));
        assert.ok(fistSpan / bladeSpan > .09 && fistSpan / bladeSpan < .23,
          `${aspect}: perspective makes the fist disproportionate to the blade (${fistSpan / bladeSpan})`);
      }
    }
  }
});

test('dadao keeps both hands on the same handle with natural wrists and continuous original arm bones', () => {
  for (const aspect of [.35, .36, 450 / 1100, .55, .8, 1.1, 1.6, 2.4]) {
    const camera = new T.PerspectiveCamera(72, aspect, .07, 20);
    const view = dadaoViewModel((side, options) => createNraGrenadeHand(source, side, { fullArm: true, ...options }));
    camera.add(view); camera.updateMatrixWorld(true);
    const hands = [view.userData.dadaoArm, view.userData.dadaoLeftArm], bones = [];
    for (const hand of hands) hand.traverse(node => {
      if (node.isBone) bones.push([node, node.position.clone(), node.scale.clone()]);
    });
    const previous = [null, null], sword = view.userData.dadaoHand;
    for (const phase of ['draw', 'ready', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 100; frame++) {
      updateDadaoView(view, { phase, progress: frame / 100 }, { weaponX: .003, weaponY: -.002 }, camera);
      hands.forEach((hand, index) => {
        const label = `${aspect}/${phase}/${frame}/${index ? 'left' : 'right'}`, state = hand.armSnapshot;
        assert.ok(state.reachable && state.error < 1e-6, `${label}: arm cannot reach the grip`);
        const wrist = new T.Vector3(...state.wrist), elbow = new T.Vector3(...state.elbow);
        const forward = new T.Vector3(0, 1, 0).applyQuaternion(hand.attachmentFrame.getWorldQuaternion(new T.Quaternion()));
        assert.ok(wrist.clone().sub(elbow).normalize().dot(forward) > .65, `${label}: wrist folds against the forearm`);
        assert.ok(elbow.z < -.12, `${label}: elbow approaches the near plane`);
        if (previous[index]) assert.ok(elbow.distanceTo(previous[index]) < .025, `${label}: elbow snaps between IK branches`);
        previous[index] = elbow;
        const actual = hand.attachmentFrame.localToWorld(new T.Vector3(...hand.userData.throwableGrips.dadao));
        const target = sword.localToWorld(new T.Vector3(0, index ? -.12 : DADAO_DIMENSIONS.gripCenter, 0));
        assert.ok(actual.distanceTo(target) < 1e-6, `${label}: hand detaches from the handle`);
      });
    }
    for (const [bone, position, scale] of bones) {
      assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale);
    }
  }
});

test('wide-screen chops leave most of the battlefield visible instead of filling the eye with sleeves', () => {
  const camera = new T.PerspectiveCamera(72, 16 / 9, .07, 20);
  const view = dadaoViewModel((side, options) => createNraGrenadeHand(source, side, { fullArm: true, ...options }));
  camera.add(view); camera.updateMatrixWorld(true);
  const meshes = [];
  view.traverse(mesh => { if (mesh.isMesh && mesh.visible) meshes.push(mesh); });
  const ray = new T.Raycaster();
  for (const [phase, progress] of [['cut', .4], ['cut', .6], ['cut', .8], ['cut', 1], ['recover', .2], ['recover', .5]]) {
    updateDadaoView(view, { phase, progress }, { weaponX: 0, weaponY: 0 }, camera);
    for (const mesh of meshes) if (mesh.isSkinnedMesh) {
      mesh.skeleton.update(); mesh.computeBoundingSphere(); mesh.computeBoundingBox();
    }
    let covered = 0;
    for (let row = 0; row < 11; row++) for (let column = 0; column < 19; column++) {
      ray.setFromCamera(new T.Vector2(-.95 + 1.9 * column / 18, -.95 + 1.9 * row / 10), camera);
      if (ray.intersectObjects(meshes, false).length) covered++;
    }
    assert.ok(covered / 209 < .4, `${phase}/${progress}: weapon and sleeves obscure ${covered}/209 of the view`);
  }
});

test('third-person shoulder and overhead chops preserve both wrists, real grips and continuous original bones', () => {
  const body = new T.Group(), avatar = clone(source), bones = prepareNraRig(avatar).canonical;
  body.add(avatar);
  body.updateMatrixWorld(true);
  const grips = {};
  for (const [side, prefix] of [['right', 'Right'], ['left', 'Left']]) {
    const hand = createNraGrenadeHand(source, side); hand.poseGrip(1, 0, 'dadao');
    const fingers = new Map(); let wristRotation;
    hand.traverse(node => {
      if (node.isBone && node.name.startsWith(prefix + 'Hand') && node.name !== prefix + 'Hand')
        fingers.set(node.name, node.quaternion.clone());
      if (node.name === prefix + 'Hand') wristRotation = node.getWorldQuaternion(new T.Quaternion());
    });
    grips[side] = { fingers, wristRotation, center: new T.Vector3(...hand.userData.throwableGrips.dadao) };
  }
  const pose = createNraDadaoPose(body, bones, { ...grips.right, left: grips.left });
  const original = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.scale.clone()]);
  for (const style of [0, 1]) {
    let previous = null;
    for (const phase of ['ready', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 100; frame++) {
      pose.update({ style, phase, progress: frame / 100 });
      const sample = pose.snapshot, label = `${style}/${phase}/${frame}`;
      assert.equal(pose.issue, null, `${label}: ${JSON.stringify(sample)}`);
      assert.ok(sample.wristAlignment > .65 && sample.leftWristAlignment > .65, `${label}: wrist folds`);
      assert.ok(sample.error < 1e-6 && sample.leftPalmError < 1e-6, `${label}: hand detaches`);
      const elbows = ['RightForeArm', 'LeftForeArm'].map(name => bones.get(name).getWorldPosition(new T.Vector3()));
      if (frame === 0 && previous) elbows.forEach((point, index) =>
        assert.ok(point.distanceTo(previous[index]) < 1e-6, `${label}: phase-boundary jump`));
      if (frame > 0) {
        pose.update({ style, phase, progress: frame / 100 - 1e-6 });
        ['RightForeArm', 'LeftForeArm'].forEach((name, index) =>
          assert.ok(bones.get(name).getWorldPosition(new T.Vector3()).distanceTo(elbows[index]) < .0001,
            `${label}: IK branch discontinuity`));
      }
      previous = elbows;
    }
  }
  for (const [bone, position, scale] of original) {
    assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale);
  }
});

test('dadao keeps cropped native sleeve edges out of sight', () => {
  const originals = new Map();
  source.traverse(mesh => { if (mesh.isSkinnedMesh) originals.set(mesh.name, mesh.geometry); });
  for (const aspect of [1.6, 450 / 1100, 360 / 1000]) {
    const camera = new T.PerspectiveCamera(72, aspect, .07, 20);
    const view = dadaoViewModel((side, options) => createNraGrenadeHand(source, side, { fullArm: true, ...options }));
    camera.add(view); camera.updateMatrixWorld(true);
    const cuts = [], sleeves = [];
    view.traverse(mesh => {
      if (!mesh.isSkinnedMesh || !mesh.visible || !['衣服', '臂章'].includes(mesh.name)) return;
      mesh.material = mesh.material.clone(); mesh.material.side = T.DoubleSide; sleeves.push(mesh);
      const original = originals.get(mesh.name), geometry = mesh.geometry;
      const key = (geometry, index) => new T.Vector3().fromBufferAttribute(geometry.attributes.position, index)
        .toArray().map(value => value.toFixed(4)).join(',');
      const edges = geometry => {
        const counts = new Map();
        for (let at = 0; at < (geometry.index?.count ?? geometry.attributes.position.count); at += 3) {
          const ids = [0, 1, 2].map(corner => geometry.index ? geometry.index.getX(at + corner) : at + corner);
          for (let corner = 0; corner < 3; corner++) {
            const ends = [ids[corner], ids[(corner + 1) % 3]], name = ends.map(index => key(geometry, index)).sort().join('|');
            if (!counts.has(name)) counts.set(name, { count: 0, ends });
            counts.get(name).count++;
          }
        }
        return counts;
      };
      const originalEdges = edges(original);
      for (const [name, edge] of edges(geometry)) if (edge.count === 1 && originalEdges.get(name)?.count !== 1)
        for (const index of edge.ends) cuts.push({ mesh, index });
    });
    assert.ok(cuts.length > 0, 'inspect actual cropped edges, not the original open wrist cuff');
    let closest = { margin: Infinity };
    for (const phase of ['draw', 'ready', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 20; frame++) {
      updateDadaoView(view, { phase, progress: frame / 20 }, { weaponX: 0, weaponY: 0 }, camera);
      for (const sleeve of sleeves) {
        sleeve.skeleton.update(); sleeve.computeBoundingSphere(); sleeve.computeBoundingBox();
      }
      for (const { mesh, index } of cuts) {
        const world = mesh.localToWorld(mesh.getVertexPosition(index, new T.Vector3()));
        const point = world.clone().project(camera), eye = camera.getWorldPosition(new T.Vector3());
        const direction = world.sub(eye);
        const ray = new T.Raycaster(eye, direction.clone().normalize(), camera.near, direction.length() - .002);
        if (ray.intersectObjects(sleeves, false).length > 0) continue;
        const margin = Math.max(Math.abs(point.x), Math.abs(point.y));
        if (Math.abs(point.z) <= 1 && margin < closest.margin) {
          closest = { margin, phase, frame, point: point.toArray(), mesh: mesh.name, index,
            weights: [0, 1, 2, 3].map(slot => [
              mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(index, slot)].name,
              mesh.geometry.attributes.skinWeight.getComponent(index, slot)]) };
        }
      }
    }
    assert.ok(closest.margin > 1.02, `${aspect}: cropped sleeve edge enters the frame (${JSON.stringify(closest)})`);
  }
});

test('the real blade cuts in its own plane, exposes curled fingers at the finish and has continuous phases', () => {
  for (const aspect of [1.6, 450 / 1100, 360 / 1000]) {
    const camera = new T.PerspectiveCamera(72, aspect, .07, 20), view = dadaoViewModel((side, options) =>
      createNraGrenadeHand(source, side, { fullArm: true, ...options }));
    camera.add(view); camera.updateMatrixWorld(true);
    const blade = view.userData.dadaoHand, arm = view.userData.dadaoArm, motion = { weaponX: 0, weaponY: 0 };
    const sleeves = [];
    arm.traverse(node => {
      if (!node.isSkinnedMesh || !node.visible || !['衣服', '臂章'].includes(node.name)) return;
      node.material = node.material.clone();
      node.material.side = T.DoubleSide;
      sleeves.push(node);
    });
    assert.ok(sleeves.length > 0, 'test the retained sleeve, not an empty occluder list');
    const pose = (phase, progress) => {
      updateDadaoView(view, { phase, progress }, motion, camera);
      return { tip: blade.localToWorld(new T.Vector3(.071, .62, 0)),
        edgePoints: [.3, .45, .6].map(y => blade.localToWorld(new T.Vector3(.04, y, 0))),
        elbow: new T.Vector3(...arm.armSnapshot.elbow),
        rotation: blade.quaternion.clone() };
    };
    for (const [before, after] of [['draw', 'ready'], ['windup', 'cut'], ['cut', 'recover'], ['recover', 'ready']]) {
      const end = pose(before, 1), start = pose(after, 0);
      assert.ok(end.tip.distanceTo(start.tip) < 1e-6, `${aspect}/${before}: tip teleports at the phase boundary`);
      assert.ok(end.elbow.distanceTo(start.elbow) < 1e-6, `${aspect}/${before}: elbow jumps at the phase boundary`);
      const angle = end.rotation.normalize().angleTo(start.rotation.normalize());
      assert.ok(angle < 1e-6, `${aspect}/${before}: wrist snaps at the phase boundary (${angle})`);
    }
    const raised = pose('cut', 0).tip, lowered = pose('cut', 1).tip;
    assert.ok(raised.x - lowered.x > .5 && raised.y - lowered.y > .8, 'tip travels right-high to left-low, not horizontally');
    for (const progress of [.7, .8, .9, 1]) {
      pose('windup', progress);
      assert.ok(new T.Vector3(1, 0, 0).applyQuaternion(blade.quaternion).z < -.35, 'raised cutting edge faces forward');
    }
    let crosshairDistance = Infinity;
    for (let frame = 20; frame <= 80; frame++) {
      const before = pose('cut', (frame - 1) / 100);
      const current = pose('cut', frame / 100);
      const edge = new T.Vector3(1, 0, 0).applyQuaternion(blade.quaternion);
      const face = new T.Vector3(0, 0, 1).applyQuaternion(blade.quaternion);
      for (const [section, point] of current.edgePoints.entries()) {
        const velocity = point.clone().sub(before.edgePoints[section]).normalize();
        assert.ok(edge.dot(velocity) > .9, `${aspect}/${frame}/${section}: blade edge must follow the cut, not merely have a positive component (${edge.dot(velocity)})`);
        assert.ok(Math.abs(face.dot(velocity)) < .1, `${aspect}/${frame}/${section}: broad face leads a slap rather than a cut`);
      }
      for (let section = 0; frame >= 40 && frame <= 60 && section <= 20; section++) {
        const point = blade.localToWorld(new T.Vector3(.04, .1 + .52 * section / 20, 0)).project(camera);
        crosshairDistance = Math.min(crosshairDistance, Math.hypot(point.x * aspect, point.y));
      }
    }
    assert.ok(crosshairDistance < .15, `${aspect}: visible blade misses the crosshair (${crosshairDistance})`);
    const joint = name => arm.getObjectByName(`RightHand${name}`).getWorldPosition(new T.Vector3());
    for (const progress of [0, .05, .1, .2]) {
      pose('recover', progress);
      for (const sleeve of sleeves) {
        sleeve.skeleton.update();
        sleeve.computeBoundingSphere(); sleeve.computeBoundingBox();
      }
      const wrist = joint(''), middle = joint('Middle1'), across = joint('Index1').sub(joint('Pinky1'));
      const palm = across.cross(middle.clone().sub(wrist)).normalize();
      const toEye = camera.getWorldPosition(new T.Vector3()).sub(wrist.clone().lerp(middle, .5)).normalize();
      assert.ok(palm.dot(toEye) > .3, `${aspect}/${progress}: show the curled-finger side, not the back of the hand`);
      assert.ok(new T.Vector3(1, 0, 0).applyQuaternion(blade.quaternion).z > .35, 'recovery cutting edge turns inward with the hand');
      const visible = ['Index', 'Middle', 'Ring', 'Pinky'].filter(finger => {
        const point = joint(`${finger}2`), projected = point.clone().project(camera);
        const origin = camera.getWorldPosition(new T.Vector3()), direction = point.sub(origin);
        const ray = new T.Raycaster(origin, direction.clone().normalize(), camera.near, direction.length() - .01);
        return Math.abs(projected.x) < .95 && Math.abs(projected.y) < .95 && ray.intersectObjects(sleeves, false).length === 0;
      });
      assert.ok(visible.length >= 3, `${aspect}/${progress}: curled fingers are clipped or sleeve-occluded (${visible})`);
    }
  }
});

test('native throwable arms isolate authorized sleeve/skin, preserve source resources and solve a full unstretched chain', () => {
  const original = [...rig.canonical.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  for (const side of ['left', 'right']) {
    const arm = createNraGrenadeHand(source, side, { fullArm: true }), prefix = side === 'right' ? 'Right' : 'Left';
    const bones = new Map(), visible = [];
    arm.traverse(node => { if (node.isBone) bones.set(node.name, node); });
    arm.traverseVisible(node => { if (node.isMesh) visible.push(node); });
    assert.ok(visible.some(mesh => mesh.name === '衣服'));
    assert.ok(visible.every(mesh => mesh.isSkinnedMesh && ['衣服', '臂章', '手部'].includes(mesh.name)));
    for (const mesh of visible) {
      const native = rig.meshes.find(original => original.name === mesh.name);
      const originalMaterial = Array.isArray(native.material) ? native.material[0] : native.material;
      assert.equal(mesh.material.map, originalMaterial.map, 'owner-specific glove/sleeve shaders reuse the authorized texture');
      assert.ok(mesh.material.color.equals(originalMaterial.color), 'base pigmentation is unchanged');
      assert.notEqual(mesh.geometry, native.geometry);
      assert.deepEqual(mesh.geometry.attributes.uv.array, native.geometry.attributes.uv.array);
    }
    const positions = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.scale.clone()]);
    for (const kind of ['grenade', 'explosive-pack']) for (const phase of ['idle', 'drawing', 'cooking', 'throwing', 'recovering']) {
      for (const progress of [0, .25, .6, .9, 1]) {
        const profile = throwableProfile(kind), duration = profile[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
        const motion = throwableViewPose(phase === 'idle' ? null : { kind, phase, elapsed: progress * duration }, kind);
        const sign = side === 'right' ? 1 : -1;
        motion.wrist.x *= sign;
        const pole = motion.pole.clone(); pole.x *= sign;
        arm.poseArm(new T.Vector3(sign * .2, -.25, -.03), motion.wrist, motion.rotation, pole);
        const wristRotation = bones.get(prefix + 'Hand').quaternion.clone();
        arm.poseGrip(1 - motion.opening, 0, kind);
        assert.deepEqual(bones.get(prefix + 'Hand').quaternion.toArray(), wristRotation.toArray(), 'grip cache must not reset wrist IK');
        assert.ok(arm.armSnapshot.reachable && arm.armSnapshot.error < 1e-6, JSON.stringify(arm.armSnapshot));
        assert.ok(new T.Vector3(...arm.armSnapshot.frame).distanceTo(motion.wrist) < 1e-6);
        for (const [bone, position, scale] of positions) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.scale, scale); }
      }
    }
  }
  for (const [bone, position, rotation] of original) { assert.deepEqual(bone.position, position); assert.deepEqual(bone.quaternion.toArray(), rotation.toArray()); }
});

test('helper pinches with actual index/thumb endpoints, not a second imaginary item grip', () => {
  const hand = createNraGrenadeHand(source, 'left', { fullArm: true });
  hand.poseArm(new T.Vector3(-.2, -.25, -.03), new T.Vector3(-.1, -.25, -.30),
    new T.Quaternion(), new T.Vector3(-.8, -.65, .25));
  hand.posePreparation(1);
  const target = hand.attachmentFrame.localToWorld(new T.Vector3(...hand.userData.preparationGrip));
  for (const name of ['LeftHandIndex4', 'LeftHandThumb4']) {
    assert.ok(hand.getObjectByName(name).getWorldPosition(new T.Vector3()).distanceTo(target) < .003, name);
  }
});

test('presentation is continuous at phase boundaries and opens only in the final release interval', () => {
  for (const kind of ['grenade', 'explosive-pack']) {
    const p = throwableProfile(kind);
    const sample = (phase, elapsed) => throwableViewPose(phase ? { phase, elapsed, kind } : null, kind);
    for (const [first, second] of [[sample(null, 0), sample('drawing', 0)],
      [sample('drawing', p.draw), sample('cooking', 0)],
      [sample('cooking', 1), sample('throwing', 0)],
      [sample('throwing', p.windup), sample('recovering', 0)]]) {
      assert.ok(first.wrist.distanceTo(second.wrist) < 1e-8);
      assert.ok(first.rotation.angleTo(second.rotation) < 1e-7);
      assert.equal(first.opening, second.opening);
      assert.equal(first.preparation, second.preparation);
      assert.equal(first.guiding, second.guiding);
    }
    assert.equal(sample('throwing', p.windup * .87).opening, 0);
    assert.ok(sample('throwing', p.windup * .98).opening > .4);
    assert.ok(sample('throwing', p.windup).opening < .65, 'release is never a fully splayed palm');
  }
});

test('overhand load clears the head, keeps the shoulder fixed and withdraws a relaxed hand outside the central view', () => {
  const camera = new T.PerspectiveCamera(75, 1440 / 900, .025, 20);
  camera.updateMatrixWorld();
  for (const kind of ['grenade', 'explosive-pack']) {
    const profile = throwableProfile(kind);
    const loaded = throwableViewPose({ phase: 'cooking', elapsed: 0, kind }, kind);
    assert.ok(loaded.wrist.x >= .35 && loaded.wrist.z > .1 && loaded.wrist.y > 0, 'load is beside/behind the throwing shoulder');
    const arm = createNraGrenadeHand(source, 'right', { fullArm: true });
    for (const phase of ['idle', 'cooking', 'throwing', 'recovering']) for (let frame = 0; frame <= 100; frame++) {
      const progress = frame / 100, duration = phase === 'throwing' ? profile.windup : profile.recovery;
      const motion = throwableViewPose(phase === 'idle' ? null : { kind, phase, elapsed: progress * duration }, kind);
      arm.poseArm(new T.Vector3(.2, -.25, -.03), motion.wrist, motion.rotation, motion.pole);
      arm.poseGrip(1 - motion.opening, 0, kind);
      assert.ok(arm.armSnapshot.reachable && arm.armSnapshot.error < 1e-6);
      assert.ok(new T.Vector3(...arm.armSnapshot.shoulder).distanceTo(new T.Vector3(.2, -.25, -.03)) < 1e-8);
      const forearm = motion.wrist.clone().sub(new T.Vector3(...arm.armSnapshot.elbow)).normalize();
      assert.ok(forearm.dot(motion.forward) > .15, `${kind}/${phase}/${progress}: wrist must not fold back across the forearm`);
      if (phase === 'throwing' && motion.wrist.z > -.05) assert.ok(motion.wrist.x > .32, 'wrist never winds through the head');
      if (['idle', 'recovering'].includes(phase)) {
        assert.ok(motion.palm.dot(motion.wrist.clone().negate().normalize()) < .1, `${kind}/${phase}/${progress}: palm faces camera`);
      }
      if (phase === 'recovering') {
        assert.ok(arm.gripSnapshot.closure >= .4 && arm.gripSnapshot.closure <= .6, 'relaxed curled fingers throughout recovery');
        const projected = motion.wrist.clone().project(camera);
        assert.ok(Math.abs(projected.x) > .72 || Math.abs(projected.y) > 1, 'recovery never occupies the central view');
        if (progress >= .48) {
          for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
            const tip = arm.getObjectByName(`RightHand${finger}4`).getWorldPosition(new T.Vector3()).project(camera);
            assert.ok(Math.abs(tip.x) > 1 || Math.abs(tip.y) > 1, 'relaxed fingertips have naturally left the view by mid-recovery');
          }
        }
      }
    }
  }
  const grenade = throwableViewPose({ kind: 'grenade', phase: 'drawing', elapsed: throwableProfile('grenade').draw * .65 });
  const pack = throwableViewPose({ kind: 'explosive-pack', phase: 'drawing', elapsed: throwableProfile('explosive-pack').draw * .65 });
  assert.ok(grenade.wrist.distanceTo(pack.wrist) > .035, 'heavier pack loads longer and farther outside the shoulder');
});

test('preparation cocks the right arm before cooking and leaves a relaxed angled left guide until forward release', () => {
  for (const kind of ['grenade', 'explosive-pack']) {
    const profile = throwableProfile(kind), loaded = throwableViewPose({ kind, phase: 'cooking', elapsed: 0 });
    const drawEnd = throwableViewPose({ kind, phase: 'drawing', elapsed: profile.draw });
    assert.ok(drawEnd.wrist.distanceTo(loaded.wrist) < 1e-8 && loaded.wrist.z > .1);
    assert.equal(loaded.guiding, 1);
    const cameraDirection = loaded.guide.wrist.clone().negate().normalize();
    assert.ok(loaded.guide.palm.dot(cameraDirection) * loaded.guide.palmSide < .1, 'guide is angled away, not a camera-facing open palm');
    let previousZ = loaded.wrist.z;
    for (let frame = 0; frame <= 100; frame++) {
      const sample = throwableViewPose({ kind, phase: 'throwing', elapsed: profile.windup * frame / 100 });
      assert.ok(sample.wrist.z <= previousZ + 1e-10, 'release has no second backswing');
      previousZ = sample.wrist.z;
    }
  }
});

test('shared world overhand pose remains reachable and preserves the exact legacy physical launch position', () => {
  const avatar = clone(source), bones = new Map();
  avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const rest = ['RightArm', 'RightForeArm', 'RightHand'].map(name => [bones.get(name), bones.get(name).quaternion.clone()]);
  for (const kind of ['grenade', 'explosive-pack']) {
    const profile = throwableProfile(kind);
    for (const phase of ['drawing', 'cooking', 'throwing', 'recovering']) for (let frame = 0; frame <= 50; frame++) {
      for (const [bone, rotation] of rest) bone.quaternion.copy(rotation);
      avatar.updateMatrixWorld(true);
      const duration = phase === 'drawing' ? profile.draw : phase === 'throwing' ? profile.windup : profile.recovery;
      const pose = grenadePose({ kind, phase, elapsed: duration * frame / 50 });
      const result = solveArm(bones.get('RightArm'), bones.get('RightForeArm'), bones.get('RightHand'),
        new T.Vector3(...pose.hand), new T.Vector3(...pose.view.pole));
      assert.ok(result.reachable && result.error < 1e-6, `${kind}/${phase}/${frame}: ${JSON.stringify(result)}`);
    }
    for (const eye of [.45, .92, 1.67]) {
      const launch = grenadePose({ kind, phase: 'throwing', elapsed: profile.windup }, eye);
      assert.ok(new T.Vector3(...launch.position).distanceTo(new T.Vector3(.32, eye - .01, -.48)) < 1e-12);
      const recovery = grenadePose({ kind, phase: 'recovering', elapsed: 0 }, eye);
      assert.deepEqual(recovery.hand, launch.hand);
    }
  }
});

test('third-person grenade arm consumes the same overhand wrist, elbow hint and natural hand roll', () => {
  const root = new T.Group(), avatar = clone(source), bones = new Map(), gun = new T.Group();
  root.add(avatar); root.updateMatrixWorld(true);
  avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const rifle = createNraRiflePose(root, bones, gun);
  for (const kind of ['grenade', 'explosive-pack']) for (const [phase, progress] of [
    ['cooking', 0], ['throwing', .52], ['throwing', 1], ['recovering', .5],
  ]) {
    const profile = throwableProfile(kind), duration = phase === 'throwing' ? profile.windup : profile.recovery;
    const grenade = grenadePose({ kind, phase, elapsed: progress * duration });
    rifle.update({ weaponPosition: [.1, 1.3, -.25], weaponQuaternion: [0, 0, 0, 1], grenade });
    const wrist = bones.get('RightHand').getWorldPosition(new T.Vector3());
    assert.ok(wrist.distanceTo(new T.Vector3(...grenade.hand)) < 1e-6);
    const forward = bones.get('RightHandMiddle1').getWorldPosition(new T.Vector3()).sub(wrist).normalize();
    const across = bones.get('RightHandIndex1').getWorldPosition(new T.Vector3())
      .sub(bones.get('RightHandPinky1').getWorldPosition(new T.Vector3())).normalize();
    const palm = across.cross(forward).normalize(), expected = new T.Vector3(...grenade.view.palm);
    expected.addScaledVector(forward, -expected.dot(forward)).normalize();
    assert.ok(palm.dot(expected) > .9999, `${kind}/${phase}: world and first-person palm roll must agree`);
  }
});

test('actual crouched and prone skeletons keep both throwing and guiding arms reachable and clear of head and ground', () => {
  const root = new T.Group(), avatar = clone(source), bones = new Map(), meshes = [];
  root.add(avatar); root.updateMatrixWorld(true);
  avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) meshes.push(node); });
  const postures = createNativePosturePoses(avatar, bones), mixer = new T.AnimationMixer(meshes[0]);
  const rest = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  const rifle = createNraRiflePose(root, bones, new T.Group());
  for (const stance of ['standing', 'crouched', 'prone']) {
    mixer.stopAllAction();
    for (const [bone, position, rotation] of rest) { bone.position.copy(position); bone.quaternion.copy(rotation); }
    if (stance !== 'standing') { const action = mixer.clipAction(postures[stance].clip); action.play(); action.paused = true; action.time = 0; mixer.update(0); }
    root.updateMatrixWorld(true);
    const shoulders = ['RightArm', 'LeftArm'].map(name => bones.get(name).getWorldPosition(new T.Vector3()));
    const eye = FIRING_POSES[stance]?.eye ?? 1.67;
    for (const kind of ['grenade', 'explosive-pack']) for (const phase of ['drawing', 'cooking', 'throwing', 'recovering']) {
      for (let step = 0; step <= 20; step++) {
        const profile = throwableProfile(kind), duration = profile[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
        const grenade = grenadePose({ kind, phase, elapsed: duration * step / 20 }, eye);
        rifle.update({ weaponPosition: postures[stance]?.carry.positions.slice(0, 3) ?? [.1, 1.3, -.25],
          weaponQuaternion: [0, 0, 0, 1], grenade });
        const wrist = bones.get('RightHand').getWorldPosition(new T.Vector3());
        assert.ok(wrist.distanceTo(new T.Vector3(...grenade.hand)) < 1e-6, `${stance}/${kind}/${phase}/${step}: unreachable throwing wrist`);
        for (const [index, side] of ['Right', 'Left'].entries()) {
          assert.ok(bones.get(side + 'Arm').getWorldPosition(new T.Vector3()).distanceTo(shoulders[index]) < 1e-8,
            `${stance}/${side}/${phase}: shoulder must stay attached to the original body`);
          if (side === 'Right' || grenade.view.guiding === 1) {
            const elbow = bones.get(side + 'ForeArm').getWorldPosition(new T.Vector3());
            const hand = bones.get(side + 'Hand').getWorldPosition(new T.Vector3());
            assert.ok(elbow.y >= .025 && hand.y >= .09, `${stance}/${side}/${phase}: arm intersects ground`);
            assert.ok(hand.distanceTo(bones.get('Head').getWorldPosition(new T.Vector3())) > .14, `${stance}: hand winds through head`);
          }
        }
        if (grenade.view.guiding === 1) assert.ok(bones.get('LeftHand').getWorldPosition(new T.Vector3())
          .distanceTo(new T.Vector3(...grenade.guideHand)) < 1e-6);
      }
    }
  }
});

test('native and diagnostic renderers preserve hiding, item ownership and solved wrist attachment', () => {
  for (const native of [true, false]) {
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(), hands = [];
    scene.add(camera); camera.position.set(1, 2, 3); camera.rotation.set(.3, -.5, .2);
    const renderer = native ? createGrenadeRenderer(scene, camera, side => {
      const hand = createNraGrenadeHand(source, side, { fullArm: true }); hands.push(hand); return hand;
    }) : createGrenadeRenderer(scene, camera);
    const actor = { id: 'owner', health: 100, grenades: { ammo: 1, packs: 1, action: null } };
    for (const kind of ['grenade', 'explosive-pack']) {
      for (const phase of ['idle', 'drawing', 'cooking', 'throwing', 'recovering']) {
        for (const progress of [...Array.from({ length: 21 }, (_, index) => index / 20), .72]) {
          const profile = throwableProfile(kind), duration = profile[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
          actor.grenades.action = phase === 'idle' ? null : { phase, kind, elapsed: progress * duration };
          renderer.update([], actor, true, true, kind);
          assert.equal(renderer.snapshot.handVisible, true);
          assert.equal(renderer.snapshot.heldVisible, phase !== 'recovering');
          if (native) assert.ok(renderer.snapshot.arms.every(arm => arm.reachable && arm.error < 1e-6),
            `${kind}/${phase}: ${JSON.stringify(renderer.snapshot.arms)}`);
          if (native && phase === 'drawing' && progress === .3) {
            const held = hands[1].parent.children.find(node => node.visible &&
              node.getObjectByName(kind === 'grenade' ? 'safety-ring' : 'pull-handle'));
            const handle = held.getObjectByName(kind === 'grenade' ? 'safety-ring' : 'pull-handle');
            const target = kind === 'grenade' ? handle.localToWorld(new T.Vector3(.009, .067, .011)) : handle.getWorldPosition(new T.Vector3());
            for (const finger of ['Index', 'Thumb']) assert.ok(
              hands[0].getObjectByName(`LeftHand${finger}4`).getWorldPosition(new T.Vector3()).distanceTo(target) < .003);
          }
          if (native && phase === 'cooking') {
            assert.equal(renderer.snapshot.guideGrip.closure, .60);
            assert.ok(hands[1].attachmentFrame.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorld.clone().invert()).z > .1);
            const guide = hands[0].attachmentFrame.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorld.clone().invert());
            assert.ok(Math.abs(guide.x) < .25 && guide.y > -.3 && guide.z < -.35, 'left guide stays naturally forward while waiting');
          }
        }
      }
    }
    actor.grenades = { ammo: 0, packs: 0, action: null };
    renderer.update([], actor, true, true);
    assert.equal(renderer.snapshot.handVisible, false);
    renderer.clear();
    assert.equal(renderer.snapshot.views, 0);
  }
});
