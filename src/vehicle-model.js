import * as THREE from 'three';
import { TANK_GUN_MOUNT } from './player-tank.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

export const VEHICLE_PROFILES = Object.freeze({
  tank: Object.freeze({ model: 'vickers-e-b', name: '维克斯六吨坦克B型', length: 4.88, width: 2.41, height: 2.16 }),
  plane: Object.freeze({ model: 'i-15bis', name: '伊-15bis', length: 6.28, span: 10.2 }),
});
export const JAPANESE_AIRCRAFT_PROFILE = Object.freeze({ model: 'ki-10', name: '九五式战斗机 · Ki-10',
  length: 7.2, span: 9.55, source: 'https://en.wikipedia.org/wiki/Kawasaki_Ki-10' });

const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(1, 20, 12);
const rivet = new THREE.SphereGeometry(1, 8, 4);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 24);
const disk = new THREE.CircleGeometry(1, 32);
const paint = color => new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: .18 });
const materials = {
  olive: paint(0x535b36), edge: paint(0x727653), canvas: paint(0x626943),
  underside: paint(0x9caead), steel: paint(0x41463f), rubber: paint(0x252822),
  dark: paint(0x171d1a), leather: paint(0x503b28),
  blue: paint(0x183e80), white: paint(0xe4e4d3), red: paint(0xa52c24),
  glass: new THREE.MeshStandardMaterial({ color: 0xb1d1cb, roughness: .18, metalness: .05,
    transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide }),
};
const templates = new Map();
const decalTessellation = new TessellateModifier(.12, 6);

function mesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position); object.scale.set(...scale);
  object.castShadow = object.receiveShadow = material !== materials.glass;
  parent.add(object);
  return object;
}
const block = (parent, material, position, scale) => mesh(parent, box, material, position, scale);
const oval = (parent, material, position, scale) => mesh(parent, sphere, material, position, scale);
function tube(parent, material, from, to, radius) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
  const object = mesh(parent, cylinder, material, a.clone().add(b).multiplyScalar(.5).toArray(), [radius, delta.length(), radius]);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return object;
}
function wheel(parent, x, y, z, radius, width, material = materials.rubber) {
  const object = mesh(parent, cylinder, material, [x, y, z], [radius, width, radius]);
  object.rotation.z = Math.PI / 2;
  return object;
}
function rivets(parent, from, to, count) {
  for (let i = 0; i < count; i++) {
    const point = from.map((value, axis) => THREE.MathUtils.lerp(value, to[axis], i / (count - 1)));
    mesh(parent, rivet, materials.edge, point, [.018, .018, .018]);
  }
}
function roundel(parent, position, rotation, radius, surface = null) {
  const group = new THREE.Group();
  group.position.set(...position); group.rotation.set(...rotation); parent.add(group);
  mesh(group, disk, materials.blue, [0, 0, 0], [radius, radius, 1]);
  const rays = new THREE.Shape();
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12, r = radius * (i % 2 ? .4 : .8);
    if (!i) rays.moveTo(Math.sin(angle) * r, Math.cos(angle) * r);
    else rays.lineTo(Math.sin(angle) * r, Math.cos(angle) * r);
  }
  rays.closePath();
  const geometry = new THREE.ShapeGeometry(rays);
  mesh(group, geometry, materials.white, [0, 0, .002]);
  mesh(group, disk, materials.blue, [0, 0, .003], [radius * .43, radius * .43, 1]);
  mesh(group, disk, materials.white, [0, 0, .004], [radius * .34, radius * .34, 1]);
  if (surface) {
    group.updateMatrixWorld(true);
    for (const object of group.children) {
      const original = object.geometry;
      const worldGeometry = original.clone().applyMatrix4(object.matrixWorld);
      object.geometry = decalTessellation.modify(worldGeometry);
      worldGeometry.dispose();
      const vertices = object.geometry.attributes.position, inverse = object.matrixWorld.clone().invert();
      const point = new THREE.Vector3(), offset = rotation[0] < 0 ? .002 : -.002;
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i);
        point.y = surface(point.x, point.z) + point.y - position[1] + offset;
        point.applyMatrix4(inverse);
        vertices.setXYZ(i, point.x, point.y, point.z);
      }
      object.geometry.computeVertexNormals();
      if (original !== disk) original.dispose();
    }
  }
}

// Batch rigid components by material; clones share buffers, not moving pivots.
function batch(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map(), temporary = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    geometry.deleteAttribute('uv');
    const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
    if (expanded !== geometry) geometry.dispose();
    if (!buckets.has(object.material)) buckets.set(object.material, []);
    buckets.get(object.material).push(expanded);
    if (![box, sphere, rivet, cylinder, disk].includes(object.geometry)) temporary.add(object.geometry);
  });
  group.clear();
  for (const [material, geometries] of buckets) {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error('Vehicle geometry could not be merged');
    mesh(group, geometry, material);
    geometries.forEach(item => item.dispose());
  }
  temporary.forEach(geometry => geometry.dispose());
  return group;
}

function track(parent, side) {
  const x = side * 1.025, radius = .48, half = 1.9, centerY = .54;
  const shape = new THREE.Shape();
  shape.absarc(-half, centerY, radius, Math.PI / 2, Math.PI * 1.5, false);
  shape.absarc(half, centerY, radius, -Math.PI / 2, Math.PI / 2, false);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(half, centerY, radius - .075, Math.PI / 2, -Math.PI / 2, true);
  hole.absarc(-half, centerY, radius - .075, -Math.PI / 2, -Math.PI * 1.5, true);
  hole.closePath();
  shape.holes.push(hole);
  const belt = new THREE.ExtrudeGeometry(shape, { depth: .3, bevelEnabled: false, curveSegments: 12 });
  const beltMesh = mesh(parent, belt, materials.dark, [x - .15, 0, 0]);
  beltMesh.rotation.y = Math.PI / 2;
  const straight = half * 2, circumference = straight * 2 + Math.PI * radius * 2;
  for (let i = 0; i < 80; i++) {
    let distance = i * circumference / 80, z, y, angle;
    if (distance < straight) { z = -half + distance; y = centerY + radius; angle = 0; }
    else if ((distance -= straight) < Math.PI * radius) {
      angle = distance / radius; z = half + Math.sin(angle) * radius; y = centerY + Math.cos(angle) * radius;
    } else if ((distance -= Math.PI * radius) < straight) {
      z = half - distance; y = centerY - radius; angle = Math.PI;
    } else {
      angle = Math.PI + (distance - straight) / radius;
      z = -half + Math.sin(angle) * radius; y = centerY + Math.cos(angle) * radius;
    }
    const shoe = block(parent, materials.steel, [x, y, z], [.32, .055, .115]);
    shoe.rotation.x = angle;
  }
  for (const z of [-1.94, 1.94]) {
    wheel(parent, x, centerY, z, .39, .21, materials.olive);
    wheel(parent, x + side * .13, centerY, z, .13, .045, materials.edge);
  }
  for (const bogie of [-.88, .88]) {
    for (const offset of [-.51, -.17, .17, .51]) {
      const z = bogie + offset;
      wheel(parent, x, .31, z, .205, .23);
      wheel(parent, x + side * .13, .31, z, .14, .035, materials.olive);
      wheel(parent, x + side * .155, .31, z, .045, .045, materials.edge);
    }
    tube(parent, materials.olive, [x + side * .08, .65, bogie], [x + side * .08, .32, bogie - .34], .055);
    tube(parent, materials.olive, [x + side * .08, .65, bogie], [x + side * .08, .32, bogie + .34], .055);
    for (let spring = 0; spring < 3; spring++)
      block(parent, materials.steel, [x + side * .12, .68 + spring * .025, bogie], [.07, .018, .66 - spring * .1]);
  }
  for (const z of [-1.25, 0, 1.25]) wheel(parent, x, .86, z, .11, .23, materials.olive);
}

function tankTemplate() {
  const hull = new THREE.Group(), turret = new THREE.Group(), gun = new THREE.Group();
  for (const side of [-1, 1]) track(hull, side);
  block(hull, materials.olive, [0, .88, 0], [1.73, .67, 4.25]);
  block(hull, materials.olive, [0, 1.22, -.35], [1.68, .47, 2.5]);
  block(hull, materials.olive, [0, 1.18, 1.36], [1.7, .15, 1.34]);
  const glacis = block(hull, materials.olive, [0, 1.02, -2.04], [1.72, .12, .65]);
  glacis.rotation.x = -.52;
  for (const side of [-1, 1]) {
    block(hull, materials.edge, [side * 1.03, 1.075, 0], [.35, .065, 4.76]);
    block(hull, materials.olive, [side * 1.04, 1.16, 1.15], [.28, .17, 1.2]);
    rivets(hull, [side * .87, .93, -1.85], [side * .87, .93, 1.85], 18);
    rivets(hull, [side * .85, 1.37, -1.5], [side * .85, 1.37, .82], 12);
    tube(hull, materials.steel, [side * .62, .68, 2.14], [side * .62, .68, 2.3], .07);
  }
  block(hull, materials.olive, [.43, 1.48, -1.12], [.65, .09, .66]);
  block(hull, materials.dark, [.43, 1.34, -1.61], [.35, .055, .018]);
  block(hull, materials.edge, [.43, 1.4, -1.63], [.43, .04, .035]);
  for (let i = 0; i < 12; i++)
    block(hull, materials.dark, [0, 1.263, .92 + i * .075], [1.13, .018, .035]);
  tube(hull, materials.steel, [-.62, 1.16, 2.12], [.62, 1.16, 2.12], .12);
  tube(hull, materials.steel, [.62, 1.16, 2.12], [.84, 1.17, 2.26], .06);
  for (const x of [-.63, .63]) {
    tube(hull, materials.edge, [x, 1.14, -2.01], [x, 1.31, -2.01], .025);
    oval(hull, materials.steel, [x, 1.32, -2.01], [.1, .1, .075]);
    mesh(hull, disk, materials.white, [x, 1.32, -2.087], [.065, .065, 1]).rotation.y = Math.PI;
  }
  mesh(turret, cylinder, materials.steel, [0, .035, 0], [.66, .07, .66]);
  mesh(turret, cylinder, materials.olive, [0, .37, 0], [.64, .67, .64]);
  mesh(turret, cylinder, materials.edge, [0, .72, 0], [.645, .045, .645]);
  mesh(turret, cylinder, materials.olive, [0, .76, .07], [.3, .035, .28]);
  tube(turret, materials.steel, [-.12, .79, .07], [.12, .79, .07], .02);
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    for (const y of [.12, .65])
      mesh(turret, rivet, materials.edge, [Math.sin(angle) * .644, y, Math.cos(angle) * .644], [.017, .017, .017]);
  }
  roundel(turret, [-.648, .4, .02], [0, -Math.PI / 2, 0], .2);
  roundel(turret, [.648, .4, .02], [0, Math.PI / 2, 0], .2);
  block(gun, materials.olive, [0, 0, 0], [.48, .35, .2]);
  tube(gun, materials.steel, [-.08, 0, -.05], [-.08, 0, -.42], .09);
  tube(gun, materials.steel, [-.08, 0, -.4], [-.08, 0, -1.12], .047);
  mesh(gun, disk, materials.dark, [-.08, 0, -1.122], [.027, .027, 1]).rotation.y = Math.PI;
  tube(gun, materials.steel, [TANK_GUN_MOUNT.coax[0], TANK_GUN_MOUNT.coax[1], -.08], TANK_GUN_MOUNT.coax, .025);
  batch(hull); batch(turret); batch(gun);
  turret.name = 'turret'; turret.position.fromArray(TANK_GUN_MOUNT.turret);
  gun.name = 'gun'; gun.position.fromArray(TANK_GUN_MOUNT.pivot);
  const coax = new THREE.Object3D(); coax.name = 'coax-muzzle'; coax.position.fromArray(TANK_GUN_MOUNT.coax); gun.add(coax);
  const cannon = new THREE.Object3D(); cannon.name = 'cannon-muzzle'; cannon.position.fromArray(TANK_GUN_MOUNT.cannon); gun.add(cannon);
  const sight = new THREE.Object3D(); sight.name = 'gunner-sight'; sight.position.fromArray(TANK_GUN_MOUNT.sight); gun.add(sight);
  turret.add(gun); hull.add(turret);
  return hull;
}

function loft(stations, segments = 32, cockpit = false) {
  const positions = [], indices = [];
  for (const [z, y, rx, ry] of stations) {
    for (let i = 0; i <= segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      positions.push(Math.sin(angle) * rx, y + Math.cos(angle) * ry, z);
    }
  }
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < segments; i++) {
    if (cockpit && stations[j][0] >= -.05 && stations[j + 1][0] <= .9 && (i / segments < 5 / 32 || i / segments >= 27 / 32)) continue;
    const a = j * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function wingTaper(fraction) {
  const tip = Math.abs(fraction);
  return (1 - .12 * tip) * Math.sqrt(Math.max(.0004, 1 - Math.pow(tip, 16)));
}
function wingSurface(x, z, span, chord, y, centerZ, upper) {
  const fraction = x / (span / 2), taper = wingTaper(fraction);
  const along = THREE.MathUtils.clamp((z - centerZ - Math.abs(fraction) * .13) / (chord * taper) + .5, 0, 1);
  const angle = Math.acos(1 - 2 * along), camber = Math.sin(along * Math.PI) * .035;
  return y + ((upper ? 1 : -1) * Math.sin(angle) * .055 + camber) * taper;
}
function wing(parent, span, chord, y, z, material = wingMaterial) {
  const points = [], indices = [], colors = [], color = new THREE.Color();
  const sections = 32, samples = 24;
  for (let s = 0; s <= sections; s++) {
    const fraction = s / sections * 2 - 1, tip = Math.abs(fraction);
    const taper = wingTaper(fraction);
    for (let i = 0; i <= samples; i++) {
      const angle = i / samples * Math.PI * 2, along = (1 - Math.cos(angle)) / 2;
      const camber = Math.sin(along * Math.PI) * .035;
      points.push(fraction * span / 2, y + (Math.sin(angle) * .055 + camber) * taper,
        z + (along - .5) * chord * taper + tip * .13);
      color.copy(Math.sin(angle) >= 0 ? materials.canvas.color : materials.underside.color);
      color.multiplyScalar(s % 2 ? 1 : .96); colors.push(color.r, color.g, color.b);
    }
  }
  for (let s = 0; s < sections; s++) for (let i = 0; i < samples; i++) {
    const a = s * (samples + 1) + i, b = a + samples + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  if (material.vertexColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  mesh(parent, geometry, material);
}
const wingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: .02 });

function planeTemplate() {
  const body = new THREE.Group(), propeller = new THREE.Group();
  mesh(body, loft([[-2.65, 0, .01, .01], [-2.6, 0, .62, .62], [-1.85, 0, .64, .64],
    [-1.3, .02, .48, .5], [-.6, .02, .4, .48], [-.05, .02, .36, .44],
    [.4, .02, .32, .4], [.9, .06, .27, .33], [1.7, .12, .19, .24],
    [2.6, .17, .09, .12], [3.1, .18, .015, .03]], 48, true), materials.olive);
  const cowling = new THREE.TorusGeometry(.61, .045, 8, 40);
  mesh(body, cowling, materials.edge, [0, 0, -2.59]);
  mesh(body, disk, materials.dark, [0, 0, -2.6], [.57, .57, 1]).rotation.y = Math.PI;
  for (let i = 0; i < 9; i++) {
    const angle = i * Math.PI * 2 / 9;
    const from = new THREE.Vector3(Math.sin(angle) * .18, Math.cos(angle) * .18, -2.63);
    const to = new THREE.Vector3(Math.sin(angle) * .48, Math.cos(angle) * .48, -2.63);
    const profile = [new THREE.Vector2(.72, -.5), new THREE.Vector2(1, -.4), new THREE.Vector2(.75, -.3),
      new THREE.Vector2(1, -.2), new THREE.Vector2(.75, -.1), new THREE.Vector2(1, 0),
      new THREE.Vector2(.75, .1), new THREE.Vector2(1, .2), new THREE.Vector2(.65, .5)];
    const cylinder = mesh(body, new THREE.LatheGeometry(profile, 8), materials.steel,
      from.clone().add(to).multiplyScalar(.5).toArray(), [.075, to.distanceTo(from), .075]);
    cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++)
      block(body, materials.dark, [side * (.595 - i * .013), 0, -2.37 + i * .11], [.022, .32, .045]);
    tube(body, materials.steel, [side * .49, -.28, -1.97], [side * .62, -.51, -1.7], .045);
    for (const y of [.17, -.17]) tube(body, materials.steel, [side * .42, y, -2.62], [side * .42, y, -2.77], .024);
  }
  wing(body, 10.2, 1.5, 1.05, -.94);
  wing(body, 7.5, 1.42, -.47, -.5);
  for (const [span, chord, y, centerZ] of [[10.2, 1.5, 1.05, -.94], [7.5, 1.42, -.47, -.5]]) {
    for (let x = -span / 2 + .4; x < span / 2 - .3; x += .34) {
      const taper = wingTaper(x / (span / 2));
      const fromZ = centerZ - chord * taper * .38, toZ = centerZ + chord * taper * .38;
      tube(body, materials.edge, [x, wingSurface(x, fromZ, span, chord, y, centerZ, true) + .003, fromZ],
        [x, wingSurface(x, toZ, span, chord, y, centerZ, true) + .003, toZ], .0035);
    }
    for (const side of [-1, 1]) {
      const x = side * span * .35, z = centerZ + chord * .29;
      tube(body, materials.steel, [side * span * .23, y + .035, z], [side * span * .43, y + .035, z], .007);
      for (const hinge of [.25, .35, .42]) block(body, materials.steel, [side * span * hinge, y + .04, z], [.035, .025, .07]);
    }
  }
  for (const side of [-1, 1]) {
    for (const z of [-1.43, -.35]) {
      tube(body, materials.edge, [side * 2.95, -.45, z + .37], [side * 3.04, 1.04, z], .034);
      tube(body, materials.steel, [side * .34, .25, z + .22], [side * .8, 1.02, z], .026);
    }
    tube(body, materials.steel, [side * .75, -.43, -.98], [side * 3.04, 1.02, -.35], .007);
    tube(body, materials.steel, [side * .8, 1.02, -1.42], [side * 2.95, -.43, .02], .007);
    tube(body, materials.olive, [side * .4, -.35, -1.25], [side * .94, -1.3, -1.05], .055);
    tube(body, materials.olive, [side * .36, -.35, -.15], [side * .94, -1.3, -1.05], .045);
    wheel(body, side * .97, -1.31, -1.05, .32, .19);
    wheel(body, side * 1.08, -1.31, -1.05, .17, .035, materials.edge);
    roundel(body, [side * 3.85, 1.05, -.85], [-Math.PI / 2, 0, 0], .48,
      (x, z) => wingSurface(x, z, 10.2, 1.5, 1.05, -.94, true));
    roundel(body, [side * 2.78, -.47, -.48], [Math.PI / 2, 0, 0], .39,
      (x, z) => wingSurface(x, z, 7.5, 1.42, -.47, -.5, false));
    tube(body, materials.leather, [side * .245, .32, -.05], [side * .22, .34, .85], .034);
  }
  oval(body, materials.dark, [0, .05, .4], [.27, .22, .48]);
  block(body, materials.leather, [0, .22, .73], [.38, .32, .08]);
  tube(body, materials.leather, [-.18, .34, .69], [.16, .04, .48], .018);
  tube(body, materials.leather, [.18, .34, .69], [-.16, .04, .48], .018);
  block(body, materials.dark, [0, .16, .58], [.035, .32, .035]);
  tube(body, materials.steel, [-.19, -.05, .24], [.19, -.05, .24], .012);
  for (const side of [-1, 1]) {
    tube(body, materials.steel, [side * .045, -.02, 1], [side * 1.1, .18, 2.44], .005);
    for (let rivetIndex = 0; rivetIndex < 10; rivetIndex++) mesh(body, rivet, materials.edge,
      [side * .42, .05, -1.5 + rivetIndex * .12], [.009, .009, .009]);
  }
  const windscreen = mesh(body, new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.glass, [0, .42, -.1], [.28, .28, .23]);
  windscreen.rotation.x = -Math.PI / 5;
  oval(body, materials.olive, [0, .18, 2.42], [1.51, .055, .6]);
  oval(body, materials.olive, [0, .65, 2.47], [.045, .76, .56]);
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1])
      block(body, i % 2 ? materials.white : materials.blue, [side * .047, .35 + i * .18, 2.68],
        [.009, .15, .37 - Math.abs(i - 2) * .04]);
  }
  tube(body, materials.steel, [0, -.02, 2.56], [0, -.46, 2.8], .025);
  tube(body, materials.steel, [0, -.46, 2.8], [0, -.48, 3.02], .027);
  for (const side of [-1, 1]) {
    const blade = oval(propeller, materials.steel, [side * .64, 0, 0], [.66, .09, .035]);
    blade.rotation.z = side * .06;
    oval(propeller, materials.edge, [side * 1.2, side * .03, -.01], [.09, .085, .038]);
  }
  oval(propeller, materials.steel, [0, 0, -.08], [.18, .18, .15]);
  batch(body); batch(propeller);
  propeller.name = 'propeller'; propeller.position.z = -3.03; body.add(propeller);
  body.userData.details = { wingRibs: true, aileronHinges: true, bracingWires: true, cockpitHarness: true,
    engine: 'radial', engineCoolingFins: 9, fuselageSections: 48 };
  return body;
}

function japanesePlaneTemplate() {
  const body = new THREE.Group(), propeller = new THREE.Group();
  mesh(body, loft([[-3.55, 0, .01, .01], [-3.35, 0, .3, .36], [-2.7, .02, .36, .39],
    [-1.5, .04, .4, .48], [-.05, .02, .34, .43], [.8, .07, .28, .32],
    [1.9, .1, .16, .23], [3.4, .16, .015, .04]], 32, true), materials.underside);
  wing(body, 9.55, 1.42, 1.1, -.9);
  wing(body, 7.6, 1.32, -.44, -.55);
  block(body, materials.dark, [0, -.38, -1.65], [.46, .23, .8]);
  for (const side of [-1, 1]) {
    for (const z of [-1.42, -.3]) {
      tube(body, materials.edge, [side * 2.8, -.42, z + .3], [side * 2.9, 1.08, z], .027);
      tube(body, materials.edge, [side * .33, .26, z + .2], [side * .72, 1.08, z], .025);
    }
    tube(body, materials.steel, [side * .7, -.42, -.9], [side * 2.9, 1.08, -.3], .006);
    tube(body, materials.steel, [side * .72, 1.08, -1.42], [side * 2.8, -.42, 0], .006);
    tube(body, materials.underside, [side * .34, -.32, -1.1], [side * .95, -1.3, -.65], .04);
    tube(body, materials.underside, [side * .32, -.32, .1], [side * .95, -1.3, -.65], .035);
    wheel(body, side * .97, -1.3, -.65, .31, .18);
    oval(body, materials.underside, [side * .97, -1.25, -.65], [.19, .37, .58]);
    for (let exhaust = 0; exhaust < 6; exhaust++) tube(body, materials.steel,
      [side * .34, .05, -2.65 + exhaust * .18], [side * .43, -.03, -2.65 + exhaust * .18], .021);
    const insignia = mesh(body, disk, materials.red, [side * 3.5, 1.16, -.8], [.45, .45, 1]);
    insignia.rotation.x = -Math.PI / 2;
    const under = mesh(body, disk, materials.red, [side * 2.7, -.5, -.45], [.38, .38, 1]);
    under.rotation.x = Math.PI / 2;
  }
  oval(body, materials.dark, [0, .05, .4], [.25, .22, .4]);
  block(body, materials.leather, [0, .2, .72], [.34, .3, .07]);
  oval(body, materials.underside, [0, .18, 2.7], [1.4, .05, .6]);
  oval(body, materials.underside, [0, .65, 2.8], [.04, .72, .6]);
  for (const side of [-1, 1]) oval(propeller, materials.leather,
    [side * .58, 0, 0], [.61, .075, .03]).rotation.z = side * .05;
  oval(propeller, materials.underside, [0, 0, -.1], [.2, .2, .24]);
  batch(body); batch(propeller);
  propeller.name = 'propeller'; propeller.position.z = -3.55; body.add(propeller);
  body.userData.details = { engine: 'inline', fixedGear: true, bracingWires: true, roundel: 'hinomaru' };
  return body;
}

export function historicalVehicleModel(type, team = 'friendly') {
  if (!Object.hasOwn(VEHICLE_PROFILES, type)) throw new RangeError(`Unknown historical vehicle: ${type}`);
  if (!['friendly', 'enemy'].includes(team)) throw new RangeError('Unknown vehicle team');
  const key = type === 'plane' ? `${team}-plane` : type;
  if (!templates.has(key)) templates.set(key, type === 'tank' ? tankTemplate() : team === 'enemy' ? japanesePlaneTemplate() : planeTemplate());
  const model = templates.get(key).clone(true);
  model.userData.profile = type === 'plane' && team === 'enemy' ? JAPANESE_AIRCRAFT_PROFILE : VEHICLE_PROFILES[type];
  if (type === 'tank') {
    model.userData.turret = model.getObjectByName('turret');
    model.userData.gun = model.getObjectByName('gun');
  } else model.userData.propeller = model.getObjectByName('propeller');
  return model;
}

export function vehicleWeaponView(type, seat = 'commander') {
  const key = type === 'tank' ? `${type}-${seat}-view` : 'plane-view';
  if (!['tank', 'plane'].includes(type)) throw new RangeError(`Unknown vehicle view: ${type}`);
  if (type === 'tank' && !['commander', 'gunner', 'driver'].includes(seat)) throw new RangeError('Unknown tank observation seat');
  if (!templates.has(key)) {
    const group = new THREE.Group();
    if (type === 'plane') {
      mesh(group, loft([[-2.95, -.94, .36, .34], [-2.2, -.94, .52, .42], [-1.55, -.94, .58, .46],
        [-.85, -.94, .58, .46]], 32), materials.olive);
      wing(group, 7.5, 1.25, -1.10, -1.45, materials.olive);
      block(group, materials.dark, [0, -.48, -.92], [1.05, .34, .08]);
      for (const side of [-1, 1]) {
        for (const x of [.38, .48]) for (const y of [-.34, -.61]) mesh(group, rivet, materials.edge,
          [side * x, y, -.865], [.008, .008, .004]);
        for (let vent = 0; vent < 4; vent++) block(group, materials.steel,
          [side * .51, -.58, -1.45 - vent * .17], [.015, .065, .06]);
        tube(group, materials.edge, [side * .5, -.63, -.62], [side * .5, -.63, -1.7], .018);
        block(group, materials.leather, [side * .49, -.59, -.92], [.07, .14, .04]);
      }
      for (const x of [-.32, 0, .32]) {
        mesh(group, disk, materials.edge, [x, -.45, -.87], [.115, .115, 1]);
        mesh(group, disk, materials.dark, [x, -.45, -.864], [.095, .095, 1]);
        tube(group, materials.white, [x, -.45, -.86], [x + .04, -.39, -.86], .005);
        for (let mark = 0; mark < 12; mark++) {
          const angle = mark * Math.PI / 6;
          tube(group, materials.white, [x + Math.sin(angle) * .075, -.45 + Math.cos(angle) * .075, -.856],
            [x + Math.sin(angle) * .086, -.45 + Math.cos(angle) * .086, -.856], .0018);
        }
      }
      for (const x of [-.18, .18]) {
        mesh(group, disk, materials.edge, [x, -.65, -.875], [.065, .065, 1]);
        mesh(group, disk, materials.dark, [x, -.65, -.87], [.053, .053, 1]);
        tube(group, materials.white, [x, -.65, -.864], [x + .024, -.615, -.864], .003);
      }
      const sight = mesh(group, new THREE.TorusGeometry(.07, .004, 6, 32), materials.steel, [0, 0, -1.19]);
      sight.name = 'ring-sight';
      for (const side of [-1, 1]) {
        tube(group, materials.steel, [0, side * .07, -1.19], [0, side * .012, -1.19], .0025);
        tube(group, materials.steel, [side * .07, 0, -1.19], [side * .012, 0, -1.19], .0025);
      }
      tube(group, materials.leather, [-.44, -.38, -.67], [-.44, -.42, -1.03], .022);
      tube(group, materials.leather, [.44, -.38, -.67], [.44, -.42, -1.03], .022);
      for (const side of [-1, 1]) {
        tube(group, materials.edge, [side * .56, -.6, -1], [side * .33, -.16, -1.3], .018);
      }
      for (let section = 0; section < 12; section++) {
        const a = section * Math.PI / 12, b = (section + 1) * Math.PI / 12;
        tube(group, materials.edge, [.33 * Math.cos(a), -.16 + .35 * Math.sin(a), -1.3],
          [.33 * Math.cos(b), -.16 + .35 * Math.sin(b), -1.3], .011);
      }
      mesh(group, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        materials.glass, [0, -.16, -1.31], [.325, .34, .045]);
      group.userData.details = { roundedWindscreen: true, sideRails: true, lowerWingVisible: true, panelFasteners: true };
    }
    batch(group);
    templates.set(key, group);
  }
  const view = templates.get(key).clone(true);
  view.userData.profile = VEHICLE_PROFILES[type];
  view.userData.observationSeat = type === 'tank' ? seat : 'pilot';
  view.userData.optical = type === 'tank';
  view.userData.breech = view.getObjectByName('breech') ?? null;
  return view;
}
