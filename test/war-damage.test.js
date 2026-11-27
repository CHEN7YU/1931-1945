import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHELL_CRATERS, CRATER_EDGE, RUINED_SHOPS, craterHeight } from '../src/war-damage-layout.js';
import { damagedSurfaceGeometry, craterGeometry, addStaticWrecks } from '../src/war-damage.js';
import { groundHeight, BRIDGE } from '../src/ground.js';
import { makeTownLayout } from '../src/town-layout.js';
import { makeBaseSpawns } from '../src/spawns.js';
import { PAVED_AREAS } from '../src/battlefield.js';
import { createSolidIndex } from '../src/solid-index.js';
import { createVehicleRenderer } from '../src/vehicle-renderer.js';
import { CHI_HA } from '../src/chi-ha.js';

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
  const wrecks = addStaticWrecks(scene, { mesh, box, obstacles, groundHeight, timber: new THREE.MeshBasicMaterial() });
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

test('default wreck hulls are candidates for the real projectile collision index', () => {
  const scene = new THREE.Scene(), solids = [], obstacles = [], boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = (geometry, material, x, y, z, solid, parent = scene) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z); parent.add(object);
    if (solid) solids.push(object);
    return object;
  };
  const box = (x, y, z, w, h, d, material, solid, parent) => {
    const object = mesh(boxGeometry, material, x, y, z, solid, parent);
    object.scale.set(w, h, d); return object;
  };
  const wrecks = addStaticWrecks(scene, { mesh, box, obstacles, groundHeight, timber: new THREE.MeshBasicMaterial() });
  scene.updateMatrixWorld(true);
  const index = createSolidIndex(solids), ray = new THREE.Raycaster();
  for (const wreck of wrecks) {
    const target = new THREE.Vector3(wreck.x, groundHeight(wreck.x, wreck.z) + .75, wreck.z);
    const start = target.clone().add(new THREE.Vector3(Math.cos(wreck.heading) * 5, 0, -Math.sin(wreck.heading) * 5));
    const direction = target.clone().sub(start).normalize();
    ray.set(start, direction); ray.far = 10;
    const hits = ray.intersectObjects(index.candidates(start, direction, ray.far), false);
    assert.ok(hits.some(hit => `wreck-${hit.object.parent?.userData.staticWreckId}` === wreck.id), wreck.id);
  }
});

test('Taierzhuang tank reuses the full-size combat wreck with blocking and leaves other tanks unchanged', () => {
  const build = (wreck, weathered) => {
    const scene = new THREE.Scene(), solids = [], obstacles = [], boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = (geometry, material, x, y, z, solid, parent = scene) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, y, z); parent.add(object);
      if (solid) solids.push(object);
      return object;
    };
    const box = (x, y, z, w, h, d, material, solid, parent) => {
      const object = mesh(boxGeometry, material, x, y, z, solid, parent);
      object.scale.set(w, h, d); return object;
    };
    addStaticWrecks(scene, { mesh, box, obstacles, groundHeight, timber: new THREE.MeshBasicMaterial(),
      wrecks: [wreck], weathered });
    return { scene, solids, obstacle: obstacles[0] };
  };
  const tank = { id: 'north-light-tank', type: 'tank', x: 10.6, z: -41, heading: -.08 };
  const revised = build(tank, false), other = build({ ...tank, id: 'nanjing-tank' }, true);
  const previous = { minX: 8.846449330333076, maxX: 12.64722998570068,
    minZ: -44.173701140413144, maxZ: -38.76512092091194, height: 2.252553694201112 };
  for (const key of ['minX', 'minZ']) assert.ok(revised.obstacle[key] <= previous[key] + 1e-9);
  for (const key of ['maxX', 'maxZ', 'height']) assert.ok(revised.obstacle[key] >= previous[key] - 1e-9);
  assert.equal(revised.solids.length, other.solids.length + 1);
  assert.ok(revised.solids.every(item => !item.visible && item.userData.collisionOnly));
  assert.ok(other.solids.every(item => item.visible && !item.userData.collisionOnly));
  for (let i = 0; i < other.solids.length; i++) {
    assert.deepEqual(revised.solids[i].position.toArray(), other.solids[i].position.toArray());
    assert.deepEqual(revised.solids[i].scale.toArray(), other.solids[i].scale.toArray());
    assert.deepEqual(revised.solids[i].quaternion.toArray(), other.solids[i].quaternion.toArray());
  }
  const root = revised.scene.children[0];
  const visual = root.children.find(child => child.userData.staticTankVisual);
  assert.ok(visual);
  assert.deepEqual(visual.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(revised.solids.at(-1).scale.toArray(), [CHI_HA.width, 1.2, CHI_HA.length]);
  revised.scene.updateMatrixWorld(true);
  const visualBounds = new THREE.Box3().setFromObject(visual);
  assert.ok(revised.obstacle.minX <= visualBounds.min.x && revised.obstacle.maxX >= visualBounds.max.x);
  assert.ok(revised.obstacle.minZ <= visualBounds.min.z && revised.obstacle.maxZ >= visualBounds.max.z);
  const index = createSolidIndex(revised.solids);
  for (const sign of [-1, 1]) {
    const origin = root.localToWorld(new THREE.Vector3(0, .75, sign * 5));
    const target = root.localToWorld(new THREE.Vector3(0, .75, 0));
    const direction = target.sub(origin).normalize(), ray = new THREE.Raycaster(origin, direction, 0, 10);
    const hit = ray.intersectObjects(index.candidates(origin, direction, 10), false)[0];
    assert.equal(hit?.object, revised.solids.at(-1), 'the extended visible hull blocks shots from either end');
  }
  const referenceScene = new THREE.Scene(), reference = createVehicleRenderer(referenceScene);
  reference.update([{ id: 'enemy-tank', type: 'tank', variant: CHI_HA.id, team: 'enemy',
    position: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0, turretYaw: 0,
    turretPitch: 0, trackDistance: 0, machineGuns: [], health: 0 }]);
  const batches = group => group.children.filter(item => item.userData.wreckBatch);
  const expected = batches(referenceScene), actual = visual.children[0];
  assert.ok(expected.length > 0 && actual.isMesh && visual.children.length === 1);
  assert.equal(actual.material.color.getHex(), expected[0].material.color.getHex());
  assert.equal(actual.geometry.attributes.position.count, expected.reduce((sum, batch) =>
    sum + (batch.geometry.index?.count ?? batch.geometry.attributes.position.count) * batch.count, 0));
  referenceScene.updateMatrixWorld(true);
  actual.geometry.computeBoundingBox();
  const referenceBounds = new THREE.Box3();
  for (const batch of expected) referenceBounds.union(new THREE.Box3().setFromObject(batch));
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(actual.geometry.boundingBox.min[axis] - referenceBounds.min[axis]) < 1e-5);
    assert.ok(Math.abs(actual.geometry.boundingBox.max[axis] - referenceBounds.max[axis]) < 1e-5);
  }
  let offset = 0;
  for (const batch of expected) {
    const position = batch.geometry.attributes.position, indices = batch.geometry.index;
    const count = indices?.count ?? position.count, transform = new THREE.Matrix4();
    for (let instance = 0; instance < batch.count; instance++) {
      batch.getMatrixAt(instance, transform);
      for (const vertex of [0, Math.floor(count / 2), count - 1]) {
        const source = indices ? indices.getX(vertex) : vertex;
        const point = new THREE.Vector3().fromBufferAttribute(position, source).applyMatrix4(transform);
        const merged = new THREE.Vector3().fromBufferAttribute(actual.geometry.attributes.position, offset + vertex);
        assert.ok(point.distanceTo(merged) < 1e-5, 'combined geometry retains each combat-wreck instance');
      }
      offset += count;
    }
  }
  reference.clear();
});

test('weathered wreck details leave vehicle obstacles and projectile solids unchanged', () => {
  const build = weathered => {
    const scene = new THREE.Scene(), solids = [], obstacles = [], boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = (geometry, material, x, y, z, solid, parent = scene) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, y, z); parent.add(object);
      if (solid) solids.push(object);
      return object;
    };
    const box = (x, y, z, w, h, d, material, solid, parent) => {
      const object = mesh(boxGeometry, material, x, y, z, solid, parent);
      object.scale.set(w, h, d); return object;
    };
    const wrecks = [
      { id: 'bus', type: 'bus', x: -45, z: -63, heading: Math.PI / 2 },
      { id: 'truck', type: 'truck', x: -15, z: -61, heading: 0 },
    ];
    addStaticWrecks(scene, { mesh, box, obstacles, groundHeight, timber: new THREE.MeshBasicMaterial(), wrecks, weathered });
    return { obstacles, solids };
  };
  const original = build(false), weathered = build(true);
  assert.deepEqual(weathered.obstacles, original.obstacles);
  assert.equal(weathered.solids.length, original.solids.length);
  for (let i = 0; i < original.solids.length; i++) {
    assert.deepEqual(weathered.solids[i].position.toArray(), original.solids[i].position.toArray());
    assert.deepEqual(weathered.solids[i].scale.toArray(), original.solids[i].scale.toArray());
  }
});
