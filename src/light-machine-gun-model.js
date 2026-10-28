import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { infantryWeaponProfile } from './rifle-action.js';

const templates = new Map();
const steel = new THREE.MeshStandardMaterial({ color: 0x343b3c, metalness: .78, roughness: .48 });
const wood = new THREE.MeshStandardMaterial({ color: 0x65432d, roughness: .78 });
const brass = new THREE.MeshStandardMaterial({ color: 0xa18447, metalness: .65, roughness: .5 });
const edge = new THREE.MeshStandardMaterial({ color: 0x60696c, metalness: .85, roughness: .4 });
const black = new THREE.MeshStandardMaterial({ color: 0x15191a, metalness: .3, roughness: .7 });

export function configureLightMachineGunMaterials(materials) {
  for (const [name, material] of Object.entries({ steel, wood, brass, edge, black })) material.copy(materials[name]);
}

export function lightMachineGunModel(model, detail = 'near') {
  const profile = infantryWeaponProfile({ model });
  if (!profile.automatic) throw new RangeError('A light machine gun model requires an automatic weapon');
  if (!['near', 'far'].includes(detail)) throw new RangeError('Unknown light machine gun detail');
  const key = `${model}:${detail}`, near = detail === 'near';
  if (!templates.has(key)) {
    const root = new THREE.Group(), body = new THREE.Group();
    body.name = 'lmg-body';
    root.add(body);
    const add = (parent, name, geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    const box = (parent, name, x, y, z, w, h, d, material = steel, radius = .002) =>
      add(parent, name, near ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)) :
        new THREE.BoxGeometry(w, h, d), material, x, y, z);
    const cylinder = (parent, name, x, y, z, radius, length, material = steel, endRadius = radius) => {
      const geometry = new THREE.CylinderGeometry(radius, endRadius, length, near ? 32 : 10);
      geometry.rotateX(Math.PI / 2);
      return add(parent, name, geometry, material, x, y, z);
    };
    const contour = (name, shape, width, material, x = 0) => {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, steps: 1, curveSegments: near ? 12 : 3,
        bevelEnabled: near, bevelThickness: .0015, bevelSize: .002, bevelSegments: 2 });
      geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2, 0, 0);
      return add(body, name, geometry, material, x, 0, 0);
    };
    const tube = (name, points, radius, material = steel) => {
      const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
      return add(body, name, new THREE.TubeGeometry(path, near ? 20 : 6, radius, near ? 10 : 5, false), material, 0, 0, 0);
    };
    const ring = (name, x, y, z, outer, inner, length) => {
      const geometry = new THREE.LatheGeometry([
        [inner, -length / 2], [outer, -length / 2], [outer, length / 2],
        [inner, length / 2], [inner, -length / 2],
      ].map(([r, h]) => new THREE.Vector2(r, h)), near ? 40 : 12);
      geometry.rotateX(Math.PI / 2);
      return add(body, name, geometry, steel, x, y, z);
    };
    // Keep the existing shoulder/palm interface; the receiver is offset from the sight line.
    const axis = profile.muzzleX, barrelEnd = profile.muzzleZ;
    const stock = new THREE.Shape();
    stock.moveTo(-.1, -.014); stock.bezierCurveTo(-.025, -.02, .025, -.057, .09, -.049);
    stock.quadraticCurveTo(.165, -.036, .211, -.039); stock.lineTo(.211, -.151);
    stock.quadraticCurveTo(.13, -.16, .08, -.127); stock.bezierCurveTo(.012, -.092, -.045, -.068, -.1, -.069);
    stock.closePath();
    contour('shaped-stock', stock, .044, wood, axis * .25);
    box(body, 'butt-plate', axis * .25, -.095, .215, .049, .117, .008, steel, .003);
    box(body, 'stock-socket', axis * .5, -.039, -.075, .051, .059, .055);
    box(body, 'receiver', axis, -.026, -.248, .051, .058, .29, steel, .005);
    box(body, 'receiver-cover', axis, .006, -.235, .046, .01, .254, steel, .002);
    box(body, 'lower-receiver', axis * .6, -.063, -.2, .039, .017, .18);
    const grip = new THREE.Shape();
    grip.moveTo(-.096, -.066); grip.quadraticCurveTo(-.086, -.112, -.062, -.159);
    grip.quadraticCurveTo(-.042, -.174, -.018, -.158); grip.lineTo(-.038, -.077); grip.closePath();
    contour('shaped-pistol-grip', grip, .033, wood, .012);
    tube('trigger-guard', [[.012, -.07, -.15], [.012, -.108, -.15], [.012, -.118, -.116], [.012, -.086, -.093]], .003);
    tube('trigger', [[.012, -.073, -.129], [.012, -.093, -.126], [.012, -.101, -.115]], .0025, black);
    box(body, 'support-grip', 0, -.077, -.385, .045, .038, .17, wood, .009);
    cylinder(body, 'barrel-collar', axis, 0, -.397, .027, .034);
    cylinder(body, 'barrel', axis, 0, (-.4 + barrelEnd) / 2, .0125, -.4 - barrelEnd);
    cylinder(body, 'gas-tube', axis, -.039, -.605, .0095, .435);
    cylinder(body, 'gas-regulator', axis, -.039, -.815, .013, .028, edge);
    const finCount = near ? 29 : 18, finStart = -.422, finEnd = barrelEnd + .105;
    for (let i = 0; i < finCount; i++) {
      const z = THREE.MathUtils.lerp(finStart, finEnd, i / (finCount - 1));
      cylinder(body, 'cooling-fin', axis, 0, z, .0225, near ? .003 : .005);
    }
    cylinder(body, 'front-barrel-collar', axis, 0, barrelEnd + .075, .019, .025);
    ring('hollow-muzzle', axis, 0, barrelEnd + .017, model === 'zb26' ? .021 : .0165, .008, .034);
    cylinder(body, 'muzzle-bore', axis, 0, barrelEnd + .032, .0078, .001, black);
    for (const [z, front] of [[-.08, false], [barrelEnd + .045, true]]) {
      box(body, 'offset-sight-base', axis / 2, .018, z, Math.abs(axis) + .016, .009, .021);
      if (front) {
        box(body, 'front-sight-post', 0, .0375, z, .002, .025, .003, black, .0003);
        for (const side of [-1, 1]) box(body, 'front-sight-ear', side * .009, .035, z, .0025, .025, .012);
      } else {
        box(body, 'rear-sight-bed', 0, .028, z - .008, .023, .008, .035);
        for (const side of [-1, 1]) box(body, 'rear-sight-notch', side * .008, .041, z, .01, .018, .004, black, .0005);
      }
    }
    box(body, 'bipod-hinge', axis, -.024, -.754, .055, .019, .027);
    for (const side of [-1, 1]) {
      const leg = cylinder(body, 'folded-bipod', axis + side * .032, -.041, -.57, .0045, .38);
      leg.rotation.y = side * .055;
      box(body, 'bipod-foot', axis + side * .042, -.044, -.381, .014, .009, .025);
      box(body, 'receiver-rail', axis + side * .026, -.027, -.246, .003, .005, .238, edge, .0005);
    }
    box(body, 'ejection-port', axis + .0265, -.017, -.2, .0015, .018, .058, black, .0003);
    cylinder(body, 'charging-handle', axis + .045, -.021, -.13, .0065, .033);
    box(body, 'charging-handle-link', axis + .032, -.021, -.139, .029, .008, .008);
    if (near) {
      for (const side of [-1, 1]) for (const z of [-.12, -.29, -.36]) {
        const pin = cylinder(body, 'receiver-pin', axis + side * .027, -.036, z, .0032, .002, edge);
        pin.rotation.y = Math.PI / 2;
        box(body, 'pin-slot', axis + side * .0282, -.036, z, .0006, .001, .004, black, .0001);
      }
      for (let i = 0; i < 7; i++) box(body, 'sight-graduation', -.006, .0325, -.102 + i * .005,
        .007, .001, .0008, edge, .0001);
      tube('rear-sling-swivel', [[-.024, -.12, .152], [-.033, -.136, .152], [-.033, -.136, .127], [-.024, -.12, .127]], .0025);
    }
    if (model === 'zb26') {
      tube('carry-handle-stem', [[axis + .019, -.008, -.43], [axis + .043, .048, -.43], [axis + .043, .069, -.465]], .0045);
      cylinder(body, 'carry-handle', axis + .043, .069, -.5, .011, .09, wood);
      cylinder(body, 'carry-handle-cap', axis + .043, .069, -.549, .012, .008, edge);
    }
    const feed = new THREE.Group(); feed.name = 'feed'; root.add(feed);
    if (model === 'zb26') {
      box(body, 'magazine-well', axis, .012, -.25, .045, .018, .096);
      box(feed, 'top-magazine', axis, .112, -.25, .033, .184, .078, steel, .004);
      box(feed, 'magazine-floorplate', axis, .206, -.25, .038, .007, .084, steel, .002);
      for (const side of [-1, 1]) {
        for (const z of [-.27, -.235]) box(feed, 'magazine-pressed-rib', axis + side * .0175, .114, z,
          .002, .155, .005, steel, .0006);
      }
      box(body, 'magazine-latch', axis, .027, -.199, .018, .018, .014, edge);
    } else {
      box(feed, 'hopper-floor', -.123, .004, -.216, .143, .01, .137);
      for (const z of [-.282, -.15]) box(feed, 'hopper-wall', -.123, .034, z, .143, .064, .006);
      box(feed, 'hopper-outer-wall', -.193, .034, -.216, .006, .064, .137);
      for (let clip = 0; clip < (near ? 6 : 1); clip++) {
        const y = .014 + clip * .009;
        box(feed, 'stripper-clip', -.123, y, -.163, .118, .004, .008);
        for (let round = 0; round < 5; round++) {
          cylinder(feed, 'hopper-cartridge', -.169 + round * .023, y + .003, -.211, .0039, .063, brass);
        }
      }
      box(feed, 'hopper-lid', -.123, .079, -.216, .151, .008, .143, steel, .003);
      cylinder(feed, 'hopper-hinge', -.197, .071, -.216, .0055, .145, edge);
      box(feed, 'hopper-lid-ridge', -.123, .085, -.216, .019, .006, .12);
    }
    for (const group of [body, feed]) {
      group.updateMatrixWorld(true);
      const batches = new Map();
      for (const mesh of [...group.children]) {
        let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded; }
        if (!batches.has(mesh.material)) batches.set(mesh.material, []);
        batches.get(mesh.material).push(geometry);
        mesh.geometry.dispose(); group.remove(mesh);
      }
      for (const [material, geometries] of batches) {
        const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
        mesh.receiveShadow = true;
        geometries.forEach(geometry => geometry.dispose());
        group.add(mesh);
      }
    }
    root.userData.model = model;
    root.userData.detail = detail;
    root.userData.referenceLength = profile.length;
    templates.set(key, root);
  }
  return templates.get(key).clone(true);
}
