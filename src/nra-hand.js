import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { solveArm } from './nra-rifle-pose.js';

export function createNraGrenadeHand(source, side) {
  if (!['left', 'right'].includes(side)) throw new Error('Inspected hand requires its side');
  const prefix = side === 'right' ? 'Right' : 'Left', root = new THREE.Group(), alignment = new THREE.Group(), avatar = clone(source);
  root.name = `${side}-grenade-hand`; root.add(alignment); alignment.add(avatar); root.updateMatrixWorld(true);
  const meshes = [], bones = new Map();
  avatar.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); if (node.isBone) bones.set(node.name, node); });
  const handMesh = meshes.find(mesh => mesh.name === '\u624b\u90e8'), wrist = bones.get(prefix + 'Hand');
  if (!handMesh || !wrist) throw new Error('Native grenade hand is missing its inspected skin and wrist');
  const geometry = handMesh.geometry.clone(), attributes = geometry.attributes, kept = [];
  const owned = index => [0, 1, 2, 3].some(slot => attributes.skinWeight.getComponent(index, slot) > .05 &&
    handMesh.skeleton.bones[attributes.skinIndex.getComponent(index, slot)].name.startsWith(prefix + 'Hand'));
  const count = geometry.index?.count ?? attributes.position.count;
  for (let at = 0; at < count; at += 3) {
    const ids = [0, 1, 2].map(corner => geometry.index ? geometry.index.getX(at + corner) : at + corner);
    if (ids.every(owned)) kept.push(...ids);
  }
  if (kept.length < 60) throw new Error('Inspected hand has no isolated finger surface');
  geometry.clearGroups(); geometry.setIndex(kept); handMesh.geometry = geometry;
  if (Array.isArray(handMesh.material)) handMesh.material = handMesh.material[0];
  avatar.traverse(node => { if (node.isMesh) node.visible = node === handMesh; });
  const point = name => bones.get(prefix + name).getWorldPosition(new THREE.Vector3());
  const origin = point('Hand'), forward = point('HandMiddle1').sub(origin).normalize();
  const across = point('HandIndex1').sub(point('HandPinky1')).normalize();
  across.addScaledVector(forward, -across.dot(forward)).normalize();
  const frame = new THREE.Matrix4().makeBasis(across, forward, across.clone().cross(forward)).setPosition(origin).invert();
  alignment.matrixAutoUpdate = false; alignment.matrix.copy(frame); root.updateMatrixWorld(true);
  const rest = new Map([...bones].filter(([name]) => name.startsWith(prefix + 'Hand'))
    .map(([name, bone]) => [name, bone.quaternion.clone()]));
  root.userData.handSource = 'nra-authorized-skinned-hand';
  root.userData.grenadeGrip = [0, .115, -.04];
  root.userData.fingerCount = 5;
  root.poseGrip = (closure, pinPull = 0) => {
    if (![closure, pinPull].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Invalid native finger pose');
    for (const [name, rotation] of rest) bones.get(name).quaternion.copy(rotation);
    root.updateMatrixWorld(true);
    const facing = root.getWorldQuaternion(new THREE.Quaternion()), axis = new THREE.Vector3(1, 0, 0).applyQuaternion(facing);
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) for (let joint = 1; joint <= 3; joint++) {
      const bone = bones.get(`${prefix}Hand${finger}${joint}`);
      const amount = closure * [ 1.55, 1.3, .7 ][joint - 1] * (pinPull && ['Index', 'Middle'].includes(finger) ? .45 : 1);
      const world = new THREE.Quaternion().setFromAxisAngle(axis, -amount).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      bone.updateMatrixWorld(true);
    }
    const first = bones.get(prefix + 'HandThumb1'), second = bones.get(prefix + 'HandThumb2'), third = bones.get(prefix + 'HandThumb3');
    const target = root.localToWorld(new THREE.Vector3(side === 'right' ? -.012 : .012, .06 + .015 * closure, -.035 * closure));
    const delta = target.sub(first.getWorldPosition(new THREE.Vector3()));
    const a = first.getWorldPosition(new THREE.Vector3()).distanceTo(second.getWorldPosition(new THREE.Vector3()));
    const b = second.getWorldPosition(new THREE.Vector3()).distanceTo(third.getWorldPosition(new THREE.Vector3()));
    delta.clampLength(Math.abs(a - b) + .001, a + b - .001).add(first.getWorldPosition(new THREE.Vector3()));
    solveArm(first, second, third, delta, new THREE.Vector3(side === 'right' ? 1 : -1, 0, .4).applyQuaternion(facing));
    root.updateMatrixWorld(true);
  };
  root.traverse(node => { if (node.isMesh) { node.frustumCulled = false; node.castShadow = false; } });
  return root;
}
