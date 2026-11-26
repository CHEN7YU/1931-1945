import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { solveArm, solveCylinderGripFinger } from './nra-rifle-pose.js';
import { throwableGripPoint } from './grenade-model.js';
import { DADAO_GRIP } from './dadao.js';
import { createOfficerHandAppearance, createOfficerSleeveAppearance } from './officer-appearance.js';
import { weaponGripFingerRotation } from './weapon-hands.js';

function trimSleeveAtShoulder(mesh, upper, lower) {
  const origin = upper.getWorldPosition(new THREE.Vector3()), axis = lower.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const geometry = mesh.geometry, source = geometry.attributes, output = Object.fromEntries(Object.keys(source).map(name => [name, []]));
  const read = index => Object.fromEntries(Object.entries(source).map(([name, attribute]) =>
    [name, Array.from({ length: attribute.itemSize }, (_, slot) => attribute.getComponent(index, slot))]));
  const distance = vertex => new THREE.Vector3(...vertex.position).applyMatrix4(mesh.matrixWorld).sub(origin).dot(axis) - .025;
  const between = (a, b, t) => {
    const vertex = {};
    for (const [name, attribute] of Object.entries(source)) {
      if (name === 'skinIndex' || name === 'skinWeight') continue;
      vertex[name] = Array.from({ length: attribute.itemSize }, (_, slot) => a[name][slot] + (b[name][slot] - a[name][slot]) * t);
    }
    const weights = new Map();
    for (const [v, factor] of [[a, 1 - t], [b, t]]) for (let slot = 0; slot < 4; slot++) {
      const joint = v.skinIndex[slot];
      weights.set(joint, (weights.get(joint) ?? 0) + v.skinWeight[slot] * factor);
    }
    const influences = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4), total = influences.reduce((sum, [, w]) => sum + w, 0);
    vertex.skinIndex = Array.from({ length: 4 }, (_, slot) => influences[slot]?.[0] ?? 0);
    vertex.skinWeight = Array.from({ length: 4 }, (_, slot) => (influences[slot]?.[1] ?? 0) / total);
    return vertex;
  };
  for (let triangle = 0; triangle < geometry.index.count; triangle += 3) {
    const polygon = [0, 1, 2].map(corner => read(geometry.index.getX(triangle + corner))), clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = distance(a), db = distance(b);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) clipped.push(between(a, b, da / (da - db)));
    }
    for (let corner = 1; corner + 1 < clipped.length; corner++) for (const vertex of [clipped[0], clipped[corner], clipped[corner + 1]]) {
      for (const name of Object.keys(output)) output[name].push(...vertex[name]);
    }
  }
  const trimmed = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source)) {
    const array = new attribute.array.constructor(output[name]);
    trimmed.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  trimmed.computeBoundingBox(); trimmed.computeBoundingSphere();
  mesh.geometry = trimmed; geometry.dispose();
}

export function createNraGrenadeHand(source, side, { fullArm = false, weaponRig = false, blueUniformMaterials = null } = {}) {
  if (!['left', 'right'].includes(side)) throw new Error('Inspected hand requires its side');
  const prefix = side === 'right' ? 'Right' : 'Left', root = new THREE.Group(), alignment = new THREE.Group(), avatar = clone(source);
  root.name = `${side}-grenade-hand`; root.add(alignment); alignment.add(avatar); root.updateMatrixWorld(true);
  const meshes = [], bones = new Map();
  avatar.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); if (node.isBone) bones.set(node.name, node); });
  const handMesh = meshes.find(mesh => mesh.name === '\u624b\u90e8'), wrist = bones.get(prefix + 'Hand');
  if (!handMesh || !wrist) throw new Error('Native grenade hand is missing its inspected skin and wrist');
  const geometry = handMesh.geometry.clone(), attributes = geometry.attributes, kept = [];
  const owned = index => [0, 1, 2, 3].some(slot => attributes.skinWeight.getComponent(index, slot) > .05 &&
    (handMesh.skeleton.bones[attributes.skinIndex.getComponent(index, slot)].name.startsWith(prefix + 'Hand') ||
      fullArm && (weaponRig
        ? new RegExp(`^${prefix}(Arm|ForeArm)$`).test(handMesh.skeleton.bones[attributes.skinIndex.getComponent(index, slot)].name)
        : handMesh.skeleton.bones[attributes.skinIndex.getComponent(index, slot)].name === prefix + 'ForeArm')));
  const count = geometry.index?.count ?? attributes.position.count;
  for (let at = 0; at < count; at += 3) {
    const ids = [0, 1, 2].map(corner => geometry.index ? geometry.index.getX(at + corner) : at + corner);
    if (weaponRig ? ids.some(owned) : ids.every(owned)) kept.push(...ids);
  }
  if (kept.length < 60) throw new Error('Inspected hand has no isolated finger surface');
  geometry.clearGroups(); geometry.setIndex(kept); handMesh.geometry = geometry;
  if (Array.isArray(handMesh.material)) handMesh.material = handMesh.material[0];
  const officerAppearance = createOfficerHandAppearance(handMesh, { geometryOwned: true });
  const officerSleeves = [];
  root.userData.officerGloves = false;
  root.setOfficerAppearance = (officer, blue = false) => {
    officerAppearance.setOfficerAppearance(officer);
    for (const sleeve of officerSleeves) {
      sleeve.setOfficerAppearance(officer && !blue);
      sleeve.setBlueAppearance(blue);
    }
    root.userData.officerGloves = officer;
  };
  Object.defineProperty(root, 'officerAppearanceSnapshot', {
    get: () => ({ ...officerAppearance.snapshot, sleeveMaterials: officerSleeves.length }),
  });
  const sleeves = [];
  if (fullArm) {
    for (const mesh of meshes.filter(mesh => ['衣服', '臂章'].includes(mesh.name))) {
      const skin = mesh.geometry.attributes, indices = [], original = mesh.geometry;
      const belongs = index => {
        let weight = 0;
        for (let slot = 0; slot < 4; slot++) {
          if (new RegExp(`^${prefix}(Arm|ForeArm|Hand)`).test(mesh.skeleton.bones[skin.skinIndex.getComponent(index, slot)].name)) {
            weight += skin.skinWeight.getComponent(index, slot);
          }
        }
        return weight > (weaponRig ? .05 : .5);
      };
      for (let at = 0; at < (original.index?.count ?? skin.position.count); at += 3) {
        const ids = [0, 1, 2].map(corner => original.index ? original.index.getX(at + corner) : at + corner);
        if (weaponRig ? ids.some(belongs) : ids.every(belongs)) indices.push(...ids);
      }
      if (!indices.length) continue;
      mesh.geometry = original.clone(); mesh.geometry.clearGroups(); mesh.geometry.setIndex(indices);
      if (weaponRig) {
        const weights = mesh.geometry.attributes.skinWeight.clone(), joints = mesh.geometry.attributes.skinIndex.clone();
        const upperIndex = mesh.skeleton.bones.findIndex(bone => bone.name === prefix + 'Arm');
        const handIndex = mesh.skeleton.bones.findIndex(bone => bone.name === prefix + 'Hand');
        for (let vertex = 0; vertex < weights.count; vertex++) {
          for (let slot = 0; slot < 4; slot++) {
            const name = mesh.skeleton.bones[joints.getComponent(vertex, slot)].name;
            if (name.startsWith(prefix + 'Hand')) joints.setComponent(vertex, slot, handIndex);
            else if (!new RegExp(`^${prefix}(Arm|ForeArm)$`).test(name)) joints.setComponent(vertex, slot, upperIndex);
          }
        }
        mesh.geometry.setAttribute('skinWeight', weights); mesh.geometry.setAttribute('skinIndex', joints);
        mesh.normalizeSkinWeights();
        trimSleeveAtShoulder(mesh, bones.get(prefix + 'Arm'), bones.get(prefix + 'ForeArm'));
      }
      if (Array.isArray(mesh.material)) mesh.material = mesh.material[0];
      if (mesh.name === '衣服') officerSleeves.push(createOfficerSleeveAppearance(mesh, blueUniformMaterials?.get(mesh.material)));
      sleeves.push(mesh);
    }
    if (!sleeves.length) throw new Error('Native throwable arm is missing its authorized sleeve');
  }
  avatar.traverse(node => { if (node.isMesh) node.visible = node === handMesh || sleeves.includes(node); });
  const point = name => bones.get(prefix + name).getWorldPosition(new THREE.Vector3());
  const origin = point('Hand'), forward = point('HandMiddle1').sub(origin).normalize();
  const across = point('HandIndex1').sub(point('HandPinky1')).normalize();
  across.addScaledVector(forward, -across.dot(forward)).normalize();
  const frame = new THREE.Matrix4().makeBasis(across, forward, across.clone().cross(forward)).setPosition(origin).invert();
  alignment.matrixAutoUpdate = false; alignment.matrix.copy(frame); root.updateMatrixWorld(true);
  const rest = new Map([...bones].filter(([name]) => name.startsWith(prefix + 'Hand'))
    .map(([name, bone]) => [name, bone.quaternion.clone()]));
  const fingerNames = ['Index', 'Middle', 'Ring', 'Pinky'];
  const chains = new Map(['Thumb', ...fingerNames].map(name => {
    const chain = [1, 2, 3, 4].map(index => bones.get(`${prefix}Hand${name}${index}`));
    if (chain.some(bone => !bone)) throw new Error(`Inspected hand lacks a complete ${name} chain`);
    return [name, chain];
  }));
  const localPoint = bone => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const middleBase = localPoint(chains.get('Middle')[0]);
  const gripCenter = new THREE.Vector3(-.012, middleBase.y - .002, .048);
  const fingerLengths = Object.freeze(Object.fromEntries([...chains].map(([name, chain]) =>
    [name, Object.freeze(chain.slice(1).map((bone, index) => localPoint(bone).distanceTo(localPoint(chain[index]))))])));
  const solutions = new Map();
  const applySolution = (solution, closure, pinPull, kind) => {
    for (const [name, rotation] of rest) {
      if (name === prefix + 'Hand') continue;
      const finger = fingerNames.find(finger => name.startsWith(prefix + 'Hand' + finger));
      const weight = closure * (['Index', 'Middle'].includes(finger) ? 1 - .45 * pinPull : 1);
      bones.get(name).quaternion.copy(rotation).slerp(solution.rotations.get(name), weight);
    }
    root.updateMatrixWorld(true);
    root.gripSnapshot = Object.freeze({ kind, closure, reachAdjustment: solution.reachAdjustment, fingerLengths });
  };
  const rotateEnd = (third, end, target) => {
    const base = third.getWorldPosition(new THREE.Vector3()), direction = end.getWorldPosition(new THREE.Vector3()).sub(base).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(direction, target.clone().sub(base).normalize());
    const world = swing.multiply(third.getWorldQuaternion(new THREE.Quaternion()));
    third.quaternion.copy(third.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    third.updateMatrixWorld(true);
  };
  root.userData.handSource = 'nra-authorized-skinned-hand';
  root.userData.palmFacingAxis = side === 'left' ? -1 : 1;
  root.userData.grenadeGrip = gripCenter.toArray();
  root.userData.throwableGrips = Object.freeze({ grenade: Object.freeze(gripCenter.toArray()),
    'explosive-pack': Object.freeze([gripCenter.x, gripCenter.y, .056]),
    dadao: Object.freeze([gripCenter.x, gripCenter.y, DADAO_GRIP.palmDepth]) });
  root.userData.fingerCount = 5;
  const weaponGrips = new Map();
  root.prepareWeaponGrip = (name, { center, depth, thickness, round = false }) => {
    if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite) ||
      ![depth, thickness].every(value => Number.isFinite(value) && value > 0) || root.armSnapshot) {
      throw new RangeError('Weapon grips need finite dimensions in the unposed wrist frame');
    }
    for (const [name, rotation] of rest) bones.get(name).quaternion.copy(rotation);
    root.updateMatrixWorld(true);
    if (weaponRig && name !== 'machine') {
      for (const finger of fingerNames) {
        const chain = chains.get(finger);
        for (let joint = 0; joint < 3; joint++) {
          const bone = chain[joint], original = rest.get(bone.name);
          bone.quaternion.copy(weaponGripFingerRotation(bone.name, original, side, name));
        }
      }
      const thumb = chains.get('Thumb');
      for (let joint = 0; joint < 3; joint++) {
        const bone = thumb[joint];
        bone.quaternion.copy(weaponGripFingerRotation(bone.name, rest.get(bone.name), side, name));
      }
      if (name === 'bolt') {
        root.updateMatrixWorld(true);
        const tip = new THREE.Vector3(...center).add(new THREE.Vector3(.5, -.7, -.5).normalize().multiplyScalar(.018));
        const target = root.localToWorld(tip.clone().add(new THREE.Vector3(0, -fingerLengths.Thumb[2], 0)));
        const solved = solveArm(thumb[0], thumb[1], thumb[2], target,
          new THREE.Vector3(.8, .4, .8).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
        if (!solved.reachable || solved.error > .001) throw new Error('Native bolt thumb cannot oppose the wrapped fingers');
        rotateEnd(thumb[2], thumb[3], root.localToWorld(tip));
      }
      weaponGrips.set(name, { center: [...center], rotations: new Map([...rest.keys()]
        .filter(name => name !== prefix + 'Hand').map(name => [name, bones.get(name).quaternion.clone()])) });
      return;
    }
    const facing = root.getWorldQuaternion(new THREE.Quaternion()), sign = root.userData.palmFacingAxis;
    const contact = (angle, x) => {
      const curve = value => Math.sign(value) * Math.abs(value) ** (round ? 1 : .5);
      return new THREE.Vector3(x, center[1] + (depth + .005) * curve(Math.cos(angle)),
        center[2] - sign * (thickness + .005) * curve(Math.sin(angle)));
    };
    for (const [index, finger] of fingerNames.entries()) {
      const [first, second, third, end] = chains.get(finger), base = localPoint(first);
      const a = fingerLengths[finger][0], b = fingerLengths[finger][1];
      const x = round && name !== 'machine' && index < 2 ? center[0] + (index ? -.006 : .006) : base.x;
      if (name === 'machine') {
        solveCylinderGripFinger(first, second, third, end, angle => root.localToWorld(contact(angle, x)),
          new THREE.Vector3(0, 1, -sign * .7).applyQuaternion(facing), `${side} ${finger} machine-gun finger`);
        continue;
      }
      const angles = [-.2, ...Array.from({ length: 60 }, (_, i) => -.175 + i * .025),
        ...Array.from({ length: 108 }, (_, i) => -.225 - i * .025)];
      const angle = angles.find(angle => {
        const desired = root.localToWorld(contact(angle, x));
        const distance = desired.distanceTo(first.getWorldPosition(new THREE.Vector3()));
        return distance < a + b - .001 && distance > Math.abs(a - b) + .001;
      });
      if (angle === undefined) throw new Error(`Native ${side} ${finger} cannot reach ${name}`);
      const desired = root.localToWorld(contact(angle, x));
      const solved = solveArm(first, second, third, desired,
        new THREE.Vector3(0, 1, -sign * .7).applyQuaternion(facing));
      if (!solved.reachable || solved.error > .001) throw new Error(`Native ${name} finger solve failed`);
      const dip = localPoint(third), length = fingerLengths[finger][2];
      let low = 0, high = 2.4;
      if (contact(angle - high, x).distanceTo(dip) < length) throw new Error(`Native ${name} fingertip arc is too short`);
      for (let step = 0; step < 24; step++) {
        const turn = (low + high) / 2;
        if (contact(angle - turn, x).distanceTo(dip) < length) low = turn;
        else high = turn;
      }
      rotateEnd(third, end, root.localToWorld(contact(angle - (low + high) / 2, x)));
    }
    const [first, second, third, end] = chains.get('Thumb');
    const tip = contact(name === 'machine' ? .6 : 1.5,
      name === 'machine' ? localPoint(first).x : center[0] + (round ? .006 : .014));
    const direction = new THREE.Vector3(0, .8, sign * .6);
    const desired = root.localToWorld(tip.clone().addScaledVector(direction, -fingerLengths.Thumb[2]));
    const solved = solveArm(first, second, third, desired,
      new THREE.Vector3(.8, .4, -sign * .8).applyQuaternion(facing));
    if (!solved.reachable || solved.error > .001) throw new Error(`Native ${name} thumb cannot oppose the fingers`);
    rotateEnd(third, end, root.localToWorld(tip));
    weaponGrips.set(name, { center: [...center], rotations: new Map([...rest.keys()]
      .filter(name => name !== prefix + 'Hand').map(name => [name, bones.get(name).quaternion.clone()])) });
  };
  root.poseWeaponGrip = weights => {
    const selected = Object.entries(weights).filter(([, weight]) => weight > 0);
    if (!selected.length || Object.values(weights).some(weight => !Number.isFinite(weight) || weight < 0) ||
      selected.some(([name]) => !weaponGrips.has(name))) throw new RangeError('Invalid native weapon grip weights');
    for (const name of rest.keys()) {
      if (name === prefix + 'Hand') continue;
      let total = 0;
      for (const [grip, weight] of selected) {
        const target = weaponGrips.get(grip).rotations.get(name);
        if (!total) bones.get(name).quaternion.copy(target);
        else bones.get(name).quaternion.slerp(target, weight / (total + weight));
        total += weight;
      }
    }
    root.updateMatrixWorld(true);
    const frame = root.attachmentFrame ?? root;
    root.weaponGripSnapshot = { weights: { ...weights }, fingerLengths,
      curls: weaponRig ? Object.fromEntries([...chains].map(([finger, chain]) =>
        [finger, chain.slice(0, 3).map(bone => new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ').x)])) : null,
      joints: Object.fromEntries([...chains].map(([finger, chain]) =>
        [finger, chain.map(bone => frame.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).toArray())])) };
  };
  root.poseGrip = (closure, pinPull = 0, kind = 'grenade') => {
    if (![closure, pinPull].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Invalid native finger pose');
    if (!['grenade', 'explosive-pack', 'dadao'].includes(kind)) throw new RangeError('Hand contact needs a supported held object');
    if (solutions.has(kind)) { applySolution(solutions.get(kind), closure, pinPull, kind); return; }
    for (const [name, rotation] of rest) bones.get(name).quaternion.copy(rotation);
    root.updateMatrixWorld(true);
    const facing = root.getWorldQuaternion(new THREE.Quaternion()), pack = kind === 'explosive-pack';
    const center = new THREE.Vector3().fromArray(root.userData.throwableGrips[kind]);
    // The cylindrical grip includes finger-pad clearance: bones cannot lie on the handle surface.
    const surface = (x, angle) => kind === 'dadao'
      ? new THREE.Vector3(x, Math.sin(angle) * (DADAO_GRIP.radiusX + DADAO_GRIP.fingerPad),
        -Math.cos(angle) * (DADAO_GRIP.radiusZ + DADAO_GRIP.fingerPad))
      : throwableGripPoint(kind, x, angle);
    let reachAdjustment = 0;
    for (const [index, finger] of fingerNames.entries()) {
      const [first, second, third, end] = chains.get(finger), base = localPoint(first);
      const x = pack ? base.x : THREE.MathUtils.clamp(base.x, center.x - .030, center.x + .030);
      let angle = (kind === 'dadao' ? [2.45, 2.6, 2.6, 2.3]
        : pack ? [1.0, 1.15, 1.2, .7] : [1.4, 1.55, 1.55, .8])[index];
      const origin = first.getWorldPosition(new THREE.Vector3()), elbow = second.getWorldPosition(new THREE.Vector3()), dip = third.getWorldPosition(new THREE.Vector3());
      const a = origin.distanceTo(elbow), b = elbow.distanceTo(dip);
      const contact = theta => surface(x - center.x, theta).add(center);
      let desired = root.localToWorld(contact(angle));
      while (desired.distanceTo(origin) >= a + b - .001 && angle > .35) {
        angle -= .05; desired = root.localToWorld(contact(angle));
      }
      const delta = desired.clone().sub(origin);
      const clamped = delta.clone().clampLength(Math.abs(a - b) + .00001, a + b - .00001);
      reachAdjustment = Math.max(reachAdjustment, clamped.distanceTo(delta));
      solveArm(first, second, third, clamped.add(origin), new THREE.Vector3(0, 1, .25).applyQuaternion(facing));
      const current = localPoint(third);
      let low = angle, high = angle + 1.5;
      for (let i = 0; i < 24; i++) {
        const theta = (low + high) / 2;
        if (contact(theta).distanceTo(current) < fingerLengths[finger][2]) low = theta;
        else high = theta;
      }
      rotateEnd(third, end, root.localToWorld(contact((low + high) / 2)));
    }
    const [first, second, third, end] = chains.get('Thumb');
    const target = root.localToWorld(surface(kind === 'dadao' ? .04 : .032, kind === 'dadao' ? -.2 : -.45).add(center));
    const delta = target.sub(first.getWorldPosition(new THREE.Vector3()));
    const a = first.getWorldPosition(new THREE.Vector3()).distanceTo(second.getWorldPosition(new THREE.Vector3()));
    const b = second.getWorldPosition(new THREE.Vector3()).distanceTo(third.getWorldPosition(new THREE.Vector3()));
    delta.clampLength(Math.abs(a - b) + .001, a + b - .001).add(first.getWorldPosition(new THREE.Vector3()));
    solveArm(first, second, third, delta, new THREE.Vector3(1, .3, -.25).applyQuaternion(facing));
    rotateEnd(third, end, root.localToWorld(surface(kind === 'dadao' ? .014 : .006, kind === 'dadao' ? 1.05 : .02).add(center)));
    const solution = { reachAdjustment, rotations: new Map([...rest.keys()].map(name => [name, bones.get(name).quaternion.clone()])) };
    solutions.set(kind, solution); applySolution(solution, closure, pinPull, kind);
  };
  // Cache in the normalized wrist frame, before the independent arm rig is posed.
  for (const kind of ['grenade', 'explosive-pack', 'dadao']) root.poseGrip(1, 0, kind);
  const pinch = new THREE.Vector3(.025, .137, .025), pinchRotations = new Map();
  root.poseGrip(.3);
  for (const finger of ['Index', 'Thumb']) {
    const [first, second, third, end] = chains.get(finger);
    const target = root.localToWorld(pinch.clone());
    const direction = target.clone().sub(first.getWorldPosition(new THREE.Vector3())).normalize();
    const dip = target.clone().addScaledVector(direction, -fingerLengths[finger][2]);
    solveArm(first, second, third, dip, new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
    rotateEnd(third, end, target);
  }
  for (const name of rest.keys()) if (name !== prefix + 'Hand') pinchRotations.set(name, bones.get(name).quaternion.clone());
  for (const [name, rotation] of rest) bones.get(name).quaternion.copy(rotation);
  root.updateMatrixWorld(true);
  const guideRotations = new Map(), palmSide = root.userData.palmFacingAxis;
  for (const finger of fingerNames) {
    const [first, second, third, end] = chains.get(finger), base = localPoint(first);
    const target = root.localToWorld(new THREE.Vector3(base.x * .9, base.y + .028, palmSide * .065));
    const direction = target.clone().sub(first.getWorldPosition(new THREE.Vector3())).normalize();
    const dip = target.clone().addScaledVector(direction, -fingerLengths[finger][2]);
    solveArm(first, second, third, dip, new THREE.Vector3(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
    rotateEnd(third, end, target);
  }
  for (const name of rest.keys()) if (name !== prefix + 'Hand') guideRotations.set(name, bones.get(name).quaternion.clone());
  root.userData.preparationGrip = pinch.toArray();
  root.posePreparation = (weight = 1) => {
    root.poseGrip(.3);
    for (const [name, value] of pinchRotations) bones.get(name).quaternion.slerp(value, weight);
    root.updateMatrixWorld(true);
  };
  root.poseGuide = (preparation = 0, closure = .60) => {
    root.poseGrip(closure, .25);
    for (const [name, value] of guideRotations) {
      bones.get(name).quaternion.copy(value).slerp(pinchRotations.get(name), preparation);
    }
    root.updateMatrixWorld(true);
  };
  root.poseGrip(1);
  if (fullArm) {
    const upper = bones.get(prefix + 'Arm'), lower = bones.get(prefix + 'ForeArm');
    const armRest = [upper, lower, wrist].map(bone => [bone, bone.quaternion.clone()]);
    const shoulder = localPoint(upper), attachment = new THREE.Object3D();
    attachment.name = 'throwable-wrist-frame';
    const relative = wrist.matrixWorld.clone().invert().multiply(root.matrixWorld);
    relative.decompose(attachment.position, attachment.quaternion, attachment.scale);
    wrist.add(attachment);
    const wristOffset = attachment.quaternion.clone().invert();
    const lengths = [upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3())),
      lower.getWorldPosition(new THREE.Vector3()).distanceTo(wrist.getWorldPosition(new THREE.Vector3()))];
    root.userData.armLengths = Object.freeze([...lengths]);
    root.attachmentFrame = attachment;
    root.userData.armSource = 'nra-authorized-skinned-sleeve';
    root.poseArm = (origin, target, facing, pole) => {
      for (const [bone, rotation] of armRest) bone.quaternion.copy(rotation);
      alignment.matrix.copy(new THREE.Matrix4().makeTranslation(...origin.clone().sub(shoulder).toArray()).multiply(frame));
      root.updateMatrixWorld(true);
      const worldFacing = root.getWorldQuaternion(new THREE.Quaternion());
      const result = solveArm(upper, lower, wrist, root.localToWorld(target.clone()), pole.clone().applyQuaternion(worldFacing));
      const desired = worldFacing.clone().multiply(facing).multiply(wristOffset);
      const delta = desired.clone().multiply(wrist.getWorldQuaternion(new THREE.Quaternion()).invert());
      const axis = wrist.getWorldPosition(new THREE.Vector3()).sub(lower.getWorldPosition(new THREE.Vector3())).normalize();
      const projected = axis.clone().multiplyScalar(new THREE.Vector3(delta.x, delta.y, delta.z).dot(axis));
      const twist = new THREE.Quaternion(projected.x, projected.y, projected.z, delta.w);
      if (twist.lengthSq() > 1e-8) {
        const shared = new THREE.Quaternion().slerp(twist.normalize(), .65).multiply(lower.getWorldQuaternion(new THREE.Quaternion()));
        lower.quaternion.copy(lower.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(shared));
        root.updateMatrixWorld(true);
      }
      wrist.quaternion.copy(wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      root.updateMatrixWorld(true);
      root.armSnapshot = { ...result, lengths, shoulder: localPoint(upper).toArray(), elbow: localPoint(lower).toArray(),
        wrist: localPoint(wrist).toArray(), frame: root.worldToLocal(attachment.getWorldPosition(new THREE.Vector3())).toArray() };
    };
  }
  root.traverse(node => { if (node.isMesh) { node.frustumCulled = false; node.castShadow = false; } });
  return root;
}
