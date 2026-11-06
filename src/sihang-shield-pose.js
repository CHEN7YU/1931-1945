import * as THREE from 'three';
import { solveArm } from './nra-rifle-pose.js';

export const SIHANG_SHIELD_POSES = Object.freeze([
  Object.freeze({ mode: 'roof', slot: 0, active: true, handTarget: Object.freeze([-.3, 1.88, 0]) }),
  Object.freeze({ mode: 'turtle', slot: 0, active: true, handTarget: Object.freeze([-.3, 1.35, -.3]) }),
]);

export const SIHANG_SHIELD_BANKS = Object.freeze([
  ...SIHANG_SHIELD_POSES,
  ...SIHANG_SHIELD_POSES.map(pose => Object.freeze({ ...pose, installing: true })),
]);

export function sihangShieldInstalling(actor) {
  return actor?.sihangShield?.installing === true && sihangShieldPoseIndex(actor) >= 0;
}

export function sihangShieldWalkWeights(phase, weight) {
  const cycle = ((phase - .25) % 1 + 1) % 1;
  const opposite = cycle < .5 ? cycle * 2 : 2 - cycle * 2;
  const strength = THREE.MathUtils.clamp(weight, 0, 1);
  return [(1 - opposite) * strength, opposite * strength];
}

export function createSihangSatchel() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.24, .28, .12),
    new THREE.MeshStandardMaterial({ color: '#65553b', roughness: .95 }));
  mesh.name = 'sihang-demolition-satchel';
  mesh.visible = false;
  return mesh;
}

export function sihangShieldPoseIndex(actor) {
  const shield = actor?.sihangShield;
  if (actor?.team !== 'enemy' || !(actor.health > 0) || actor.casualty || shield?.active !== true ||
    !Number.isInteger(shield.slot) || shield.slot < 0 || shield.slot >= 20 ||
    !Array.isArray(shield.handTarget) || shield.handTarget.length !== 3 ||
    !shield.handTarget.every(Number.isFinite)) return -1;
  return SIHANG_SHIELD_POSES.findIndex(pose => pose.mode === shield.mode);
}

function basis(forward, across) {
  const x = forward.clone().normalize(), y = across.clone().addScaledVector(x, -across.dot(x)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

// Targets are wrist positions in the actor root's metre-space, not the imported avatar's rotated space.
export function createSihangShieldPose(root, bones, satchel = null) {
  const shoulder = bones.get('LeftShoulder'), upper = bones.get('LeftArm');
  const lower = bones.get('LeftForeArm'), hand = bones.get('LeftHand');
  const shoulderRest = shoulder.quaternion.clone();
  const fingers = [...bones].filter(([name]) => /^LeftHand(?:Thumb|Index|Middle|Ring|Pinky)/.test(name))
    .map(([, bone]) => [bone, bone.quaternion.clone()]);
  const position = bone => bone.getWorldPosition(new THREE.Vector3());
  let target = null, time = null, snapshot = null;
  return {
    reset() { target = null; time = null; snapshot = null; if (satchel) satchel.visible = false; },
    update(actor, now) {
      const index = sihangShieldPoseIndex(actor);
      if (index < 0) { this.reset(); return null; }
      const desired = new THREE.Vector3().fromArray(actor.sihangShield.handTarget);
      if (!target || time === null || now <= time) target = desired.clone();
      else target.lerp(desired, 1 - Math.exp(-Math.max(0, now - time) * 12));
      time = now;
      shoulder.quaternion.copy(shoulderRest);
      for (const [bone, rest] of fingers) bone.quaternion.copy(rest);
      root.updateMatrixWorld(true);
      const rotation = root.getWorldQuaternion(new THREE.Quaternion());
      const worldTarget = root.localToWorld(target.clone());
      const armLength = position(upper).distanceTo(position(lower)) + position(lower).distanceTo(position(hand));
      const shoulderLift = THREE.MathUtils.smoothstep(position(upper).distanceTo(worldTarget), armLength * .8, armLength * 1.1);
      if (shoulderLift > 0) {
        // Elevate the native clavicle before reaching overhead; never translate or scale an arm bone.
        const from = position(upper).sub(position(shoulder)).normalize();
        const to = worldTarget.clone().sub(position(shoulder)).normalize();
        const swing = new THREE.Quaternion().setFromUnitVectors(from, to);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
        const elevation = new THREE.Quaternion().slerp(swing, shoulderLift * (angle > 0 ? Math.min(1, .95 / angle) : 1));
        const world = elevation.multiply(shoulder.getWorldQuaternion(new THREE.Quaternion()));
        shoulder.quaternion.copy(shoulder.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
        shoulder.updateMatrixWorld(true);
      }
      const solved = solveArm(upper, lower, hand, worldTarget,
        new THREE.Vector3(-1, .1, .35).applyQuaternion(rotation));
      const roof = index === 0;
      const forward = new THREE.Vector3(0, roof ? 0 : 1, roof ? -1 : 0).applyQuaternion(rotation);
      const normal = new THREE.Vector3(0, roof ? 1 : 0, roof ? 0 : -1).applyQuaternion(rotation);
      const middle = bones.get('LeftHandMiddle1'), first = bones.get('LeftHandIndex1'), last = bones.get('LeftHandPinky1');
      if (middle && first && last) {
        const current = basis(position(middle).sub(position(hand)), position(first).sub(position(last)));
        const desired = basis(forward, normal.clone().cross(forward));
        const world = desired.multiply(current.invert()).multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
        hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
        hand.updateMatrixWorld(true);
      }
      const installing = sihangShieldInstalling(actor);
      let installation = null;
      if (satchel) satchel.visible = installing;
      if (installing) {
        const rightHand = bones.get('RightHand');
        const handTarget = root.localToWorld(new THREE.Vector3(.26, 1.08, -.32));
        const reach = solveArm(bones.get('RightArm'), bones.get('RightForeArm'), rightHand, handTarget,
          new THREE.Vector3(.9, -.3, .2).applyQuaternion(rotation));
        if (satchel) {
          satchel.position.copy(root.worldToLocal(position(rightHand))).y -= .15;
          satchel.quaternion.identity();
          satchel.updateMatrixWorld(true);
        }
        installation = { wrist: position(rightHand).toArray(), worldTarget: handTarget.toArray(),
          reachable: reach.reachable, error: reach.error };
      }
      snapshot = { mode: actor.sihangShield.mode, slot: actor.sihangShield.slot,
        handTarget: actor.sihangShield.handTarget.slice(), localTarget: target.toArray(), worldTarget: worldTarget.toArray(),
        wrist: position(hand).toArray(), clavicle: position(shoulder).toArray(),
        upperOrigin: position(upper).toArray(), reachable: solved.reachable, error: solved.error,
        upperLength: position(upper).distanceTo(position(lower)), lowerLength: position(lower).distanceTo(position(hand)),
        ...(installation ? { installation } : {}) };
      return snapshot;
    },
    get snapshot() { return snapshot; },
  };
}
