import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIFLE, riflePose, infantryWeaponProfile } from './rifle-action.js';
import { lightMachineGunModel, configureLightMachineGunMaterials } from './light-machine-gun-model.js';
import { RIFLE_PBR_ASSETS } from './weapon-assets.js';
import { applyRifleTextures } from './optional-rifle-textures.js';
import { RIFLE_STOCK_SECTIONS } from './rifle-contacts.js';

let template;
let distantTemplate;
let automaticHands;
let bayonetTemplate;
const scopeTemplates = new Map();
const materials = {};
function texture(canvas, color = false) {
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export async function configureRifleMaterials(maxAnisotropy = 8) {
  let seed = 1936;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const wood = document.createElement('canvas'), steel = document.createElement('canvas'), weave = document.createElement('canvas');
  wood.width = 512; wood.height = 1024;
  const context = wood.getContext('2d'), pixels = context.createImageData(512, 1024);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 512; x++) {
    const grain = Math.sin(x * .2 + Math.sin(y * .008) * 5 + Math.sin(y * .023) * 2);
    const fine = Math.sin(x * .9 + Math.sin(y * .012) * 6);
    const v = grain * 7 + fine * 2 + random() * 7;
    const i = (y * 512 + x) * 4;
    pixels.data.set([94 + v, 53 + v * .65, 29 + v * .4, 255], i);
  }
  context.putImageData(pixels, 0, 0);
  steel.width = steel.height = 512;
  const metal = steel.getContext('2d'), metalPixels = metal.createImageData(512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const v = random() * 12 + Math.sin(i % 512 * .035) * 3;
    metalPixels.data.set([60 + v, 66 + v, 70 + v, 255], i * 4);
  }
  metal.putImageData(metalPixels, 0, 0);
  for (let i = 0; i < 100; i++) {
    metal.strokeStyle = `rgba(190,188,172,${random() * .15})`;
    const x = random() * 512, y = random() * 512;
    metal.beginPath(); metal.moveTo(x, y); metal.lineTo(x + random() * 22, y + random() * 2); metal.stroke();
  }
  weave.width = weave.height = 128;
  const cloth = weave.getContext('2d');
  cloth.fillStyle = '#8a9080'; cloth.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) {
    cloth.fillStyle = i % 4 ? '#737d73' : '#a3a593';
    cloth.fillRect(i, 0, 1, 128); cloth.fillRect(0, i, 128, 1);
  }
  materials.wood = new THREE.MeshStandardMaterial({ map: texture(wood, true), bumpMap: texture(wood), bumpScale: .00012, roughness: .56, metalness: 0 });
  materials.steel = new THREE.MeshStandardMaterial({ map: texture(steel, true), roughness: .42, metalness: .82 });
  materials.edge = new THREE.MeshStandardMaterial({ color: 0x737c80, roughness: .37, metalness: .88 });
  materials.black = new THREE.MeshStandardMaterial({ color: 0x121717, roughness: .8 });
  materials.brass = new THREE.MeshStandardMaterial({ color: 0x9f793f, roughness: .43, metalness: .8 });
  materials.skin = new THREE.MeshStandardMaterial({ color: 0xc59c7c, roughness: .7 });
  materials.nails = new THREE.MeshStandardMaterial({ color: 0xbda18b, roughness: .58 });
  materials.cloth = new THREE.MeshStandardMaterial({ map: texture(weave, true), color: 0x7d8a7e, roughness: .98 });
  materials.cloth.map.repeat.set(6, 8);
  materials.leather = new THREE.MeshStandardMaterial({ color: 0x443124, roughness: .8 });
  await applyRifleTextures(materials, RIFLE_PBR_ASSETS, maxAnisotropy);
  configureLightMachineGunMaterials(materials);
}

export function rifleTextureSnapshot() {
  return Object.fromEntries(['wood', 'steel'].map(name => {
    const material = materials[name];
    return [name, { roughness: material.roughness, metalness: material.metalness,
      textures: Object.fromEntries(['map', 'normalMap', 'roughnessMap', 'metalnessMap'].map(channel => [channel,
        material[channel] ? { url: material[channel].userData.assetUrl || 'generated', colorSpace: material[channel].colorSpace } : null])) }];
  }));
}

function add(parent, geometry, mat, x = 0, y = 0, z = 0, name = '') {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z); mesh.name = name;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function rounded(parent, x, y, z, w, h, d, mat, radius = .002) {
  return add(parent, new RoundedBoxGeometry(w, h, d, 3, radius), mat, x, y, z);
}
function axial(parent, x, y, z, radius, length, mat, name = '', frontRadius = radius) {
  const geometry = new THREE.CylinderGeometry(radius, frontRadius, length, 40, 1);
  geometry.rotateX(Math.PI / 2);
  return add(parent, geometry, mat, x, y, z, name);
}
function hollowRing(parent, z, outer, inner, length, mat) {
  const geometry = new THREE.LatheGeometry([
    new THREE.Vector2(inner, -length / 2), new THREE.Vector2(outer, -length / 2),
    new THREE.Vector2(outer, length / 2), new THREE.Vector2(inner, length / 2),
    new THREE.Vector2(inner, -length / 2),
  ], 48);
  geometry.rotateX(Math.PI / 2);
  return add(parent, geometry, mat, 0, 0, z);
}
function sphere(parent, x, y, z, rx, ry, rz, mat) {
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  geometry.scale(rx, ry, rz);
  return add(parent, geometry, mat, x, y, z);
}
function tube(parent, points, radius, mat, segments = 24) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return add(parent, new THREE.TubeGeometry(path, segments, radius, 10, false), mat);
}
function loft(sections, rings = 97, sides = 32) {
  const positions = [], uv = [], indices = [];
  const channels = [1, 2, 3].map(channel => new THREE.SplineCurve(sections.map(section => new THREE.Vector2(section[0], section[channel]))));
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1), [center, width, height] = channels.map(curve => curve.getPoint(t));
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      positions.push(Math.cos(a) * width.y, center.y + Math.sin(a) * height.y, center.x);
      uv.push(j / sides, t * 2);
      if (i < rings - 1 && j < sides) {
        const p = i * (sides + 1) + j;
        indices.push(p, p + sides + 1, p + 1, p + 1, p + sides + 1, p + sides + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
function batch(parent) {
  parent.updateMatrixWorld(true);
  const batches = new Map();
  for (const object of [...parent.children]) {
    if (!object.isMesh) continue;
    let geometry = object.geometry.clone().applyMatrix4(object.matrix);
    if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded; }
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(geometry);
    parent.remove(object);
    object.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    add(parent, mergeGeometries(geometries), material);
    geometries.forEach(geometry => geometry.dispose());
  }
}

function makeHand(parent, side) {
  const hand = new THREE.Group(); hand.name = `${side}Hand`; parent.add(hand);
  const right = side === 'right';
  const z = right ? -.115 : -.45, x = right ? .043 : -.03, y = -.065;
  sphere(hand, x, y, z, .018, .031, .044, materials.skin);
  for (let i = 0; i < 4; i++) {
    const fz = z - .034 + i * .018;
    const points = right
      ? [[.043, -.048, fz], [.037, -.084, fz], [.005, -.094, fz], [-.015, -.075, fz]]
      : [[-.035, -.064, fz], [-.035, -.027, fz], [-.005, -.013, fz], [.022, -.035, fz]];
    tube(hand, points, .006, materials.skin, 18);
    const tip = points.at(-1);
    sphere(hand, ...tip, .006, .006, .006, materials.skin);
    sphere(hand, tip[0], tip[1] - .001, tip[2] - .004, .0043, .004, .001, materials.nails);
  }
  tube(hand, right ? [[.046, -.043, z + .022], [.033, -.024, z + .034], [.005, -.024, z + .017]] :
    [[-.041, -.063, z + .025], [-.017, -.086, z + .05], [.008, -.071, z + .035]], .008, materials.skin);
  batch(hand);
  return hand;
}

function machineGunHands(model) {
  if (!automaticHands) {
    automaticHands = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xad8062, roughness: .82 });
    for (const side of ['right', 'left']) {
      const hand = new THREE.Group(); hand.name = `${side}Hand`; automaticHands.add(hand);
      if (side === 'right') {
        sphere(hand, .04, -.11, -.061, .017, .031, .024, skin);
        for (let i = 0; i < 3; i++) {
          const y = -.113 - i * .013;
          tube(hand, [[.039, y, -.073], [.033, y, -.096], [.013, y, -.108],
            [-.005, y, -.103], [-.009, y + .006, -.086]], .0058 - i * .0004, skin, 18);
          sphere(hand, .033, y, -.093, .006, .006, .007, skin);
        }
        tube(hand, [[.039, -.087, -.071], [.034, -.082, -.103], [.023, -.087, -.125],
          [.012, -.091, -.128]], .0055, skin, 18);
        tube(hand, [[.041, -.09, -.049], [.026, -.077, -.044], [.004, -.075, -.056],
          [-.006, -.086, -.067]], .007, skin, 18);
        sphere(hand, .042, -.12, -.038, .016, .018, .025, skin);
      } else {
        sphere(hand, -.029, -.101, -.386, .023, .017, .039, skin);
        for (let i = 0; i < 4; i++) {
          const z = -.419 + i * .017;
          tube(hand, [[-.04, -.09, z], [-.035, -.065, z], [-.02, -.046, z],
            [.006, -.046, z], [.025, -.06, z], [.02, -.077, z]], .0055 - i * .0002, skin, 18);
          sphere(hand, -.034, -.066, z, .006, .007, .006, skin);
        }
        tube(hand, [[-.043, -.096, -.357], [-.02, -.116, -.35],
          [.004, -.109, -.361], [.012, -.095, -.378]], .007, skin, 18);
        sphere(hand, -.046, -.106, -.382, .018, .017, .029, skin);
      }
      batch(hand);
    }
  }
  for (const side of ['right', 'left']) {
    model.remove(model.getObjectByName(`${side}Hand`));
    const hand = automaticHands.getObjectByName(`${side}Hand`).clone(true);
    model.add(hand); model.userData.rifle[`${side}Hand`] = hand;
    model.getObjectByName(`${side}Sleeve`).userData.wrist = side === 'right'
      ? [.043, -.12, -.034] : [-.05, -.106, -.38];
  }
}

function buildTemplate(detail = 'near') {
  const root = new THREE.Group();
  const body = new THREE.Group(); body.name = 'rifleBody'; root.add(body);
  const { wood, steel, edge, black, brass, leather } = materials;
  add(body, loft(RIFLE_STOCK_SECTIONS, detail === 'far' ? 17 : 97, detail === 'far' ? 12 : 32), wood);
  sphere(body, 0, -.026, -.73, .018, .019, .003, wood);
  rounded(body, 0, -.095, .216, .053, .14, .008, steel, .003);
  axial(body, 0, 0, -.595, .0084, .59, steel, '', .0145);
  const receiver = new THREE.CylinderGeometry(.019, .019, .2, 48, 1, true, Math.PI * 4 / 3, Math.PI * 4 / 3);
  receiver.rotateX(Math.PI / 2);
  add(body, receiver, steel, 0, 0, -.18);
  axial(body, 0, 0, -.295, .022, .043, steel);
  hollowRing(body, -.075, .018, .014, .026, steel);
  rounded(body, -.018, -.001, -.18, .005, .015, .19, edge, .001);
  rounded(body, 0, -.081, -.2, .05, .007, .155, steel);
  rounded(body, 0, -.087, -.18, .041, .006, .11, steel);
  tube(body, [[0,-.077,-.16], [0,-.112,-.158], [0,-.123,-.1], [0,-.096,-.073], [0,-.067,-.077]], .0035, steel, 32);
  tube(body, [[0,-.075,-.125], [0,-.091,-.13], [0,-.101,-.121]], .002, steel);
  for (const z of [-.475, -.705]) {
    const band = add(body, new THREE.TorusGeometry(.025, .0038, 12, 48), steel, 0, -.02, z);
    band.scale.set(.92, 1.55, 2);
    const rim = add(body, new THREE.TorusGeometry(.025, .0008, 8, 48), edge, 0, -.02, z - .007);
    rim.scale.set(.92, 1.55, 1);
  }
  axial(body, 0, -.06, -.77, .0025, .22, edge);
  axial(body, 0, -.034, -.759, .009, .055, steel);
  const sight = new THREE.Shape();
  sight.moveTo(-.012, .022); sight.lineTo(.012, .022); sight.lineTo(.012, .055);
  sight.lineTo(.004, .055); sight.lineTo(0, .05); sight.lineTo(-.004, .055); sight.lineTo(-.012, .055); sight.closePath();
  add(body, new THREE.ExtrudeGeometry(sight, { depth: .008, bevelEnabled: true, bevelThickness: .0003, bevelSize: .0003, bevelSegments: 2 }), steel, 0, 0, -.36);
  rounded(body, 0, .017, -.385, .024, .008, .11, steel, .001);
  for (let i = 0; i < 6; i++) rounded(body, .009, .023, -.36 - i * .014, .003, .001, .0015, edge, .0002);
  rounded(body, 0, .015, -.855, .016, .018, .025, steel, .001);
  const post = new THREE.Shape();
  post.moveTo(-.004, .018); post.lineTo(.004, .018); post.lineTo(.0009, .05); post.lineTo(-.0009, .05); post.closePath();
  add(body, new THREE.ExtrudeGeometry(post, { depth: .003, bevelEnabled: false }), steel, 0, 0, -.857);
  axial(body, 0, 0, -.8895, .0085, .001, edge);
  axial(body, 0, 0, -.8901, .004, .001, black);
  for (const z of [-.11, -.25]) {
    const screw = axial(body, 0, -.087, z, .004, .002, edge);
    screw.rotation.x = Math.PI / 2;
    rounded(body, 0, -.089, z, .005, .001, .0007, black, .0002);
  }
  tube(body, [[-.021,-.084,.16], [-.033,-.097,.08], [-.04,-.105,-.25], [-.035,-.067,-.67]], .005, leather, 48);
  const bolt = new THREE.Group(); bolt.name = 'bolt'; root.add(bolt);
  axial(bolt, 0, 0, -.173, .0125, .195, edge);
  const handle = axial(bolt, .045, .001, -.086, .0045, .074, steel);
  handle.rotation.y = Math.PI / 2;
  sphere(bolt, .082, .001, -.086, .012, .012, .012, steel);
  rounded(bolt, 0, .02, -.075, .006, .027, .015, steel, .002);
  batch(body);
  const bodyBounds = new THREE.Box3().setFromObject(body);
  root.userData.dimensions = { length: bodyBounds.max.z - bodyBounds.min.z, referenceLength: RIFLE.length };
  batch(bolt);
  const clip = new THREE.Group(); clip.name = 'clip'; root.add(clip);
  rounded(clip, 0, .102, -.18, .058, .006, .009, steel, .001).name = 'charger';
  for (let i = 0; i < 5; i++) {
    const cartridge = new THREE.Group(); cartridge.name = `cartridge${i}`; clip.add(cartridge);
    const round = axial(cartridge, 0, .073, -.18, .0046, .043, brass);
    round.rotation.x = Math.PI / 2;
    const tip = add(cartridge, new THREE.ConeGeometry(.0042, .013, 20), brass, 0, .045, -.18);
    tip.rotation.x = Math.PI;
    batch(cartridge);
  }
  makeHand(root, 'right'); makeHand(root, 'left');
  const sleeveGeometry = new THREE.LatheGeometry([
    [0,0], [.055,0], [.057,.08], [.055,.2], [.058,.28], [.052,.45], [.047,.62], [.04,.78], [.033,.92], [.031,1], [0,1],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  sleeveGeometry.scale(1, 1, .9);
  const upperGeometry = new THREE.LatheGeometry([
    [0,0], [.075,0], [.079,.12], [.073,.4], [.068,.65], [.057,.9], [.055,1], [0,1],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  upperGeometry.scale(1, 1, .92);
  for (const [side, x, z] of [['right', .04, -.085], ['left', -.055, -.405]]) {
    const sleeve = add(root, sleeveGeometry, materials.cloth, 0, 0, 0, `${side}Sleeve`);
    sleeve.userData.wrist = [x, -.09, z];
    add(root, upperGeometry, materials.cloth, 0, 0, 0, `${side}UpperArm`);
    sphere(root, 0, 0, 0, .057, .054, .055, materials.cloth).name = `${side}Elbow`;
    add(root, new THREE.TorusGeometry(.031, .005, 12, 32), materials.cloth, x, -.09, z, `${side}Cuff`);
  }
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0, -.891); root.add(muzzle);
  const rearSight = new THREE.Object3D(); rearSight.name = 'rearSight'; rearSight.position.set(0, RIFLE.sightHeight, -.36); root.add(rearSight);
  const frontSight = new THREE.Object3D(); frontSight.name = 'frontSight'; frontSight.position.set(0, RIFLE.sightHeight, -.857); root.add(frontSight);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffe1a3, transparent: true, opacity: .8, depthWrite: false });
  flashMaterial.blending = THREE.AdditiveBlending;
  const flash = add(root, new THREE.ConeGeometry(.026, .1, 12), flashMaterial, 0, 0, -.936, 'flash');
  flash.rotation.x = -Math.PI / 2;
  const casing = axial(root, 0, 0, 0, .0046, .05, brass, 'casing');
  casing.visible = flash.visible = false;
  return root;
}

function scopeModel(detail = 'near') {
  if (!scopeTemplates.has(detail)) {
    const scope = new THREE.Group();
    scope.name = 'sniper-scope';
    const sides = detail === 'far' ? 8 : 24;
    for (const [z, radius, length] of [[-.36, .016, .24], [-.225, .023, .05], [-.505, .025, .05]]) {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, sides);
      geometry.rotateX(Math.PI / 2);
      add(scope, geometry, materials.steel, 0, RIFLE.sightHeight, z);
    }
    for (const z of [-.29, -.43]) {
      rounded(scope, 0, .027, z, .03, .025, .025, materials.steel);
      const ring = add(scope, new THREE.TorusGeometry(.018, .003, 6, sides), materials.edge, 0, RIFLE.sightHeight, z);
      ring.name = 'scope-mount';
    }
    axial(scope, 0, RIFLE.sightHeight, -.199, .020, .002, materials.black);
    axial(scope, 0, RIFLE.sightHeight, -.531, .022, .002, materials.black);
    if (detail === 'near') {
      add(scope, new THREE.CylinderGeometry(.013, .013, .018, 16), materials.edge, 0, .073, -.35);
      const dial = add(scope, new THREE.CylinderGeometry(.011, .011, .018, 16), materials.edge, .024, .05, -.35);
      dial.rotation.z = Math.PI / 2;
    }
    batch(scope);
    scopeTemplates.set(detail, scope);
  }
  return scopeTemplates.get(detail).clone(true);
}

export function rifleModel(weaponState = null) {
  if (!template) template = buildTemplate();
  const model = template.clone(true);
  model.userData.rifle = {
    bolt: model.getObjectByName('bolt'), clip: model.getObjectByName('clip'),
    rightHand: model.getObjectByName('rightHand'), leftHand: model.getObjectByName('leftHand'),
    muzzle: model.getObjectByName('muzzle'), rearSight: model.getObjectByName('rearSight'), frontSight: model.getObjectByName('frontSight'),
    flash: model.getObjectByName('flash'), casing: model.getObjectByName('casing'),
  };
  if (infantryWeaponProfile(weaponState).scoped) model.add(scopeModel());
  if (infantryWeaponProfile(weaponState).automatic) {
    model.getObjectByName('rifleBody').visible = false;
    model.getObjectByName('bolt').visible = false;
    model.add(lightMachineGunModel(weaponState.model));
    machineGunHands(model);
    model.userData.rifle.muzzle.position.z = infantryWeaponProfile(weaponState).muzzleZ;
    model.userData.rifle.muzzle.position.x = infantryWeaponProfile(weaponState).muzzleX;
    model.userData.rifle.frontSight.position.z = infantryWeaponProfile(weaponState).muzzleZ + .045;
    model.userData.rifle.rearSight.position.z = -.08;
    model.userData.rifle.flash.position.z = infantryWeaponProfile(weaponState).muzzleZ - .045;
    model.userData.rifle.flash.position.x = infantryWeaponProfile(weaponState).muzzleX;
    model.userData.dimensions = { length: infantryWeaponProfile(weaponState).length };
  }
  return model;
}

function bayonetModel() {
  if (!bayonetTemplate) {
    bayonetTemplate = new THREE.Group(); bayonetTemplate.name = 'fixed-bayonet';
    const steel = materials.edge ?? new THREE.MeshStandardMaterial({ color: 0x92999b, metalness: .8, roughness: .38 });
    const dark = materials.steel ?? new THREE.MeshStandardMaterial({ color: 0x454947, metalness: .7, roughness: .55 });
    const blade = new THREE.BufferGeometry();
    const base = [[-.014, -.045, -.95], [0, -.041, -.95], [.014, -.045, -.95], [0, -.049, -.95]];
    const tip = [0, -.045, -1.35], vertices = [];
    for (let i = 0; i < 4; i++) vertices.push(...base[i], ...base[(i + 1) % 4], ...tip);
    vertices.push(...base[0], ...base[3], ...base[2], ...base[0], ...base[2], ...base[1]);
    blade.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const uv = [];
    for (let i = 0; i < vertices.length; i += 3) uv.push(vertices[i] / .028 + .5, (-vertices[i + 2] - .95) / .4);
    blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); blade.computeVertexNormals();
    add(bayonetTemplate, blade, steel, 0, 0, 0, 'bayonet-blade');
    add(bayonetTemplate, new THREE.BoxGeometry(.025, .026, .13), dark, 0, -.045, -.855);
    add(bayonetTemplate, new THREE.BoxGeometry(.06, .065, .012), dark, 0, -.023, -.93);
    batch(bayonetTemplate);
  }
  return bayonetTemplate.clone(true);
}

export function rifleWorldModel(detail = 'near', weaponState = null, { bayonet = false } = {}) {
  if (!template) template = buildTemplate();
  if (detail === 'far' && !distantTemplate) distantTemplate = buildTemplate('far');
  const source = detail === 'far' ? distantTemplate : template;
  const model = new THREE.Group();
  model.add(source.getObjectByName('rifleBody').clone(true), source.getObjectByName('bolt').clone(true));
  model.userData.referenceLength = RIFLE.length;
  model.userData.personalWeapon = true;
  model.userData.detail = detail;
  model.userData.bayonetEquipped = bayonet;
  if (bayonet) model.add(bayonetModel());
  if (weaponState) syncWorldWeapon(model, weaponState);
  return model;
}

export function syncWorldWeapon(model, state) {
  const profile = infantryWeaponProfile(state);
  const key = state.model ?? 'rifle';
  const bayonet = model.getObjectByName('fixed-bayonet');
  if (bayonet) bayonet.visible = key === 'rifle';
  if (model.userData.weaponModel !== key) {
    model.getObjectByName('rifleBody').visible = !profile.automatic;
    model.getObjectByName('bolt').visible = !profile.automatic;
    const previous = model.getObjectByName('light-machine-gun');
    if (previous) model.remove(previous);
    const previousScope = model.getObjectByName('sniper-scope');
    if (previousScope) model.remove(previousScope);
    if (profile.automatic) {
      const gun = lightMachineGunModel(key, model.userData.detail ?? 'near'); gun.name = 'light-machine-gun'; model.add(gun);
    }
    if (profile.scoped) model.add(scopeModel(model.userData.detail ?? 'near'));
    model.userData.weaponModel = key;
  }
  const pose = riflePose(state), bolt = model.getObjectByName('bolt');
  if (bolt) { bolt.rotation.z = pose.boltLift; bolt.position.z = pose.boltTravel; }
  const feed = model.getObjectByName('feed');
  if (feed) feed.position.y = pose.lower * .07;
  const muzzle = model.getObjectByName('owned-muzzle');
  if (muzzle) muzzle.position.set(profile.muzzleX ?? 0, 0, profile.muzzleZ);
}

export function updateRifleModel(model, state) {
  const pose = riflePose(state), parts = model.userData.rifle;
  if (infantryWeaponProfile(state).automatic) {
    parts.clip.visible = false;
    parts.flash.visible = state.action === 'cycle' && state.elapsed < .045;
    parts.casing.visible = false;
    model.getObjectByName('feed').position.y = pose.lower * .18;
    parts.rightHand.position.set(0, 0, 0);
    parts.leftHand.position.set(0, -pose.lower * .06, pose.lower * .08);
    return pose;
  }
  parts.bolt.rotation.z = pose.boltLift;
  parts.bolt.position.z = pose.boltTravel;
  parts.clip.visible = pose.clipVisible;
  parts.clip.position.y = -.055 * pose.cartridgePush;
  const missing = RIFLE.magazine - state.ammo;
  const loose = Boolean(infantryWeaponProfile(state).scoped) || state.ammo > 0;
  parts.clip.getObjectByName('charger').visible = !loose;
  const looseFeed = Math.max(0, (state.elapsed - .7) / 1.2) * missing;
  if (loose) parts.clip.position.y = -.055 * (looseFeed % 1);
  for (let i = 0; i < RIFLE.magazine; i++) {
    const cartridge = parts.clip.getObjectByName(`cartridge${i}`);
    cartridge.visible = !loose || (i === Math.min(missing - 1, Math.floor(looseFeed)));
    cartridge.position.x = !loose ? -.022 + i * .011 : 0;
  }
  parts.flash.visible = state.action === 'cycle' && state.elapsed < .045;
  const ejection = (state.elapsed - .3) / .35;
  parts.casing.visible = state.action === 'cycle' && ejection >= 0 && ejection < 1;
  parts.casing.position.set(.025 + ejection * .3, .015 + Math.sin(ejection * Math.PI) * .12, -.16 + ejection * .14);
  parts.casing.rotation.set(ejection * 8, ejection * 6, ejection * 10);
  parts.rightHand.position.set(pose.hand * (.035 - pose.loading * .06), pose.hand * .07 + pose.loading * .08, pose.boltTravel - pose.loading * .06);
  parts.rightHand.rotation.z = -pose.hand * .25;
  parts.leftHand.position.set(0, 0, 0);
  return pose;
}

export function updateRifleArms(model) {
  const parts = model.userData.rifle;
  model.updateMatrix();
  const inverse = model.matrix.clone().invert();
  const segment = (mesh, start, end) => {
    mesh.position.copy(start);
    mesh.scale.y = start.distanceTo(end);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  };
  const measurements = {};
  for (const side of ['right', 'left']) {
    const sleeve = model.getObjectByName(`${side}Sleeve`), hand = parts[`${side}Hand`];
    hand.updateMatrix();
    const wrist = new THREE.Vector3(...sleeve.userData.wrist).applyMatrix4(hand.matrix);
    const shoulder = new THREE.Vector3(side === 'right' ? .23 : -.23, -.3, .04).applyMatrix4(inverse);
    const direction = wrist.clone().sub(shoulder).normalize();
    const distance = Math.min(.689, Math.max(.02, wrist.distanceTo(shoulder)));
    const along = (.35 ** 2 - .34 ** 2 + distance ** 2) / (2 * distance);
    const bend = new THREE.Vector3(side === 'right' ? .7 : -.7, -1, .15).transformDirection(inverse);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, .35 ** 2 - along ** 2)));
    segment(model.getObjectByName(`${side}UpperArm`), shoulder, elbow);
    segment(sleeve, elbow, wrist);
    model.getObjectByName(`${side}Elbow`).position.copy(elbow);
    const cuff = model.getObjectByName(`${side}Cuff`);
    cuff.position.copy(wrist); cuff.quaternion.copy(sleeve.quaternion);
    cuff.rotateX(Math.PI / 2);
    measurements[side] = { upper: shoulder.distanceTo(elbow), forearm: elbow.distanceTo(wrist) };
  }
  model.userData.armLengths = measurements;
}
