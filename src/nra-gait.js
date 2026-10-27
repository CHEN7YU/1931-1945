import { Vector3, Quaternion } from 'three';
import { solveArm } from './nra-rifle-pose.js';

export function applyNativeBodyLean(root, bones, motion) {
  if (!Number.isFinite(motion.bodyLean) || motion.bodyLean < 0 || motion.bodyLean > .4) throw new Error('Invalid owned torso lean');
  if (!motion.bodyLean) return;
  const facing = root.getWorldQuaternion(new Quaternion());
  const rotate = (bone, angle) => {
    const delta = facing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle)).multiply(facing.clone().invert());
    const world = delta.multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  };
  rotate(bones.get('Spine'), -motion.bodyLean);
  rotate(bones.get('Head'), motion.bodyLean * .8);
}

export function applyNativeLegLift(root, bones, motion, groundY) {
  const factor = 1 + (motion.legLift - 1) * motion.weight * motion.jog * motion.upright;
  if (!Number.isFinite(factor) || factor < .4 || factor > 1 || !Number.isFinite(groundY)) throw new Error('Invalid owned leg-lift motion');
  if (factor > .999) return { factor };
  const result = { factor }, facing = root.getWorldQuaternion(new Quaternion());
  for (const side of ['Left', 'Right']) {
    const upper = bones.get(`${side}UpLeg`), knee = bones.get(`${side}Leg`), foot = bones.get(`${side}Foot`);
    const origin = upper.getWorldPosition(new Vector3()), bend = knee.getWorldPosition(new Vector3());
    const source = foot.getWorldPosition(new Vector3()), target = source.clone();
    const rotation = foot.getWorldQuaternion(new Quaternion());
    const reach = origin.distanceTo(bend) + bend.distanceTo(source) - 1e-5;
    const horizontal = Math.hypot(source.x - origin.x, source.z - origin.z);
    const lowest = origin.y - Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal));
    target.y = Math.max(lowest, groundY + .1 + Math.max(0, source.y - groundY - .1) * factor);
    const pole = bend.clone().sub(origin), direction = target.clone().sub(origin).normalize();
    if (pole.clone().addScaledVector(direction, -pole.dot(direction)).lengthSq() < 1e-8) pole.set(0, 0, -1).applyQuaternion(facing);
    const solved = solveArm(upper, knee, foot, target, pole);
    if (!solved.reachable || solved.error > .01) throw new Error('Lower-lift running foot is unreachable');
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
    foot.updateMatrixWorld(true);
    result[side.toLowerCase()] = { sourceY: source.y - groundY, targetY: target.y - groundY, error: solved.error };
  }
  return result;
}
