import * as THREE from 'three';
import { MORTAR } from './mortar.js';

const steel = new THREE.MeshStandardMaterial({ color: 0x53604b, roughness: .68, metalness: .4 });
const dark = new THREE.MeshStandardMaterial({ color: 0x202921, roughness: .58, metalness: .5 });
const bore = new THREE.MeshStandardMaterial({ color: 0x080d09, roughness: .9, side: THREE.DoubleSide });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);
const parts = new Map();
const geometry = (name, build) => {
  if (!parts.has(name)) parts.set(name, build());
  return parts.get(name);
};

function mesh(parent, name, shape, material, position, scale = [1, 1, 1]) {
  const object = new THREE.Mesh(shape, material);
  object.name = name; object.position.fromArray(position); object.scale.fromArray(scale);
  parent.add(object);
  return object;
}
function rod(parent, name, from, to, radius, material = steel) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
  const object = mesh(parent, name, unitCylinder, material, a.clone().add(b).multiplyScalar(.5).toArray(), [radius, delta.length(), radius]);
  object.quaternion.setFromUnitVectors(Y, delta.normalize());
  return object;
}

export function mortarModel() {
  const root = new THREE.Group(); root.name = 'light-mortar';
  mesh(root, 'baseplate', geometry('plate', () => new THREE.CylinderGeometry(.24, .21, .035, 24)), steel, [0, .025, .14]);
  for (const side of [-1, 1]) {
    mesh(root, `plate-rib-${side}`, unitBox, dark, [side * .11, .051, .14], [.025, .018, .34]);
    rod(root, `bipod-${side}`, [side * .28, .04, -.30], [side * .06, .49, -.07], .016);
    mesh(root, `bipod-foot-${side}`, unitBox, steel, [side * .28, .025, -.30], [.11, .025, .10]);
  }
  rod(root, 'bipod-crossbar', [-.16, .27, -.18], [.16, .27, -.18], .009, dark);
  rod(root, 'elevation-screw', [0, .24, -.17], [0, .52, -.055], .011, dark);
  rod(root, 'windage-screw', [-.11, .48, -.055], [.16, .48, -.055], .008, dark);
  rod(root, 'crank-shaft', [.16, .48, -.055], [.16, .48, .02], .007, dark);
  rod(root, 'crank-handle', [.16, .48, .02], [.20, .48, .02], .009, dark);
  const tube = new THREE.Group(); tube.name = 'mortar-tube'; tube.position.set(0, .075, .14); root.add(tube);
  mesh(tube, 'barrel', geometry('barrel', () => new THREE.CylinderGeometry(.038, .041, .86, 32, 1, true)), steel, [0, .43, 0]);
  mesh(tube, 'bore-wall', geometry('bore', () => new THREE.CylinderGeometry(.031, .031, .15, 24, 1, true)), bore, [0, .79, 0]);
  mesh(tube, 'bore-bottom', geometry('bottom', () => new THREE.CircleGeometry(.031, 24)), bore, [0, .70, 0]).rotation.x = Math.PI / 2;
  mesh(tube, 'muzzle-rim', geometry('rim', () => new THREE.TorusGeometry(.035, .004, 8, 32)), dark, [0, .86, 0]).rotation.x = Math.PI / 2;
  mesh(tube, 'barrel-collar', geometry('collar', () => new THREE.CylinderGeometry(.049, .049, .04, 24)), dark, [0, .47, 0]);
  mesh(tube, 'sight-bracket', unitBox, dark, [.075, .53, 0], [.08, .018, .025]);
  rod(tube, 'sight', [.10, .50, 0], [.10, .59, 0], .016, dark);
  const muzzle = new THREE.Object3D(); muzzle.name = 'mortar-muzzle'; muzzle.position.set(0, .86, 0); tube.add(muzzle);
  root.userData.mortar = { tube, muzzle };
  updateMortarModel(root, 100);
  root.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });
  return root;
}

export function updateMortarModel(root, range) {
  if (!Number.isFinite(range) || range < MORTAR.minRange || range > MORTAR.maxRange) throw new RangeError('Mortar display requires its valid range');
  root.userData.mortar.tube.rotation.x = -(10 + (range - MORTAR.minRange) / (MORTAR.maxRange - MORTAR.minRange) * 20) * Math.PI / 180;
}
