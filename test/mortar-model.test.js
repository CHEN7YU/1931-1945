import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { mortarModel, updateMortarModel } from '../src/mortar-model.js';
import { mortarPlacement } from '../src/mortar.js';

test('mortar has an open tube, baseplate, articulated bipod and sight rather than two placeholder cylinders', () => {
  const model = mortarModel();
  for (const name of ['barrel', 'baseplate', 'bipod--1', 'bipod-1', 'bipod-crossbar', 'elevation-screw',
    'windage-screw', 'sight', 'muzzle-rim', 'bore-wall']) assert.ok(model.getObjectByName(name), name);
  model.updateMatrixWorld(true);
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  assert.ok(size.y > .7 && size.y < 1.1);
  assert.ok(size.x > .45 && size.x < .8);
  const muzzle = model.userData.mortar.muzzle.getWorldPosition(new Vector3());
  assert.ok(muzzle.y > .8);
  model.traverse(mesh => {
    if (mesh.isMesh) assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  });
});

test('range moves the tube without rebuilding buffers or resizing its ground base', () => {
  const a = mortarModel(), b = mortarModel(), plate = a.getObjectByName('baseplate');
  assert.equal(a.getObjectByName('barrel').geometry, b.getObjectByName('barrel').geometry);
  const original = plate.position.clone(), buffers = a.getObjectByName('barrel').geometry;
  updateMortarModel(a, 50); const near = a.userData.mortar.tube.rotation.x;
  updateMortarModel(a, 250);
  assert.ok(a.userData.mortar.tube.rotation.x < near);
  assert.deepEqual(plate.position, original);
  assert.equal(a.getObjectByName('barrel').geometry, buffers);
  assert.throws(() => updateMortarModel(a, 49), RangeError);
});

test('emplacement sits safely in front of the operator rather than under their feet', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const position = { x: 4, y: .45, z: 8 }, anchor = mortarPlacement(position, heading);
    assert.ok(Math.abs(Math.hypot(anchor.x - position.x, anchor.z - position.z) - .85) < 1e-12);
    assert.equal(anchor.y, position.y);
    assert.ok((anchor.x - position.x) * -Math.sin(heading) + (anchor.z - position.z) * -Math.cos(heading) > .84);
  }
});
