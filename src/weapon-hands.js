import * as THREE from 'three';
import { riflePose, infantryWeaponProfile } from './rifle-action.js';
import { machineGunReloadPose } from './machine-gun-reload.js';
import { BOLT_HANDLE } from './rifle-contacts.js';

export const WEAPON_HAND_GRIPS = Object.freeze({
  left: Object.freeze({
    support: { center: [0, .115, -.03], depth: .022, thickness: .028 },
    magazine: { center: [0, .108, -.05], depth: .0145, thickness: .038 },
    press: { center: [0, .115, -.035], depth: .017, thickness: .025 },
  }),
  right: Object.freeze({
    trigger: { center: [0, .11, .033], depth: .032, thickness: .022 },
    pistol: { center: [0, .11, .025], depth: .022, thickness: .013 },
    bolt: { center: [.0245, .128, .072], depth: .012, thickness: .012, round: true },
  }),
});

const vector = values => new THREE.Vector3(...values);
const smooth = (value, from, to) => THREE.MathUtils.smoothstep(value, from, to);
function frame(across, forward) {
  const y = vector(forward).normalize(), x = vector(across);
  x.addScaledVector(y, -x.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}
const sideFrame = frame([0, 1, 0], [0, 0, -1]);
const triggerFrame = frame([0, 1, 0], [-.15, .25, -.956]);
const supportFrame = frame([-1, 0, -1], [.641, .423, -.641]);
const pressFrame = frame([0, 0, 1], [1, 0, 0]);
const boltFrame = frame([0, 0, 1], [-.8, .6, 0]);
const magazineFrame = frame([0, -1, 0], [1, 0, 0]);

function alignedElbowPole(shoulder, wrist, forward, lengths, down, belowWrist) {
  const axis = wrist.clone().sub(shoulder), distance = axis.length(), [upper, lower] = lengths;
  axis.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const radius = Math.sqrt(Math.max(0, upper * upper - along * along));
  const center = shoulder.clone().addScaledVector(axis, along);
  const desired = wrist.clone().addScaledVector(forward, -lower).sub(center);
  desired.addScaledVector(axis, -desired.dot(axis));
  const downInPlane = down.clone().addScaledVector(axis, -down.dot(axis));
  if (desired.lengthSq() < 1e-10) desired.copy(downInPlane);
  desired.normalize();
  let limited = false;
  const available = center.clone().sub(wrist).dot(down) + radius * downInPlane.length();
  if (belowWrist && radius > 1e-6 && downInPlane.lengthSq() > 1e-10) {
    const vertical = downInPlane.length(), lowered = downInPlane.clone().normalize();
    limited = available < belowWrist;
    const required = (center.clone().sub(wrist).dot(down) * -1 + Math.min(belowWrist, available)) / (radius * vertical);
    if (desired.dot(lowered) < required) {
      const tangent = axis.clone().cross(lowered).normalize(), along = THREE.MathUtils.clamp(required, -1, 1);
      const direction = desired.dot(tangent) < 0 ? -1 : 1;
      desired.copy(lowered).multiplyScalar(along).addScaledVector(tangent,
        Math.sqrt(1 - along * along) * direction);
    }
  }
  return { pole: desired, constraint: { requested: belowWrist, available, limited } };
}

export function createWeaponHands(createHand) {
  const root = new THREE.Group(), hands = {}, skins = {};
  root.name = 'native-weapon-hands';
  for (const side of ['left', 'right']) {
    const hand = createHand(side);
    if (!hand.poseArm || !hand.prepareWeaponGrip) throw new Error('Weapon view requires articulated native arms and fingers');
    for (const [name, shape] of Object.entries(WEAPON_HAND_GRIPS[side])) hand.prepareWeaponGrip(name, shape);
    const skin = hand.getObjectByName('\u624b\u90e8');
    if (!skin?.isSkinnedMesh || Array.isArray(skin.material)) throw new Error('Weapon hand lacks its isolated native skin material');
    skin.material = skin.material.clone();
    skins[side] = { material: skin.material, original: skin.material.color.clone() };
    hands[side] = hand; root.add(hand);
  }
  let bound = null, observation = null;
  const goal = (side, kind, anchor, rotation, weight = 1) => ({
    kind, weight, rotation,
    wrist: vector(anchor).sub(vector(WEAPON_HAND_GRIPS[side][kind].center).applyQuaternion(rotation)),
  });
  function apply(side, goals, inverse, supportDrop = 0) {
    const hand = hands[side], selected = goals.filter(goal => goal.weight > 0), weights = {};
    const wrist = new THREE.Vector3(), rotation = new THREE.Quaternion();
    let total = 0;
    for (const goal of selected) {
      weights[goal.kind] = (weights[goal.kind] ?? 0) + goal.weight;
      wrist.addScaledVector(goal.wrist, goal.weight);
      if (!total) rotation.copy(goal.rotation);
      else rotation.slerp(goal.rotation, goal.weight / (total + goal.weight));
      total += goal.weight;
    }
    wrist.divideScalar(total);
    const loading = side === 'left' ? Math.min(1, (weights.magazine ?? 0) + (weights.press ?? 0)) : 0;
    const supportWeight = weights.support ?? 0, triggerWeight = Math.min(1, (weights.trigger ?? 0) + (weights.pistol ?? 0));
    const shoulder = new THREE.Vector3(side === 'left' ? -.18 : .22,
      side === 'left' ? -.31 + loading * .06 - supportWeight * supportDrop : -.20,
      side === 'left' ? -.10 - loading * .13 : -.08 + triggerWeight * .20).applyMatrix4(inverse);
    const defaultPole = new THREE.Vector3(side === 'left' ? -.5 : .5, -1, -.15).transformDirection(inverse);
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const down = new THREE.Vector3(0, -1, 0).transformDirection(inverse);
    const elbow = alignedElbowPole(shoulder, wrist, forward, hand.userData.armLengths, down,
      supportWeight > .999 ? .05 : 0);
    // Choose the elbow on its two-bone circle to align the forearm with the palm,
    // rather than solving a hand target with an unrelated, fixed elbow direction.
    elbow.pole.lerp(defaultPole.clone().multiplyScalar(.25), 1 - Math.max(supportWeight, triggerWeight));
    hand.poseArm(shoulder, wrist, rotation, elbow.pole);
    if (!hand.armSnapshot.reachable || hand.armSnapshot.error > .002) {
      throw new Error(`Native ${side} weapon arm cannot reach its owned contact: ` +
        `shoulder=${shoulder.toArray()}, wrist=${wrist.toArray()}, model=${bound.position.toArray()}`);
    }
    hand.poseWeaponGrip(weights);
    const forearm = vector(hand.armSnapshot.wrist).sub(vector(hand.armSnapshot.elbow)).normalize();
    const wristAngle = Math.acos(THREE.MathUtils.clamp(forearm.dot(forward), -1, 1));
    const palmNormal = new THREE.Vector3(0, 0, side === 'left' ? -1 : 1).applyQuaternion(rotation);
    return { source: hand.userData.handSource, arm: hand.armSnapshot, grip: hand.weaponGripSnapshot,
      wrist: wrist.toArray(), rotation: rotation.toArray(), wristAngle, palmNormal: palmNormal.toArray(),
      elbowConstraint: elbow.constraint };
  }
  return {
    root,
    update(model, state, { stowed = false, appearance = null } = {}) {
      if (bound !== model) {
        model.add(root); bound = model;
        for (const side of ['left', 'right']) {
          for (const part of ['Hand', 'Sleeve', 'UpperArm', 'Elbow', 'Cuff']) model.getObjectByName(`${side}${part}`).visible = false;
        }
      }
      for (const skin of Object.values(skins)) {
        if (appearance) skin.material.color.set(appearance.skin);
        else skin.material.color.copy(skin.original);
      }
      root.visible = !stowed;
      if (stowed) {
        if (observation) observation = { ...observation, visible: false };
        return;
      }
      const profile = infantryWeaponProfile(state), pose = riflePose(state);
      model.updateMatrix(); model.updateMatrixWorld(true);
      const inverse = model.matrix.clone().invert();
      const rightKind = profile.automatic ? 'pistol' : 'trigger';
      const rightAnchor = profile.automatic ? [.012, -.115, -.065] : [.015, -.055, -.105];
      const boltWeight = profile.automatic ? 0 : pose.hand * (1 - pose.loading);
      const loadWeight = profile.automatic ? 0 : pose.loading;
      const boltRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.boltLift);
      const wristTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.boltLift * .25);
      const boltCenter = vector(BOLT_HANDLE.center).applyQuaternion(boltRotation);
      boltCenter.z += pose.boltTravel;
      const right = [
        goal('right', rightKind, rightAnchor, profile.automatic ? sideFrame : triggerFrame, 1 - boltWeight - loadWeight),
        goal('right', 'bolt', boltCenter.toArray(), wristTurn.multiply(boltFrame), boltWeight),
        goal('right', 'bolt', [0, .13 + model.userData.rifle.clip.position.y, -.18], sideFrame, loadWeight),
      ];
      const supportHeight = profile.automatic ? -.072 : -.035;
      const support = goal('left', 'support', [0, supportHeight, -.34], supportFrame);
      let left = [support];
      if (profile.automatic && state.action === 'reload') {
        const reload = machineGunReloadPose(state), t = state.elapsed / profile.reloadSeconds;
        const reach = smooth(t, 0, .12) * (1 - smooth(t, .91, 1));
        const pressing = smooth(t, .7, .78) * (1 - smooth(t, .86, .94));
        const carry = state.model === 'zb26' ? [.065, .127, -.247].map((value, i) => value + reload.feed[i])
          : [reload.palm[0] + .035, reload.palm[1] - .025, reload.palm[2]];
        const top = state.model === 'zb26' ? [.065, .182 - reload.press, -.247] : [-.123, .045, -.216];
        const magazine = goal('left', 'magazine', carry, magazineFrame, reach * (1 - pressing));
        if (state.model === 'zb26' && t >= .7 && t < .78) magazine.wrist.y += Math.sin((t - .7) / .08 * Math.PI) * .10;
        left = [
          { ...support, weight: 1 - reach }, magazine,
          goal('left', 'press', top, pressFrame, reach * pressing),
        ];
      }
      observation = { source: 'nra-authorized-skinned-weapon-hands', visible: true, appearance: appearance?.key ?? null,
        left: apply('left', left, inverse, -.035 - supportHeight), right: apply('right', right, inverse) };
      root.updateMatrixWorld(true);
    },
    get snapshot() { return observation; },
  };
}
