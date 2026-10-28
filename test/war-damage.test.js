import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHELL_CRATERS, CRATER_EDGE, RUINED_SHOPS, craterHeight } from '../src/war-damage-layout.js';
import { damagedSurfaceGeometry, craterGeometry, addStaticWrecks } from '../src/war-damage.js';
import { groundHeight, BRIDGE } from '../src/ground.js';
import { makeTownLayout } from '../src/town-layout.js';
import { makeBaseSpawns } from '../src/spawns.js';
import { PAVED_AREAS } from '../src/battlefield.js';

test('shell holes have actual depth, continuous rims and no remaining flat ground cap', () => {
  const ground = new THREE.Mesh(damagedSurfaceGeometry(0, 0, 800, 800), new THREE.MeshBasicMaterial());
  ground.updateMatrixWorld(true);
  for (const crater of SHELL_CRATERS) {
    assert.ok(Math.abs(groundHeight(crater.x, crater.z) + crater.depth) < 1e-8);
    assert.ok(Math.abs(craterHeight(crater.x + crater.radius * CRATER_EDGE, crater.z)) < 1e-8);
    assert.ok(craterHeight(crater.x + crater.radius, crater.z) > 0);
    const ray = new THREE.Raycaster(new THREE.Vector3(crater.x, 3, crater.z), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(ground).length, 0, 'flat base terrain is actually cut out');
    const bowl = new THREE.Mesh(craterGeometry(crater, 0), new THREE.MeshBasicMaterial());
    bowl.updateMatrixWorld(true);
    const hits = ray.intersectObject(bowl);
    assert.ok(hits.length > 0 && Math.abs(hits[0].point.y + crater.depth) < 1e-5);
    bowl.geometry.dispose();
  }
  ground.geometry.dispose();
});

test('all overlapping paved layers are cut away throughout every crater interior', () => {
  const surfaces = PAVED_AREAS.slice(0, -1).map(([x, z, w, d]) => {
    const mesh = new THREE.Mesh(damagedSurfaceGeometry(x, z, w, d), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true); return mesh;
  });
  for (const crater of SHELL_CRATERS) for (const fraction of [0, .5, .9]) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    const ray = new THREE.Raycaster(new THREE.Vector3(crater.x + Math.cos(angle) * crater.radius * fraction,
      3, crater.z + Math.sin(angle) * crater.radius * fraction), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObjects(surfaces).length, 0, 'No floating pavement islands over a bowl');
  }
  for (const mesh of surfaces) mesh.geometry.dispose();
  assert.throws(() => damagedSurfaceGeometry(-1, 48, 9, 3), /pavement boundary/);
});

test('damage keeps bridge support and fixed deployment centres intact', () => {
  assert.equal(groundHeight(8, -16), BRIDGE.height);
  assert.equal(groundHeight(8, -24.5), BRIDGE.height / 2);
  for (const point of makeBaseSpawns().filter(point => point.kind !== 'air')) {
    assert.equal(groundHeight(point.x, point.z), 0);
    assert.ok(SHELL_CRATERS.every(crater => Math.hypot(point.x - crater.x, point.z - crater.z) > crater.radius * CRATER_EDGE + 5));
  }
});

test('partially collapsed shops retain their floor and usable front doorway', () => {
  const town = makeTownLayout();
  assert.deepEqual(town.buildings.filter(building => building.ruined).map(building => building.id).sort(), [...RUINED_SHOPS].sort());
  for (const id of RUINED_SHOPS) {
    assert.ok(town.pieces.some(piece => piece.id === `${id}-floor`));
    const shop = town.buildings.find(building => building.id === id);
    assert.ok(town.passages.some(passage => passage.x === shop.x + shop.facing * shop.w / 2 && passage.z === shop.doorZ));
    assert.ok(town.pieces.some(piece => piece.wall && piece.id.startsWith(`${id}-`) && piece.h > .88 && piece.h < 2.4));
  }
});
test('new homes and courtyard walls leave the entire existing shell crater bowls and rims exposed', () => {
  const town = makeTownLayout();
  for (const crater of SHELL_CRATERS) {
    for (const piece of town.pieces.filter(piece => /^(west-home-|east-home-|east-lane-home-|west-lane-gate-|west-yard-gate-|east-yard-gate-|canal-)/.test(piece.id))) {
      const dx = Math.max(0, Math.abs(crater.x - piece.x) - piece.w / 2);
      const dz = Math.max(0, Math.abs(crater.z - piece.z) - piece.d / 2);
      assert.ok(Math.hypot(dx, dz) > crater.radius * CRATER_EDGE, `${piece.id} overlaps ${crater.id}`);
    }
  }
});

test('static vehicle wreck geometry has blocking bounds but leaves the central infantry lane clear', () => {
  const scene = new THREE.Scene(), obstacles = [], boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = (geometry, material, x, y, z, solid, parent = scene) => {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); parent.add(object); return object;
  };
  const box = (x, y, z, w, h, d, material, solid, parent) => {
    const object = mesh(boxGeometry, material, x, y, z, solid, parent); object.scale.set(w, h, d); return object;
  };
  const beam = (a, b, radius, material, parent) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 6), material,
      (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, false, parent);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return object;
  };
  const wrecks = addStaticWrecks(scene, { mesh, box, beam, obstacles, groundHeight, timber: new THREE.MeshBasicMaterial() });
  assert.equal(wrecks.length, 3);
  assert.equal(obstacles.length, 3);
  assert.ok(wrecks.some(wreck => wreck.type === 'tank') && wrecks.some(wreck => wreck.type === 'truck'));
  for (const wreck of wrecks) {
    assert.ok(wreck.height > 1.7 && wreck.maxX > wreck.minX && wreck.maxZ > wreck.minZ);
    const laneX = wreck.z < -20 ? 8 : 0;
    assert.ok(laneX + .45 < wreck.minX || laneX - .45 > wreck.maxX);
    for (const home of makeTownLayout().buildings.filter(building => building.kind === 'home' || building.riverSide)) {
      assert.ok(home.x + home.w / 2 < wreck.minX || home.x - home.w / 2 > wreck.maxX ||
        home.z + home.d / 2 < wreck.minZ || home.z - home.d / 2 > wreck.maxZ, home.id);
    }
  }
});
