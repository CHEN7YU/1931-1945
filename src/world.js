import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { configureRifleMaterials, rifleModel, rifleWorldModel } from './rifle-model.js';

const actorBox = new THREE.BoxGeometry(1, 1, 1);
const actorSphere = new THREE.SphereGeometry(1, 12, 8);
const actorCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
const actorCapsule = new THREE.CapsuleGeometry(1, 1, 3, 8);
const actorMaterials = {
  friendly: new THREE.MeshStandardMaterial({ color: 0x6c7775, roughness: .95 }),
  enemy: new THREE.MeshStandardMaterial({ color: 0x8b8260, roughness: .95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb89978, roughness: .9 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x222825, roughness: .63, metalness: .55 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x725438, roughness: .8 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x454e47, roughness: .65, metalness: .5 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x44372b, roughness: .88 }),
};

export function setModelSurfaces(surface) {
  configureRifleMaterials();
  const timber = surface('timber');
  Object.assign(actorMaterials.wood, {
    map: timber.map, normalMap: timber.normalMap,
    normalScale: new THREE.Vector2(.25, .25),
  });
  timber.dispose();
}

function shaped(parent, geometry, x, y, z, w, h, d, mat) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
const part = (parent, x, y, z, w, h, d, mat) => shaped(parent, actorBox, x, y, z, w, h, d, mat);
const sphere = (parent, x, y, z, w, h, d, mat) => shaped(parent, actorSphere, x, y, z, w, h, d, mat);
const cylinder = (parent, x, y, z, radius, length, mat) => shaped(parent, actorCylinder, x, y, z, radius, length, radius, mat);
function limb(parent, from, to, radius, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const mesh = cylinder(parent, ...a.clone().add(b).multiplyScalar(.5).toArray(), radius, a.distanceTo(b), mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  sphere(parent, ...from, radius, radius, radius, mat);
  sphere(parent, ...to, radius, radius, radius, mat);
  return mesh;
}

const soldierBodies = new Map();
function batchSoldier(group, legs, friendly) {
  // Only the two leg meshes animate independently; cache the rigid body per side.
  if (!soldierBodies.has(friendly)) {
    group.updateMatrixWorld(true);
    const byMaterial = new Map();
    group.traverse(child => {
      if (!child.isMesh || legs.includes(child)) return;
      const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
      if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
      byMaterial.get(child.material).push(geometry.index ? geometry.toNonIndexed() : geometry);
      if (geometry.index) geometry.dispose();
    });
    soldierBodies.set(friendly, [...byMaterial].map(([material, geometries]) => {
      const geometry = mergeGeometries(geometries);
      geometries.forEach(item => item.dispose());
      return { geometry, material };
    }));
  }
  for (const child of [...group.children]) if (!legs.includes(child)) group.remove(child);
  for (const { geometry, material } of soldierBodies.get(friendly)) {
    const body = new THREE.Mesh(geometry, material);
    body.castShadow = body.receiveShadow = true;
    group.add(body);
  }
}

export function soldierModel(friendly = false) {
  const group = new THREE.Group();
  const uniform = friendly ? actorMaterials.friendly : actorMaterials.enemy;
  shaped(group, actorCapsule, 0, 1.11, 0, .24, .23, .15, uniform);
  sphere(group, 0, 1.63, -.015, .135, .17, .12, actorMaterials.skin);
  cylinder(group, 0, 1.46, 0, .07, .16, actorMaterials.skin);
  sphere(group, 0, 1.77, .008, .18, .1, .17, uniform);
  shaped(group, actorCylinder, 0, 1.74, -.075, .18, .028, .22, uniform);
  sphere(group, 0, 1.63, -.135, .024, .034, .027, actorMaterials.skin);
  for (const x of [-.055, .055]) part(group, x, 1.665, -.125, .026, .012, .008, actorMaterials.dark);
  const leftLeg = shaped(group, actorCapsule, -.135, .43, 0, .095, .25, .105, uniform);
  const rightLeg = shaped(group, actorCapsule, .135, .43, 0, .095, .25, .105, uniform);
  for (const x of [-.135, .135]) {
    sphere(group, x, .085, -.075, .105, .09, .2, actorMaterials.leather);
    for (let y = .16; y < .46; y += .06) cylinder(group, x, y, 0, .098, .012, actorMaterials.leather);
  }
  limb(group, [-.24, 1.32, 0], [-.09, 1.13, -.26], .065, uniform);
  limb(group, [-.09, 1.13, -.26], [.10, 1.325, -.43], .055, uniform);
  limb(group, [.24, 1.32, 0], [.34, 1.1, .05], .065, uniform);
  limb(group, [.34, 1.1, .05], [.173, 1.325, -.095], .052, uniform);
  sphere(group, .10, 1.325, -.43, .037, .035, .055, actorMaterials.skin);
  sphere(group, .173, 1.325, -.095, .033, .04, .048, actorMaterials.skin);
  if (friendly) {
    const rifle = rifleWorldModel();
    rifle.position.set(.13, 1.39, .02);
    group.add(rifle);
  } else {
    part(group, .13, 1.29, -.32, .062, .085, .86, actorMaterials.wood);
    cylinder(group, .13, 1.39, -.89, .014, .36, actorMaterials.dark).rotation.x = Math.PI / 2;
  }
  part(group, 0, .96, 0, .51, .07, .34, actorMaterials.leather);
  part(group, -.16, 1.07, -.19, .13, .17, .08, actorMaterials.leather);
  part(group, .12, 1.07, -.19, .13, .17, .08, actorMaterials.leather);
  part(group, 0, 1.12, .23, .35, .4, .18, actorMaterials.leather);
  limb(group, [-.18, 1.39, .12], [-.17, .98, -.19], .025, actorMaterials.leather);
  limb(group, [.18, 1.39, .12], [.17, .98, -.19], .025, actorMaterials.leather);
  cylinder(group, .29, .99, .07, .08, .2, actorMaterials.steel);
  group.userData.legs = [leftLeg, rightLeg];
  batchSoldier(group, group.userData.legs, friendly);
  return group;
}

export function tankModel() {
  const group = new THREE.Group();
  const m = actorMaterials.steel;
  part(group, 0, .8, 0, 2.8, 1.2, 4.7, m);
  part(group, -1.5, .55, 0, .65, 1.05, 4.9, actorMaterials.dark);
  part(group, 1.5, .55, 0, .65, 1.05, 4.9, actorMaterials.dark);
  for (const x of [-1.85, 1.85]) for (let z = -1.6; z <= 1.7; z += .8) {
    cylinder(group, x, .5, z, .33, .1, m).rotation.z = Math.PI / 2;
  }
  const turret = new THREE.Group();
  turret.position.y = 1.5;
  group.add(turret);
  part(turret, 0, .4, -.1, 1.9, .8, 2, m);
  cylinder(turret, 0, .45, -2.5, .09, 3.3, m).rotation.x = Math.PI / 2;
  cylinder(turret, .4, .87, -.1, .33, .14, actorMaterials.dark);
  group.userData.turret = turret;
  return group;
}

export function planeModel() {
  const group = new THREE.Group();
  sphere(group, 0, 0, 0, .48, .45, 2.9, actorMaterials.steel);
  part(group, 0, .1, -.2, 8, .14, 1.6, actorMaterials.steel);
  part(group, 0, .35, 2, 3.1, .12, .9, actorMaterials.steel);
  part(group, 0, .7, 2.1, .12, 1.5, .85, actorMaterials.steel);
  sphere(group, 0, .38, .15, .35, .5, .6, actorMaterials.dark);
  part(group, 0, 0, -3, 2.5, .12, .12, actorMaterials.wood);
  return group;
}

export function weaponModel(type) {
  if (type === 'infantry') return rifleModel();
  const group = new THREE.Group();
  const steel = actorMaterials.dark, wood = actorMaterials.wood, uniform = actorMaterials.friendly;
  if (type === 'hammer') {
    cylinder(group, .3, -.34, -.65, .035, .65, wood).rotation.x = -.35;
    part(group, .3, -.03, -.75, .38, .15, .16, actorMaterials.steel);
    limb(group, [.38, -.65, -.22], [.3, -.39, -.59], .085, uniform);
    sphere(group, .3, -.35, -.62, .065, .085, .07, actorMaterials.skin);
  } else if (type === 'plane') {
    for (const x of [-.7, .7]) cylinder(group, x, -.44, -.9, .05, .9, steel).rotation.x = Math.PI / 2;
    part(group, 0, -.7, -.5, 2.4, .3, .6, actorMaterials.steel);
    part(group, -.42, -.1, -.8, .045, 1, .045, actorMaterials.steel).rotation.z = -.25;
    part(group, .42, -.1, -.8, .045, 1, .045, actorMaterials.steel).rotation.z = .25;
  } else if (type === 'tank') {
    part(group, 0, -.7, -.5, 3, .65, 1.6, actorMaterials.steel);
    cylinder(group, .2, -.4, -1.6, .075, 2.2, steel).rotation.x = Math.PI / 2;
  } else if (type === 'mortar') {
    cylinder(group, .36, -.46, -.75, .09, 1.2, actorMaterials.steel).rotation.x = .8;
    shaped(group, actorCylinder, .36, -.8, -.55, .4, .08, .35, steel);
  } else throw new RangeError(`Unknown view weapon: ${type}`);
  return group;
}

export function rallyPointModel(team = 'friendly', preview = false) {
  const group = new THREE.Group();
  const mat = preview
    ? new THREE.MeshBasicMaterial({ color: 0x93c285, transparent: true, opacity: .4, depthWrite: false })
    : actorMaterials.steel;
  part(group, 0, .15, 0, 1.6, .3, 1.3, preview ? mat : actorMaterials.wood);
  part(group, 0, .65, 0, .85, .7, .5, mat);
  cylinder(group, .25, 1.65, .15, .018, 1.5, mat);
  cylinder(group, -.25, .72, -.27, .06, .05, preview ? mat : actorMaterials.dark).rotation.x = Math.PI / 2;
  cylinder(group, .15, .72, -.27, .06, .05, preview ? mat : actorMaterials.dark).rotation.x = Math.PI / 2;
  const banner = part(group, .65, .75, .28, .6, .4, .04, preview ? mat : team === 'friendly' ? actorMaterials.friendly : actorMaterials.enemy);
  banner.rotation.y = .1;
  if (preview) group.traverse(mesh => { mesh.castShadow = false; });
  return group;
}

export function baseSpawnModel(team = 'friendly') {
  const group = new THREE.Group();
  const cloth = team === 'friendly' ? actorMaterials.friendly : actorMaterials.enemy;
  for (const x of [-4.5, 4.5]) {
    part(group, x, .45, 1, 1.5, .9, 1.3, actorMaterials.wood);
    part(group, x, 1.15, 1, 1.2, .5, .9, cloth);
    for (const offset of [-.55, .55]) part(group, x + offset, .45, 1.67, .1, .9, .08, actorMaterials.leather);
  }
  cylinder(group, 4.5, 2.4, 1, .03, 2.1, actorMaterials.wood);
  part(group, 5, 3.1, 1, .95, .55, .04, cloth);
  return group;
}
