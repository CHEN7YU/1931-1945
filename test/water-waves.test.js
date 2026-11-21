import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { waterNormalTexture } from '../src/jiangyin/jiangyin-surfaces.js';
import { createWaterNormalTexture, createWaterWaveClock, waterWaveHeight } from '../src/water-waves.js';

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
  const shader = () => ({ uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n' +
      '#include <normal_fragment_maps>\n#include <opaque_fragment>' });
  const a = shader(), b = shader();
  horizontal.onBeforeCompile(a); plane.onBeforeCompile(b);
  clock.update(7);
  assert.equal(a.uniforms.waterTime, b.uniforms.waterTime);
  assert.equal(a.uniforms.waterTime.value, 7);
  assert.match(a.vertexShader, /transformed\.y \+= waterHeight/);
  assert.match(b.vertexShader, /transformed\.z \+= waterHeight/);
  assert.match(a.vertexShader, /attribute float waterDepth/);
  assert.match(a.fragmentShader, /waterFoam = foamBand \* foamPattern/);
  assert.match(a.fragmentShader, /waterFresnel \* waterReflection/);
  assert.doesNotMatch(b.fragmentShader, /waterFoam/);
  assert.ok(horizontal.normalMap);
  assert.ok(!plane.normalMap);
  assert.throws(() => clock.attach(plane, 'x'), RangeError);
});

test('Jiangyin and shared river surfaces use the same cached, tileable normal texture', () => {
  const shared = createWaterNormalTexture();
  assert.equal(createWaterNormalTexture(), shared);
  assert.equal(waterNormalTexture(), shared);
  assert.equal(shared.image.width, 256);
  assert.equal(shared.wrapS, THREE.RepeatWrapping);
  assert.equal(shared.wrapT, THREE.RepeatWrapping);
  assert.throws(() => createWaterNormalTexture(1), RangeError);
});
