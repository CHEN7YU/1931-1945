import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRallyRenderer } from '../src/rally-renderer.js';
import { createRallyPoint, replaceTeamRally, damageRallyPoint } from '../src/spawns.js';

const rally = (id, team = 'friendly', x = 0, z = 5) => createRallyPoint({ id, team, builderId: `${team}-engineer`,
  position: { x, y: 0, z } });
test('rally views project data and bind real mesh ray hits by identity without keeping a state back-reference', () => {
  const scene = new THREE.Scene(), renderer = createRallyRenderer(scene), point = rally('r1');
  const before = structuredClone(point);
  const targets = renderer.targets([point]);
  assert.deepEqual(point, before);
  assert.equal('model' in point, false);
  assert.deepEqual(renderer.snapshot, { count: 1, ids: ['r1'] });
  const ray = new THREE.Raycaster(new THREE.Vector3(0, .65, 0), new THREE.Vector3(0, 0, 1), 0, 20);
  const hit = ray.intersectObjects(targets, true)[0];
  assert.ok(hit);
  assert.equal(hit.object.userData.rallyId, 'r1');
  assert.equal('spawnPoint' in hit.object.userData, false);
  assert.ok(Math.abs(hit.point.z - 4.75) < 1e-6, 'actual box geometry, not a larger proxy, provides the contact');
  damageRallyPoint(point, 100);
  assert.equal(renderer.targets([point])[0], targets[0], 'a surviving view is reused instead of recreated each frame');
  assert.equal(point.health, 20);
  renderer.clear();
  assert.equal(scene.children.length, 0);
});
test('replacement/destruction/reset remove old visible and ray targets without disposing shared resources', () => {
  const scene = new THREE.Scene(), renderer = createRallyRenderer(scene);
  const first = rally('first'), enemy = rally('enemy', 'enemy', 10, 8);
  let points = [first, enemy];
  const oldTargets = renderer.targets(points), oldModel = oldTargets[0], resources = new Set();
  let disposed = 0;
  const onDispose = () => disposed++;
  for (const model of oldTargets) model.traverse(object => {
    if (object.isMesh) { resources.add(object.geometry); resources.add(object.material); }
  });
  for (const resource of resources) resource.addEventListener('dispose', onDispose);
  const next = rally('next', 'friendly', 0, 10);
  points = replaceTeamRally(points, next);
  let targets = renderer.targets(points);
  assert.equal(oldModel.parent, null);
  assert.equal(renderer.snapshot.count, 2);
  assert.equal(renderer.snapshot.ids.includes('first'), false);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, .65, 0), new THREE.Vector3(0, 0, 1), 0, 7);
  assert.equal(ray.intersectObjects(targets, true).length, 0, 'the old closer rally cannot intercept a later shot');
  ray.far = 20;
  assert.equal(ray.intersectObjects(targets, true)[0].object.userData.rallyId, 'next');
  damageRallyPoint(next, 120);
  targets = renderer.targets(points);
  assert.deepEqual(renderer.snapshot, { count: 1, ids: ['enemy'] });
  assert.equal(ray.intersectObjects(targets, true).length, 0);
  assert.equal(points.includes(next), true, 'destroyed spawn state remains available for the deployment error');
  assert.equal(next.health, 0);
  renderer.clear();
  assert.deepEqual(renderer.snapshot, { count: 0, ids: [] });
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, 0, 'per-rally removal must not destroy shared geometry or materials');
  for (const resource of resources) resource.removeEventListener('dispose', onDispose);
});
test('a rally destroyed before its first render creates no orphan view, and ambiguous IDs fail explicitly', () => {
  const scene = new THREE.Scene(), renderer = createRallyRenderer(scene), point = rally('gone');
  damageRallyPoint(point, 120);
  assert.deepEqual(renderer.targets([point]), []);
  assert.equal(renderer.snapshot.count, 0);
  const live = rally('live');
  assert.throws(() => renderer.update([live, live]), /Duplicate/);
  renderer.update([live]);
  live.team = 'enemy';
  assert.throws(() => renderer.update([live]), /different team/);
  renderer.clear();
});
