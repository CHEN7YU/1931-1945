import { Vector3, Quaternion } from 'three';
import { solveArm } from './nra-rifle-pose.js';

export class NativeGaitReachError extends Error {
  constructor(message, details) {
    super(message); this.name = 'NativeGaitReachError'; this.details = details;
  }
}
import { firingCarryPosition } from './rifle-contacts.js';
import { applyHeadAim } from './head-aim.js';

export function applyNativeUpperBody(root, bones, motion) {
  applyNativeBodyLean(root, bones, motion);
  applyHeadAim(root, bones, motion.headAim);
}

export function applyNativeBodyLean(root, bones, motion) {
  if (!Number.isFinite(motion.bodyLean) || motion.bodyLean < 0 || motion.bodyLean > .75) throw new Error('Invalid owned torso lean');
  const yaw = motion.torsoYaw ?? 0;
  if (!Number.isFinite(yaw) || Math.abs(yaw) > .6) throw new Error('Invalid owned firing torso turn');
  const upper = motion.upperBody ?? { yaw: 0, pitch: 0, roll: 0 };
  const lift = upper.lift ?? 0, lateral = upper.lateral ?? 0;
  if (![upper.yaw, upper.pitch, upper.roll].every(Number.isFinite) ||
    ![lift, lateral].every(Number.isFinite) || Math.abs(lift) > .03 || Math.abs(lateral) > .03 ||
    Math.abs(upper.yaw) > .19 || Math.abs(upper.pitch) > .02 || Math.abs(upper.roll) > .1)
    throw new Error('Invalid owned upper-body gait');
  if (!motion.bodyLean && !yaw && !upper.yaw && !upper.pitch && !upper.roll && !lift && !lateral) return;
  const facing = root.getWorldQuaternion(new Quaternion());
  const rotate = (bone, angle, axis = new Vector3(1, 0, 0)) => {
    const delta = facing.clone().multiply(new Quaternion().setFromAxisAngle(axis, angle)).multiply(facing.clone().invert());
    const world = delta.multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  };
  if (yaw || upper.yaw) {
    rotate(bones.get('Spine'), yaw + upper.yaw, new Vector3(0, 1, 0));
    rotate(bones.get('Head'), -yaw - upper.yaw, new Vector3(0, 1, 0));
  }
  rotate(bones.get('Spine'), -motion.bodyLean + upper.pitch);
  rotate(bones.get('Head'), motion.bodyLean * .8 - upper.pitch * .8);
  if (upper.roll) {
    rotate(bones.get('Spine'), upper.roll, new Vector3(0, 0, 1));
    rotate(bones.get('Head'), -upper.roll * .8, new Vector3(0, 0, 1));
  }
  if (lift || lateral) {
    const spine = bones.get('Spine'), position = spine.getWorldPosition(new Vector3());
    position.add(new Vector3(lateral, lift, 0).applyQuaternion(facing));
    spine.position.copy(spine.parent.worldToLocal(position));
    spine.updateMatrixWorld(true);
  }
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

export function turningStepTarget(phase, direction) {
  if (!Number.isFinite(phase) || phase < 0 || phase >= 1 || ![-1, 1].includes(direction)) {
    throw new RangeError('Turning steps require a bounded phase and signed turn direction');
  }
  const duty = .55, angle = Math.PI / 3;
  if (phase < duty) return { yaw: -direction * angle * phase, lift: 0 };
  const swing = (phase - duty) / (1 - duty), smooth = swing * swing * (3 - 2 * swing);
  return { yaw: direction * angle * (smooth - phase), lift: .055 * Math.sin(Math.PI * swing) ** 2 };
}

export function applyNativeFootCycle(root, bones, motion, restFeet, groundAt) {
  const turning = (motion.turn?.weight ?? 0) * (1 - motion.weight);
  const turnSupport = Math.min(1, motion.upright + (motion.wallLeft ?? 0) + (motion.wallRight ?? 0) +
    .65 * ((motion.kneeling ?? 0) + (motion.crouched ?? 0)));
  const weight = Math.max(motion.weight * motion.upright, turning * turnSupport);
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
    const lowTurn = turning * Math.min(1, (motion.kneeling ?? 0) + (motion.crouched ?? 0));
    if (lowTurn > 0) {
      const stanceFoot = root.worldToLocal(source.clone());
      local.x += (stanceFoot.x - local.x) * lowTurn;
      local.z += (stanceFoot.z - local.z) * lowTurn;
    }
    const turn = turningStepTarget(((motion.turn?.phase ?? 0) + offset) % 1, motion.turn?.direction ?? 1);
    const travelZ = walk.z + (run.z - walk.z) * motion.jog;
    local.z += travelZ * (1 - turning);
    local.applyAxisAngle(new Vector3(0, 1, 0), turn.yaw * turning);
    root.localToWorld(local);
    const contact = turning < .001 ? motion.footContacts?.[side.toLowerCase()] : null;
    if (contact) { local.x = contact.x; local.z = contact.z; }
    const floor = groundAt(local.x, local.z), lift = (walk.lift + (run.lift - walk.lift) * motion.jog) * (1 - turning) + turn.lift * turning;
    target.set(local.x, floor + restFeet[side].y + lift, local.z);
    const upperLength = origin.distanceTo(bend), lowerLength = bend.distanceTo(source);
    const reach = upperLength + lowerLength - 1e-5, minimum = Math.abs(upperLength - lowerLength) + 1e-5;
    const horizontal = Math.hypot(target.x - origin.x, target.z - origin.z);
    const lowest = origin.y - Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal));
    target.y = Math.max(lowest, target.y);
    if (origin.distanceTo(target) < minimum) {
      // Rising from a folded pose can put the planted foot inside the two-bone inner reach.
      const outward = new Vector3(target.x - origin.x, 0, target.z - origin.z);
      if (outward.lengthSq() < 1e-10) outward.set(side === 'Left' ? -1 : 1, 0, 0).applyQuaternion(facing);
      outward.normalize().multiplyScalar(Math.sqrt(Math.max(0, minimum * minimum - (target.y - origin.y) ** 2)));
      target.x = origin.x + outward.x; target.z = origin.z + outward.z;
    }

    const solved = solveArm(upper, knee, foot, target, new Vector3(0, 0, -1).applyQuaternion(facing));
    if (!solved.reachable || solved.error > .01) throw new NativeGaitReachError(`Native low-step foot is unreachable: ${side}`, {
      side, target: target.toArray(), origin: origin.toArray(), reach, error: solved.error });
    upper.quaternion.copy(upperBefore.slerp(upper.quaternion, weight));
    knee.quaternion.copy(kneeBefore.slerp(knee.quaternion, weight));
    upper.updateMatrixWorld(true);
    const pitch = run.pitch * motion.jog * weight;
    const footRotation = facing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn.yaw * turning))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
      .multiply(facing.clone().invert()).multiply(rotation);
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(footRotation));
    foot.updateMatrixWorld(true);
    result[side.toLowerCase()] = { floor, lift: foot.getWorldPosition(new Vector3()).y - floor - restFeet[side].y,
      requestedLift: lift * weight, localZ: walk.z + (run.z - walk.z) * motion.jog,
      phase: turning > .5 ? turn.lift > 0 ? 'turn-swing' : 'turn-support' : motion.jog > .5 ? run.stage : 'walk', error: solved.error };
  }
  return result;
}

function limitFootReach(origin, bend, source, target, sign, facing) {
  const upperLength = origin.distanceTo(bend), lowerLength = bend.distanceTo(source);
  const reach = upperLength + lowerLength - 1e-5, minimum = Math.abs(upperLength - lowerLength) + 1e-5;
  const horizontal = Math.hypot(target.x - origin.x, target.z - origin.z);
  target.y = Math.max(target.y, origin.y - Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal)));
  if (origin.distanceTo(target) < minimum) {
    const outward = new Vector3(target.x - origin.x, 0, target.z - origin.z);
    if (outward.lengthSq() < 1e-10) outward.set(sign, 0, .2).applyQuaternion(facing);
    outward.normalize().multiplyScalar(Math.sqrt(Math.max(0, minimum * minimum - (target.y - origin.y) ** 2)));
    target.x = origin.x + outward.x; target.z = origin.z + outward.z;
  }
  const displacement = target.clone().sub(origin);
  if (displacement.length() > reach) target.copy(origin).add(displacement.clampLength(minimum, reach));
}

export function applyNativeRestStance(root, bones, motion, restFeet, groundAt) {
  if (motion.upright < .99 || motion.weight > .001 || (motion.turn?.weight ?? 0) > .001) return;
  if (motion.hipDrop) {
    const hips = bones.get('Hips'), position = hips.getWorldPosition(new Vector3());
    position.y -= motion.hipDrop;
    hips.position.copy(hips.parent.worldToLocal(position)); root.updateMatrixWorld(true);
  }
  const facing = root.getWorldQuaternion(new Quaternion()), forward = new Vector3(0, 0, -1).applyQuaternion(facing);
  const centerZ = (restFeet.Left.z + restFeet.Right.z) / 2;
  const result = { kind: 'native-resting-stance', limited: false, feet: {} };
  for (const side of ['Left', 'Right']) {
    const upper = bones.get(`${side}UpLeg`), knee = bones.get(`${side}Leg`), foot = bones.get(`${side}Foot`);
    const sign = side === 'Left' ? -1 : 1;
    const target = root.localToWorld(new Vector3(sign * .125, 0, centerZ + sign * .025));
    target.y = groundAt(target.x, target.z) + restFeet[side].y;
    const requested = target.clone();
    const origin = upper.getWorldPosition(new Vector3()), bend = knee.getWorldPosition(new Vector3()),
      source = foot.getWorldPosition(new Vector3());
    limitFootReach(origin, bend, source, target, sign, facing);
    const previousRotation = foot.getWorldQuaternion(new Quaternion());
    const solved = solveArm(upper, knee, foot, target, new Vector3(sign * .08, 0, -1).applyQuaternion(facing));
    if (!solved.reachable || solved.error > .01) throw new NativeGaitReachError(`Native resting foot is unreachable: ${side}`, {
      side, requested: requested.toArray(), target: target.toArray(), error: solved.error });
    const adjustment = requested.distanceTo(target);
    result.limited ||= adjustment > .001;
    result.feet[side.toLowerCase()] = { requested: requested.toArray(), target: target.toArray(), adjustment, error: solved.error };
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(previousRotation));
    foot.updateMatrixWorld(true);
    const toe = bones.get(`${side}ToeBase`);
    if (toe) {
      const direction = toe.getWorldPosition(new Vector3()).sub(foot.getWorldPosition(new Vector3())); direction.y = 0;
      if (direction.lengthSq() > 1e-8) {
        const rotation = new Quaternion().setFromUnitVectors(direction.normalize(), forward);
        foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert()
          .multiply(rotation).multiply(foot.getWorldQuaternion(new Quaternion())));
        foot.updateMatrixWorld(true);
      }
    }
  }
  return result;
}

function postureFootBounds(root, bones) {
  const bounds = Object.fromEntries(['Left', 'Right'].map(side => [side, []]));
  root.traverseVisible(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let vertex = 0; vertex < position.count; vertex++) for (const side of ['Left', 'Right']) {
      let weight = 0;
      for (let slot = 0; slot < 4; slot++) {
        if ([`${side}Foot`, `${side}ToeBase`].includes(mesh.skeleton.bones[skinIndex.getComponent(vertex, slot)].name))
          weight += skinWeight.getComponent(vertex, slot);
      }
      if (weight <= .5) continue;
      const point = new Vector3().fromBufferAttribute(position, vertex);
      mesh.applyBoneTransform(vertex, point).applyMatrix4(mesh.matrixWorld);
      bounds[side].push(bones.get(`${side}Foot`).worldToLocal(point));
    }
  });
  return bounds;
}

export function applyNativePostureSupport(root, bones, motion, restFeet, groundAt, postures, feet) {
  const kneeWeight = (motion.crouched ?? 0) + (motion.kneeling ?? 0);
  if (!postures || kneeWeight < .001 || (motion.prone ?? 0) > .001 ||
    (motion.wallLeft ?? 0) + (motion.wallRight ?? 0) > .001 ||
    motion.speed > .25 || (motion.turn?.weight ?? 0) > .001) return null;
  const facing = root.getWorldQuaternion(new Quaternion()), centerZ = (restFeet.Left.z + restFeet.Right.z) / 2;
  const result = { kind: 'native-posture-support', feet: {} };
  for (const side of ['Left', 'Right']) {
    const sign = side === 'Left' ? -1 : 1, foot = bones.get(`${side}Foot`);
    // Plant the forward foot before folding the rear leg; reverse that order when rising.
    const step = Math.min(1, Math.max(0, side === 'Left' ? kneeWeight / .3 : (kneeWeight - .3) / .7));
    const supportWeight = step * step * (3 - 2 * step);
    const target = new Vector3(sign * .125, restFeet[side].y, centerZ + sign * .025).multiplyScalar(1 - supportWeight);
    const rotation = feet[side].rotation.clone();
    let total = 1 - supportWeight;
    for (const name of ['crouched', 'kneeling']) {
      const weight = (motion[name] ?? 0) / kneeWeight * supportWeight;
      if (!weight) continue;
      const support = postures[name].feet[side];
      target.addScaledVector(new Vector3().fromArray(support.position), weight);
      rotation.slerp(new Quaternion().fromArray(support.rotation), weight / (total + weight));
      total += weight;
    }
    if (side === 'Left') target.y += .045 * Math.sin(Math.PI * step) ** 2;
    const worldRotation = facing.clone().multiply(rotation);
    const localY = target.y;
    root.localToWorld(target);
    const floor = groundAt(target.x, target.z);
    const offset = new Vector3(), scale = foot.getWorldScale(new Vector3());
    let sole = Infinity;
    for (const point of feet[side].bounds) sole = Math.min(sole,
      offset.copy(point).multiply(scale).applyQuaternion(worldRotation).y);
    target.y = floor + Math.max(localY, -sole + .001);
    const requested = target.clone();
    limitFootReach(bones.get(`${side}UpLeg`).getWorldPosition(new Vector3()),
      bones.get(`${side}Leg`).getWorldPosition(new Vector3()), foot.getWorldPosition(new Vector3()), target, sign, facing);
    const solved = solveArm(bones.get(`${side}UpLeg`), bones.get(`${side}Leg`), foot, target,
      new Vector3(0, 0, -1).applyQuaternion(facing));
    if (!solved.reachable || solved.error > .01) throw new NativeGaitReachError(`Native posture foot is unreachable: ${side}`, {
      side, target: target.toArray(), error: solved.error });
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(worldRotation));
    foot.updateMatrixWorld(true);
    result.feet[side.toLowerCase()] = { requested: requested.toArray(), target: target.toArray(),
      adjustment: requested.distanceTo(target), floor, error: solved.error };
  }
  return result;
}

export function createNativeGaitProjection(root, bones, restFeet, groundAt, onRecovery = null, postures = null) {
  const hipsRest = bones.get('Hips').position.clone();
  const bounds = postures ? postureFootBounds(root, bones) : null;
  const feet = postures ? Object.fromEntries(['Left', 'Right'].map(side => [side, {
    rotation: root.getWorldQuaternion(new Quaternion()).invert().multiply(bones.get(`${side}Foot`).getWorldQuaternion(new Quaternion())),
    bounds: bounds[side],
  }])) : null;
  const restored = ['Hips', ...['Left', 'Right'].flatMap(side => ['UpLeg', 'Leg', 'Foot'].map(part => side + part))]
    .map(name => {
      const bone = bones.get(name);
      if (!bone) throw new Error(`Gait projection lacks ${name}`);
      return { bone, position: bone.position.clone(), rotation: bone.quaternion.clone() };
    });
  return (actor, motion, supportAt = groundAt) => {
    for (const entry of restored) {
      entry.position.copy(entry.bone.position); entry.rotation.copy(entry.bone.quaternion);
    }
    try {
      if (postures && actor.health > 0 && (motion.crouched ?? 0) + (motion.kneeling ?? 0) > .001 &&
        (motion.prone ?? 0) + (motion.wallLeft ?? 0) + (motion.wallRight ?? 0) < .001) {
        // Paused mixer bindings can retain an idle position during a repeated half-rise hold.
        const hips = bones.get('Hips'), knee = (motion.crouched ?? 0) + (motion.kneeling ?? 0);
        hips.position.copy(hipsRest).multiplyScalar(1 - knee);
        for (const name of ['crouched', 'kneeling']) if (motion[name])
          hips.position.addScaledVector(new Vector3().fromArray(postures[name].hips), motion[name]);
        root.updateMatrixWorld(true);
      }
      const restStance = actor.health > 0 ? applyNativeRestStance(root, bones, motion, restFeet, supportAt) : null;
      const legPose = applyNativeFootCycle(root, bones, motion, restFeet, supportAt);
      const postureSupport = actor.health > 0
        ? applyNativePostureSupport(root, bones, motion, restFeet, supportAt, postures, feet) : null;
      return { restStance: postureSupport ?? restStance ?? null, legPose };
    } catch (error) {
      if (!(error instanceof NativeGaitReachError) || !onRecovery || actor.id === 'pose-bake') throw error;
      for (const entry of restored) {
        entry.bone.position.copy(entry.position); entry.bone.quaternion.copy(entry.rotation);
      }
      root.updateMatrixWorld(true);
      onRecovery(error, { stage: 'native-gait', soldierId: actor.id, team: actor.team, stance: actor.stance,
        position: actor.position.toArray ? actor.position.toArray() : [actor.position.x, actor.position.y, actor.position.z],
        details: error.details });
      return { restStance: null, legPose: { kind: 'native-animation-base-pose', weight: 0, recovered: true } };
    }
  };
}
