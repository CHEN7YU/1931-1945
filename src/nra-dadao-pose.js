import * as THREE from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { dadaoModel, dadaoWorldStroke, DADAO_DIMENSIONS } from './dadao-model.js';
import { dadaoCalibratedGrip } from './dadao-grip-frame.js';
import { sampleDadaoWorldGrip } from './dadao-world-grips.js';

export function createNraDadaoPose(root, bones, grip, chestRest =
  root.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(bones.get('Spine').getWorldQuaternion(new THREE.Quaternion()))) {
  const blade = dadaoModel();
  blade.userData.personalWeapon = true;
  blade.visible = false; root.add(blade);
  let solution = null, leftSolution = null;
  let leftPalmError = 0;
  const point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
  const wristAlignment = (side, wristRotation) => point(`${side}Hand`).sub(point(`${side}ForeArm`)).normalize().dot(
    new THREE.Vector3(0, 1, 0).applyQuaternion(bones.get(`${side}Hand`).getWorldQuaternion(new THREE.Quaternion())
      .multiply(wristRotation.clone().invert())));
  return {
    blade,
    update(pose, calibration) {
      blade.visible = Boolean(pose);
      if (!pose) { solution = leftSolution = null; return; }
      const { anchor: offset, rotation, rightPole, leftPole } = dadaoWorldStroke(pose, calibration);
      const body = root.getWorldQuaternion(new THREE.Quaternion());
      const chest = bones.get('Spine').getWorldQuaternion(new THREE.Quaternion()).multiply(chestRest.clone().invert());
      const bladeRotation = chest.clone().multiply(rotation);
      const shoulderCenter = point('RightArm').add(point('LeftArm')).multiplyScalar(.5);
      const anchor = shoulderCenter.add(offset.applyQuaternion(chest));
      const worldRotation = bladeRotation;
      const center = anchor.clone().sub(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0).applyQuaternion(worldRotation));
      blade.position.copy(root.worldToLocal(center));
      blade.quaternion.copy(body.clone().invert().multiply(worldRotation));
      root.updateMatrixWorld(true);
      const rightGrip = dadaoCalibratedGrip(anchor, worldRotation, point('RightArm'), grip.center,
        rightPole.applyQuaternion(chest), ...sampleDadaoWorldGrip(pose, 'right'));
      const frameRotation = rightGrip.rotation, rightWrist = rightGrip.wrist;
      solution = solveArm(bones.get('RightArm'), bones.get('RightForeArm'), bones.get('RightHand'), rightWrist,
        rightGrip.pole);
      const hand = bones.get('RightHand');
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(frameRotation).multiply(grip.wristRotation));
      for (const [name, quaternion] of grip.fingers) bones.get(name).quaternion.copy(quaternion);
      hand.updateMatrixWorld(true);
      const left = grip.left;
      const palm = blade.localToWorld(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter - .09, 0));
      const leftGrip = dadaoCalibratedGrip(palm, worldRotation, point('LeftArm'), left.center,
        leftPole.applyQuaternion(chest), ...sampleDadaoWorldGrip(pose, 'left'));
      const leftFrame = leftGrip.rotation;
      const wrist = leftGrip.wrist;
      leftSolution = solveArm(bones.get('LeftArm'), bones.get('LeftForeArm'), bones.get('LeftHand'), wrist,
        leftGrip.pole);
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
