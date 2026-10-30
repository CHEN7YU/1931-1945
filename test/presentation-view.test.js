import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { createPresentationView } from '../src/presentation-view.js';

test('presentation bounds retain the image edges, nearby lights and large offscreen sources that reach the image', () => {
  const camera = new PerspectiveCamera(72, 1, .07, 200), view = createPresentationView(camera);
  view.update();
  assert.equal(view.intersects(new Vector3(0, 0, -30), .1), true);
  assert.equal(view.intersects(new Vector3(0, 0, 30), .1), false);
  assert.equal(view.intersects(new Vector3(24, 0, -30), .1), true, 'two-metre apron avoids edge popping');
  assert.equal(view.intersects(new Vector3(30, 0, -30), .1), false);
  assert.equal(view.intersects(new Vector3(30, 0, -30), 10), true, 'do not cull smoke by its origin alone');
  assert.equal(view.intersects(new Vector3(0, 0, 4), 5), true, 'a light behind the observer can illuminate visible surfaces');
});

test('turns, camera parent movement and FOV/aspect changes refresh visibility on the next presentation', () => {
  const parent = new Object3D(), camera = new PerspectiveCamera(72, 1, .07, 200);
  parent.add(camera);
  const view = createPresentationView(camera), point = new Vector3(0, 0, 30);
  view.update();
  assert.equal(view.intersects(point, 1), false);
  parent.rotation.y = Math.PI;
  view.update();
  assert.equal(view.intersects(point, 1), true);
  parent.position.x = 100;
  view.update();
  assert.equal(view.intersects(point, 1), false);
  parent.position.x = 0; parent.rotation.y = 0;
  camera.aspect = 2; camera.updateProjectionMatrix(); view.update();
  assert.equal(view.intersects(new Vector3(40, 0, -30), .1), true);
  camera.fov = 20; camera.updateProjectionMatrix(); view.update();
  assert.equal(view.intersects(new Vector3(40, 0, -30), .1), false);
});
