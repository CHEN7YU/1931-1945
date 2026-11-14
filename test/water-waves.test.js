import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWaterWaveClock, waterWaveHeight } from '../src/water-waves.js';

test('water waves are continuous, bounded and evolve in space and time', () => {
  for (const x of [-100, 0, 100]) for (const z of [-20, 0, 52]) for (const time of [0, 5, 120]) {
    const height = waterWaveHeight(x, z, time);
    assert.ok(Math.abs(height) <= .10200001);
    assert.ok(Math.abs(height - waterWaveHeight(x + .001, z, time)) < .0001);
    assert.ok(Math.abs(height - waterWaveHeight(x, z, time + .001)) < .0001);
  }
  assert.notEqual(waterWaveHeight(0, 0, 0), waterWaveHeight(0, 0, 5));
  assert.notEqual(waterWaveHeight(0, 0, 5), waterWaveHeight(10, 0, 5));
});

test('water materials share their clock and retain their local vertical axes', () => {
  const clock = createWaterWaveClock();
  const horizontal = new THREE.MeshStandardMaterial(), plane = new THREE.MeshBasicMaterial();
  clock.attach(horizontal, 'y'); clock.attach(plane, 'z');
  const shader = () => ({ uniforms: {}, vertexShader: '#include <begin_vertex>',
    fragmentShader: '#include <normal_fragment_maps>' });
  const a = shader(), b = shader();
  horizontal.onBeforeCompile(a); plane.onBeforeCompile(b);
  clock.update(7);
  assert.equal(a.uniforms.waterTime, b.uniforms.waterTime);
  assert.equal(a.uniforms.waterTime.value, 7);
  assert.match(a.vertexShader, /transformed\.y \+= waterHeight/);
  assert.match(b.vertexShader, /transformed\.z \+= waterHeight/);
  assert.throws(() => clock.attach(plane, 'x'), RangeError);
});
