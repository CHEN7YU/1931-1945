import { Vector3, Quaternion } from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { firingCarryPosition } from './rifle-contacts.js';
import { applyHeadAim } from './head-aim.js';

export function applyNativeUpperBody(root, bones, motion) {
  applyNativeBodyLean(root, bones, motion);
  applyHeadAim(root, bones, motion.headAim);
}

export function applyNativeBodyLean(root, bones, motion) {
  if (!Number.isFinite(motion.bodyLean) || motion.bodyLean < 0 || motion.bodyLean > .65) throw new Error('Invalid owned torso lean');
  const yaw = motion.torsoYaw ?? 0;
  if (!Number.isFinite(yaw) || Math.abs(yaw) > .6) throw new Error('Invalid owned firing torso turn');
  if (!motion.bodyLean && !yaw) return;
  const facing = root.getWorldQuaternion(new Quaternion());
  const rotate = (bone, angle, axis = new Vector3(1, 0, 0)) => {
    const delta = facing.clone().multiply(new Quaternion().setFromAxisAngle(axis, angle)).multiply(facing.clone().invert());
    const world = delta.multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  };
  if (yaw) {
    rotate(bones.get('Spine'), yaw, new Vector3(0, 1, 0));
    rotate(bones.get('Head'), -yaw, new Vector3(0, 1, 0));
  }
  rotate(bones.get('Spine'), -motion.bodyLean);
  rotate(bones.get('Head'), motion.bodyLean * .8);
}

export function createNativeGaitProfile(idle, shoulder = null, pocket = null) {
  if (shoulder) {
    const origin = firingCarryPosition(shoulder, pocket), original = idle.positions.slice(0, 3);
    idle = { ...idle, positions: idle.positions.map((value, i) => value - original[i % 3] + origin[i % 3]) };
  }
  const carry = () => ({ duration: 1, times: [0, 1],
    positions: [...idle.positions.slice(0, 3), ...idle.positions.slice(0, 3)],
    quaternions: [...idle.quaternions.slice(0, 4), ...idle.quaternions.slice(0, 4)] });
  return { idle, walk: carry(), run: carry(), strideMeters: 2.4, walkStrideMeters: 1.25,
    muzzle: [0, 0, -.891], footCycleGait: true, lowReadyCarry: true, runContact: .27 };
}

export function lowStepTarget(phase, stride, duty, clearance) {
  if (![phase, stride, duty, clearance].every(Number.isFinite) || phase < 0 || phase >= 1 ||
    stride <= 0 || duty <= 0 || duty >= 1 || clearance < 0 || clearance > .1) throw new RangeError('Invalid low-step trajectory');
  const half = stride * duty / 2;
  if (phase < duty) return { z: -half + stride * phase, lift: 0 };
  const t = (phase - duty) / (1 - duty), smooth = t * t * (3 - 2 * t);
  return { z: half * (1 - 2 * smooth), lift: clearance * Math.sin(Math.PI * t) ** 2 };
}

export function runningStepTarget(phase, stride, heelHeight, duty = .27) {
  if (!Number.isFinite(duty) || duty <= 0 || duty >= .5 || !Number.isFinite(heelHeight) ||
    heelHeight < .1 || heelHeight > .3) throw new RangeError('Invalid running recovery');
  if (phase < duty) return { ...lowStepTarget(phase, stride, duty, 0), pitch: 0, stage: 'support' };
  lowStepTarget(phase, stride, duty, 0);
  const t = (phase - duty) / (1 - duty), half = stride * duty / 2;
  const smooth = value => value * value * (3 - 2 * value);
  const z = t < .35 ? half * (1 - .2 * smooth(t / .35)) : half * (.8 - 1.8 * smooth((t - .35) / .65));
  const lift = heelHeight * Math.sin(Math.PI * t ** .65) ** 2;
  return { z, lift, pitch: -.4 * Math.min(1, lift / .08) * Math.sin(Math.PI * t),
    stage: t < .55 ? 'rear-recovery' : 'forward-swing' };
}

export function applyNativeFootCycle(root, bones, motion, restFeet, groundAt) {
  const weight = motion.weight * motion.upright;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1 || typeof groundAt !== 'function') throw new Error('Invalid owned low-step gait');
  if (weight < .001) return { kind: 'native-foot-cycle', weight };
  const hips = bones.get('Hips'), hipPosition = hips.getWorldPosition(new Vector3());
  hipPosition.y -= motion.hipDrop;
  hips.position.copy(hips.parent.worldToLocal(hipPosition));
  root.updateMatrixWorld(true);
  const result = { kind: 'native-foot-cycle', weight }, facing = root.getWorldQuaternion(new Quaternion());
  for (const side of ['Left', 'Right']) {
    const upper = bones.get(`${side}UpLeg`), knee = bones.get(`${side}Leg`), foot = bones.get(`${side}Foot`);
    const origin = upper.getWorldPosition(new Vector3()), bend = knee.getWorldPosition(new Vector3());
    const source = foot.getWorldPosition(new Vector3()), target = source.clone();
    const upperBefore = upper.quaternion.clone(), kneeBefore = knee.quaternion.clone();
    const rotation = foot.getWorldQuaternion(new Quaternion());
    const offset = side === 'Left' ? 0 : .5;
    const walk = lowStepTarget((motion.walkPhase + offset) % 1, motion.walkStride, motion.walkContact ?? .52,
      motion.walkClearance ?? .03 + .02 * motion.legLift);
    const run = runningStepTarget((motion.runPhase + offset) % 1, motion.runStride,
      motion.heelHeight ?? .20 + .06 * motion.legLift, motion.runContact);
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
    if (!solved.reachable || solved.error > .01) throw new Error(`Native low-step foot is unreachable: ${side}, ` +
      `target=${target.toArray()}, origin=${origin.toArray()}, reach=${reach}, error=${solved.error}`);
    upper.quaternion.copy(upperBefore.slerp(upper.quaternion, weight));
    knee.quaternion.copy(kneeBefore.slerp(knee.quaternion, weight));
    upper.updateMatrixWorld(true);
    const pitch = run.pitch * motion.jog * weight;
    const footRotation = facing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
      .multiply(facing.clone().invert()).multiply(rotation);
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(footRotation));
    foot.updateMatrixWorld(true);
    result[side.toLowerCase()] = { floor, lift: foot.getWorldPosition(new Vector3()).y - floor - restFeet[side].y,
      requestedLift: lift * weight, localZ: walk.z + (run.z - walk.z) * motion.jog,
      phase: motion.jog > .5 ? run.stage : 'walk', error: solved.error };
  }
  return result;
}
