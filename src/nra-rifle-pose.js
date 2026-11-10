import * as THREE from 'three';
import { RIFLE_CONTACTS, rifleStockSection } from './rifle-contacts.js';
import { rifleActionPalm } from './rifle-hand-action.js';
import { WEAPON_RELOAD_FRAMES, weaponGripFingerRotation } from './weapon-hands.js';

function position(bone) { return bone.getWorldPosition(new THREE.Vector3()); }
function rotation(bone) { return bone.getWorldQuaternion(new THREE.Quaternion()); }
function setRotation(bone, value) {
  bone.quaternion.copy(rotation(bone.parent).invert().multiply(value));
  bone.updateMatrixWorld(true);
}
function swing(bone, child, destination) {
  const origin = position(bone);
  const delta = new THREE.Quaternion().setFromUnitVectors(position(child).sub(origin).normalize(), destination.clone().sub(origin).normalize());
  setRotation(bone, delta.multiply(rotation(bone)));
}

export class PoseGeometryError extends Error {
  constructor(message) {
    super(message); this.name = 'PoseGeometryError'; this.code = 'pose-geometry';
  }
}

export function solveArm(upper, lower, hand, target, pole) {
  const origin = position(upper), elbow = position(lower), wrist = position(hand);
  const a = origin.distanceTo(elbow), b = elbow.distanceTo(wrist);
  const direction = target.clone().sub(origin), distance = direction.length();
  if (![a, b, distance, pole.x, pole.y, pole.z].every(Number.isFinite) || Math.min(a, b, distance) < 1e-7)
    throw new PoseGeometryError('Invalid rifle arm geometry');
  direction.normalize();
  const reach = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, distance));
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    // A parallel pole leaves the bend plane underdetermined, not the limb invalid.
    bend.copy(elbow).sub(origin).addScaledVector(direction, -elbow.clone().sub(origin).dot(direction));
    if (bend.lengthSq() < 1e-8) {
      const axis = Math.abs(direction.x) <= Math.abs(direction.y) && Math.abs(direction.x) <= Math.abs(direction.z)
        ? new THREE.Vector3(1, 0, 0) : Math.abs(direction.y) <= Math.abs(direction.z)
          ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      bend.copy(axis).addScaledVector(direction, -axis.dot(direction));
    }
  }
  bend.normalize();
  const along = (a * a - b * b + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const desiredElbow = origin.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  swing(upper, lower, desiredElbow);
  swing(lower, hand, target);
  return { error: position(hand).distanceTo(target), reachable: distance < a + b && distance > Math.abs(a - b) };
}

function basis(forward, across) {
  const x = forward.clone().normalize(), y = across.clone().addScaledVector(x, -across.dot(x)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

export function createNraRiflePose(root, bones, gun) {
  // update() synchronizes the rig before reads and each joint solve refreshes its descendants.
  const position = node => new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
  const rotation = node => {
    const result = new THREE.Quaternion();
    node.matrixWorld.decompose(new THREE.Vector3(), result, new THREE.Vector3());
    return result;
  };
  const bone = name => {
    const found = bones.get(name);
    if (!found) throw new Error(`Missing rifle-pose joint: ${name}`);
    return found;
  };
  const fingers = new Map([...bones].filter(([name]) => /Hand(?:Thumb|Index|Middle|Ring|Pinky)/.test(name))
    .map(([, joint]) => [joint, joint.quaternion.clone()]));
  const arms = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']
    .map(name => ({ bone: bone(name), rest: bone(name).quaternion.clone() }));
  const leftShoulderRest = bone('LeftShoulder').quaternion.clone();
  const grip = new THREE.Object3D(); grip.position.fromArray(RIFLE_CONTACTS.supportWrist); gun.add(grip);
  const triggerPalm = new THREE.Object3D(); triggerPalm.position.fromArray(RIFLE_CONTACTS.triggerPalm); gun.add(triggerPalm);
  const muzzle = new THREE.Object3D(); muzzle.name = 'owned-muzzle'; muzzle.position.set(0, 0, -.891); gun.add(muzzle);
  const stock = new THREE.Object3D(); stock.position.fromArray(RIFLE_CONTACTS.stock); gun.add(stock);
  root.add(gun);
  let right = null, left = null, rightTarget = new THREE.Vector3(), leftTarget = new THREE.Vector3(), contactTarget = null;
  let fingerError = 0, rightPalmGoal = new THREE.Vector3();
  const palmPosition = side => position(bone(`${side}Hand`)).lerp(position(bone(`${side}HandMiddle1`)), .55);
  function orientHand(side, palmNormal, desiredForward = null) {
    const hand = bone(`${side}Hand`);
    const forward = position(hand).sub(position(bone(`${side}ForeArm`))).normalize();
    if (desiredForward) forward.applyQuaternion(new THREE.Quaternion().slerp(
      new THREE.Quaternion().setFromUnitVectors(forward, desiredForward.direction), desiredForward.weight));
    const normal = palmNormal.clone().addScaledVector(forward, -palmNormal.dot(forward));
    if (normal.lengthSq() < 1e-8) throw new Error('Palm normal cannot be parallel to its forearm');
    const across = normal.normalize().cross(forward).normalize();
    const currentForward = position(bone(`${side}HandMiddle1`)).sub(position(hand));
    const currentAcross = position(bone(`${side}HandIndex1`)).sub(position(bone(`${side}HandPinky1`)));
    const delta = basis(forward, across).multiply(basis(currentForward, currentAcross).invert());
    const desired = delta.clone().multiply(rotation(hand)), forearm = bone(`${side}ForeArm`);
    const axis = position(hand).sub(position(forearm)).normalize();
    const projected = axis.clone().multiplyScalar(new THREE.Vector3(delta.x, delta.y, delta.z).dot(axis));
    const twist = new THREE.Quaternion(projected.x, projected.y, projected.z, delta.w);
    if (twist.lengthSq() > 1e-8) {
      twist.normalize();
      const shared = new THREE.Quaternion().slerp(twist, .7);
      setRotation(forearm, shared.multiply(rotation(forearm)));
    }
    setRotation(hand, desired);
  }
  function curlHand(side) {
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      const first = bone(`${side}Hand${finger}1`), second = bone(`${side}Hand${finger}2`), third = bone(`${side}Hand${finger}3`);
      const local = gun.worldToLocal(position(first)), z = Math.max(-.44, Math.min(.19, local.z));
      const [center, width, height] = rifleStockSection(z);
      const angle = Math.atan2((local.y - center) / height, local.x / width);
      const wrap = finger === 'Thumb' ? side === 'Right' ? .85 : -.85 : side === 'Right' ? -1.05 : 1.05;
      const target = gun.localToWorld(new THREE.Vector3((width + .002) * Math.cos(angle + wrap),
        center + (height + .002) * Math.sin(angle + wrap), z));
      const pole = new THREE.Vector3(local.x, local.y - center, 0).normalize().transformDirection(gun.matrixWorld);
      const solved = solveArm(first, second, third, target, pole);
      fingerError = Math.max(fingerError, solved.error);
    }
  }
  function placeHand(side, palm, seed, pole, normal, iterations = 4, damping = 1, forward = null) {
    const target = seed.clone();
    let solved;
    for (let iteration = 0; iteration < iterations; iteration++) {
      solved = solveArm(bone(`${side}Arm`), bone(`${side}ForeArm`), bone(`${side}Hand`), target, pole);
      orientHand(side, normal, forward);
      const offset = palm.clone().sub(palmPosition(side));
      if (offset.length() < .0005 || iteration === iterations - 1) break;
      target.addScaledVector(offset, damping);
    }
    curlHand(side);
    return { ...solved, palmError: palmPosition(side).distanceTo(palm), target };
  }
  return {
    update(carry) {
      root.updateWorldMatrix(true, false);
      fingerError = 0;
      bone('LeftShoulder').quaternion.copy(leftShoulderRest);
      for (const arm of arms) arm.bone.quaternion.copy(arm.rest);
      for (const [joint, rest] of fingers) joint.quaternion.copy(rest);
      root.updateMatrixWorld(true);
      const localRotation = new THREE.Quaternion().fromArray(carry.weaponQuaternion);
      const bodyFacing = rotation(root), facing = bodyFacing.clone().multiply(localRotation);
      gun.position.fromArray(carry.weaponPosition); gun.quaternion.copy(localRotation);
      const lowGrip = carry.bayonet || carry.weaponBlocked ? .5 : carry.lowReady ?? 0;
      grip.position.fromArray(RIFLE_CONTACTS.supportPalm).lerp(new THREE.Vector3(...RIFLE_CONTACTS.carrySupportPalm), lowGrip);
      const machineGun = ['zb26', 'type11'].includes(carry.weaponModel);
      grip.position.z += (machineGun ? .04 * Math.max(0, -(carry.aimPitch ?? 0)) :
        .07 + .12 * Math.max(0, -(carry.aimPitch ?? 0))) * (carry.chestFire ?? 0) * (1 - lowGrip);
      const reload = gun.userData.automaticReload;
      grip.position.z += (.16 * (carry.prone ?? 0) + .06 * ((carry.wallLeft ?? 0) + (carry.wallRight ?? 0))) * (1 - (carry.lowReady ?? 0));
      grip.position.z += .05 * (carry.wallRight ?? 0) * (carry.lowReady ?? 0);
      if (reload?.handWeight > 0)
        grip.position.lerp(new THREE.Vector3(...reload.palm), reload.handWeight);
      root.updateMatrixWorld(true);
      contactTarget = carry.stockContact ? root.localToWorld(new THREE.Vector3(...carry.stockContact)) : null;
      const shoulder = bone('LeftShoulder');
      setRotation(shoulder, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0).applyQuaternion(bodyFacing), -.35)
        .multiply(rotation(shoulder)));
      rightTarget = root.localToWorld(new THREE.Vector3(...RIFLE_CONTACTS.triggerWrist).applyQuaternion(localRotation)
        .add(new THREE.Vector3().fromArray(carry.weaponPosition)));
      rightPalmGoal.copy(position(triggerPalm));
      const operation = carry.rifleOperation;
      if (operation?.hand > 0) {
        const clipY = gun.getObjectByName('clip')?.position.y;
        rightPalmGoal.copy(gun.localToWorld(new THREE.Vector3(...rifleActionPalm(operation, clipY))));
        rightTarget.add(rightPalmGoal.clone().sub(position(triggerPalm)));
      }
      const bracing = machineGun ? (reload?.supportWeight ?? 0) * (1 - (carry.prone ?? 0)) : 0;
      const rightPole = new THREE.Vector3(.7, -.7, .1).lerp(new THREE.Vector3(.12, -1, .05), bracing);
      right = placeHand('Right', rightPalmGoal, rightTarget, rightPole.applyQuaternion(bodyFacing),
        new THREE.Vector3(-1, 0, 0).applyQuaternion(facing), carry.weaponBlocked ? 16 : carry.bayonet ? 8 : 4,
        carry.weaponBlocked ? .5 : 1);
      rightTarget = right.target;
      root.updateMatrixWorld(true);
      const seed = new THREE.Vector3(...RIFLE_CONTACTS.supportWrist)
        .lerp(new THREE.Vector3(...RIFLE_CONTACTS.carrySupportWrist), lowGrip);
      seed.z = grip.position.z + .04;
      root.localToWorld(seed.applyQuaternion(localRotation).add(new THREE.Vector3(...carry.weaponPosition)));
      const reloadWeight = reload?.handWeight ?? 0;
      const handFrame = WEAPON_RELOAD_FRAMES.magazine.clone().slerp(WEAPON_RELOAD_FRAMES.press, reload?.pressWeight ?? 0);
      const reloadNormal = new THREE.Vector3(0, 0, -1).applyQuaternion(handFrame);
      const normal = new THREE.Vector3(0, 1, 0).lerp(reloadNormal, reloadWeight).normalize().applyQuaternion(facing);
      const forward = reloadWeight > 0 ? {
        direction: new THREE.Vector3(0, 1, 0).applyQuaternion(handFrame).applyQuaternion(facing), weight: reloadWeight,
      } : null;
      left = placeHand('Left', position(grip), seed, new THREE.Vector3(-.9, -.6, .1).applyQuaternion(bodyFacing),
        normal, carry.weaponBlocked ? 16 : reloadWeight > 0 ? 12 : carry.bayonet ? 8 : 4,
        carry.weaponBlocked ? .5 : 1, forward);
      if (reloadWeight > 0) for (const [joint, rest] of fingers) {
        if (!joint.name.startsWith('LeftHand')) continue;
        const magazine = weaponGripFingerRotation(joint.name, rest, 'left', 'magazine');
        const press = weaponGripFingerRotation(joint.name, rest, 'left', 'press');
        joint.quaternion.slerp(magazine.slerp(press, reload.pressWeight), reloadWeight);
      }
      leftTarget = left.target;
      root.updateMatrixWorld(true);
      if (operation?.hand > 0) {
        for (const [joint, rest] of fingers) {
          if (!joint.name.startsWith('RightHand')) continue;
          const index = Number(joint.name.at(-1)) - 1;
          if (index < 0 || index > 2) continue;
          const desired = new THREE.Euler().setFromQuaternion(rest, 'XYZ');
          const thumb = joint.name.includes('Thumb');
          desired.x = thumb ? index ? .65 : .5 : operation.loading > .5 ? [.35, .85, .55][index] : [.8, 1.25, .85][index];
          if (thumb && index === 0) desired.z += .35;
          joint.quaternion.slerp(new THREE.Quaternion().setFromEuler(desired), operation.hand);
        }
        root.updateMatrixWorld(true);
      }
      if (carry.grenade) {
        bone('LeftShoulder').quaternion.copy(leftShoulderRest);
        root.updateMatrixWorld(true);
        const target = root.localToWorld(new THREE.Vector3(...carry.grenade.hand));
        const view = carry.grenade.view;
        solveArm(bone('RightArm'), bone('RightForeArm'), bone('RightHand'), target,
          new THREE.Vector3(...(carry.grenade.pole ?? view?.pole ?? [.8, -.3, .3])).applyQuaternion(bodyFacing));
        if (view) {
          const hand = bone('RightHand'), desiredForward = new THREE.Vector3(...view.forward).normalize().applyQuaternion(bodyFacing);
          const normal = new THREE.Vector3(...view.palm).applyQuaternion(bodyFacing);
          normal.addScaledVector(desiredForward, -normal.dot(desiredForward)).normalize();
          const currentForward = position(bone('RightHandMiddle1')).sub(position(hand));
          const currentAcross = position(bone('RightHandIndex1')).sub(position(bone('RightHandPinky1')));
          const delta = basis(desiredForward, desiredForward.clone().cross(normal)).multiply(basis(currentForward, currentAcross).invert());
          setRotation(hand, delta.multiply(rotation(hand)));
          for (const [finger, rest] of fingers) {
            if (finger.name.startsWith('RightHand')) finger.quaternion.slerp(rest, view.opening);
          }
          if (view.guiding > 0) {
            const guideTarget = position(bone('LeftHand')).lerp(root.localToWorld(new THREE.Vector3(...carry.grenade.guideHand)), view.guiding);
            solveArm(bone('LeftArm'), bone('LeftForeArm'), bone('LeftHand'), guideTarget,
              new THREE.Vector3(...carry.grenade.guidePole).applyQuaternion(bodyFacing));
            const guideForward = new THREE.Vector3(...view.guide.forward).normalize().applyQuaternion(bodyFacing);
            const guideNormal = new THREE.Vector3(...view.guide.palm).applyQuaternion(bodyFacing);
            guideNormal.addScaledVector(guideForward, -guideNormal.dot(guideForward)).normalize();
            const leftHand = bone('LeftHand'), leftForward = position(bone('LeftHandMiddle1')).sub(position(leftHand));
            const leftAcross = position(bone('LeftHandIndex1')).sub(position(bone('LeftHandPinky1')));
            const guideRotation = basis(guideForward, guideForward.clone().cross(guideNormal)).multiply(basis(leftForward, leftAcross).invert());
            setRotation(leftHand, new THREE.Quaternion().slerp(guideRotation, view.guiding).multiply(rotation(leftHand)));
            for (const [finger, rest] of fingers) {
              if (finger.name.startsWith('LeftHand')) finger.quaternion.slerp(rest, .55 * view.guiding);
            }
          }
        } else orientHand('Right', new THREE.Vector3(-1, 0, 0).applyQuaternion(bodyFacing));
        root.updateMatrixWorld(true);
      }
    },
    get issue() {
      if (right && (!right.reachable || right.error > .015)) return '右手握点超出可达范围';
      if (left && (!left.reachable || left.error > .015)) return '左手握点超出可达范围';
      if (right?.palmError > .005 || left?.palmError > .005) return '手掌未贴合实际握持接触点';
      return null;
    },
    get snapshot() {
      root.updateWorldMatrix(true, true);
      const result = value => value ? { error: value.error, reachable: value.reachable, palmError: value.palmError } : null;
      return { right: result(right), left: result(left),
        rightTarget: rightTarget.toArray(), leftTarget: leftTarget.toArray(), muzzle: position(muzzle).toArray(),
        rightPalm: palmPosition('Right').toArray(), leftPalm: palmPosition('Left').toArray(),
        rightPalmTarget: rightPalmGoal.toArray(), leftPalmTarget: position(grip).toArray(),
        stock: position(stock).toArray(), stockTarget: contactTarget?.toArray() ?? null,
        fingerError,
        leftElbow: position(bone('LeftForeArm')).toArray(), rightElbow: position(bone('RightForeArm')).toArray(),
        direction: new THREE.Vector3(0, 0, -1).transformDirection(gun.matrixWorld).toArray() };
    },
  };
}
