import * as THREE from 'three';
import { poseDadaoViewArm } from './dadao-view-grips.js';
import { sampleDadaoWorldCut } from './dadao-world-grips.js';
import { grenadeHand, poseGrenadeHand, grenadeSleeve, alignGrenadeSleeve } from './grenade-model.js';
import { createStudySurface } from './uniform-surfaces.js';
import { dadaoSurfaces, DADAO_ART_ROOT, DADAO_CLOTH_TILE_METERS } from './dadao-surface.js';
import { DADAO, DADAO_GRIP, dadaoStroke } from './dadao.js';

export const DADAO_DIMENSIONS = Object.freeze({ bladeLength: .575, maxWidth: .093, gripLength: DADAO_GRIP.length,
  spineThickness: .006, edgeThickness: .00025, gripCenter: DADAO_GRIP.centerY });
const bladeProfile = [
  [.045, -.022, .035], [.10, -.023, .042], [.28, -.021, .053], [.43, -.017, .067],
  [.51, -.014, .079], [.555, .005, .083], [.595, .055, .074], [.62, .071, .071],
];
let template;
const views = new Map(), gripRoll = 3.8;
export const DADAO_HAND_TO_BLADE = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, gripRoll, Math.PI / 2, 'YXZ'));
const handToBlade = DADAO_HAND_TO_BLADE;
// Preserve the carry fist orientation without changing the grip during the stroke.
const carryGrip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.6 - gripRoll);
// Wrist travel and blade rotation share a plane, preventing a face-first slap.
const cutDown = new THREE.Vector3(-1, -DADAO.diagonalSlope, 0).normalize();
const cutNormal = new THREE.Vector3(DADAO.diagonalSlope, -1, 0).normalize().setZ(-1.2).normalize();
const cutForward = new THREE.Vector3().crossVectors(cutNormal, cutDown);

function chopRotation(angle) {
  const axis = cutDown.clone().multiplyScalar(Math.sin(angle)).addScaledVector(cutForward, Math.cos(angle));
  const edge = cutDown.clone().multiplyScalar(Math.cos(angle)).addScaledVector(cutForward, -Math.sin(angle));
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(edge, axis, cutNormal));
}

const raisedRotation = chopRotation(-1.2);
const viewFollowRotation = chopRotation(1.0);
const worldAxis = angles => new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...angles, 'YXZ'));
const worldLoadedAxes = [worldAxis([-.1, -.55, -.8]), worldAxis([.55, 0, -.10])];
const worldContactAxis = worldAxis([-1.25, -.3, -.55]), worldBrakeAxis = worldAxis([-2.05, -.25, -.3]);

export function authoredDadaoWorldCut(overhead, progress) {
  const start = new THREE.Vector3(...(overhead ? [-.04, .47, -.065] : [.22, .06, -.14]));
  const end = new THREE.Vector3(-.22, -.16, -.35);
  const first = start.clone().add(new THREE.Vector3(overhead ? 0 : -.12, overhead ? -.32 : -.14, overhead ? -.65 : -.20));
  const second = end.clone().add(new THREE.Vector3(overhead ? .14 : .02, overhead ? -.04 : .02, overhead ? -.20 : -.08));
  const t = progress, u = 1 - t, loadedAxis = worldLoadedAxes[overhead ? 1 : 0];
  const contactAxis = worldContactAxis, brakeAxis = worldBrakeAxis;
  const rawAxis = loadedAxis.clone().multiplyScalar(u * u).addScaledVector(contactAxis, 2 * u * t)
    .addScaledVector(brakeAxis, t * t);
  const axis = rawAxis.clone().normalize();
  const axisVelocity = contactAxis.clone().sub(loadedAxis).multiplyScalar(2 * u)
    .addScaledVector(brakeAxis.clone().sub(contactAxis), 2 * t);
  axisVelocity.addScaledVector(axis, -axisVelocity.dot(axis)).divideScalar(rawAxis.length());
  const anchor = start.clone().multiplyScalar(u ** 3).addScaledVector(first, 3 * u * u * t)
    .addScaledVector(second, 3 * u * t * t).addScaledVector(end, t ** 3);
  const velocity = first.clone().sub(start).multiplyScalar(3 * u * u)
    .addScaledVector(second.clone().sub(first), 6 * u * t).addScaledVector(end.clone().sub(second), 3 * t * t)
    .addScaledVector(axisVelocity, .48);
  // Roll the actual cutting edge into the tangent, rather than interpolating arbitrary Euler roll.
  const edge = velocity.addScaledVector(axis, -velocity.dot(axis)).normalize();
  const normal = new THREE.Vector3().crossVectors(edge, axis);
  return {
    anchor,
    rotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(edge, axis, normal)),
    rightPole: new THREE.Vector3(.30, -.65, -.55),
    leftPole: new THREE.Vector3(-.35, -.65, -.8),
  };
}

export function dadaoWorldStroke(pose, calibration) {
  const overhead = pose.style === 1, t = THREE.MathUtils.clamp(pose.progress, 0, 1);
  const key = (position, angles, right, left) => ({ anchor: new THREE.Vector3(...position),
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles, 'YXZ')),
    rightPole: new THREE.Vector3(...right), leftPole: new THREE.Vector3(...left) });
  const ready = key([.04, .13, -.23], [-.15, .15, -.25], [.35, -.8, -.5], [-.35, -.8, -.5]);
  const cutKey = progress => {
    const sample = calibration?.(progress) ?? sampleDadaoWorldCut({ ...pose, progress });
    return { ...sample, rightPole: new THREE.Vector3(.30, -.65, -.55), leftPole: new THREE.Vector3(-.35, -.65, -.8) };
  };
  if (pose.phase === 'cut') return cutKey(t);
  const loaded = cutKey(0), brake = cutKey(1);
  const gathered = key([-.10, -.02, -.30], [-1.2, -.35, -.65], [.25, -.9, -.4], [-.3, -.9, -.4]);
  const blend = (a, b, weight) => ({
    anchor: a.anchor.clone().lerp(b.anchor, weight), rotation: a.rotation.clone().slerp(b.rotation, weight),
    rightPole: a.rightPole.clone().lerp(b.rightPole, weight), leftPole: a.leftPole.clone().lerp(b.leftPole, weight),
  });
  const smooth = value => THREE.MathUtils.smoothstep(value, 0, 1);
  if (pose.phase === 'windup') {
    const stroke = blend(ready, loaded, smooth(t));
    // Load around the front/outside of the head, not diagonally through the neck.
    stroke.anchor.z -= .23 * Math.sin(Math.PI * smooth(t));
    return stroke;
  }
  if (pose.phase === 'recover') {
    // Gather beside the torso before returning to guard, rather than reversing the striking arc.
    return t < .35 ? blend(brake, gathered, smooth(t / .35)) : blend(gathered, ready, smooth((t - .35) / .65));
  }
  if (pose.phase === 'draw') return blend(key([.16, -.12, -.18], [-.6, -.2, -.5],
    [.35, -.8, -.5], [-.35, -.8, -.5]), ready, smooth(t));
  return ready;
}

export function dadaoBladeGeometry() {
  const positions = [], uv = [], indices = [], sections = [];
  for (let row = 0; row <= 112; row++) {
    const y = .045 + .575 * row / 112;
    const next = bladeProfile.findIndex(section => section[0] >= y - 1e-8);
    const b = bladeProfile[Math.max(1, next)], a = bladeProfile[Math.max(1, next) - 1];
    const mix = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    sections.push([y, THREE.MathUtils.lerp(a[1], b[1], mix), THREE.MathUtils.lerp(a[2], b[2], mix)]);
  }
  const bands = [0, .08, .73, .94, 1], bandDepth = [1, .95, .76, .2, .04167], stride = bands.length;
  for (const sign of [1, -1]) for (const [row, [y, spine, edge]] of sections.entries()) {
    const taper = THREE.MathUtils.lerp(.003, .0017, row / 112);
    for (const [column, u] of bands.entries()) {
      const nick = u === 1 ? Math.max(0, Math.sin(y * 923) - .92) * .0014 : 0;
      positions.push(THREE.MathUtils.lerp(spine, edge, u) - nick, y, sign * taper * bandDepth[column]);
      uv.push(u, row / 112);
    }
  }
  const sideSize = sections.length * stride;
  for (let face = 0; face < 2; face++) for (let row = 0; row < sections.length - 1; row++) {
    for (let column = 0; column < stride - 1; column++) {
      const a = face * sideSize + row * stride + column, b = a + stride;
      if (face === 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
      else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  for (let row = 0; row < sections.length - 1; row++) for (const column of [0, stride - 1]) {
    const a = row * stride + column, b = a + stride;
    if (column === 0) indices.push(a, b, a + sideSize, b, b + sideSize, a + sideSize);
    else indices.push(a, a + sideSize, b, b, a + sideSize, b + sideSize);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}

function gripWrapGeometry() {
  const positions = [], uv = [], indices = [], turns = 15, steps = turns * 32;
  const circumference = 2 * Math.PI * Math.sqrt((DADAO_GRIP.radiusX ** 2 + DADAO_GRIP.radiusZ ** 2) / 2);
  const stripLength = Math.hypot(circumference, .174 / turns) * turns;
  for (let step = 0; step <= steps; step++) for (const side of [-1, 1]) {
    const t = step / steps, angle = t * Math.PI * 2 * turns + Math.sin(t * 63) * .035;
    const y = -.158 + .174 * t + side * .0052;
    const swell = 1 + .08 * Math.sin(t * Math.PI), irregular = 1 + .018 * Math.sin(angle * 2.3);
    positions.push(Math.cos(angle) * DADAO_GRIP.radiusX * swell * irregular, y,
      Math.sin(angle) * DADAO_GRIP.radiusZ * swell * irregular);
    uv.push((side + 1) / 2 * .0104 / DADAO_CLOTH_TILE_METERS, t * stripLength / DADAO_CLOTH_TILE_METERS);
    if (step < steps && side === -1) {
      const a = step * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); return geometry;
}

export function dadaoModel() {
  if (!template) {
    template = new THREE.Group(); template.name = 'nra-dadao';
    const surfaces = dadaoSurfaces();
    const steel = new THREE.MeshStandardMaterial({ ...surfaces.steel, metalness: 1, roughness: 1 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x48463f, metalness: .82, roughness: .78 });
    const wood = new THREE.MeshStandardMaterial({ ...createStudySurface('leather', 128), color: 0x3f3021, roughness: .92 });
    const cloth = new THREE.MeshStandardMaterial({ ...surfaces.cotton,
      metalness: 0, roughness: 1, side: THREE.DoubleSide });
    const add = (geometry, material, name, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name; mesh.position.set(x, y, z); template.add(mesh); return mesh;
    };
    add(dadaoBladeGeometry(), steel, 'wide-blade');
    add(new THREE.BoxGeometry(.052, .023, .0055), steel, 'blade-neck', .004, .034);
    const guard = new THREE.Shape();
    guard.moveTo(-.076, .023); guard.quadraticCurveTo(-.084, .002, -.06, -.004);
    guard.lineTo(.056, -.004); guard.quadraticCurveTo(.074, -.005, .079, -.023);
    guard.lineTo(.071, -.026); guard.quadraticCurveTo(.065, -.011, .054, -.012);
    guard.lineTo(-.061, -.012); guard.quadraticCurveTo(-.094, -.005, -.084, .026); guard.closePath();
    const guardGeometry = new THREE.ExtrudeGeometry(guard, { depth: .012, bevelEnabled: true,
      bevelThickness: .0012, bevelSize: .0012, bevelSegments: 2, steps: 1, curveSegments: 10 });
    guardGeometry.scale(.8, .75, 1);
    guardGeometry.translate(0, 0, -.006);
    add(guardGeometry, iron, 'guard', 0, .035);
    const handle = add(new THREE.CylinderGeometry(DADAO_GRIP.radiusX - .001, DADAO_GRIP.radiusX,
      DADAO_GRIP.length, 20, 6), wood, 'wrapped-grip', 0, -.0755);
    handle.scale.z = DADAO_GRIP.radiusZ / DADAO_GRIP.radiusX;
    add(gripWrapGeometry(), cloth, 'grip-binding');
    const collar = add(new THREE.CylinderGeometry(.0155, .0155, .012, 20), iron, 'grip-collar', 0, .017);
    collar.scale.z = DADAO_GRIP.radiusZ / DADAO_GRIP.radiusX;
    const ring = new THREE.TorusGeometry(.022, .0038, 8, 40);
    const p = ring.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), variation = Math.sin(Math.atan2(y, x) * 7) * .00035;
      p.setXYZ(i, x * 1.04 + variation, y * 1.12, p.getZ(i));
    }
    ring.computeVertexNormals();
    add(ring, iron, 'pommel-ring', 0, -.195);
    template.userData.dimensions = DADAO_DIMENSIONS;
    template.userData.materialSource = `${DADAO_ART_ROOT}source.json`;
  }
  return template.clone(true);
}

export function dadaoViewModel(createHand = null) {
  const key = createHand ?? 'procedural';
  if (views.has(key)) return views.get(key);
  const root = new THREE.Group(), blade = dadaoModel(), hand = createHand ? createHand('right') : grenadeHand('right');
  if (createHand && (!hand.poseArm || !hand.poseGrip || !hand.attachmentFrame)) throw new Error('Dadao requires the authorized articulated hand and sleeve');
  const leftHand = createHand ? createHand('left') : null;
  if (leftHand && (!leftHand.poseArm || !leftHand.poseGrip || !leftHand.attachmentFrame)) {
    throw new Error('Dadao requires the authorized articulated support hand and sleeve');
  }
  root.name = 'dadao-first-person'; root.add(blade, hand);
  if (leftHand) root.add(leftHand);
  let sleeve = null;
  if (!createHand) { sleeve = grenadeSleeve(); root.add(sleeve); poseGrenadeHand(hand, 1); }
  root.userData.dadaoHand = blade; root.userData.dadaoArm = hand; root.userData.dadaoSleeve = sleeve;
  root.userData.dadaoLeftArm = leftHand;
  root.userData.handSource = hand.userData.handSource ?? 'procedural-diagnostic-hand';
  root.userData.materialSource = blade.userData.materialSource;
  root.traverse(mesh => { if (mesh.isMesh) { mesh.frustumCulled = false; mesh.castShadow = false; } });
  views.set(key, root);
  return root;
}

export function updateDadaoView(root, pose, motion, camera = null) {
  if (pose.phase === 'stowed') {
    if (!root.userData.dadaoStowed) root.userData.dadaoVisibleBeforeStow = root.visible;
    root.userData.dadaoStowed = true;
    root.visible = false;
    return;
  }
  if (root.userData.dadaoStowed) {
    root.visible = root.userData.dadaoVisibleBeforeStow;
    root.userData.dadaoStowed = false;
  }
  if (!['draw', 'ready', 'windup', 'cut', 'recover'].includes(pose.phase))
    throw new RangeError(`Unknown dadao view phase: ${pose.phase}`);
  const blade = root.userData.dadaoHand, hand = root.userData.dadaoArm;
  const { raise, cut } = dadaoStroke(pose);
  const draw = pose.phase === 'draw' ? 1 - pose.progress : 0;
  const aspect = camera?.aspect ?? 1.6, narrow = THREE.MathUtils.clamp((1.1 - aspect) / .75, 0, 1);
  const loadDip = .10 * raise * (1 - cut) * (1 - narrow);
  // Compose the already-solved rigid arms separately; never change grip or wrist angles for the camera.
  root.position.set(.11 - .07 * narrow - loadDip,
    -.20 + .04 * narrow - loadDip, -.20 * (1 - narrow));
  const viewDepth = .15, armDepth = narrow * .12;
  const carry = new THREE.Vector3(.23, -.16, -.50 - viewDepth + narrow * .04);
  const carryRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08, -.28, -.30 + narrow * .12)).multiply(carryGrip);
  const tangent = Math.tan(THREE.MathUtils.degToRad((camera?.fov ?? 72) / 2));
  let left = -Infinity, right = Infinity;
  for (const x of [-.09, .12]) for (const y of [-.225, .62]) for (const z of [-.03, .03]) {
    const point = new THREE.Vector3(x, y, z).applyQuaternion(carryRotation).add(new THREE.Vector3(0, carry.y, carry.z));
    const limit = Math.max(.02, -point.z) * tangent * aspect * .9;
    left = Math.max(left, -limit - point.x); right = Math.min(right, limit - point.x);
  }
  carry.x = left <= right ? THREE.MathUtils.clamp(carry.x, left, right) : (left + right) / 2;
  const grip = new THREE.Vector3().fromArray(hand.userData.throwableGrips?.dadao ?? [-.012, .073, DADAO_GRIP.palmDepth]);
  const recovering = pose.phase === 'recover';
  const recovery = recovering ? THREE.MathUtils.smoothstep(pose.progress, 0, 1) : 0;
  const readyWrist = new THREE.Vector3(.16 + (carry.x - .23) * .2 - narrow * .06, -.12, -.36 - armDepth);
  const raisedWrist = new THREE.Vector3(.19, .01, -.40 - armDepth);
  const followWrist = new THREE.Vector3(.05, -.13, -.40 - armDepth);
  const wrist = recovering ? new THREE.CubicBezierCurve3(followWrist,
    new THREE.Vector3(-.02, .04, -.44 - armDepth),
    new THREE.Vector3(.12, .04, -.42 - armDepth), readyWrist).getPoint(recovery)
    : readyWrist.clone().lerp(raisedWrist, raise).lerp(followWrist, THREE.MathUtils.smoothstep(cut, .15, .85));
  const drawOffset = new THREE.Vector3(0, -draw * .15, draw * .04);
  wrist.add(new THREE.Vector3(motion.weaponX, motion.weaponY, 0)).add(drawOffset);
  const rotation = recovering ? viewFollowRotation.clone().slerp(carryRotation, THREE.MathUtils.smoothstep(pose.progress, .2, 1))
    : carryRotation.clone().slerp(raisedRotation, raise).slerp(viewFollowRotation, cut);
  const anchor = wrist.clone().add(grip.clone().applyQuaternion(rotation.clone().multiply(handToBlade)))
    .add(new THREE.Vector3(-.04 - .05 * cut, -.05 * cut, -.03));
  // Author the rigid grip frame first, then solve both arms independently to it.
  blade.position.copy(anchor).sub(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0).applyQuaternion(rotation));
  blade.quaternion.copy(rotation);
  if (hand.poseArm) {
    const wideCarry = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08, -.28, -.30)).multiply(carryGrip);
    const wideRotation = recovering ? viewFollowRotation.clone().slerp(wideCarry, THREE.MathUtils.smoothstep(pose.progress, .2, 1))
      : wideCarry.clone().slerp(raisedRotation, raise).slerp(viewFollowRotation, cut);
    const wideReady = new THREE.Vector3(.16, -.12, -.36), wideRaised = new THREE.Vector3(.19, .01, -.40);
    const wideFollow = new THREE.Vector3(.05, -.13, -.40);
    const wideWrist = recovering ? new THREE.CubicBezierCurve3(wideFollow, new THREE.Vector3(-.02, .04, -.44),
      new THREE.Vector3(.12, .04, -.42), wideReady).getPoint(recovery)
      : wideReady.clone().lerp(wideRaised, raise).lerp(wideFollow, THREE.MathUtils.smoothstep(cut, .15, .85));
    wideWrist.add(new THREE.Vector3(motion.weaponX, motion.weaponY, 0)).add(drawOffset);
    const wideAnchor = wideWrist.add(grip.clone().applyQuaternion(wideRotation.clone().multiply(handToBlade)))
      .add(new THREE.Vector3(-.04 - .05 * cut, -.05 * cut, -.03));
    const viewRotation = rotation.clone().multiply(wideRotation.clone().invert());
    for (const [side, arm] of [['right', hand], ['left', root.userData.dadaoLeftArm]]) {
      if (!arm) continue;
      const shoulder = new THREE.Vector3(side === 'right' ? .22 : -.22, -.38 + .16 * raise * (1 - cut), -.28)
        .sub(wideAnchor).applyQuaternion(viewRotation).add(anchor);
      const palm = anchor.clone().add(new THREE.Vector3(0, side === 'right' ? 0 : -.09, 0).applyQuaternion(rotation));
      poseDadaoViewArm(arm, side, shoulder, palm, rotation,
        new THREE.Vector3(side === 'right' ? .25 : -.25, -1, -.6).applyQuaternion(viewRotation), pose);
      arm.poseGrip(1, 0, 'dadao');
    }
  } else {
    hand.position.copy(wrist); hand.quaternion.copy(rotation).multiply(handToBlade);
    alignGrenadeSleeve(root.userData.dadaoSleeve, new THREE.Vector3(.30, -.39, -.35), wrist);
  }
  root.updateMatrixWorld(true);
}
