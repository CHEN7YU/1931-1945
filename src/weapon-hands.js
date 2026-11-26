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
    bolt: { center: [.011, .113, .035], depth: .012, thickness: .012, round: true },
    charger: { center: [.0245, .128, .072], depth: .012, thickness: .012, round: true },
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
export const WEAPON_RELOAD_FRAMES = Object.freeze({ magazine: magazineFrame, press: pressFrame });

export function weaponGripFingerRotation(name, rest, side, kind) {
  const joint = Number(name.at(-1)) - 1, euler = new THREE.Euler().setFromQuaternion(rest, 'XYZ');
  if (!Number.isInteger(joint) || joint < 0 || joint > 2) return rest.clone();
  if (name.includes('Thumb')) {
    euler.x = kind === 'press' ? .12 : kind === 'bolt' ? joint === 0 ? .50 : .65
      : side === 'left' ? joint === 0 ? -.25 : .15 : joint === 0 ? .25 : .45;
    if (joint === 0) euler.z += side === 'left' ? -.22 : kind === 'bolt' ? .35 : .22;
  } else {
    const finger = ['Index', 'Middle', 'Ring', 'Pinky'].findIndex(finger => name.includes(finger));
    const curls = kind === 'press' ? [.18, .24, .20] : kind === 'bolt' ? [.80, 1.25, .85]
      : kind === 'charger' ? [.35, .85, .55] : kind === 'magazine' ? [.55, .95, .55] : [.5, .85, .5];
    euler.x = Math.min([1.25, 1.5, 1.05][joint], curls[joint] + [0, .06, .09, .16][finger]);
    if (joint > 0) { euler.y = 0; euler.z = 0; }
  }
  return new THREE.Quaternion().setFromEuler(euler);
}

function alignedElbowPole(shoulder, wrist, forward, lengths, down, belowWrist, outward = null) {
  const axis = wrist.clone().sub(shoulder), distance = axis.length(), [upper, lower] = lengths;
  axis.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const radius = Math.sqrt(Math.max(0, upper * upper - along * along));
  const center = shoulder.clone().addScaledVector(axis, along);
  const desired = wrist.clone().addScaledVector(forward, -lower).sub(center);
  desired.addScaledVector(axis, -desired.dot(axis));
  const downInPlane = down.clone().addScaledVector(axis, -down.dot(axis));
  if (desired.lengthSq() < 1e-10) desired.copy(downInPlane);
  if (outward) {
    const lateral = outward.clone().addScaledVector(axis, -outward.dot(axis)).normalize();
    // Keep the loading elbow on the outside branch, including while the palm turns.
    desired.addScaledVector(lateral, Math.max(0, outward.length() - desired.dot(lateral)));
  }
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
    if (!hand.setOfficerAppearance) skin.material = skin.material.clone();
    skins[side] = { material: skin.material, original: skin.material.color.clone() };
    hands[side] = hand; root.add(hand);
  }
  let bound = null, observation = null, reachWarningActive = false;
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
    const shoulder = new THREE.Vector3(side === 'left' ? -.18 : .22 + (weights.bolt ?? 0) * .025,
      side === 'left' ? -.31 + loading * .06 - supportWeight * supportDrop : -.20,
      side === 'left' ? -.10 - loading * .13 : -.08 + triggerWeight * .20).applyMatrix4(inverse);
    if (![...shoulder, ...wrist, ...rotation].every(Number.isFinite)) {
      throw new Error(`Native ${side} weapon arm has a non-finite pose`);
    }
    const [upper, lower] = hand.userData.armLengths;
    let distance = shoulder.distanceTo(wrist);
    if (side === 'right' && weights.bolt > 0 && distance < Math.abs(upper - lower) + .006) {
      // Roll the shoulder slightly as the closed hand passes it; never shorten either arm bone.
      const separation = shoulder.clone().sub(wrist);
      if (distance < 1e-8) separation.set(1, 0, 0).transformDirection(inverse);
      else separation.divideScalar(distance);
      shoulder.addScaledVector(separation, Math.abs(upper - lower) + .006 - distance);
      distance = shoulder.distanceTo(wrist);
    }
    if (distance <= Math.abs(upper - lower) + .001 || distance >= upper + lower - .001) {
      return { contactLimited: true, side, requestedDistance: distance,
        minimumDistance: Math.abs(upper - lower), maximumDistance: upper + lower };
    }
    const defaultPole = new THREE.Vector3(side === 'left' ? -.5 : .5, -1, -.15).transformDirection(inverse);
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const down = new THREE.Vector3(0, -1, 0).transformDirection(inverse);
    const elbow = alignedElbowPole(shoulder, wrist, forward, hand.userData.armLengths, down,
      loading > 0 ? .05 * smooth(shoulder.clone().sub(wrist).dot(down), -.05, .1) : supportWeight > .999 ? .05 : 0,
      loading > 0 ? new THREE.Vector3(-1, -.5, .1).transformDirection(inverse)
        .multiplyScalar(.1 * smooth(loading, 0, .2) + .8 * loading * (1 - loading)) : null);
    // Choose the elbow on its two-bone circle to align the forearm with the palm,
    // rather than solving a hand target with an unrelated, fixed elbow direction.
    elbow.pole.lerp(defaultPole.clone().multiplyScalar(.25), 1 - Math.max(supportWeight + loading, triggerWeight));
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
    update(model, state, { stowed = false, appearance = null, officer = false } = {}) {
      if (typeof officer !== 'boolean') throw new TypeError('Weapon hand officer appearance requires a boolean');
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
      for (const hand of Object.values(hands)) hand.setOfficerAppearance?.(officer, Boolean(appearance?.blueFieldCap));
      root.visible = !stowed;
      if (stowed) {
        if (observation) observation = { ...observation, visible: false, officer };
        return;
      }
      const profile = infantryWeaponProfile(state), pose = riflePose(state);
      if (![...model.position, ...model.quaternion, ...model.scale].every(Number.isFinite) ||
        model.scale.toArray().some(value => value <= 0)) throw new Error('Weapon hands require a finite, non-singular weapon transform');
      model.updateMatrix(); model.updateMatrixWorld(true);
      const inverse = model.matrix.clone().invert();
      const pistolGrip = profile.automatic && !profile.smg;
      const rightKind = pistolGrip ? 'pistol' : 'trigger';
      const rightAnchor = pistolGrip ? [.012, -.115, -.065] : [.015, -.055, -.105];
      const boltWeight = profile.automatic ? 0 : pose.hand * (1 - pose.loading);
      const loadWeight = profile.automatic ? 0 : pose.loading;
      const boltRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.boltLift);
      const wristTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.boltLift * .25);
      const boltCenter = vector(BOLT_HANDLE.center).applyQuaternion(boltRotation);
      boltCenter.z += pose.boltTravel;
      const right = [
        goal('right', rightKind, rightAnchor, pistolGrip ? sideFrame : triggerFrame, 1 - boltWeight - loadWeight),
        goal('right', 'bolt', boltCenter.toArray(), wristTurn.multiply(boltFrame), boltWeight),
        goal('right', 'charger', [0, .13 + model.userData.rifle.clip.position.y, -.18], sideFrame, loadWeight),
      ];
      const supportHeight = pistolGrip ? -.072 : -.035;
      const support = goal('left', 'support', [0, supportHeight, -.34], supportFrame);
      let left = [support];
      if (profile.automatic && state.action === 'reload') {
        const reload = machineGunReloadPose(state), t = state.elapsed / profile.reloadSeconds;
        const reach = reload.handWeight;
        const pressing = reload.pressWeight;
        const carry = state.model === 'zb26' ? [.065, .127, -.247].map((value, i) => value + reload.feed[i])
          : [reload.palm[0] + .035, reload.palm[1] - .025, reload.palm[2]];
        const top = state.model === 'zb26' ? [.065, .182 - reload.press, -.247] : reload.palm;
        const magazine = goal('left', 'magazine', carry, magazineFrame, reach * (1 - pressing));
        if (state.model === 'zb26' && t >= .7 && t < .78) magazine.wrist.y += Math.sin((t - .7) / .08 * Math.PI) * .10;
        left = [
          { ...support, weight: 1 - reach }, magazine,
          goal('left', 'press', top, pressFrame, reach * pressing),
        ];
      }
      const leftPose = apply('left', left, inverse, -.035 - supportHeight);
      const rightPose = apply('right', right, inverse);
      const limited = [leftPose, rightPose].filter(pose => pose.contactLimited);
      if (limited.length) {
        root.visible = false;
        observation = { source: 'nra-authorized-skinned-weapon-hands', visible: false,
          reachLimited: true, reason: 'weapon-outside-arm-workspace', contacts: limited, officer };
        if (!reachWarningActive) console.warn('Weapon view stowed outside native arm reach; battle simulation continues', limited);
        reachWarningActive = true;
        return;
      }
      reachWarningActive = false;
      observation = { source: 'nra-authorized-skinned-weapon-hands', visible: true, reachLimited: false, appearance: appearance?.key ?? null, officer,
        left: leftPose, right: rightPose };
      root.updateMatrixWorld(true);
    },
    get snapshot() { return observation; },
  };
}
