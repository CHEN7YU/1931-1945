import { Vector3, Quaternion, Matrix4 } from 'three';

export function dadaoCalibratedGrip(anchor, rotation, shoulder, center, pole, theta, phi) {
  const axis = new Vector3(0, 1, 0).applyQuaternion(rotation);
  const forward = new Vector3(1, 0, 0).applyQuaternion(rotation).multiplyScalar(Math.cos(theta))
    .addScaledVector(new Vector3(0, 0, 1).applyQuaternion(rotation), Math.sin(theta));
  const normal = new Vector3().crossVectors(axis, forward);
  const wrist = anchor.clone().addScaledVector(axis, -center.x).addScaledVector(forward, -center.y).addScaledVector(normal, -center.z);
  const direction = wrist.clone().sub(shoulder).normalize();
  const out = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
  const across = new Vector3().crossVectors(direction, out);
  return { wrist, rotation: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(axis, forward, normal)),
    pole: out.multiplyScalar(Math.cos(phi)).addScaledVector(across, Math.sin(phi)) };
}
