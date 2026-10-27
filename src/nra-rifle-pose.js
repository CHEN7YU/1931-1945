import * as THREE from 'three';

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
  const grip = new THREE.Object3D(); grip.position.set(-.055, -.10, -.29); gun.add(grip);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -.891); gun.add(muzzle);
  let attached = false, right = null, left = null, rightTarget = new THREE.Vector3();
  function orientHand(side, forward, across, frameRotation) {
    const hand = bone(`${side}Hand`);
    const currentForward = position(bone(`${side}HandMiddle1`)).sub(position(hand));
    const currentAcross = position(bone(`${side}HandIndex1`)).sub(position(bone(`${side}HandPinky1`)));
    const delta = basis(forward, across).multiply(basis(currentForward, currentAcross).invert());
    setRotation(hand, delta.multiply(rotation(hand)));
    const curlAxis = new THREE.Vector3(0, 0, side === 'Right' ? -1 : 1).applyQuaternion(frameRotation);
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      const amounts = side === 'Right' && finger === 'Index' ? [.15, .2, .15] : [.4, .75, .65];
      for (let index = 1; index <= 3; index++) {
        const joint = bone(`${side}Hand${finger}${index}`);
        setRotation(joint, new THREE.Quaternion().setFromAxisAngle(curlAxis, amounts[index - 1]).multiply(rotation(joint)));
      }
    }
  }
  return {
    update(carry) {
      for (const [joint, rest] of fingers) joint.quaternion.copy(rest);
      root.updateMatrixWorld(true);
      const localRotation = new THREE.Quaternion().fromArray(carry.weaponQuaternion);
      const facing = rotation(root).multiply(localRotation);
      rightTarget = root.localToWorld(new THREE.Vector3(.045, -.02, -.085).applyQuaternion(localRotation)
        .add(new THREE.Vector3().fromArray(carry.weaponPosition)));
      right = solveArm(bone('RightArm'), bone('RightForeArm'), bone('RightHand'), rightTarget,
        new THREE.Vector3(.7, -1, .1).applyQuaternion(facing));
      orientHand('Right', new THREE.Vector3(0, -1, 0).applyQuaternion(facing), new THREE.Vector3(0, 0, -1).applyQuaternion(facing), facing);
      if (!attached) {
        gun.position.fromArray(carry.weaponPosition); gun.quaternion.copy(localRotation);
        root.add(gun); root.updateMatrixWorld(true);
        bone('RightHand').attach(gun); attached = true;
      }
      root.updateMatrixWorld(true);
      left = solveArm(bone('LeftArm'), bone('LeftForeArm'), bone('LeftHand'), position(grip),
        new THREE.Vector3(-.7, -1, .1).applyQuaternion(facing));
      orientHand('Left', new THREE.Vector3(1, 0, 0).applyQuaternion(facing), new THREE.Vector3(0, 0, -1).applyQuaternion(facing), facing);
      root.updateMatrixWorld(true);
    },
    get issue() {
      if (right && (!right.reachable || right.error > .015)) return '右手握点超出可达范围';
      if (left && (!left.reachable || left.error > .015)) return '左手握点超出可达范围';
      return null;
    },
    get snapshot() {
      return { right: right ? { ...right } : null, left: left ? { ...left } : null,
        rightTarget: rightTarget.toArray(), leftTarget: position(grip).toArray(), muzzle: position(muzzle).toArray(),
        direction: new THREE.Vector3(0, 0, -1).transformDirection(gun.matrixWorld).toArray() };
    },
  };
}
