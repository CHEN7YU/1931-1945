import * as THREE from 'three';
import { supportWeaponPoseIndex, supportWeaponTargets, supportViewShoulders, SUPPORT_CONTACT } from './support-weapon-pose.js';

function handFrame(target, invert = false) {
  const forward = new THREE.Vector3(...target.forward).normalize(), normal = new THREE.Vector3(...target.normal).normalize();
  const across = normal.clone().cross(forward).normalize();
  if (invert) across.negate();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, forward, across.clone().cross(forward)));
}

export function createSupportViewHands(createHand, { applyAppearance = null } = {}) {
  const root = new THREE.Group(), hands = {}, palms = {}, lengths = {};
  const materials = new Map(), geometries = new Set();
  root.name = 'native-support-view-arms'; root.visible = false;
  for (const side of ['left', 'right']) {
    const hand = createHand(side);
    if (!hand.poseArm || !hand.prepareWeaponGrip || !hand.poseWeaponGrip || !hand.userData.armLengths)
      throw new Error('Support view requires the isolated native articulated weapon arms');
    hand.prepareWeaponGrip('support', { center: [0, .055, 0], depth: .022, thickness: .022 });
    hand.prepareWeaponGrip('press', { center: [0, .055, 0], depth: .036, thickness: .036 });
    let wrist = null, middle = null;
    hand.traverse(node => {
      if (node.isBone && node.name === (side === 'left' ? 'LeftHand' : 'RightHand')) wrist = node;
      if (node.isBone && node.name === (side === 'left' ? 'LeftHandMiddle1' : 'RightHandMiddle1')) middle = node;
    });
    if (!wrist || !middle) throw new Error('Support view lacks the actual native palm joints');
    hand.traverseVisible(node => {
      if (!node.isMesh) return;
      geometries.add(node.geometry);
      const isolated = source => {
        // Native hand factories already isolate their shader uniforms; cloning drops those hooks.
        if (!materials.has(source)) materials.set(source, hand.setOfficerAppearance ? source : source.clone());
        return materials.get(source);
      };
      node.material = Array.isArray(node.material) ? node.material.map(isolated) : isolated(node.material);
    });
    hand.updateMatrixWorld(true);
    palms[side] = hand.worldToLocal(wrist.getWorldPosition(new THREE.Vector3())
      .lerp(middle.getWorldPosition(new THREE.Vector3()), .55));
    hand.prepareWeaponGrip('machine', { center: [palms[side].x, palms[side].y,
      palms[side].z + hand.userData.palmFacingAxis * .03], depth: .022, thickness: .022, round: true });
    hands[side] = { hand, wrist, middle }; lengths[side] = hand.userData.armLengths;
    root.add(hand);
  }
  let owner = null, modelOwner = null, appearanceOwner = null, observation = null;
  const reset = () => { root.visible = false; owner = modelOwner = appearanceOwner = null; observation = null; };
  return {
    root,
    reset,
    dispose() {
      reset(); root.removeFromParent(); root.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      geometries.clear(); materials.clear();
    },
    update(actor, camera, model, { nativePose = null, shoulders = null, appearance = null } = {}) {
      if (!camera?.isCamera || actor?.team !== 'friendly' || supportWeaponPoseIndex(actor) < 0 || !model) {
        reset(); return null;
      }
      root.position.copy(actor.position); root.rotation.set(0, actor.heading, 0); root.updateMatrixWorld(true);
      const marker = actor.supportWeaponPose, targets = supportWeaponTargets(model, root, marker.phase);
      const reference = shoulders ? { shoulders, lean: 0 } : nativePose ? {
        shoulders: Object.fromEntries(['left', 'right'].map(side => [side, nativePose.hands[side].shoulder])),
        lean: nativePose.lean,
      } : supportViewShoulders(marker.kind, targets, lengths, actor.nativeMotion?.profile, marker.phase);
      const result = {};
      let limited = false;
      for (const side of ['left', 'right']) {
        const { hand, wrist: wristBone, middle } = hands[side], target = targets[side];
        const machine = ['maxim24', 'maxim24aa'].includes(marker.kind);
        const orientation = machine ? { ...target,
          forward: new THREE.Vector3(...target.normal).cross(new THREE.Vector3(...target.axis))
            .multiplyScalar(side === 'left' ? 1 : -1).normalize().toArray() } : target;
        const facing = handFrame(orientation, side === 'left' && machine);
        const wrist = new THREE.Vector3(...target.palm).sub(palms[side].clone().applyQuaternion(facing));
        const shoulder = new THREE.Vector3(...reference.shoulders[side]);
        const distance = wrist.distanceTo(shoulder), [upper, lower] = lengths[side];
        const reachable = distance < upper + lower - 1e-6 && distance > Math.abs(upper - lower) + 1e-6;
        hand.visible = reachable;
        if (reachable) {
          const pole = machine
            ? wrist.clone().sub(shoulder).addScaledVector(new THREE.Vector3(...orientation.forward), -lower)
            : new THREE.Vector3(side === 'left' ? -.8 : .8,
              marker.kind === 'bofors75' && marker.phase !== 'march' ? .35 : -.55, .25);
          hand.poseArm(shoulder, wrist, facing, pole);
          hand.poseWeaponGrip({ [machine ? 'machine' : marker.phase === 'loading' && side === 'right' ? 'press' : 'support']: 1 });
        }
        root.updateMatrixWorld(true);
        const actualWrist = root.worldToLocal(wristBone.getWorldPosition(new THREE.Vector3()));
        const actualPalm = root.worldToLocal(wristBone.getWorldPosition(new THREE.Vector3())
          .lerp(middle.getWorldPosition(new THREE.Vector3()), .55));
        const wristError = actualWrist.distanceTo(machine ? wrist : new THREE.Vector3(...target.wrist));
        const palmError = actualPalm.distanceTo(new THREE.Vector3(...target.palm));
        const contactLimited = !reachable || wristError > SUPPORT_CONTACT.wristTolerance || palmError > SUPPORT_CONTACT.palmTolerance;
        limited ||= contactLimited;
        result[side] = { reachable, contactLimited, wrist: actualWrist.toArray(), palm: actualPalm.toArray(),
          shoulder: shoulder.toArray(), wristError, palmError, distance, maximumReach: upper + lower,
          lengths: [...lengths[side]], source: hand.userData.armSource, grip: hand.weaponGripSnapshot };
      }
      if (owner !== actor.id || modelOwner !== model || appearanceOwner !== appearance) applyAppearance?.(root, actor, appearance);
      owner = actor.id; modelOwner = model; appearanceOwner = appearance;
      root.visible = !limited;
      observation = { owner, kind: marker.kind, phase: marker.phase, lean: reference.lean, hands: result,
        contactLimited: limited, visible: root.visible };
      return observation;
    },
    get snapshot() { return observation; },
    get resources() { return { arms: 2, geometries: geometries.size, materials: materials.size }; },
    get issue() { return observation?.contactLimited ? '第一人称支援武器握点超出原生手臂范围' : null; },
  };
}
