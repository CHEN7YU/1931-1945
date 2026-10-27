import * as THREE from 'three';
import { RIFLE_CONTACTS, rifleStockSection } from './rifle-contacts.js';

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

export function solveArm(upper, lower, hand, target, pole) {
  const origin = position(upper), elbow = position(lower), wrist = position(hand);
  const a = origin.distanceTo(elbow), b = elbow.distanceTo(wrist);
  const direction = target.clone().sub(origin), distance = direction.length();
  if (![a, b, distance].every(Number.isFinite) || Math.min(a, b, distance) < 1e-7) throw new Error('Invalid rifle arm geometry');
  direction.normalize();
  const reach = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, distance));
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) throw new Error('Rifle elbow hint is parallel to the arm target');
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
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -.891); gun.add(muzzle);
  const stock = new THREE.Object3D(); stock.position.fromArray(RIFLE_CONTACTS.stock); gun.add(stock);
  root.add(gun);
  let right = null, left = null, rightTarget = new THREE.Vector3(), leftTarget = new THREE.Vector3(), contactTarget = null;
  let fingerError = 0;
  const palmPosition = side => position(bone(`${side}Hand`)).lerp(position(bone(`${side}HandMiddle1`)), .55);
  function orientHand(side, palmNormal) {
    const hand = bone(`${side}Hand`);
    const forward = position(hand).sub(position(bone(`${side}ForeArm`))).normalize();
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
  function placeHand(side, palm, seed, pole, normal) {
    const target = seed.clone();
    let solved;
    for (let iteration = 0; iteration < 4; iteration++) {
      solved = solveArm(bone(`${side}Arm`), bone(`${side}ForeArm`), bone(`${side}Hand`), target, pole);
      orientHand(side, normal);
      const offset = palm.clone().sub(palmPosition(side));
      if (offset.length() < .0005 || iteration === 3) break;
      target.add(offset);
    }
    curlHand(side);
    return { ...solved, palmError: palmPosition(side).distanceTo(palm), target };
  }
  return {
    update(carry) {
      fingerError = 0;
      bone('LeftShoulder').quaternion.copy(leftShoulderRest);
      for (const arm of arms) arm.bone.quaternion.copy(arm.rest);
      for (const [joint, rest] of fingers) joint.quaternion.copy(rest);
      root.updateMatrixWorld(true);
      const localRotation = new THREE.Quaternion().fromArray(carry.weaponQuaternion);
      const bodyFacing = rotation(root), facing = bodyFacing.clone().multiply(localRotation);
      gun.position.fromArray(carry.weaponPosition); gun.quaternion.copy(localRotation);
      grip.position.fromArray(RIFLE_CONTACTS.supportPalm).lerp(new THREE.Vector3(...RIFLE_CONTACTS.carrySupportPalm), carry.lowReady ?? 0);
      grip.position.z += (.16 * (carry.prone ?? 0) + .06 * ((carry.wallLeft ?? 0) + (carry.wallRight ?? 0))) * (1 - (carry.lowReady ?? 0));
      grip.position.z += .05 * (carry.wallRight ?? 0) * (carry.lowReady ?? 0);
      root.updateMatrixWorld(true);
      contactTarget = carry.stockContact ? root.localToWorld(new THREE.Vector3(...carry.stockContact)) : null;
      const shoulder = bone('LeftShoulder');
      setRotation(shoulder, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0).applyQuaternion(bodyFacing), -.35)
        .multiply(rotation(shoulder)));
      rightTarget = root.localToWorld(new THREE.Vector3(...RIFLE_CONTACTS.triggerWrist).applyQuaternion(localRotation)
        .add(new THREE.Vector3().fromArray(carry.weaponPosition)));
      right = placeHand('Right', position(triggerPalm), rightTarget, new THREE.Vector3(.7, -.7, .1).applyQuaternion(bodyFacing),
        new THREE.Vector3(-1, 0, 0).applyQuaternion(facing));
      rightTarget = right.target;
      root.updateMatrixWorld(true);
      const seed = new THREE.Vector3(...RIFLE_CONTACTS.supportWrist)
        .lerp(new THREE.Vector3(...RIFLE_CONTACTS.carrySupportWrist), carry.lowReady ?? 0);
      seed.z = grip.position.z + .04;
      root.localToWorld(seed.applyQuaternion(localRotation).add(new THREE.Vector3(...carry.weaponPosition)));
      left = placeHand('Left', position(grip), seed, new THREE.Vector3(-.9, -.6, .1).applyQuaternion(bodyFacing),
        new THREE.Vector3(0, 1, 0).applyQuaternion(facing));
      leftTarget = left.target;
      root.updateMatrixWorld(true);
    },
    get issue() {
      if (right && (!right.reachable || right.error > .015)) return '右手握点超出可达范围';
      if (left && (!left.reachable || left.error > .015)) return '左手握点超出可达范围';
      if (right?.palmError > .005 || left?.palmError > .005) return '手掌未贴合实际握持接触点';
      return null;
    },
    get snapshot() {
      const result = value => value ? { error: value.error, reachable: value.reachable, palmError: value.palmError } : null;
      return { right: result(right), left: result(left),
        rightTarget: rightTarget.toArray(), leftTarget: leftTarget.toArray(), muzzle: position(muzzle).toArray(),
        rightPalm: palmPosition('Right').toArray(), leftPalm: palmPosition('Left').toArray(),
        rightPalmTarget: position(triggerPalm).toArray(), leftPalmTarget: position(grip).toArray(),
        stock: position(stock).toArray(), stockTarget: contactTarget?.toArray() ?? null,
        fingerError,
        leftElbow: position(bone('LeftForeArm')).toArray(), rightElbow: position(bone('RightForeArm')).toArray(),
        direction: new THREE.Vector3(0, 0, -1).transformDirection(gun.matrixWorld).toArray() };
    },
  };
}
