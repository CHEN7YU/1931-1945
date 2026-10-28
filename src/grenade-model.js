import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStudySurface } from './uniform-surfaces.js';

const skin = new THREE.MeshStandardMaterial({ color: 0xbb9276, roughness: .82 });
const nail = new THREE.MeshStandardMaterial({ color: 0xc6aa91, roughness: .62 });
const olive = new THREE.MeshStandardMaterial({ color: 0x4e5541, roughness: .86, metalness: .28 });
const steel = new THREE.MeshStandardMaterial({ color: 0x777b70, roughness: .5, metalness: .7 });
const cloth = new THREE.MeshStandardMaterial({ ...createStudySurface('cloth', 64), color: 0x68725b, roughness: 1 });
const grenadeTemplates = new Map(), packTemplates = new Map();
const hands = new Map(), Y = new THREE.Vector3(0, 1, 0);

function palmGeometry() {
  const sections = [[-.004, .021, .010], [.012, .025, .014], [.032, .034, .016],
    [.055, .034, .013], [.072, .031, .011], [.082, .027, .008]];
  const vertices = [], indices = [], uv = [], sides = 20;
  for (const [ring, [y, width, depth]] of sections.entries()) for (let side = 0; side <= sides; side++) {
    const angle = side / sides * Math.PI * 2;
    vertices.push(Math.cos(angle) * width, y, Math.sin(angle) * depth);
    uv.push(side / sides, ring / (sections.length - 1));
    if (ring < sections.length - 1 && side < sides) {
      const a = ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); return geometry;
}

function mesh(parent, geometry, material, name, position = [0, 0, 0]) {
  const part = new THREE.Mesh(geometry, material); part.name = name;
  part.position.fromArray(position); part.receiveShadow = true; parent.add(part); return part;
}

function merged(parts) {
  const expanded = parts.map(geometry => {
    if (!geometry.index) return geometry;
    const result = geometry.toNonIndexed(); geometry.dispose(); return result;
  });
  const result = mergeGeometries(expanded);
  expanded.forEach(geometry => geometry.dispose()); return result;
}

function surface(kind) {
  const size = 128, color = new Uint8Array(size * size * 4), normal = new Uint8Array(color.length);
  const rough = new Uint8Array(color.length), height = new Float32Array(size * size);
  let seed = 1938;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed >>> 24) / 255, broad = Math.sin(x * .12 + Math.sin(y * .08)) * Math.cos(y * .09);
    const fiber = Math.sin(x * 2.8 + y * .11) * .5 + Math.sin(y * .41) * .25;
    const base = kind === 'cast' ? [69, 77, 56] : [197, 173, 131];
    const value = (grain - .5) * (kind === 'cast' ? 13 : 7) + broad * 7 + (kind === 'paper' ? fiber * 5 : 0);
    const index = y * size + x, at = index * 4;
    color.set([...base.map(channel => Math.round(channel + value)), 255], at);
    const r = kind === 'cast' ? 205 + grain * 35 : 237 + grain * 16;
    rough.set([r, r, r, 255], at);
    height[index] = kind === 'cast' ? grain * .10 + broad * .018 : grain * .025 + fiber * .03;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size];
    const dy = height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x];
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    normal.set([Math.round((n.x * .5 + .5) * 255), Math.round((n.y * .5 + .5) * 255), Math.round((n.z * .5 + .5) * 255), 255], (y * size + x) * 4);
  }
  const texture = (bytes, srgb = false) => {
    const map = new THREE.DataTexture(bytes, size, size);
    if (srgb) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true; return map;
  };
  return new THREE.MeshStandardMaterial({ map: texture(color, true), normalMap: texture(normal),
    roughnessMap: texture(rough), normalScale: new THREE.Vector2(.24, .24), roughness: 1, metalness: kind === 'cast' ? .35 : 0 });
}

let castMaterial, paperMaterial, strapMaterial;
const shellProfile = [[-.048, .014], [-.045, .024], [-.033, .035], [-.012, .039], [.018, .038], [.038, .027], [.048, .016]];
function shellRadius(y) {
  if (y < shellProfile[0][0] || y > shellProfile.at(-1)[0]) return 0;
  for (let i = 1; i < shellProfile.length; i++) if (y <= shellProfile[i][0]) {
    const a = shellProfile[i - 1], b = shellProfile[i];
    return THREE.MathUtils.lerp(a[1], b[1], (y - a[0]) / (b[0] - a[0]));
  }
  return shellProfile.at(-1)[1];
}

const paperCenters = [[0, 0], [-.029, 0], [.029, 0], [-.015, .027], [.015, .027], [-.015, -.027], [.015, -.027]];
export function throwableGripPoint(kind, x, angle) {
  if (!['grenade', 'explosive-pack'].includes(kind) || ![x, angle].every(Number.isFinite)) throw new RangeError('Invalid throwable surface contact');
  const y = Math.sin(angle), z = -Math.cos(angle);
  let distance;
  if (kind === 'grenade') {
    let low = 0, high = .065;
    for (let i = 0; i < 24; i++) {
      const t = (low + high) / 2, radius = shellRadius(t * y);
      if (x * x + (t * z) ** 2 <= radius * radius) low = t;
      else high = t;
    }
    distance = low;
  } else {
    distance = 0;
    for (const [px, py] of paperCenters) {
      const dot = py * y - px * z, discriminant = dot * dot - (px * px + py * py - .017 ** 2);
      if (discriminant >= 0) distance = Math.max(distance, dot + Math.sqrt(discriminant));
    }
  }
  return new THREE.Vector3(x, (distance + .003) * y, (distance + .003) * z);
}

function shellPanel(y0, y1, a0, a1) {
  const outline = [[.1, 0], [.9, 0], [1, .12], [1, .88], [.9, 1], [.1, 1], [0, .88], [0, .12]];
  const positions = [], uv = [], indices = [];
  for (const depth of [-.001, .0012]) {
    for (const [u, v] of [[.5, .5], ...outline]) {
      const y = THREE.MathUtils.lerp(y0, y1, v), a = THREE.MathUtils.lerp(a0, a1, u), r = shellRadius(y) + depth;
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r); uv.push(a / (Math.PI * 2), (y + .05) * 10);
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = i + 1, b = (i + 1) % 8 + 1;
    indices.push(9, b + 9, a + 9, 0, a, b, a, a + 9, b, b, a + 9, b + 9);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function grenadeModel(detail = 'near') {
  if (!['near', 'world'].includes(detail)) throw new RangeError('Unknown grenade detail');
  if (!grenadeTemplates.has(detail)) {
    castMaterial ??= surface('cast');
    const root = new THREE.Group(), fine = detail === 'near', sectors = fine ? 10 : 8;
    const levels = fine ? [-.043, -.027, -.009, .010, .028, .042] : [-.043, -.023, .001, .023, .042];
    mesh(root, new THREE.LatheGeometry([new THREE.Vector2(0, -.048),
      ...shellProfile.map(([y, r]) => new THREE.Vector2(r, y)), new THREE.Vector2(0, .048)], fine ? 40 : 20), olive, 'fragmentation-body');
    const panels = [];
    for (let row = 1; row < levels.length; row++) for (let sector = 0; sector < sectors; sector++) {
      panels.push(shellPanel(levels[row - 1] + .0007, levels[row] - .0007,
        sector / sectors * Math.PI * 2 + .019, (sector + 1) / sectors * Math.PI * 2 - .019));
    }
    mesh(root, merged(panels), castMaterial, 'cast-shell-ridges');
    const necks = [new THREE.CylinderGeometry(.012, .016, .022, 16).translate(0, .058, 0)];
    for (const y of fine ? [.048, .052, .056, .060] : [.05, .058]) {
      const ring = new THREE.TorusGeometry(.0128, .0007, 4, fine ? 24 : 12); ring.rotateX(Math.PI / 2); ring.translate(0, y, 0); necks.push(ring);
    }
    mesh(root, merged(necks), steel, 'fuse-neck');
    const shape = new THREE.Shape();
    [[-.012, .076], [.016, .076], [.035, .051], [.045, -.010], [.035, -.043], [.029, -.041], [.038, -.010], [.029, .047], [.012, .069], [-.012, .069]]
      .forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const lever = new THREE.ExtrudeGeometry(shape, { depth: .009, bevelEnabled: fine, bevelThickness: .0006, bevelSize: .0006, bevelSegments: 1, steps: 1 });
    lever.translate(0, 0, -.0045);
    mesh(root, lever, steel, 'safety-lever');
    const ring = new THREE.TorusGeometry(.012, .0014, 6, fine ? 32 : 16);
    ring.rotateY(Math.PI / 2); ring.translate(.009, .067, .011);
    const pin = new THREE.CylinderGeometry(.0011, .0011, .025, 8); pin.rotateZ(Math.PI / 2); pin.translate(.003, .064, .009);
    mesh(root, merged([ring, pin]), steel, 'safety-ring');
    if (fine) {
      const hinge = new THREE.CylinderGeometry(.0045, .0045, .011, 16); hinge.rotateX(Math.PI / 2); hinge.translate(.011, .069, 0);
      const seam = new THREE.BoxGeometry(.0007, .005, .012); seam.translate(.011, .069, 0);
      mesh(root, merged([hinge, seam]), steel, 'lever-hinge');
    }
    root.userData.detail = detail; root.userData.shellPanels = (levels.length - 1) * sectors;
    grenadeTemplates.set(detail, root);
  }
  return grenadeTemplates.get(detail).clone(true);
}

function paperRoll(x, y, length, index, fine) {
  const positions = [], uv = [], indices = [], sides = fine ? 24 : 12, rings = fine ? 16 : 3;
  for (let ring = 0; ring <= rings; ring++) for (let side = 0; side <= sides; side++) {
    const t = ring / rings, a = side / sides * Math.PI * 2;
    const bandPressure = Math.exp(-(((t - .22) / .07) ** 2)) + Math.exp(-(((t - .77) / .07) ** 2));
    const radius = .017 - .0006 * bandPressure + (fine ? .00045 * Math.sin(a * 5 + t * 13 + index) : 0);
    positions.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius, (t - .5) * length);
    uv.push(side / sides * 2, t * 3);
    if (ring < rings && side < sides) {
      const a = ring * (sides + 1) + side; indices.push(a, a + 1, a + sides + 1, a + 1, a + sides + 2, a + sides + 1);
    }
  }
  for (const sign of [-1, 1]) {
    const center = positions.length / 3; positions.push(x, y, sign * (length / 2 - .0015)); uv.push(.5, .5);
    for (let side = 0; side <= sides; side++) {
      const a = side / sides * Math.PI * 2, fold = fine ? .0012 * (1 + Math.cos(a * 6 + index)) : 0;
      positions.push(x + Math.cos(a) * .0165, y + Math.sin(a) * .0165, sign * (length / 2 - fold));
      uv.push(.5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5);
      if (side < sides) sign > 0 ? indices.push(center, center + side + 1, center + side + 2) : indices.push(center, center + side + 2, center + side + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function explosivePackModel(detail = 'near') {
  if (!['near', 'world'].includes(detail)) throw new RangeError('Unknown pack detail');
  if (!packTemplates.has(detail)) {
    paperMaterial ??= surface('paper');
    strapMaterial ??= new THREE.MeshStandardMaterial({ ...createStudySurface('leather', 128), color: 0x484642, roughness: .92 });
    const root = new THREE.Group(), fine = detail === 'near', rolls = [], seams = [];
    root.name = 'explosive-pack';
    const edge = new THREE.MeshStandardMaterial({ color: 0xa18b69, roughness: 1 });
    const handle = new THREE.MeshStandardMaterial({ color: 0x96534b, roughness: .85 });
    for (const [index, [x, y]] of paperCenters.entries()) {
      const length = .23 + (fine ? .003 * Math.sin(index * 2.3) : 0);
      rolls.push(paperRoll(x, y, length, index, fine));
      if (fine) {
        const seam = new THREE.BoxGeometry(.0008, .001, length - .004); seam.translate(x + .012, y + .011, 0); seams.push(seam);
        for (const sign of [-1, 1]) {
          const fold = new THREE.TorusGeometry(.012, .0006, 4, 20);
          fold.translate(x, y, sign * (length / 2 - .0005)); seams.push(fold);
        }
      }
    }
    mesh(root, merged(rolls), paperMaterial, 'paper-wrappers');
    if (fine) mesh(root, merged(seams), edge, 'paper-seams-and-folds');
    const shape = new THREE.Shape(); shape.absellipse(0, 0, .0555, .048, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absellipse(0, 0, .0535, .046, 0, Math.PI * 2, true); shape.holes.push(hole);
    const band = new THREE.ExtrudeGeometry(shape, { depth: .027, bevelEnabled: fine, bevelSize: .0006, bevelThickness: .0006, bevelSegments: 1, steps: 1, curveSegments: fine ? 32 : 12 });
    for (const [index, z] of [-.075, .05].entries()) mesh(root, band, strapMaterial, `binding-strap-${index}`, [0, 0, z]);
    const loop = new THREE.CatmullRomCurve3([[0, .025, .11], [.022, .025, .15], [0, .025, .18], [-.022, .025, .15], [0, .025, .11]].map(p => new THREE.Vector3(...p)));
    const section = new THREE.Shape(); section.moveTo(-.003, -.0009); section.lineTo(.003, -.0009); section.lineTo(.003, .0009); section.lineTo(-.003, .0009); section.closePath();
    mesh(root, new THREE.ExtrudeGeometry(section, { extrudePath: loop, steps: fine ? 28 : 10, bevelEnabled: false }), strapMaterial, 'carrying-loop');
    mesh(root, new THREE.CylinderGeometry(.0025, .0025, .075, fine ? 12 : 6), steel, 'pull-handle-stem', [0, .04, -.13]).rotation.x = Math.PI / 2;
    mesh(root, new RoundedBoxGeometry(.05, .009, .009, fine ? 2 : 1, .002), handle, 'pull-handle', [0, .04, -.17]);
    root.userData.detail = detail; root.userData.paperRolls = 7; packTemplates.set(detail, root);
  }
  return packTemplates.get(detail).clone(true);
}

export function grenadeHand(side) {
  if (!['left', 'right'].includes(side)) throw new Error('Grenade hand requires a left or right side');
  if (!hands.has(side)) {
    const root = new THREE.Group(), sign = side === 'right' ? 1 : -1;
    root.name = `${side}-grenade-hand`;
    const palm = mesh(root, palmGeometry(), skin, 'palm');
    palm.rotation.z = sign * .04;
    mesh(root, new THREE.CylinderGeometry(.022, .025, .04, 12), skin, 'wrist', [0, -.016, .004]);
    mesh(root, new THREE.CylinderGeometry(.027, .031, .027, 16), cloth, 'woven-cuff', [0, -.035, .006]);
    for (const [index, length] of [.064, .071, .067, .052].entries()) {
      const finger = new THREE.Group(); finger.name = `finger-${index}`; root.add(finger);
      finger.position.set(sign * (-.025 + index * .0165), .075 - (index === 3 ? .006 : 0), -.005);
      let joint = finger;
      for (let segment = 0; segment < 3; segment++) {
        const height = length * [ .44, .32, .24 ][segment], radius = (.0082 - index * .00045) * (1 - segment * .08);
        const next = new THREE.Group(); next.name = `joint-${index}-${segment}`; joint.add(next);
        const bone = mesh(next, new THREE.CapsuleGeometry(radius, Math.max(.002, height - radius * 2), 4, 8),
          skin, `finger-segment-${index}-${segment}`, [0, height / 2, 0]);
        if (segment === 2) mesh(next, new RoundedBoxGeometry(radius * 1.25, height * .63, .0018, 2, .0008),
          nail, `nail-${index}`, [0, height * .55, radius * .9]);
        bone.userData.length = height;
        const end = new THREE.Group(); end.position.y = height; next.add(end); joint = end;
      }
    }
    const thumb = new THREE.Group(); thumb.name = 'thumb'; thumb.position.set(sign * .029, .022, -.008);
    thumb.rotation.z = -sign * .85; thumb.rotation.y = sign * .7; root.add(thumb);
    for (let i = 0; i < 2; i++) {
      const joint = new THREE.Group(); joint.name = `thumb-joint-${i}`; thumb.add(joint);
      mesh(joint, new THREE.CapsuleGeometry(.010 - i * .001, .012, 4, 8), skin, `thumb-segment-${i}`, [0, .016, 0]);
      if (i === 1) mesh(joint, new RoundedBoxGeometry(.011, .016, .002, 2, .001), nail, 'thumbnail', [0, .02, .009]);
      if (i === 0) { const end = new THREE.Group(); end.position.y = .031; joint.add(end); end.name = 'thumb-end'; }
    }
    const last = thumb.getObjectByName('thumb-joint-1'); thumb.getObjectByName('thumb-end').add(last);
    root.traverse(node => { if (node.isMesh) node.frustumCulled = false; });
    hands.set(side, root);
  }
  return hands.get(side).clone(true);
}

export function poseGrenadeHand(hand, closure, pinPull = 0) {
  if (![closure, pinPull].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Invalid grenade hand articulation');
  for (let index = 0; index < 4; index++) for (let segment = 0; segment < 3; segment++) {
    hand.getObjectByName(`joint-${index}-${segment}`).rotation.x = -closure * [.9, 1.0, .65][segment] *
      (pinPull && index < 2 ? .4 : 1);
  }
  hand.getObjectByName('thumb-joint-0').rotation.x = -.35 - closure * .45;
  hand.getObjectByName('thumb-joint-1').rotation.x = -closure * .65;
}

export function grenadeSleeve() {
  const root = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(.029, .041, 1, 16, 5);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i), fold = 1 + .045 * Math.sin(y * 36) * (1 - Math.abs(y));
    positions.setXYZ(i, positions.getX(i) * fold, y, positions.getZ(i) * fold);
  }
  geometry.computeVertexNormals(); mesh(root, geometry, cloth, 'tailored-sleeve');
  return root;
}

export function alignGrenadeSleeve(sleeve, start, end) {
  sleeve.position.copy(start).add(end).multiplyScalar(.5);
  sleeve.quaternion.setFromUnitVectors(Y, end.clone().sub(start).normalize());
  sleeve.scale.set(1, start.distanceTo(end), 1);
}
