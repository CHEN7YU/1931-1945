import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { infantryWeaponProfile } from './rifle-action.js';

const templates = new Map();
const steel = new THREE.MeshStandardMaterial({ color: 0x343b3c, metalness: .78, roughness: .48 });
const wood = new THREE.MeshStandardMaterial({ color: 0x65432d, roughness: .78 });
const brass = new THREE.MeshStandardMaterial({ color: 0xa18447, metalness: .65, roughness: .5 });

export function lightMachineGunModel(model) {
  const profile = infantryWeaponProfile({ model });
  if (!profile.automatic) throw new RangeError('A light machine gun model requires an automatic weapon');
  if (!templates.has(model)) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const box = (parent, name, x, y, z, w, h, d, material = steel) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.name = name; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    const cylinder = (name, x, y, z, radius, length) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
      geometry.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, steel);
      mesh.name = name; mesh.position.set(x, y, z); body.add(mesh); return mesh;
    };
    // Keep the existing shoulder/palm interface; the receiver is offset from the sight line.
    const axis = profile.muzzleX;
    box(body, 'stock', 0, -.095, .09, .05, .13, .26, wood);
    box(body, 'receiver', axis, -.025, -.24, .06, .065, .3);
    box(body, 'pistol-grip', .015, -.1, -.065, .045, .12, .07, wood);
    box(body, 'support-grip', 0, -.082, -.37, .055, .045, .19, wood);
    const barrelEnd = profile.muzzleZ;
    cylinder('barrel', axis, 0, (-.36 + barrelEnd) / 2, .016, -.36 - barrelEnd);
    cylinder('gas-tube', axis, -.055, -.6, .015, .48);
    for (let i = 0; i < 22; i++) cylinder('cooling-fin', axis, 0, -.39 - i * .018, .027, .006);
    cylinder('muzzle', axis, 0, barrelEnd + .017, model === 'zb26' ? .023 : .017, .034);
    for (const z of [-.08, barrelEnd + .045]) {
      box(body, 'sight-base', axis / 2, .024, z, Math.abs(axis) + .018, .018, .025);
      box(body, 'sight', 0, .04, z, .01, .02, .014);
    }
    for (const side of [-1, 1]) {
      const leg = box(body, 'folded-bipod', axis + side * .04, -.055, -.62, .012, .018, .42);
      leg.rotation.y = side * .055;
    }
    if (model === 'zb26') {
      box(body, 'carry-handle-stem', .09, .055, -.43, .012, .13, .012);
      box(body, 'carry-handle', .09, .12, -.46, .025, .025, .12, wood);
    }
    const feed = new THREE.Group(); feed.name = 'feed'; root.add(feed);
    if (model === 'zb26') {
      box(feed, 'top-magazine', axis, .11, -.25, .045, .19, .095);
    } else {
      box(feed, 'side-hopper', -.13, .02, -.19, .19, .08, .15);
      for (let clip = 0; clip < 6; clip++) {
        box(feed, 'clip-layer', -.13, .065 + clip * .009, -.19, .14, .006, .12, brass);
      }
      box(feed, 'hopper-lid', -.13, .13, -.19, .2, .012, .16);
    }
    for (const group of [body, feed]) {
      group.updateMatrixWorld(true);
      const batches = new Map();
      for (const mesh of [...group.children]) {
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        if (!batches.has(mesh.material)) batches.set(mesh.material, []);
        batches.get(mesh.material).push(geometry);
        mesh.geometry.dispose(); group.remove(mesh);
      }
      for (const [material, geometries] of batches) {
        const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
        geometries.forEach(geometry => geometry.dispose());
        group.add(mesh);
      }
    }
    root.userData.model = model;
    root.userData.referenceLength = profile.length;
    templates.set(model, root);
  }
  return templates.get(model).clone(true);
}
