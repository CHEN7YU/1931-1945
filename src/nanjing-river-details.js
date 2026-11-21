import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const NANJING_FERRY_FLOOR = .42;
export const NANJING_OAR_BLADE_TIP = Object.freeze([2.975, 0, 0]);

const stations = [-3.2, -2.85, -2.35, -1.65, -.8, 0, .8, 1.65, 2.35, 2.85, 3.2];
const beam = x => .045 + .89 * Math.pow(Math.max(0, 1 - (x / 3.22) ** 2), .65);
const sheer = x => .82 + .25 * (Math.abs(x) / 3.2) ** 3;
const leftGrip = new THREE.Vector3(), rightGrip = new THREE.Vector3();
const shaftAxis = new THREE.Vector3(1, 0, 0), shaftDirection = new THREE.Vector3();

function finish(parts, material) {
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!geometry) throw new Error('River detail geometries could not be merged');
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function box(parts, size, position, color) {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(...position);
  const tint = new THREE.Color(color), colors = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(tint.r, tint.g, tint.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  parts.push(geometry);
}

export function createNanjingFerryFactory(timber) {
  const wood = timber.clone(); wood.vertexColors = true; wood.side = THREE.DoubleSide;
  const parts = [];
  // Separate strakes leave fine dark seams and form a genuinely open, flared hull.
  for (const side of [-1, 1]) for (let plank = 0; plank < 5; plank++) {
    const positions = [], uvs = [], colors = [], indices = [];
    for (const x of stations) for (const t of [(plank + .025) / 5, (plank + .975) / 5]) {
      const z = side * beam(x) * (.46 + .54 * t);
      const y = -.30 + (sheer(x) + .30) * t;
      positions.push(x, y, z); uvs.push(x / 2, t);
      const tint = new THREE.Color().setRGB(.66 + plank * .055, .60 + plank * .05, .49 + plank * .045);
      colors.push(tint.r, tint.g, tint.b);
    }
    for (let i = 0; i < stations.length - 1; i++) {
      const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); parts.push(geometry);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const x = (stations[i] + stations[i + 1]) / 2;
    box(parts, [stations[i + 1] - stations[i], .08, beam(x) * .88], [x, -.32, 0], 0x75634e);
    if (Math.abs(x) < 2.65) {
      for (let strip = -2; strip <= 2; strip++)
        box(parts, [stations[i + 1] - stations[i] - .015, .07, beam(x) * .27],
          [x, NANJING_FERRY_FLOOR - .035, strip * beam(x) * .28], strip % 2 ? 0xb5a18a : 0x95816a);
    }
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(stations[i], sheer(stations[i]), side * beam(stations[i]));
      const to = new THREE.Vector3(stations[i + 1], sheer(stations[i + 1]), side * beam(stations[i + 1]));
      const rail = new THREE.CylinderGeometry(.035, .035, from.distanceTo(to), 5);
      rail.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
      rail.translate(...from.add(to).multiplyScalar(.5).toArray());
      const colors = new Float32Array(rail.attributes.position.count * 3); colors.fill(.85);
      rail.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(rail);
    }
  }
  for (const x of [-2.4, -1.35, -.45, .45, 1.35, 2.4]) {
    const width = beam(x);
    box(parts, [.075, .55, .07], [x, .47, -width * .80], 0x88715a);
    box(parts, [.075, .55, .07], [x, .47, width * .80], 0x88715a);
    if (Math.abs(x) < 2) box(parts, [.23, .09, width * 1.72], [x, .68, 0], 0xc3ac8b);
  }
  const hull = finish(parts, wood);
  hull.userData.nanjingFeature = 'open-planked-ferry';
  const oarParts = [];
  box(oarParts, [3.7, .055, .055], [1.05, 0, 0], 0xc1aa83);
  box(oarParts, [.65, .055, .27], [2.65, 0, 0], 0x9b805d);
  const oar = finish(oarParts, wood);
  return () => {
    const boat = new THREE.Group();
    boat.add(hull.clone());
    const paddle = new THREE.Group(); paddle.add(oar.clone());
    paddle.userData.bladeTip = [...NANJING_OAR_BLADE_TIP];
    paddle.position.set(2.35, 1.1, -.15);
    boat.add(paddle); boat.userData.oar = paddle;
    return boat;
  };
}

export function updateNanjingFerryRower(ferry, time) {
  const { rower, oar, state } = ferry.userData;
  const moving = state === 'outbound' || state === 'inbound';
  const phase = moving ? Math.sin(time * 2.8) : 0;
  rower.rotation.y = state === 'inbound' ? -Math.PI / 2 : Math.PI / 2;
  rower.civilianTorso.rotation.x = moving ? phase * .12 : 0;
  for (const arm of rower.civilianArms) arm.rotation.x = moving ? .72 + phase * .18 : -.15;
  oar.visible = moving;
  if (!moving) return;
  const { leftElbow, rightElbow } = rower.civilianSkin.joints;
  leftElbow.rotation.x = rightElbow.rotation.x = -.18;
  rower.updateWorldMatrix(true, true);
  leftGrip.set(-.002, -.285, -.005).applyMatrix4(leftElbow.matrixWorld);
  rightGrip.set(.002, -.285, -.005).applyMatrix4(rightElbow.matrixWorld);
  ferry.worldToLocal(leftGrip); ferry.worldToLocal(rightGrip);
  oar.position.copy(leftGrip).add(rightGrip).multiplyScalar(.5);
  shaftDirection.copy(rightGrip).sub(leftGrip).normalize();
  if (shaftDirection.y > 0) shaftDirection.negate();
  oar.quaternion.setFromUnitVectors(shaftAxis, shaftDirection);
}

export function createShoreReeds(banks) {
  const positions = [], colors = [];
  const vertex = (x, y, z, tint) => { positions.push(x, y, z); colors.push(...tint); };
  for (const bank of banks) {
    const { from, to, startInset, endInset } = bank.userData.shoreline;
    const horizontal = bank.userData.riverId === 'qinhuai-south';
    const side = Math.sign(horizontal ? bank.position.z - 52 : bank.position.x + 84);
    for (let cluster = 0; cluster < 4; cluster++) {
      const t = (cluster + .35) / 4, along = from + (to - from) * t;
      const inset = startInset + (endInset - startInset) * t;
      const cross = (horizontal ? bank.position.z : bank.position.x) -
        side * ((horizontal ? bank.scale.z : bank.scale.x) / 2 + inset);
      const x = horizontal ? along : cross, z = horizontal ? cross : along;
      if (x > -77 && x < -55 && z > -94 && z < -66) continue;
      if (Math.sin(along * 1.73 + side) < -.3) continue;
      for (let blade = 0; blade < 9; blade++) {
        const seed = along * 7.31 + blade * 2.47;
        const bx = x + Math.sin(seed) * .28, bz = z + Math.cos(seed * 1.3) * .28;
        const height = .45 + .7 * (.5 + .5 * Math.sin(seed * .7));
        const leanX = Math.cos(seed) * height * .23, leanZ = Math.sin(seed) * height * .23;
        const width = .025, baseY = -.60;
        for (const axis of [0, Math.PI / 2]) {
          const dx = Math.cos(axis + seed) * width, dz = Math.sin(axis + seed) * width;
          vertex(bx - dx, baseY, bz - dz, [.19, .25, .085]);
          vertex(bx + dx, baseY, bz + dz, [.25, .34, .10]);
          vertex(bx + leanX, baseY + height, bz + leanZ, [.47, .52, .19]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const reeds = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, side: THREE.DoubleSide,
  }));
  reeds.userData.nanjingFeature = 'shore-reeds';
  return reeds;
}
