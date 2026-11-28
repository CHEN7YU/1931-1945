import * as THREE from 'three';
import { createRoofGeometry } from './roof-geometry.js';
import { woodlandTreeGeometry, WOODLAND_SPECIES } from './woodland.js';
import { addStaticWrecks } from './war-damage.js';
import { batchStaticScene } from './static-scene-batches.js';
import { nanjingEarth } from './nanjing-earth.js';

// These parcels are beyond the playable southern boundary, not new combat cover.
export function createNanjingSouthBackdrop(scene, { surface, brick, stone, timber, roofMaterial, heightAt }) {
  const root = new THREE.Group();
  root.name = 'nanjing-south-backdrop';
  scene.add(root);
  const meshes = [], houses = [], fields = [], trees = [], fixtures = [], formerHouseSites = [];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const plaster = surface('plaster', 0xaaa18b, 2);
  const dark = new THREE.MeshStandardMaterial({ color: 0x36362d, roughness: 1 });
  const fieldMaterials = [
    nanjingEarth(surface, 0xdbc69e, 3),
    nanjingEarth(surface, 0xb7b093, 3),
  ];
  const furrowMaterial = nanjingEarth(surface, 0x62563f, 3);
  const roadMaterial = nanjingEarth(surface, 0xa99c7e, 3);
  const metal = new THREE.MeshStandardMaterial({ color: 0x45483c, roughness: .88, metalness: .2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9d957f, roughness: .7 });
  const mesh = (geometry, material, x, y, z, _solid = false, parent = root) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.receiveShadow = true;
    parent.add(object);
    meshes.push(object);
    return object;
  };
  const box = (x, y, z, w, h, d, material, solid = false, parent = root) => {
    const geometry = boxGeometry.clone();
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
    const meters = material.userData.metersPerTile ?? 2.4;
    for (let index = 0; index < uv.count; index++) {
      uv.setXY(index, (Math.abs(normals.getX(index)) > .5 ? positions.getZ(index) * d : positions.getX(index) * w) / meters,
        (Math.abs(normals.getY(index)) > .5 ? positions.getZ(index) * d : positions.getY(index) * h) / meters);
    }
    const object = mesh(geometry, material, x, y, z, solid, parent);
    object.scale.set(w, h, d);
    return object;
  };
  const patch = (x, z, w, d, material, lift = .025) => {
    const geometry = new THREE.PlaneGeometry(w, d, 4, 4);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index++) {
      const px = x + positions.getX(index), pz = z - positions.getY(index);
      positions.setZ(index, heightAt(px, pz) + lift);
      uv.setXY(index, px / 3, -pz / 3);
    }
    geometry.computeVertexNormals();
    const object = mesh(geometry, material, x, 0, z);
    object.rotation.x = -Math.PI / 2;
    return object;
  };
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  const beam = (from, to, radius, material) => {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
    const object = mesh(beamGeometry, material, ...start.clone().add(end).multiplyScalar(.5).toArray());
    object.scale.set(radius, start.distanceTo(end), radius);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
    return object;
  };

  for (let row = 0; row < 3; row++) for (let column = 0; column < 8; column++) {
    const index = row * 8 + column;
    const x = -83 + column * 25 + Math.sin(index * 2.31) * 4;
    const z = 124 + row * 54 + column % 3 * 7;
    if ((row + column) % 2 === 1) {
      if (Math.abs(x - 2) > 15) formerHouseSites.push({ x, z });
      continue;
    }
    const width = 6 + index % 3, depth = 5 + index % 2;
    const height = 3.4 + index % 4 * .7, base = heightAt(x, z);
    const ruined = index % 7 === 3;
    houses.push({ x, z, width, depth, height, base, ruined });
    box(x, base + height / 2 - .3, z, width, height + .6, depth, index % 3 ? brick : plaster);
    const roof = mesh(createRoofGeometry(width + .8, depth + .7, 1.1, 1.4),
      roofMaterial, x, base + height, z);
    if (ruined) {
      roof.scale.x = .6;
      roof.position.x -= width * .2;
      box(x + width * .28, base + height - .25, z, .14, .14, depth, timber);
      for (let piece = 0; piece < 4; piece++)
        box(x + width * .4 + piece * .45, base + .15, z - depth / 2 - .8,
          .65, .3 + piece % 2 * .2, .55, stone).rotation.y = piece * .7;
    }
    const front = z - depth / 2 - .02;
    box(x, base + .95, front, .9, 1.9, .08, timber);
    for (const side of [-1, 1]) {
      box(x + side * width * .3, base + height * .6, front, 1.1, .85, .06, dark);
      box(x + side * width * .3, base + height * .6 - .45, front - .05, 1.3, .09, .18, timber);
      box(x + side * width * .3, base + height * .6, front - .06, .055, .85, .08, timber);
    }
    if (row === 0)
      box(x, base + .25, z - depth / 2 - 3, width + 2, .5, .35, stone);
  }
  for (let index = 0; index < 18; index++) {
    const x = -92 + index % 9 * 24, z = 292 + Math.floor(index / 9) * 62 + index % 3 * 8;
    if ((index + Math.floor(index / 9)) % 2 === 1) {
      if (Math.abs(x - 2) > 15) formerHouseSites.push({ x, z });
      continue;
    }
    const width = 7 + index % 3, depth = 6, height = 3.8 + index % 4 * .6, base = heightAt(x, z);
    houses.push({ x, z, width, depth, height, base, ruined: false });
    box(x, base + height / 2 - .4, z, width, height + .8, depth, index % 2 ? brick : plaster);
    mesh(createRoofGeometry(width + .7, depth + .6, 1.2, 1.4), roofMaterial, x, base + height, z);
  }
  for (let index = 0; index < 18; index++) {
    const x = -148 - index % 3 * 35 - Math.floor(index / 3) * 4;
    const z = 182 + Math.floor(index / 3) * 34 + index % 3 * 5;
    const width = 6 + index % 3, depth = 5.5, height = 3.6 + index % 4 * .6, base = heightAt(x, z);
    houses.push({ x, z, width, depth, height, base, ruined: false, district: 'southwest' });
    box(x, base + height / 2 - .4, z, width, height + .8, depth, index % 3 ? brick : plaster);
    mesh(createRoofGeometry(width + .7, depth + .6, 1.1, 1.4), roofMaterial, x, base + height, z);
    box(x, base + .9, z - depth / 2 - .02, .9, 1.8, .08, timber);
    for (const side of [-1, 1])
      box(x + side * width * .3, base + height * .6, z - depth / 2 - .03, 1, .85, .06, dark);
  }
  for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
    const x = -73 + column * 56, z = 163 + row * 54;
    const width = 36, depth = 19;
    fields.push({ x, z, width, depth });
    patch(x, z, width, depth, fieldMaterials[(row + column) % 2]);
    for (let furrow = 0; furrow < 5; furrow++)
      patch(x, z - 7 + furrow * 3.5, width, .55, furrowMaterial, .075);
  }
  for (const [index, site] of formerHouseSites.entries()) {
    const { x, z } = site, width = 19, depth = 11;
    fields.push({ x, z, width, depth, district: 'south', formerHouse: true });
    patch(x, z, width, depth, fieldMaterials[index % 2], .06);
    for (let furrow = 0; furrow < 4; furrow++)
      patch(x, z - 3.6 + furrow * 2.4, width, .55, furrowMaterial, .075);
  }
  patch(2, 234, 6, 224, roadMaterial, .055);
  for (let row = 0; row < 3; row++) patch(11, 151 + row * 54, 205, 3, roadMaterial, .055);
  for (let index = 0; index < 6; index++) {
    const x = -165 - index % 2 * 58, z = 208 + Math.floor(index / 2) * 64;
    fields.push({ x, z, width: 35, depth: 18, district: 'southwest' });
    patch(x, z, 35, 18, fieldMaterials[index % 2]);
    for (let furrow = 0; furrow < 4; furrow++)
      patch(x, z - 6 + furrow * 4, 35, .55, furrowMaterial, .075);
  }
  patch(-187, 260, 4, 160, roadMaterial, .055);

  const bark = Object.fromEntries(Object.keys(WOODLAND_SPECIES).map(species => {
    const material = surface(`bark-${species}`);
    material.vertexColors = true;
    return [species, material];
  }));
  const treeGeometry = new Map();
  for (let index = 0; index < 32; index++) {
    const species = index % 4 === 0 ? 'poplar' : index % 3 === 0 ? 'willow' : 'elm';
    const x = -99 + index % 8 * 29 + Math.sin(index * 1.73) * 3;
    const z = 143 + Math.floor(index / 8) * 58 + index % 2 * 9;
    if (houses.some(house => Math.abs(x - house.x) < house.width / 2 + 3 &&
      Math.abs(z - house.z) < house.depth / 2 + 3)) continue;
    const base = heightAt(x, z), height = 5.5 + index % 5 * .8;
    if (!treeGeometry.has(species)) {
      const tree = { species, height: 7, radius: 7 * WOODLAND_SPECIES[species].girth,
        seed: 1937 + index, age: 'adult', dead: true, sparse: true, heading: index * 2.39 };
      treeGeometry.set(species, woodlandTreeGeometry(tree).bark);
    }
    const object = mesh(treeGeometry.get(species), bark[species], x, base, z);
    object.scale.setScalar(height / 7);
    object.rotation.y = index * 2.39;
    trees.push({ x, z, base, height, species });
  }
  for (let index = 0; index < 10; index++) {
    const x = -135 - index % 3 * 42, z = 205 + Math.floor(index / 3) * 50;
    const species = index % 2 ? 'willow' : 'elm', height = 6 + index % 3, base = heightAt(x, z);
    const object = mesh(treeGeometry.get(species), bark[species], x, base, z);
    object.scale.setScalar(height / 7); object.rotation.y = index * 1.73;
    trees.push({ x, z, base, height, species, district: 'southwest' });
  }
  const shadeGeometry = new THREE.ConeGeometry(.25, .22, 8);
  for (let index = 0; index < 6; index++) {
    const x = index % 2 ? 7 : -4, z = 130 + index * 29, base = heightAt(x, z);
    beam([x, base, z], [x, base + 4.5, z], .075, metal);
    beam([x, base + 4.4, z], [x + 1, base + 4.2, z], .045, metal);
    mesh(shadeGeometry, metal, x + 1, base + 4.17, z);
    box(x + 1, base + 4.03, z, .15, .14, .15, glass);
    fixtures.push({ kind: 'streetlamp', x, z, base });
  }
  for (let index = 0; index < 3; index++) {
    const x = -14, z = 140 + index * 48, base = heightAt(x, z);
    beam([x, base, z], [x, base + 6, z], .1, timber);
    beam([x - .7, base + 5.65, z], [x + .7, base + 5.65, z], .045, timber);
    fixtures.push({ kind: 'utility', x, z, base });
  }
  const wrecks = addStaticWrecks(root, {
    wrecks: [
      { id: 'south-road-truck', type: 'truck', x: -9, z: 120, heading: -.3 },
      { id: 'south-road-tank', type: 'tank', x: 11, z: 140, heading: .6 },
      { id: 'south-village-bus', type: 'bus', x: -32, z: 151, heading: 1.3 },
      { id: 'south-farm-truck', type: 'truck', x: 39, z: 187, heading: -.8 },
      { id: 'south-field-tank', type: 'tank', x: -44, z: 218, heading: -.4 },
      { id: 'southwest-lane-truck', type: 'truck', x: -182, z: 200, heading: -.3 },
      { id: 'southwest-field-tank', type: 'tank', x: -207, z: 282, heading: .8 },
    ],
    mesh, box, obstacles: [], groundHeight: heightAt, timber, weathered: true,
  });
  const rendering = batchStaticScene(root, meshes, { spatial: false });
  return { root, houses, fields, trees, fixtures, wrecks, rendering,
    historicalReplica: false, collision: false, leafStyle: 'winter-bare-branches' };
}
