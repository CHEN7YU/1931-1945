import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStudySurface } from './uniform-surfaces.js';

const skin = new THREE.MeshStandardMaterial({ color: 0xbb9276, roughness: .82 });
const nail = new THREE.MeshStandardMaterial({ color: 0xc6aa91, roughness: .62 });
const olive = new THREE.MeshStandardMaterial({ color: 0x4e5541, roughness: .86, metalness: .28 });
const steel = new THREE.MeshStandardMaterial({ color: 0x777b70, roughness: .5, metalness: .7 });
const cloth = new THREE.MeshStandardMaterial({ ...createStudySurface('cloth', 64), color: 0x68725b, roughness: 1 });
let grenadeTemplate;
let packTemplate;
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

export function grenadeModel() {
  if (!grenadeTemplate) {
    grenadeTemplate = new THREE.Group();
    const profile = [[0, -.048], [.022, -.047], [.033, -.035], [.039, -.012], [.038, .018], [.029, .042], [.016, .048]];
    const shell = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 24);
    mesh(grenadeTemplate, shell, olive, 'fragmentation-body');
    const grooves = [];
    for (const y of [-.027, -.008, .012, .031]) {
      const ring = new THREE.TorusGeometry(y > .02 ? .031 : .038, .0012, 4, 24);
      ring.rotateX(Math.PI / 2); ring.translate(0, y, 0); grooves.push(ring);
    }
    mesh(grenadeTemplate, mergeGeometries(grooves), olive, 'cast-shell-ridges');
    grooves.forEach(geometry => geometry.dispose());
    mesh(grenadeTemplate, new THREE.CylinderGeometry(.012, .015, .023, 16), steel, 'fuse-neck', [0, .057, 0]);
    mesh(grenadeTemplate, new RoundedBoxGeometry(.012, .072, .008, 2, .002), steel, 'safety-lever', [.031, .025, 0]).rotation.z = .24;
    const ring = mesh(grenadeTemplate, new THREE.TorusGeometry(.012, .0016, 6, 24), steel, 'safety-ring', [.009, .067, .01]);
    ring.rotation.y = Math.PI / 2;
  }
  return grenadeTemplate.clone(true);
}

export function explosivePackModel() {
  if (!packTemplate) {
    packTemplate = new THREE.Group(); packTemplate.name = 'explosive-pack';
    const fibers = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const value = 237 + 6 * Math.sin(x * 2.3 + y * .2) + 4 * Math.cos(y * 1.7);
      fibers.set([value, value, value, 255], (y * 64 + x) * 4);
    }
    const paperMap = new THREE.DataTexture(fibers, 64, 64);
    paperMap.wrapS = paperMap.wrapT = THREE.RepeatWrapping; paperMap.repeat.set(2, 5);
    paperMap.magFilter = THREE.LinearFilter; paperMap.needsUpdate = true;
    const paper = new THREE.MeshStandardMaterial({ map: paperMap, color: 0xcbb78e, roughness: 1 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xa18b69, roughness: 1 });
    const strap = new THREE.MeshStandardMaterial({ ...createStudySurface('leather', 64), color: 0x48494a, roughness: .94 });
    const handle = new THREE.MeshStandardMaterial({ color: 0x96534b, roughness: .85 });
    for (const [index, [x, y]] of [[0, 0], [-.029, 0], [.029, 0], [-.015, .027], [.015, .027], [-.015, -.027], [.015, -.027]].entries()) {
      const tube = new THREE.CylinderGeometry(.017, .017, .23, 16, 1); tube.rotateX(Math.PI / 2);
      mesh(packTemplate, tube, paper, `paper-bundle-${index}`, [x, y, 0]);
      for (const z of [-.116, .116]) mesh(packTemplate, new THREE.TorusGeometry(.012, .0011, 4, 16), edge,
        `rolled-paper-end-${index}-${z}`, [x, y, z]);
    }
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, .057, .049, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absellipse(0, 0, .051, .043, 0, Math.PI * 2, true); shape.holes.push(hole);
    const band = new THREE.ExtrudeGeometry(shape, { depth: .025, bevelEnabled: true, bevelSize: .0015, bevelThickness: .0015, bevelSegments: 1, steps: 1, curveSegments: 16 });
    for (const [index, z] of [-.075, .05].entries()) mesh(packTemplate, band, strap, `binding-strap-${index}`, [0, 0, z]);
    const loop = new THREE.CatmullRomCurve3([[0, .025, .11], [.022, .025, .15], [0, .025, .18], [-.022, .025, .15], [0, .025, .11]].map(p => new THREE.Vector3(...p)));
    mesh(packTemplate, new THREE.TubeGeometry(loop, 20, .0028, 6, false), strap, 'carrying-loop');
    mesh(packTemplate, new THREE.CylinderGeometry(.004, .004, .075, 8), steel, 'pull-handle-stem', [0, .04, -.13]).rotation.x = Math.PI / 2;
    mesh(packTemplate, new RoundedBoxGeometry(.05, .009, .009, 2, .002), handle, 'pull-handle', [0, .04, -.17]);
  }
  return packTemplate.clone(true);
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
