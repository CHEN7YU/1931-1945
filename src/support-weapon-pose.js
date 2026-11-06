import * as THREE from 'three';
import { solveArm } from './nra-rifle-pose.js';

export const SUPPORT_WEAPON_BANKS = Object.freeze([
  { kind: 'type89', stance: 'crouched', firingPose: 'kneeling', phase: 'operate', neutralPitch: 0, modelOffset: Object.freeze([0, 0, -.14]) },
  { kind: 'maxim24', stance: 'crouched', firingPose: 'kneeling', phase: 'operate', neutralPitch: 0, modelOffset: Object.freeze([0, 0, -.76]) },
  { kind: 'maxim24aa', stance: 'standing', firingPose: null, phase: 'operate', neutralPitch: .05, modelOffset: Object.freeze([0, 0, -.68]) },
  { kind: 'bofors75', stance: 'crouched', firingPose: 'kneeling', phase: 'operate', neutralPitch: 0, modelOffset: Object.freeze([0, 0, -1.02]) },
].map(Object.freeze));
export const SUPPORT_CONTACT = Object.freeze({ wristTolerance: .04, palmTolerance: .008,
  maximumLean: 1.05, maximumClavicleSwing: .7 });

const position = node => node.getWorldPosition(new THREE.Vector3());
const rotation = node => node.getWorldQuaternion(new THREE.Quaternion());
function setRotation(node, world) {
  node.quaternion.copy(rotation(node.parent).invert().multiply(world));
  node.updateMatrixWorld(true);
}
function frame(forward, across) {
  const x = forward.clone().normalize(), y = across.clone().addScaledVector(x, -across.dot(x)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

// Anchors survive mesh batching and rotate with the actual control assembly.
export function addSupportGrip(parent, name, { center, radius, normal, forward, axis = [0, 1, 0] }) {
  const grip = new THREE.Object3D(), palm = new THREE.Object3D(), wrist = new THREE.Object3D();
  grip.name = `${name}-control-axis`; grip.position.fromArray(center); parent.add(grip);
  const outward = new THREE.Vector3(...normal).normalize(), advance = new THREE.Vector3(...forward).normalize();
  palm.name = `${name}-palm-contact`; palm.position.copy(outward).multiplyScalar(radius + .008);
  wrist.name = `${name}-wrist-target`; wrist.position.copy(palm.position).addScaledVector(advance, -.055);
  grip.add(palm, wrist);
  return { grip, palm, wrist, radius, axis: [...axis], forward: advance.toArray(), normal: outward.toArray() };
}

export function supportWeaponPoseIndex(actor) {
  const marker = actor?.supportWeaponPose;
  if (!(actor?.health > 0) || actor.casualty || actor.sihangShield?.active ||
    marker?.active !== true || !(['operate', 'loading'].includes(marker.phase) ||
      marker.kind === 'bofors75' && marker.phase === 'march')) return -1;
  return SUPPORT_WEAPON_BANKS.findIndex(bank => bank.kind === marker.kind);
}

export function supportWeaponTargets(model, actorRoot, phase = 'operate') {
  const support = model?.userData.supportWeapon;
  if (!support || !['operate', 'loading', 'march'].includes(phase)) throw new Error('Missing authored support control anchors');
  model.updateWorldMatrix(true, true); actorRoot.updateWorldMatrix(true, false);
  const local = node => actorRoot.worldToLocal(position(node)).toArray();
  const inverse = rotation(actorRoot).invert();
  return Object.fromEntries(['left', 'right'].map(side => {
    const anchor = phase === 'loading' && support.loading?.[side] || support.grips[side];
    const transform = rotation(anchor.grip);
    const direction = values => new THREE.Vector3(...values).applyQuaternion(transform).applyQuaternion(inverse).toArray();
    return [side, { wrist: local(anchor.wrist), palm: local(anchor.palm), center: local(anchor.grip),
      radius: anchor.radius, forward: direction(anchor.forward), normal: direction(anchor.normal),
      axis: direction(anchor.axis) }];
  }));
}

// The isolated first-person sleeves use the same native posture origins, not camera-relative invented arm lengths.
export function supportViewShoulders(kind, targets, lengths, profile, phase = 'operate') {
  const bank = SUPPORT_WEAPON_BANKS.find(bank => bank.kind === kind);
  const stance = phase === 'march' ? 'standing' : bank?.firingPose ?? 'standing';
  const right = profile?.rifleContacts?.[stance], pivot = profile?.riflePivots?.[stance] ?? profile?.leanPivot;
  if (!right || !pivot) throw new Error('First-person support arms require the native posture shoulder/pivot profile');
  const shoulders = { left: new THREE.Vector3(-right[0], right[1], right[2]), right: new THREE.Vector3(...right) };
  const center = new THREE.Vector3(...targets.left.wrist).add(new THREE.Vector3(...targets.right.wrist)).multiplyScalar(.5);
  const origin = new THREE.Vector3(...pivot), horizontal = center.clone().sub(origin); horizontal.y = 0;
  const axis = horizontal.lengthSq() > 1e-8 ? new THREE.Vector3(0, 1, 0).cross(horizontal.normalize()).normalize()
    : new THREE.Vector3(1, 0, 0);
  const score = points => Math.max(...['left', 'right'].map(side => points[side].distanceTo(new THREE.Vector3(...targets[side].wrist)) /
    (lengths[side][0] + lengths[side][1])));
  let best = shoulders, bestScore = score(shoulders), lean = 0;
  if (bestScore > .88) for (let step = 1; step <= 12; step++) {
    const angle = SUPPORT_CONTACT.maximumLean * step / 12, swing = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const candidate = Object.fromEntries(['left', 'right'].map(side =>
      [side, shoulders[side].clone().sub(origin).applyQuaternion(swing).add(origin)]));
    const candidateScore = score(candidate);
    if (candidateScore < bestScore) { best = candidate; bestScore = candidateScore; lean = angle; }
  }
  for (const side of ['left', 'right']) {
    const target = new THREE.Vector3(...targets[side].wrist);
    if (best[side].distanceTo(target) < (lengths[side][0] + lengths[side][1]) * .92) continue;
    const offset = new THREE.Vector3(side === 'left' ? -.10 : .10, -.025, .025);
    const clavicle = best[side].clone().sub(offset);
    const swing = new THREE.Quaternion().setFromUnitVectors(offset.clone().normalize(), target.clone().sub(clavicle).normalize());
    const angle = 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
    offset.applyQuaternion(new THREE.Quaternion().slerp(swing, angle > 0 ?
      Math.min(1, SUPPORT_CONTACT.maximumClavicleSwing / angle) : 1));
    best[side].copy(clavicle).add(offset);
  }
  return { shoulders: Object.fromEntries(Object.entries(best).map(([side, point]) => [side, point.toArray()])), lean };
}

export function createSupportWeaponPose(root, bones, {
  poseIndex = supportWeaponPoseIndex, readMarker = actor => actor.supportWeaponPose,
} = {}) {
  if (typeof poseIndex !== 'function' || typeof readMarker !== 'function')
    throw new TypeError('Native grip posing requires explicit pose and marker readers');
  const required = ['Spine', ...['Left', 'Right'].flatMap(side =>
    ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'HandMiddle1', 'HandIndex1', 'HandPinky1'].map(name => side + name))];
  for (const name of required) if (!bones.has(name)) throw new Error(`Missing native support joint: ${name}`);
  const modified = new Map();
  let owner = null, snapshot = null;
  const restore = () => {
    for (const [bone, state] of modified) {
      // A later animation/casualty solver owns its new rotations; never overwrite those.
      if (bone.quaternion.equals(state.applied)) bone.quaternion.copy(state.base);
    }
    modified.clear(); root.updateMatrixWorld(true);
  };
  const remember = bone => {
    if (!modified.has(bone)) modified.set(bone, { base: bone.quaternion.clone(), applied: null });
  };
  const palm = side => position(bones.get(`${side}Hand`)).lerp(position(bones.get(`${side}HandMiddle1`)), .55);
  function orient(side, forward, normal) {
    const hand = bones.get(`${side}Hand`);
    const native = frame(position(bones.get(`${side}HandMiddle1`)).sub(position(hand)),
      position(bones.get(`${side}HandIndex1`)).sub(position(bones.get(`${side}HandPinky1`))));
    setRotation(hand, frame(forward, normal.clone().cross(forward)).multiply(native.invert()).multiply(rotation(hand)));
  }
  function curl(side) {
    for (const [index, finger] of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'].entries()) {
      for (let joint = 1; joint <= 3; joint++) {
        const bone = bones.get(`${side}Hand${finger}${joint}`);
        if (!bone) continue;
        remember(bone);
        const base = modified.get(bone).base, angle = new THREE.Euler().setFromQuaternion(base, 'XYZ');
        angle.x = finger === 'Thumb' ? side === 'Left' ? [-.25, .15, .15][joint - 1] : [.25, .45, .45][joint - 1]
          : [.5, .85, .5][joint - 1] + index * .04;
        if (joint > 1) { angle.y = 0; angle.z = 0; }
        if (finger === 'Thumb' && joint === 1) angle.z += side === 'Left' ? -.22 : .22;
        bone.quaternion.setFromEuler(angle);
      }
    }
    root.updateMatrixWorld(true);
  }
  return {
    reset({ preservePose = false } = {}) {
      if (preservePose) modified.clear(); else restore();
      owner = null; snapshot = null;
    },
    update(actor, now, model = null) {
      if (!Number.isFinite(now)) throw new RangeError('Support pose requires finite simulation time');
      const index = poseIndex(actor);
      if (index < 0) { this.reset({ preservePose: actor?.health <= 0 || Boolean(actor?.casualty) }); return null; }
      restore();
      const marker = readMarker(actor);
      const targets = model ? supportWeaponTargets(model, root, marker.phase) : marker.targets;
      for (const side of ['left', 'right']) for (const key of ['wrist', 'palm', 'forward', 'normal']) {
        if (!Array.isArray(targets?.[side]?.[key]) || targets[side][key].length !== 3 ||
          !targets[side][key].every(Number.isFinite)) throw new Error('Support pose requires finite actor-local grip frames');
      }
      owner = actor.id;
      for (const name of ['Spine', ...['Left', 'Right'].flatMap(side => ['Shoulder', 'Arm', 'ForeArm', 'Hand'].map(name => side + name))])
        remember(bones.get(name));
      root.updateMatrixWorld(true);
      const facing = rotation(root), goals = Object.fromEntries(['left', 'right'].map(side =>
        [side, root.localToWorld(new THREE.Vector3(...targets[side].wrist))]));
      const spine = bones.get('Spine'), baseSpine = rotation(spine);
      const center = goals.left.clone().add(goals.right).multiplyScalar(.5);
      const reachScore = () => Math.max(...['Left', 'Right'].map(side => {
        const arm = bones.get(`${side}Arm`), lower = bones.get(`${side}ForeArm`), hand = bones.get(`${side}Hand`);
        return position(arm).distanceTo(goals[side.toLowerCase()]) /
          (position(arm).distanceTo(position(lower)) + position(lower).distanceTo(position(hand)));
      }));
      const horizontal = center.clone().sub(position(spine)); horizontal.y = 0;
      let lean = 0, bestScore = reachScore();
      if (horizontal.lengthSq() > 1e-8 && bestScore > .88) {
        const axis = new THREE.Vector3(0, 1, 0).cross(horizontal.normalize()).normalize();
        for (let step = 1; step <= 12; step++) {
          const angle = SUPPORT_CONTACT.maximumLean * step / 12;
          setRotation(spine, new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(baseSpine));
          const score = reachScore();
          if (score < bestScore) { bestScore = score; lean = angle; }
        }
        setRotation(spine, new THREE.Quaternion().setFromAxisAngle(axis, lean).multiply(baseSpine));
      }
      const hands = {};
      for (const side of ['Left', 'Right']) {
        const key = side.toLowerCase(), target = targets[key], shoulder = bones.get(`${side}Shoulder`);
        const upper = bones.get(`${side}Arm`), lower = bones.get(`${side}ForeArm`), hand = bones.get(`${side}Hand`);
        const desired = goals[key].clone();
        const lengths = [position(upper).distanceTo(position(lower)), position(lower).distanceTo(position(hand))];
        if (position(upper).distanceTo(desired) > (lengths[0] + lengths[1]) * .92) {
          const swing = new THREE.Quaternion().setFromUnitVectors(position(upper).sub(position(shoulder)).normalize(),
            desired.clone().sub(position(shoulder)).normalize());
          const angle = 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
          const bounded = new THREE.Quaternion().slerp(swing, angle > 0 ? Math.min(1, SUPPORT_CONTACT.maximumClavicleSwing / angle) : 1);
          setRotation(shoulder, bounded.multiply(rotation(shoulder)));
        }
        const worldPalm = root.localToWorld(new THREE.Vector3(...target.palm));
        const forward = new THREE.Vector3(...target.forward).applyQuaternion(facing);
        const normal = new THREE.Vector3(...target.normal).applyQuaternion(facing);
        const pole = new THREE.Vector3(side === 'Left' ? -.8 : .8,
          marker.kind === 'bofors75' && marker.phase !== 'march' ? .35 : -.55, .25).applyQuaternion(facing);
        let solved;
        for (let iteration = 0; iteration < 5; iteration++) {
          solved = solveArm(upper, lower, hand, desired, pole);
          orient(side, forward, normal);
          const offset = worldPalm.clone().sub(palm(side));
          if (offset.length() < .0005 || iteration === 4) break;
          desired.add(offset);
        }
        curl(side);
        hands[key] = { wrist: root.worldToLocal(position(hand)).toArray(), anchor: target.wrist.slice(),
          shoulder: root.worldToLocal(position(upper)).toArray(),
          elbow: root.worldToLocal(position(lower)).toArray(),
          wristError: position(hand).distanceTo(goals[key]), palmError: palm(side).distanceTo(worldPalm),
          reachable: solved.reachable, solveError: solved.error, lengths,
          distance: position(upper).distanceTo(desired), maximumReach: lengths[0] + lengths[1] };
      }
      for (const [bone, state] of modified) state.applied = bone.quaternion.clone();
      const limited = Object.values(hands).some(hand => !hand.reachable ||
        hand.wristError > SUPPORT_CONTACT.wristTolerance || hand.palmError > SUPPORT_CONTACT.palmTolerance);
      snapshot = { owner, kind: marker.kind, phase: marker.phase, bankIndex: index, lean, hands, contactLimited: limited };
      return snapshot;
    },
    get snapshot() { return snapshot; },
    get issue() { return snapshot?.contactLimited ? '支援武器握点超出原生手臂可达范围' : null; },
  };
}
