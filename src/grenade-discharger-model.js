import * as THREE from 'three';
import { addSupportGrip } from './support-weapon-pose.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dischargerShellDirection } from './grenade-discharger.js';

const steel = new THREE.MeshStandardMaterial({ color: 0x394034, roughness: .84, metalness: .45 });
const bore = new THREE.MeshStandardMaterial({ color: 0x111611, roughness: .95 });
const tubeGeometry = new THREE.CylinderGeometry(.036, .036, .36, 10, 1, true);
const rimGeometry = new THREE.TorusGeometry(.032, .006, 5, 10);
const stemGeometry = new THREE.CylinderGeometry(.018, .02, .23, 8);
const plateGeometry = new THREE.BoxGeometry(.16, .024, .11);
const baseGeometry = new THREE.CircleGeometry(.029, 10);
const controlGeometry = new THREE.CylinderGeometry(.015, .015, .07, 8);
const shellPaint = new THREE.MeshStandardMaterial({ color: 0x222720, roughness: .75, metalness: .45 });
const shellFuze = new THREE.MeshStandardMaterial({ color: 0x827351, roughness: .65, metalness: .6 });
const shellBand = new THREE.MeshStandardMaterial({ color: 0x887135, roughness: .85, metalness: .15 });
const shellRed = new THREE.MeshStandardMaterial({ color: 0x75352b, roughness: .85 });
const shellShape = new THREE.LatheGeometry([new THREE.Vector2(0, -.070), new THREE.Vector2(.023, -.070),
  new THREE.Vector2(.025, -.056), new THREE.Vector2(.025, .019), new THREE.Vector2(.022, .035),
  new THREE.Vector2(.014, .052), new THREE.Vector2(.011, .056), new THREE.Vector2(0, .056)], 12);
const shellFuzeGeometry = new THREE.CylinderGeometry(.008, .011, .018, 8).translate(0, .065, 0);
const shellBaseGeometry = new THREE.CylinderGeometry(.025, .025, .008, 12).translate(0, -.060, 0);
const shellMetalGeometry = mergeGeometries([shellFuzeGeometry, shellBaseGeometry]);
shellFuzeGeometry.dispose(); shellBaseGeometry.dispose();
const shellBandGeometry = new THREE.CylinderGeometry(.0252, .0252, .008, 12, 1, true).translate(0, -.008, 0);
const shellRedGeometry = new THREE.CylinderGeometry(.0222, .024, .006, 12, 1, true).translate(0, .031, 0);
const shellAxis = new THREE.Vector3(0, 1, 0), shellFlight = new THREE.Vector3();

export function createGrenadeDischargerShellModel() {
  const model = new THREE.Group(); model.name = 'type89-he-shell';
  for (const [geometry, material] of [[shellShape, shellPaint], [shellMetalGeometry, shellFuze],
    [shellBandGeometry, shellBand], [shellRedGeometry, shellRed]]) model.add(new THREE.Mesh(geometry, material));
  model.userData.ammunition = { type: 'type89-50mm-he', diameter: .05, length: .144,
    provenance: 'Original geometry; 1943 Intelligence Bulletin black enamel, red nose band, yellow body band and copper rotating band',
    historicalDimensionsVerified: false };
  return model;
}

export function updateGrenadeDischargerShellModel(model, shell) {
  const vector = dischargerShellDirection(shell);
  shellFlight.set(vector.x, vector.y, vector.z);
  model.position.copy(shell.position);
  model.quaternion.setFromUnitVectors(shellAxis, shellFlight);
  model.rotateY(shell.elapsed * 24);
}

export function createGrenadeDischargerModel() {
  const group = new THREE.Group(), barrel = new THREE.Group();
  group.name = '八九式掷弹筒'; group.userData.weaponModel = 'type89';
  const plate = new THREE.Mesh(plateGeometry, steel); plate.position.y = .025; group.add(plate);
  const stem = new THREE.Mesh(stemGeometry, steel); stem.position.y = .14; barrel.add(stem);
  const tube = new THREE.Mesh(tubeGeometry, steel); tube.position.y = .38; barrel.add(tube);
  const rim = new THREE.Mesh(rimGeometry, steel); rim.rotation.x = Math.PI / 2;
  rim.position.y = .56; barrel.add(rim);
  const bottom = new THREE.Mesh(baseGeometry, bore); bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = .215; barrel.add(bottom);
  const muzzle = new THREE.Object3D(); muzzle.position.y = .57; barrel.add(muzzle);
  const control = new THREE.Mesh(controlGeometry, steel);
  control.rotation.z = Math.PI / 2; control.position.set(.059, .43, .005); barrel.add(control);
  const left = addSupportGrip(barrel, 'type89-left-barrel', { center: [0, .44, 0], radius: .036,
    normal: [-1, 0, 0], forward: [0, 0, -1] });
  const right = addSupportGrip(barrel, 'type89-right-control', { center: [.065, .43, .005], radius: .015,
    normal: [1, 0, 0], forward: [0, 0, -1], axis: [1, 0, 0] });
  const loading = addSupportGrip(barrel, 'type89-right-loading-rim', { center: [0, .55, 0], radius: .036,
    normal: [1, 0, 0], forward: [0, 0, -1] });
  barrel.rotation.x = -.48; group.add(barrel);
  group.userData.discharger = { muzzle };
  group.userData.supportWeapon = { kind: 'type89', grips: { left, right }, loading: { right: loading },
    operator: { x: 0, y: 0, z: .14 }, stance: 'crouched', firingPose: 'kneeling' };
  return group;
}
