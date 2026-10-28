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
let surfaceTextures;

function authoredSurfaces() {
  if (surfaceTextures) return surfaceTextures;
  const size = 256, data = Array.from({ length: 6 }, () => new Uint8Array(size * size * 4));
  const noise = (x, y) => {
    let value = Math.imul(x + 1938, 374761393) ^ Math.imul(y + 26, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, n = noise(x, y);
    const grain = Math.sin(x * .72 + Math.sin(y * .025) * 1.8 + Math.sin(y * .071) * .5);
    const pores = Math.pow(Math.max(0, grain), 12);
    const stain = Math.sin(x * .037) * Math.sin(y * .043);
    const scratch = noise(x, Math.floor(y / 9)) > .994 && y % 9 < 7 ? 1 : 0;
    const woodTone = grain * 3.5 + stain * 3 - pores * 6 + n * 2;
    data[0].set([83 + woodTone, 48 + woodTone * .7, 27 + woodTone * .45, 255], i);
    const woodHeight = 142 + grain * 9 - pores * 18;
    data[1].set([woodHeight, woodHeight, woodHeight, 255], i);
    const woodRough = 154 + pores * 25 + stain * 9;
    data[2].set([woodRough, woodRough, woodRough, 255], i);
    const steelTone = 64 + n * 4 + stain * 3 + scratch * 13;
    data[3].set([steelTone, steelTone + 4, steelTone + 5, 255], i);
    const steelHeight = 128 + (n - .5) * 4 - scratch * 12;
    data[4].set([steelHeight, steelHeight, steelHeight, 255], i);
    const steelRough = 121 + stain * 17 - scratch * 21;
    data[5].set([steelRough, steelRough, steelRough, 255], i);
  }
  surfaceTextures = data.map((pixels, index) => {
    const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.colorSpace = index % 3 === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.userData.assetUrl = 'generated:lmg-authored-surface';
    map.needsUpdate = true;
    return map;
  });
  return surfaceTextures;
}

export function configureLightMachineGunMaterials(materials) {
  for (const [name, material] of Object.entries({ steel, wood, brass, edge, black })) material.copy(materials[name]);
  const [woodColor, woodBump, woodRoughness, steelColor, steelBump, steelRoughness] = authoredSurfaces();
  for (const map of surfaceTextures) map.anisotropy = materials.wood.map?.anisotropy ?? 1;
  for (const material of [steel, edge]) {
    material.map = steelColor; material.bumpMap = steelBump; material.bumpScale = .000035;
    material.normalMap = null; material.roughnessMap = steelRoughness; material.roughness = 1;
    material.metalnessMap = null; material.metalness = .82; material.needsUpdate = true;
  }
  steel.color.setHex(0xffffff); edge.color.setHex(0xe3e1d7); edge.roughness = .8;
  wood.map = woodColor; wood.bumpMap = woodBump; wood.bumpScale = .00012;
  wood.normalMap = null; wood.roughnessMap = woodRoughness; wood.roughness = 1;
  wood.color.setHex(0xffffff); wood.needsUpdate = true;
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
    const box = (parent, name, x, y, z, w, h, d, material = steel, radius = .002) => {
      const minimum = Math.min(w, h, d);
      return add(parent, name, near && minimum > .001
        ? new RoundedBoxGeometry(w, h, d, minimum < .006 ? 1 : 2, Math.min(radius, minimum / 3))
        : new THREE.BoxGeometry(w, h, d), material, x, y, z);
    };
    const cylinder = (parent, name, x, y, z, radius, length, material = steel, endRadius = radius, segments = near ? 24 : 10) => {
      const geometry = new THREE.CylinderGeometry(radius, endRadius, length, segments);
      geometry.rotateX(Math.PI / 2);
      return add(parent, name, geometry, material, x, y, z);
    };
    const contour = (name, shape, width, material, x = 0, parent = body, bevel = .002) => {
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, steps: 1, curveSegments: near ? 12 : 3,
        bevelEnabled: near, bevelThickness: bevel, bevelSize: bevel, bevelSegments: near ? 3 : 1 });
      geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2, 0, 0);
      return add(parent, name, geometry, material, x, 0, 0);
    };
    const woodLoft = (name, sections, x = 0) => {
      const curves = [1, 2, 3].map(channel =>
        new THREE.SplineCurve(sections.map(section => new THREE.Vector2(section[0], section[channel]))));
      const rings = near ? 41 : 9, sides = near ? 24 : 10, vertices = [], uv = [], indices = [];
      for (let i = 0; i < rings; i++) {
        const [center, width, height] = curves.map(curve => curve.getPoint(i / (rings - 1)));
        for (let j = 0; j <= sides; j++) {
          const angle = j / sides * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
          vertices.push(x + Math.sign(c) * Math.abs(c) ** .8 * width.y,
            center.y + Math.sign(s) * Math.abs(s) ** .8 * height.y, center.x);
          uv.push(j / sides * 2, center.x * 2.8);
          if (i < rings - 1 && j < sides) {
            const p = i * (sides + 1) + j;
            indices.push(p, p + sides + 1, p + 1, p + 1, p + sides + 1, p + sides + 2);
          }
        }
      }
      for (const [ring, reverse] of [[0, false], [rings - 1, true]]) {
        const center = curves[0].getPoint(ring / (rings - 1));
        const middle = vertices.length / 3, start = ring * (sides + 1);
        vertices.push(x, center.y, center.x); uv.push(.5, center.x * 2.8);
        for (let j = 0; j < sides; j++) indices.push(middle, start + j + Number(reverse), start + j + Number(!reverse));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      return add(body, name, geometry, wood, 0, 0, 0);
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
    woodLoft('sculpted-stock', [[.211, -.095, .023, .054], [.18, -.094, .024, .058],
      [.11, -.087, .023, .049], [.045, -.072, .018, .033], [-.015, -.049, .015, .023],
      [-.068, -.04, .02, .025], [-.1, -.04, .023, .025]], axis * .25);
    box(body, 'butt-plate', axis * .25, -.095, .215, .049, .117, .008, steel, .003);
    box(body, 'stock-socket', axis * .5, -.039, -.075, .051, .059, .055);
    const receiver = new THREE.Shape();
    receiver.moveTo(-.102, -.049); receiver.lineTo(-.108, .002); receiver.lineTo(-.132, .007);
    receiver.lineTo(-.353, .007); receiver.lineTo(-.391, -.005); receiver.lineTo(-.391, -.047);
    receiver.lineTo(-.359, -.055); receiver.lineTo(-.121, -.055); receiver.closePath();
    contour('machined-receiver', receiver, .045, steel, axis);
    box(body, 'receiver-cover-seam', axis, .006, -.235, .044, .0015, .25, black, .0003);
    box(body, 'receiver-cover', axis, .009, -.235, .043, .005, .25, steel, .001);
    box(body, 'lower-receiver', axis * .6, -.063, -.2, .039, .017, .18);
    const grip = new THREE.Shape();
    grip.moveTo(-.096, -.066); grip.quadraticCurveTo(-.086, -.112, -.062, -.159);
    grip.quadraticCurveTo(-.042, -.174, -.018, -.158); grip.lineTo(-.038, -.077); grip.closePath();
    contour('shaped-pistol-grip', grip, .026, wood, .012, body, .004);
    tube('trigger-guard', [[.012, -.07, -.15], [.012, -.108, -.15], [.012, -.118, -.116], [.012, -.086, -.093]], .003);
    tube('trigger', [[.012, -.073, -.129], [.012, -.093, -.126], [.012, -.101, -.115]], .0025, black);
    woodLoft('sculpted-support-grip', [[-.3, -.071, .018, .014], [-.32, -.072, .022, .02],
      [-.385, -.072, .022, .022], [-.45, -.071, .021, .02], [-.47, -.071, .017, .013]]);
    cylinder(body, 'barrel-collar', axis, 0, -.397, .027, .034);
    cylinder(body, 'barrel', axis, 0, (-.4 + barrelEnd) / 2, .0125, -.4 - barrelEnd);
    cylinder(body, 'gas-tube', axis, -.039, -.605, .0095, .435);
    cylinder(body, 'gas-regulator', axis, -.039, -.815, .013, .028, edge);
    const finCount = near ? 29 : 18, finStart = -.422, finEnd = barrelEnd + .105, finProfile = [];
    for (let i = 0; i < finCount; i++) {
      const z = THREE.MathUtils.lerp(finEnd, finStart, i / (finCount - 1));
      if (near) {
        for (const [radius, offset] of [[.0125, -.003], [.021, -.0017], [.022, -.0009],
          [.022, .0009], [.021, .0017], [.0125, .003]]) finProfile.push(new THREE.Vector2(radius, z + offset));
      } else cylinder(body, 'cooling-fin', axis, 0, z, .0225, .005);
    }
    if (near) {
      const geometry = new THREE.LatheGeometry(finProfile, 24);
      geometry.rotateX(Math.PI / 2);
      add(body, 'beveled-cooling-stack', geometry, steel, axis, 0, 0);
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
      box(body, 'receiver-rail', axis + side * .0248, -.027, -.246, .0012, .002, .238, edge, .0003);
    }
    box(body, 'ejection-port', axis + .0247, -.017, -.2, .0008, .017, .055, black, .0002);
    cylinder(body, 'charging-handle', axis + .045, -.021, -.13, .0065, .033);
    box(body, 'charging-handle-link', axis + .032, -.021, -.139, .029, .008, .008);
    if (near) {
      for (const side of [-1, 1]) for (const z of [-.12, -.29, -.36]) {
        const pin = cylinder(body, 'receiver-pin', axis + side * .0248, -.036, z, .0025, .001, edge);
        pin.rotation.y = Math.PI / 2;
        box(body, 'pin-slot', axis + side * .0254, -.036, z, .0003, .0007, .003, black, .0001);
      }
      for (const side of [-1, 1]) {
        box(body, 'machined-edge-wear', axis + side * .0232, .003, -.247, .0005, .0007, .218, edge, .0001);
        for (let i = 0; i < 4; i++) box(body, 'grip-flute', .012 + side * .0172, -.119 - i * .008,
          -.065, .0006, .001, .032, black, .0001);
      }
      for (let i = 0; i < 12; i++) box(body, 'butt-plate-groove', axis * .25, -.047 - i * .008,
        .219, .033, .0007, .0005, black, .0001);
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
      const magazine = new THREE.Shape();
      magazine.moveTo(-.289, .024); magazine.lineTo(-.285, .195); magazine.quadraticCurveTo(-.285, .202, -.278, .202);
      magazine.lineTo(-.217, .202); magazine.quadraticCurveTo(-.21, .202, -.21, .195);
      magazine.lineTo(-.211, .024); magazine.closePath();
      contour('pressed-magazine-shell', magazine, .029, steel, axis, feed, .0018);
      box(feed, 'magazine-floorplate', axis, .205, -.247, .034, .004, .079, steel, .001);
      for (const side of [-1, 1]) {
        for (const z of [-.27, -.235]) {
          box(feed, 'magazine-pressed-channel', axis + side * .0164, .114, z, .0006, .149, .0028, black, .0002);
          box(feed, 'magazine-channel-lip', axis + side * .0166, .114, z + .002, .0005, .149, .0006, edge, .0001);
        }
        if (near) for (const y of [.041, .18]) {
          const rivet = cylinder(feed, 'magazine-rivet', axis + side * .0166, y, -.282, .0018, .0008, edge);
          rivet.rotation.y = Math.PI / 2;
        }
      }
      box(feed, 'magazine-weld-seam', axis, .112, -.2902, .021, .161, .0007, edge, .0002);
      box(body, 'magazine-latch', axis, .027, -.199, .018, .018, .014, edge);
    } else {
      box(feed, 'hopper-floor', -.123, .004, -.216, .143, .01, .137);
      for (const z of [-.282, -.15]) box(feed, 'hopper-wall', -.123, .034, z, .143, .064, .006);
      box(feed, 'hopper-outer-wall', -.193, .034, -.216, .006, .064, .137);
      for (let clip = 0; clip < (near ? 6 : 1); clip++) {
        const y = .014 + clip * .009;
        box(feed, 'stripper-clip', -.123, y, -.163, .118, .004, .008);
        for (let round = 0; round < 5; round++) {
          const x = -.169 + round * .023;
          cylinder(feed, 'hopper-cartridge', x, y + .003, -.207, .0039, .05, brass, .0039, near ? 12 : 10);
          if (near) {
            cylinder(feed, 'cartridge-rim', x, y + .003, -.181, .0045, .0015, brass, .0045, 12);
            cylinder(feed, 'cartridge-neck', x, y + .003, -.236, .0029, .008, brass, .0038, 12);
            const tip = new THREE.ConeGeometry(.0029, .011, 12); tip.rotateX(-Math.PI / 2);
            add(feed, 'bullet-tip', tip, brass, x, y + .003, -.2455);
          }
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
