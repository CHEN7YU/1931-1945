import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTracerPool } from '../src/tracer-pool.js';
import { createTracerPool as legacyPool } from '../scripts/fixtures/tracer-pool-legacy.js';

test('tracers reuse geometry and independent materials with fresh endpoints, colors, opacity and bounds', () => {
  const pool = createTracerPool(2), start = new THREE.Vector3(1, 2, 3), end = new THREE.Vector3(4, 5, 6);
  const first = pool.acquire(start, end, 0xff0000), second = pool.acquire(end, start, 0x00ff00);
  assert.notEqual(first.material, second.material);
  first.material.opacity = .12;
  assert.equal(second.material.opacity, .8);
  first.geometry.computeBoundingSphere();
  const geometry = first.geometry, material = first.material, oldVersion = geometry.attributes.position.version;
  pool.release(first);
  start.set(-100, 25, 30); end.set(-90, 20, 10);
  const reused = pool.acquire(start, end, 0x123456);
  assert.equal(reused, first);
  assert.equal(reused.geometry, geometry); assert.equal(reused.material, material);
  assert.deepEqual([...geometry.attributes.position.array], [-100, 25, 30, -90, 20, 10]);
  assert.ok(geometry.attributes.position.version > oldVersion);
  assert.equal(geometry.boundingSphere, null);
  assert.equal(material.opacity, .8);
  assert.equal(material.color.getHex(), 0x123456);
  start.set(0, 0, 0);
  assert.equal(geometry.attributes.position.getX(0), -100, 'geometry must not retain input vector references');
  pool.release(reused); pool.release(second);
  assert.deepEqual(pool.snapshot, { capacity: 2, active: 0, retained: 2, idle: 2, created: 2, reused: 1, disposed: 0 });
});

test('retention is bounded without dropping live tracers; retained slots survive overflow and reset disposes them once', () => {
  const pool = createTracerPool(1), p = new THREE.Vector3();
  const first = pool.acquire(p, p, 0), overflow = pool.acquire(p, p, 1);
  let geometryDisposals = 0, materialDisposals = 0;
  for (const line of [first, overflow]) {
    line.geometry.addEventListener('dispose', () => geometryDisposals++);
    line.material.addEventListener('dispose', () => materialDisposals++);
  }
  assert.equal(pool.snapshot.active, 2);
  assert.throws(() => pool.reset(), /active tracers/);
  pool.release(overflow);
  assert.equal(pool.snapshot.disposed, 1);
  pool.release(first);
  assert.equal(pool.snapshot.idle, 1);
  assert.equal(pool.acquire(p, p, 2), first, 'overflow cannot evict the retained material');
  pool.release(first);
  assert.throws(() => pool.release(first), /inactive or foreign/);
  assert.throws(() => pool.release(new THREE.Line()), /inactive or foreign/);
  pool.reset(); pool.reset();
  assert.equal(geometryDisposals, 2); assert.equal(materialDisposals, 2);
  assert.deepEqual(pool.snapshot, { capacity: 1, active: 0, retained: 0, idle: 0, created: 0, reused: 0, disposed: 0 });
});

test('pooled presentation matches former construction across repeated colors and independent fade sequences', () => {
  const pool = createTracerPool(4), legacy = legacyPool();
  for (let round = 0; round < 200; round++) {
    const pairs = [];
    for (let i = 0; i < 8; i++) {
      const start = new THREE.Vector3(round, i, -i), end = new THREE.Vector3(-i, i + .5, round + 8);
      const color = (round * 123 + i * 0x123456) & 0xffffff;
      const actual = pool.acquire(start, end, color), expected = legacy.acquire(start, end, color);
      assert.deepEqual([...actual.geometry.attributes.position.array], [...expected.geometry.attributes.position.array]);
      for (const key of ['color', 'opacity', 'transparent', 'depthWrite', 'depthTest', 'toneMapped', 'blending']) {
        assert.deepEqual(actual.material[key], expected.material[key], key);
      }
      actual.geometry.computeBoundingSphere(); expected.geometry.computeBoundingSphere();
      assert.deepEqual(actual.geometry.boundingSphere, expected.geometry.boundingSphere);
      const age = i / 8;
      actual.material.opacity = expected.material.opacity = (1 - age) * .8;
      pairs.push([actual, expected]);
    }
    for (const [actual, expected] of pairs) {
      assert.equal(actual.material.opacity, expected.material.opacity);
      pool.release(actual); legacy.release(expected);
    }
  }
  pool.reset(); legacy.reset();
  for (const capacity of [-1, .5, Infinity, NaN]) assert.throws(() => createTracerPool(capacity), RangeError);
});
