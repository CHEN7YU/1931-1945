import * as THREE from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { dadaoModel, dadaoWorldStroke, DADAO_HAND_TO_BLADE, DADAO_DIMENSIONS } from './dadao-model.js';

export function createNraDadaoPose(root, bones, grip) {
  const blade = dadaoModel();
  blade.userData.personalWeapon = true;
  blade.visible = false; root.add(blade);
  let solution = null, leftSolution = null;
  let leftPalmError = 0;
  const point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
  const lengths = Object.fromEntries(['Right', 'Left'].map(side => [side, [
    point(`${side}Arm`).distanceTo(point(`${side}ForeArm`)), point(`${side}ForeArm`).distanceTo(point(`${side}Hand`)),
  ]]));
  const wristAlignment = (side, wristRotation) => point(`${side}Hand`).sub(point(`${side}ForeArm`)).normalize().dot(
    new THREE.Vector3(0, 1, 0).applyQuaternion(bones.get(`${side}Hand`).getWorldQuaternion(new THREE.Quaternion())
      .multiply(wristRotation.clone().invert())));
  const gripFrame = (palm, shoulder, rotation, side, center) => {
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const [a, b] = lengths[side];
    const offset = palm.clone().sub(shoulder).addScaledVector(axis, -center.x), reach = center.y + b;
    const projected = offset.clone().multiplyScalar(reach).addScaledVector(new THREE.Vector3().crossVectors(offset, axis), center.z);
    projected.addScaledVector(axis, -projected.dot(axis));
    if (projected.lengthSq() < 1e-12) throw new Error('Dadao grip is parallel to its shoulder axis');
    // The cosine rule chooses hand roll around the handle so a straight wrist fits both original arm segments.
    const cosine = THREE.MathUtils.clamp((offset.lengthSq() + reach * reach + center.z * center.z - a * a) /
      (2 * projected.length()), -1, 1);
    const rawAngle = Math.acos(cosine);
    const angle = rawAngle < .3 ? rawAngle * THREE.MathUtils.smoothstep(rawAngle, 0, .3)
      : rawAngle > Math.PI - .3 ? Math.PI - (Math.PI - rawAngle) * THREE.MathUtils.smoothstep(Math.PI - rawAngle, 0, .3) : rawAngle;
    const base = projected.normalize();
    const forward = base.clone().multiplyScalar(Math.cos(angle)).addScaledVector(
      new THREE.Vector3().crossVectors(axis, base), Math.sin(angle) * (side === 'Right' ? 1 : -1));
    return { forward, rotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      axis, forward, new THREE.Vector3().crossVectors(axis, forward))) };
  };
  return {
    blade,
    update(pose) {
      blade.visible = Boolean(pose);
      if (!pose) { solution = leftSolution = null; return; }
      const { wristOffset, rotation } = dadaoWorldStroke(pose);
      const body = root.getWorldQuaternion(new THREE.Quaternion());
      const desired = point('RightArm').add(wristOffset.applyQuaternion(body));
      const bladeRotation = body.clone().multiply(rotation);
      const anchor = desired.add(grip.center.clone().applyQuaternion(bladeRotation.clone().multiply(DADAO_HAND_TO_BLADE)));
      anchor.add(new THREE.Vector3(0, 0, -.18).applyQuaternion(body));
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(bladeRotation);
      const shoulderCenter = point('RightArm').add(point('LeftArm')).multiplyScalar(.5);
      // Share the handle between both shoulders instead of aiming it back along either forearm.
      anchor.addScaledVector(axis, shoulderCenter.sub(anchor).dot(axis) + .045);
      const rightGrip = gripFrame(anchor, point('RightArm'), bladeRotation, 'Right', grip.center), frameRotation = rightGrip.rotation;
      const rightWrist = anchor.clone().sub(grip.center.clone().applyQuaternion(frameRotation));
      solution = solveArm(bones.get('RightArm'), bones.get('RightForeArm'), bones.get('RightHand'), rightWrist,
        rightGrip.forward.clone().negate());
      const hand = bones.get('RightHand');
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(frameRotation).multiply(grip.wristRotation));
      for (const [name, quaternion] of grip.fingers) bones.get(name).quaternion.copy(quaternion);
      hand.updateMatrixWorld(true);
      // Attach to the actual solved wrist, never to the requested IK target.
      const actualFrame = hand.getWorldQuaternion(new THREE.Quaternion()).multiply(grip.wristRotation.clone().invert());
      const worldRotation = bladeRotation;
      const center = point('RightHand').add(grip.center.clone().applyQuaternion(actualFrame))
        .sub(new THREE.Vector3(0, .012, 0).applyQuaternion(worldRotation));
      blade.position.copy(root.worldToLocal(center));
      blade.quaternion.copy(body.invert().multiply(worldRotation));
      root.updateMatrixWorld(true);
      const left = grip.left;
      const palm = blade.localToWorld(new THREE.Vector3(0, -.078, 0));
      const leftGrip = gripFrame(palm, point('LeftArm'), worldRotation, 'Left', left.center);
      const leftFrame = leftGrip.rotation;
      const wrist = palm.clone().sub(left.center.clone().applyQuaternion(leftFrame));
      leftSolution = solveArm(bones.get('LeftArm'), bones.get('LeftForeArm'), bones.get('LeftHand'), wrist,
        leftGrip.forward.clone().negate());
      const leftHand = bones.get('LeftHand');
      leftHand.quaternion.copy(leftHand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(leftFrame).multiply(left.wristRotation));
      for (const [name, quaternion] of left.fingers) bones.get(name).quaternion.copy(quaternion);
      root.updateMatrixWorld(true);
      const actualLeftFrame = leftHand.getWorldQuaternion(new THREE.Quaternion()).multiply(left.wristRotation.clone().invert());
      leftPalmError = point('LeftHand').add(left.center.clone().applyQuaternion(actualLeftFrame)).distanceTo(palm);
    },
    get issue() {
      if (solution && (!solution.reachable || solution.error > .015)) return '大刀右手握点超出可达范围';
      if (leftPalmError > .015) return '大刀左手未贴合第二握点';
      return leftSolution && (!leftSolution.reachable || leftSolution.error > .015) ? '大刀左臂超出可达范围' : null;
    },
    get snapshot() {
      return { visible: blade.visible, reachable: solution?.reachable ?? null, error: solution?.error ?? null,
        wrist: point('RightHand').toArray(), elbow: point('RightForeArm').toArray(),
        leftReachable: leftSolution?.reachable ?? null, leftError: leftSolution?.error ?? null,
        leftPalmError,
        wristAlignment: wristAlignment('Right', grip.wristRotation),
        leftWristAlignment: wristAlignment('Left', grip.left.wristRotation),
        grip: blade.localToWorld(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0)).toArray() };
    },
  };
}
