import * as THREE from 'three';
import { poseDadaoViewArm } from './dadao-view-grips.js';
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

const raisedRotation = chopRotation(-1.2), followRotation = chopRotation(1.6);
const viewFollowRotation = chopRotation(1.25);

export function dadaoWorldStroke(pose) {
  const { raise, cut } = dadaoStroke(pose);
  const draw = pose.phase === 'draw' ? 1 - pose.progress : 0;
  const overhead = pose.style === 1;
  const readyWrist = overhead ? new THREE.Vector3(-.10, .20, -.16) : new THREE.Vector3(.07, .13, .025);
  const readyRotation = overhead ? new THREE.Quaternion().setFromEuler(new THREE.Euler(.85, .2, .1, 'YXZ')) : raisedRotation;
  const recovery = pose.phase === 'recover' ? pose.progress * pose.progress * (3 - 2 * pose.progress) : 0;
  const attackWrist = new THREE.Vector3(-.06, .22, -.18).lerp(new THREE.Vector3(-.10, .04, -.26), cut);
  const attackRotation = raisedRotation.clone().slerp(followRotation, cut);
  return {
    wristOffset: pose.phase === 'recover' ? attackWrist.lerp(readyWrist, recovery)
      : readyWrist.clone().lerp(attackWrist, raise).lerp(new THREE.Vector3(-.14, -.14, -.16), draw),
    rotation: pose.phase === 'recover' ? attackRotation.slerp(readyRotation, recovery)
      : readyRotation.clone().slerp(attackRotation, raise).slerp(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08, -.28, -.30)).multiply(carryGrip), draw),
  };
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
  const blade = root.userData.dadaoHand, hand = root.userData.dadaoArm;
  const { raise, cut } = dadaoStroke(pose);
  const draw = pose.phase === 'draw' ? 1 - pose.progress : 0;
  const aspect = camera?.aspect ?? 1.6, narrow = THREE.MathUtils.clamp((1.1 - aspect) / .75, 0, 1);
  // Frame the complete two-arm rig farther from the eye, without changing its bones or grips.
  root.position.set(0, -.22 * (1 - narrow), -.30 * (1 - narrow));
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
    new THREE.Vector3(.02, -.20, -.44 - armDepth),
    new THREE.Vector3(.14, -.24, -.42 - armDepth), readyWrist).getPoint(recovery)
    : readyWrist.clone().lerp(raisedWrist, raise).lerp(followWrist, THREE.MathUtils.smoothstep(cut, .15, .85));
  const drawOffset = new THREE.Vector3(0, -draw * .15, draw * .04);
  wrist.add(new THREE.Vector3(motion.weaponX, motion.weaponY, 0)).add(drawOffset);
  const rotation = recovering ? viewFollowRotation.clone().slerp(carryRotation, THREE.MathUtils.smoothstep(pose.progress, .2, 1))
    : carryRotation.clone().slerp(raisedRotation, raise).slerp(viewFollowRotation, cut);
  let handRotation = rotation.clone().multiply(handToBlade);
  const shoulder = new THREE.Vector3(.30, -.39 + narrow * .04, -.35 - armDepth)
    .addScaledVector(new THREE.Vector3(.015, .025, -.015), raise * (1 - cut));
  const pole = new THREE.Vector3(0, -1, 0).applyQuaternion(handRotation).add(new THREE.Vector3(.10, 0, 0));
  if (hand.poseArm) {
    const anchor = wrist.clone().add(grip.clone().applyQuaternion(handRotation));
    handRotation = poseDadaoViewArm(hand, 'right', shoulder, anchor, rotation, pole, pose, narrow);
    hand.poseGrip(1, 0, 'dadao');
  } else {
    hand.position.copy(wrist); hand.quaternion.copy(handRotation);
    alignGrenadeSleeve(root.userData.dadaoSleeve, shoulder, wrist);
  }
  root.updateMatrixWorld(true);
  const frame = hand.attachmentFrame ?? hand;
  const relative = root.matrixWorld.clone().invert().multiply(frame.matrixWorld), scale = new THREE.Vector3();
  relative.decompose(blade.position, blade.quaternion, scale);
  blade.position.add(grip.applyQuaternion(blade.quaternion));
  blade.quaternion.multiply(rotation.clone().invert().multiply(handRotation).invert());
  blade.position.sub(new THREE.Vector3(0, DADAO_DIMENSIONS.gripCenter, 0).applyQuaternion(blade.quaternion));
  root.updateMatrixWorld(true);
  const leftHand = root.userData.dadaoLeftArm;
  if (leftHand) {
    const anchor = new THREE.Vector3(0, -.12, 0).applyQuaternion(blade.quaternion).add(blade.position);
    const wideCarry = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08, -.28, -.30)).multiply(carryGrip);
    const wideRotation = recovering ? viewFollowRotation.clone().slerp(wideCarry, THREE.MathUtils.smoothstep(pose.progress, .2, 1))
      : wideCarry.clone().slerp(raisedRotation, raise).slerp(viewFollowRotation, cut);
    const wideReady = new THREE.Vector3(.16, -.12, -.36), wideRaised = new THREE.Vector3(.19, .01, -.40);
    const wideFollow = new THREE.Vector3(.05, -.13, -.40);
    const wideWrist = recovering ? new THREE.CubicBezierCurve3(wideFollow, new THREE.Vector3(.02, -.20, -.44),
      new THREE.Vector3(.14, -.24, -.42), wideReady).getPoint(recovery)
      : wideReady.clone().lerp(wideRaised, raise).lerp(wideFollow, THREE.MathUtils.smoothstep(cut, .15, .85));
    wideWrist.add(new THREE.Vector3(motion.weaponX, motion.weaponY, 0)).add(drawOffset);
    const wideAnchor = wideWrist.add(new THREE.Vector3(...hand.userData.throwableGrips.dadao)
      .applyQuaternion(wideRotation.clone().multiply(handToBlade)))
      .add(new THREE.Vector3(0, -.09, 0).applyQuaternion(wideRotation));
    // Reframe the whole support chain, not its joint angles, when the viewport narrows.
    const viewRotation = rotation.clone().multiply(wideRotation.clone().invert());
    const leftShoulder = new THREE.Vector3(-.32, -.16, -.03)
      .addScaledVector(new THREE.Vector3(-.03, -.02, -.02), recovering ? Math.sin(Math.PI * recovery) : 0)
      .sub(wideAnchor).applyQuaternion(viewRotation).add(anchor);
    poseDadaoViewArm(leftHand, 'left', leftShoulder, anchor, rotation,
      new THREE.Vector3(-.65, -.65, -.35).applyQuaternion(viewRotation), pose, narrow);
    leftHand.poseGrip(1, 0, 'dadao');
  }
  root.updateMatrixWorld(true);
}
