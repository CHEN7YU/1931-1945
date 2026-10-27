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

export function createNativeGaitProfile(idle) {
  const carry = () => ({ duration: 1, times: [0, 1],
    positions: [...idle.positions.slice(0, 3), ...idle.positions.slice(0, 3)],
    quaternions: [...idle.quaternions.slice(0, 4), ...idle.quaternions.slice(0, 4)] });
  return { idle, walk: carry(), run: carry(), strideMeters: 2.4, walkStrideMeters: 1.25,
    muzzle: [0, 0, -.891], lowStepGait: true, lowStepBanks: [.55, .85] };
}

export function lowStepTarget(phase, stride, duty, clearance) {
  if (![phase, stride, duty, clearance].every(Number.isFinite) || phase < 0 || phase >= 1 ||
    stride <= 0 || duty <= 0 || duty >= 1 || clearance < 0 || clearance > .1) throw new RangeError('Invalid low-step trajectory');
  const half = stride * duty / 2;
  if (phase < duty) return { z: -half + stride * phase, lift: 0 };
  const t = (phase - duty) / (1 - duty), smooth = t * t * (3 - 2 * t);
  return { z: half * (1 - 2 * smooth), lift: clearance * Math.sin(Math.PI * t) ** 2 };
}

export function applyNativeLowStep(root, bones, motion, restFeet, groundAt) {
  const weight = motion.weight * motion.upright;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1 || typeof groundAt !== 'function') throw new Error('Invalid owned low-step gait');
  if (weight < .001) return { kind: 'native-low-step', weight };
  const hips = bones.get('Hips'), hipPosition = hips.getWorldPosition(new Vector3());
  hipPosition.y -= motion.hipDrop;
  hips.position.copy(hips.parent.worldToLocal(hipPosition));
  root.updateMatrixWorld(true);
  const result = { kind: 'native-low-step', weight }, facing = root.getWorldQuaternion(new Quaternion());
  for (const side of ['Left', 'Right']) {
    const upper = bones.get(`${side}UpLeg`), knee = bones.get(`${side}Leg`), foot = bones.get(`${side}Foot`);
    const origin = upper.getWorldPosition(new Vector3()), bend = knee.getWorldPosition(new Vector3());
    const source = foot.getWorldPosition(new Vector3()), target = source.clone();
    const upperBefore = upper.quaternion.clone(), kneeBefore = knee.quaternion.clone();
    const rotation = foot.getWorldQuaternion(new Quaternion());
    const offset = side === 'Left' ? 0 : .5;
    const walk = lowStepTarget((motion.walkPhase + offset) % 1, motion.walkStride, .52, .03 + .02 * motion.legLift);
    const run = lowStepTarget((motion.runPhase + offset) % 1, motion.runStride, .27, .045 + .025 * motion.legLift);
    const local = restFeet[side].clone();
    local.z += walk.z + (run.z - walk.z) * motion.jog;
    root.localToWorld(local);
    const floor = groundAt(local.x, local.z), lift = walk.lift + (run.lift - walk.lift) * motion.jog;
    target.set(local.x, floor + restFeet[side].y + lift, local.z);
    const reach = origin.distanceTo(bend) + bend.distanceTo(source) - 1e-5;
    const horizontal = Math.hypot(target.x - origin.x, target.z - origin.z);
    const lowest = origin.y - Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal));
    target.y = Math.max(lowest, target.y);
    const solved = solveArm(upper, knee, foot, target, new Vector3(0, 0, -1).applyQuaternion(facing));
    if (!solved.reachable || solved.error > .01) throw new Error('Native low-step foot is unreachable');
    upper.quaternion.copy(upperBefore.slerp(upper.quaternion, weight));
    knee.quaternion.copy(kneeBefore.slerp(knee.quaternion, weight));
    upper.updateMatrixWorld(true);
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
    foot.updateMatrixWorld(true);
    result[side.toLowerCase()] = { floor, lift: foot.getWorldPosition(new Vector3()).y - floor - restFeet[side].y,
      requestedLift: lift * weight, error: solved.error };
  }
  return result;
}
