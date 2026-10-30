import * as THREE from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { dadaoModel, dadaoWorldStroke, DADAO_HAND_TO_BLADE, DADAO_DIMENSIONS } from './dadao-model.js';

export function createNraDadaoPose(root, bones, grip) {
  const blade = dadaoModel();
  blade.userData.personalWeapon = true;
  blade.visible = false; root.add(blade);
  let solution = null, leftSolution = null;
  const point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
  return {
    blade,
    update(pose) {
      blade.visible = Boolean(pose);
      if (!pose) { solution = leftSolution = null; return; }
      const { wristOffset, rotation } = dadaoWorldStroke(pose);
      const body = root.getWorldQuaternion(new THREE.Quaternion());
      const desired = point('RightArm').add(wristOffset.applyQuaternion(body));
      const frameRotation = body.clone().multiply(rotation).multiply(DADAO_HAND_TO_BLADE);
      solution = solveArm(bones.get('RightArm'), bones.get('RightForeArm'), bones.get('RightHand'), desired,
        new THREE.Vector3(.8, -.3, .15).applyQuaternion(body));
      leftSolution = solveArm(bones.get('LeftArm'), bones.get('LeftForeArm'), bones.get('LeftHand'),
        point('LeftArm').add(new THREE.Vector3(-.02, -.40, -.08).applyQuaternion(body)),
        new THREE.Vector3(-.5, -.3, .15).applyQuaternion(body));
      const hand = bones.get('RightHand');
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(frameRotation).multiply(grip.wristRotation));
      for (const [name, quaternion] of grip.fingers) bones.get(name).quaternion.copy(quaternion);
      hand.updateMatrixWorld(true);
      // Attach to the actual solved wrist, never to the requested IK target.
      const actualFrame = hand.getWorldQuaternion(new THREE.Quaternion()).multiply(grip.wristRotation.clone().invert());
      const worldRotation = actualFrame.clone().multiply(DADAO_HAND_TO_BLADE.clone().invert());
      const center = point('RightHand').add(grip.center.clone().applyQuaternion(actualFrame))
        .sub(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0).applyQuaternion(worldRotation));
      blade.position.copy(root.worldToLocal(center));
      blade.quaternion.copy(body.invert().multiply(worldRotation));
      root.updateMatrixWorld(true);
    },
    get issue() {
      if (solution && (!solution.reachable || solution.error > .015)) return '大刀右手握点超出可达范围';
      return leftSolution && (!leftSolution.reachable || leftSolution.error > .015) ? '大刀左臂超出可达范围' : null;
    },
    get snapshot() {
      return { visible: blade.visible, reachable: solution?.reachable ?? null, error: solution?.error ?? null,
        wrist: point('RightHand').toArray(), elbow: point('RightForeArm').toArray(),
        leftReachable: leftSolution?.reachable ?? null, leftError: leftSolution?.error ?? null,
        grip: blade.localToWorld(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0)).toArray() };
    },
  };
}
