import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { configureSunShadow, createDaylight, DAYLIGHT } from '../src/lighting.js';
import { qualityProfile } from '../src/quality.js';

function sunlight() {
  const sun = new THREE.DirectionalLight();
  sun.position.set(-55, 70, 38);
  configureSunShadow(sun);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  sun.shadow.updateMatrices(sun);
  return sun;
}

test('sun shadow projection actually uses the configured 200m extent and depth planes', () => {
  const sun = sunlight(), camera = sun.shadow.camera, projection = camera.projectionMatrix;
  assert.equal(2 / projection.elements[0], camera.right - camera.left);
  assert.equal(2 / projection.elements[5], camera.top - camera.bottom);
  assert.equal(2 / projection.elements[0], 200);
  assert.ok(Math.abs(projection.elements[10] + 2 / (240 - 1)) < 1e-12);
  const product = projection.clone().multiply(camera.projectionMatrixInverse);
  assert.ok(product.elements.every((value, i) => Math.abs(value - (i % 5 === 0 ? 1 : 0)) < 1e-12));
});

test('both shops, the bridge and street junctions remain inside the actual shadow frustum at both qualities', () => {
  const sun = sunlight(), projection = sun.shadow.camera.projectionMatrix.clone();
  const points = [[-4.5, 1.5, 64], [4.5, 1.5, 64], [8, 1, -16], [-40, 0, 30], [40, 0, -51]];
  for (const preset of ['high', 'low']) {
    const size = qualityProfile(preset, 2, 8192).shadowSize;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.updateMatrices(sun);
    assert.deepEqual(sun.shadow.camera.projectionMatrix, projection);
    for (const point of points) {
      const clip = new THREE.Vector3(...point).project(sun.shadow.camera);
      assert.ok(clip.toArray().every(value => Math.abs(value) < 1), `${preset}: ${point} is inside the shadow projection`);
      assert.ok(sun.shadow.getFrustum().containsPoint(new THREE.Vector3(...point)));
    }
  }
});

test('daylight toggles change only the requested lighting profile, not shadow position or projection', () => {
  const scene = new THREE.Scene(), sun = sunlight(), hemisphere = new THREE.HemisphereLight();
  const fog = new THREE.FogExp2(), daylight = createDaylight(scene, sun, hemisphere, fog);
  const sky = new THREE.Texture(); scene.background = sky; scene.backgroundIntensity = .65;
  scene.backgroundRotation.y = 1.1;
  const projection = sun.shadow.camera.projectionMatrix.clone(), position = sun.position.clone();
  for (const enabled of [true, false, true]) {
    daylight.setEnabled(enabled);
    const profile = enabled ? DAYLIGHT.cool : DAYLIGHT.original;
    assert.equal(sun.intensity, profile.sunIntensity);
    assert.equal(hemisphere.intensity, profile.fill);
    assert.equal(scene.environmentIntensity, profile.environment);
    assert.deepEqual(sun.shadow.camera.projectionMatrix, projection);
    assert.deepEqual(sun.position, position);
    assert.equal(scene.background, sky);
    assert.equal(scene.backgroundIntensity, .65);
    assert.equal(scene.backgroundRotation.y, 1.1);
  }
});
