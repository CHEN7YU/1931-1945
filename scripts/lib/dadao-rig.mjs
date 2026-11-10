import { readFileSync } from 'node:fs';
import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../../src/nra-rig.js';
import { createNraGrenadeHand } from '../../src/nra-hand.js';
import { createNraDadaoPose } from '../../src/nra-dadao-pose.js';
import { applyNativeBodyLean } from '../../src/nra-gait.js';
import { dadaoBodyMotion } from '../../src/dadao.js';
import { loadDadaoSurfaces } from '../../src/dadao-surface.js';

export async function swordRig() {
  await loadDadaoSurfaces(1, { async loadAsync(url) { return new T.Texture({ src: url }); } });
  const manager = new T.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
  const bytes = readFileSync(new URL('../../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const bones = prepareNraRig(model).canonical, avatar = new T.Group(), body = new T.Group();
  const bounds = new T.Box3().setFromObject(model);
  avatar.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); avatar.rotation.y = Math.PI;
  model.position.y -= bounds.min.y; avatar.add(model); body.add(avatar); body.updateMatrixWorld(true);
  const point = name => bones.get(name).getWorldPosition(new T.Vector3());
  const rest = [...bones.values()].map(bone => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
  const grips = {};
  for (const [side, prefix] of [['right', 'Right'], ['left', 'Left']]) {
    const hand = createNraGrenadeHand(avatar, side); hand.poseGrip(1, 0, 'dadao');
    const fingers = new Map(); let wristRotation;
    hand.traverse(node => {
      if (node.isBone && node.name.startsWith(prefix + 'Hand') && node.name !== prefix + 'Hand')
        fingers.set(node.name, node.quaternion.clone());
      if (node.name === prefix + 'Hand') wristRotation = node.getWorldQuaternion(new T.Quaternion());
    });
    grips[side] = { fingers, wristRotation, center: new T.Vector3(...hand.userData.throwableGrips.dadao),
      knuckle: hand.worldToLocal(hand.getObjectByName(prefix + 'HandMiddle1').getWorldPosition(new T.Vector3())),
      lengths: [point(prefix + 'Arm').distanceTo(point(prefix + 'ForeArm')), point(prefix + 'ForeArm').distanceTo(point(prefix + 'Hand'))] };
  }
  const chestRest = bones.get('Spine').getWorldQuaternion(new T.Quaternion());
  const sword = createNraDadaoPose(body, bones, { ...grips.right, left: grips.left });
  const idle = T.AnimationClip.parse(JSON.parse(readFileSync(new URL(
    '../../public/assets/game/nra-88/animations.json', import.meta.url))).idle);
  idle.tracks = idle.tracks.filter(track => !/\.bones\[(?:Left|Right)(?:Arm|ForeArm|Hand)/.test(track.name));
  let skin; avatar.traverse(node => { if (node.isSkinnedMesh && !skin) skin = node; });
  const mixer = new T.AnimationMixer(skin), action = mixer.clipAction(idle); action.play();
  const idlePoses = new Map();
  const reset = (pose, idleTime = 0) => {
    if (!idlePoses.has(idleTime)) {
      mixer.stopAllAction();
      for (const { bone, position, rotation } of rest) { bone.position.copy(position); bone.quaternion.copy(rotation); }
      action.reset().play(); action.time = idleTime; mixer.update(0);
      idlePoses.set(idleTime, [...bones.values()].map(bone => ({ bone,
        position: bone.position.clone(), rotation: bone.quaternion.clone() })));
    }
    for (const { bone, position, rotation } of idlePoses.get(idleTime)) {
      bone.position.copy(position); bone.quaternion.copy(rotation);
    }
    body.updateMatrixWorld(true);
    applyNativeBodyLean(body, bones, { bodyLean: 0, dadao: pose, upperBody: dadaoBodyMotion(pose) });
  };
  const sample = (pose, idleTime = 0, calibration) => { reset(pose, idleTime); sword.update(pose, calibration); };
  const chest = () => bones.get('Spine').getWorldQuaternion(new T.Quaternion()).multiply(chestRest.clone().invert());
  return { body, avatar, bones, grips, point, reset, sample, sword, chest };
}

// Anatomical exclusion volumes include sleeve/forearm thickness, not just joint endpoints.
export function swordBodyVolumes(point) {
  const head = point('Head'), neck = point('Neck'), spine = point('Spine');
  const chest = point('LeftArm').add(point('RightArm')).multiplyScalar(.5);
  return [
    { name: 'head', start: head.clone().add(new T.Vector3(0, .04, 0)),
      end: head.clone().add(new T.Vector3(0, .13, 0)), radius: .105 },
    { name: 'neck', start: neck, end: head, radius: .085 },
    { name: 'upper-chest', start: spine.clone().lerp(chest, .65), end: chest, radius: .115 },
  ];
}

export function segmentClearance(start, end, volume, armRadius = .035) {
  const ray = new T.Ray(start, end.clone().sub(start).normalize());
  const length = start.distanceTo(end);
  const onArm = new T.Vector3(), onBody = new T.Vector3();
  ray.distanceSqToSegment(volume.start, volume.end, onArm, onBody);
  const along = onArm.clone().sub(start).dot(ray.direction);
  if (along > length) onArm.copy(end);
  new T.Line3(volume.start, volume.end).closestPointToPoint(onArm, true, onBody);
  return onArm.distanceTo(onBody) - volume.radius - armRadius;
}
