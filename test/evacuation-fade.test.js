import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEvacuationInstances, setInstanceEvacuationOpacity, setViewEvacuationOpacity } from '../src/evacuation-fade.js';

test('one departing soldier fades without changing another instance or the original material', () => {
  const source = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry();
  const first = createEvacuationInstances(geometry, source, 2);
  const second = createEvacuationInstances(geometry, source, 2);
  setInstanceEvacuationOpacity(first, 1, .4);
  assert.ok(Math.abs(first.geometry.attributes.evacuationOpacity.getX(1) - .4) < 1e-6);
  assert.equal(first.geometry.attributes.evacuationOpacity.getX(0), 1);
  assert.equal(second.geometry.attributes.evacuationOpacity.getX(1), 1);
  assert.equal(source.opacity, 1); assert.equal(source.transparent, false);
  first.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(4 * 16), 16);
  setInstanceEvacuationOpacity(first, 3, .2);
  assert.equal(first.geometry.attributes.evacuationOpacity.getX(2), 1);
  assert.ok(Math.abs(first.geometry.attributes.evacuationOpacity.getX(1) - .4) < 1e-6);
});

test('rebinding a detailed character restores its original materials instead of leaking the prior fade', () => {
  const root = new THREE.Group(), source = new THREE.MeshStandardMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(), source); root.add(body);
  setViewEvacuationOpacity(root, .3);
  assert.equal(body.material.opacity, .3); assert.equal(source.opacity, 1);
  setViewEvacuationOpacity(root, 1);
  assert.equal(body.material, source);
});
