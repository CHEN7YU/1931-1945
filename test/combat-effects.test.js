import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCombatEffects } from '../src/combat-effects.js';

const settings = { preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } };
function fixture(isGround) {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.y = 1.67;
  let queries = 0, effects;
  try { effects = createCombatEffects(scene, camera, () => { queries++; return 0; }, isGround); }
  finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
  effects.configure(settings);
  const fragments = scene.children.find(object => object.isInstancedMesh);
  return { scene, camera, effects, fragments, get queries() { return queries; } };
}
const impact = z => ({ position: { x: 0, y: .1, z }, normal: { x: 0, y: 1, z: 0 }, kind: 'stone' });

test('tank fire and aircraft smoke both receive a single-use live vehicle registry iterator', () => {
  const { effects } = fixture();
  const registry = new Map([
    ['tank', { id: 'tank', type: 'tank', health: 0, destroyedAt: 0, position: new THREE.Vector3(0, 0, -20),
      heading: 0, turretYaw: 0 }],
    ['plane', { id: 'plane', type: 'plane', team: 'enemy', health: 0, fall: { grounded: false },
      position: new THREE.Vector3(0, 40, -30), heading: 0, pitch: 0, roll: 0 }],
  ]);
  for (const preset of ['high', 'low']) {
    effects.clear(); effects.configure({ ...settings, preset });
    effects.render(0, registry.values()); effects.render(.4, registry.values());
    assert.ok(effects.snapshot.aircraftSmoke.sources.includes('plane'));
    assert.ok(effects.snapshot.aircraftSmoke.puffs >= 4);
    assert.ok(effects.snapshot.aircraftSmoke.visible);
    assert.ok(effects.snapshot.tankFire.sources.length > 0, JSON.stringify(effects.snapshot.tankFire));
  }
});

test('aircraft hits display a brief airborne fireball at flight distance without ground dust or a ground shock ring', () => {
  const { effects, scene } = fixture();
  for (const preset of ['high', 'low']) {
    effects.clear(); effects.configure({ ...settings, preset });
    effects.explosion(new THREE.Vector3(0, 60, -260), 0, 9, 'aircraft-hit');
    effects.render(0);
    assert.equal(effects.snapshot.lastExplosion.rendered, true);
    assert.ok(effects.snapshot.renderedClouds >= 3);
    assert.ok(effects.snapshot.fireClouds >= 2);
    assert.equal(effects.snapshot.fragments, 0);
    assert.equal(effects.snapshot.shockwaves, 0);
    assert.ok(scene.children.filter(node => node.isSprite && node.visible).every(node => node.position.y >= 60));
    effects.render(.65);
    assert.equal(effects.snapshot.fireClouds, 0, 'hit fireball is not a permanent bonfire');
  }
});

test('a ground bomb leaves dark smoke and a longer-lived mark even when the initial blast was out of view', () => {
  const { effects, camera } = fixture();
  effects.configure({ preset: 'low', effects: { muzzle: false, muzzleLight: false, hitParticles: false } });
  const point = new THREE.Vector3(0, .22, -320);
  effects.explosion(point, 0, 17, 'aircraft-bomb', { kind: 'soil', normal: { x: 0, y: 1, z: 0 } });
  effects.render(0);
  assert.equal(effects.snapshot.lastExplosion.rendered, false);
  assert.equal(effects.snapshot.bombAftermath.marks, 1);
  camera.position.z = -300;
  effects.render(8);
  assert.equal(effects.snapshot.clouds, 0);
  assert.equal(effects.snapshot.bombAftermath.visibleMarks, 1);
  assert.ok(effects.snapshot.bombAftermath.visiblePuffs > 0);
  effects.render(17);
  assert.deepEqual(effects.snapshot.bombAftermath, { marks: 1, visibleMarks: 1, visiblePuffs: 0 });
  effects.clear();
  assert.deepEqual(effects.snapshot.bombAftermath, { marks: 0, visibleMarks: 0, visiblePuffs: 0 });
});

test('only ground impacts leave scorch marks, and repeated hits reuse a bounded pool', () => {
  const { effects, scene } = fixture();
  const point = new THREE.Vector3(0, .22, -20), normal = { x: 0, y: 1, z: 0 };
  effects.explosion(new THREE.Vector3(0, 4, -20), 0, 17, 'aircraft-bomb');
  effects.explosion(point, 0, 17, 'aircraft-bomb', { kind: 'generic', normal });
  effects.explosion(point, 0, 7, 'default', { kind: 'soil', normal });
  effects.render(0);
  assert.equal(effects.snapshot.bombAftermath.marks, 0);
  const objectCount = scene.children.length;
  for (let i = 0; i < 30; i++) effects.explosion(point, 0, 17, 'aircraft-bomb', { kind: 'soil', normal });
  effects.render(0);
  assert.equal(scene.children.length, objectCount);
  assert.ok(effects.snapshot.bombAftermath.marks < 30);
  effects.render(56);
  assert.equal(effects.snapshot.bombAftermath.marks, 0);
});

test('ground impacts leave progressively larger marks for stronger weapons', () => {
  const { effects, scene } = fixture();
  const marks = scene.children.filter(item => item.isMesh && item.material.map?.isDataTexture);
  const styles = ['grenade', 'grenade-discharger', 'mortar', 'explosive-pack', 'tank-shell', 'aircraft-bomb'];
  const sizes = [];
  for (const style of styles) {
    effects.clear();
    effects.explosion(new THREE.Vector3(0, .1, -20), 0, 8, style);
    effects.render(2);
    assert.equal(effects.snapshot.bombAftermath.marks, 1, style);
    assert.ok(effects.snapshot.bombAftermath.visiblePuffs > 0, style);
    sizes.push(marks.find(mark => mark.visible).geometry.boundingSphere.radius);
  }
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1], `${styles[i]} > ${styles[i - 1]}`);
});

test('water and explicit non-ground impacts never leave ground scorch marks', () => {
  const { effects } = fixture((x) => x !== 1);
  const normal = { x: 0, y: 1, z: 0 };
  for (const style of ['tank-shell', 'explosive-pack', 'mortar', 'grenade-discharger', 'grenade']) {
    effects.explosion(new THREE.Vector3(1, .1, -20), 0, 8, style, { kind: 'soil', normal });
    effects.explosion(new THREE.Vector3(0, .1, -20), 0, 8, style, { kind: 'stone', normal });
    effects.explosion(new THREE.Vector3(0, 4, -20), 0, 8, style);
  }
  effects.render(0);
  assert.equal(effects.snapshot.bombAftermath.marks, 0);
});

test('a grenade retains a readable flash, dust and shock front even with low-quality hit debris disabled', () => {
  const { effects } = fixture();
  effects.configure({ preset: 'low', effects: { muzzle: false, muzzleLight: false, hitParticles: false } });
  effects.explosion(new THREE.Vector3(0, .1, -3), .1, 7, 'grenade');
  effects.render(.1);
  assert.equal(effects.snapshot.lastExplosion.rendered, true);
  assert.equal(effects.snapshot.fragments, 0);
  assert.ok(effects.snapshot.renderedClouds >= 3 && effects.snapshot.renderedClouds <= 6);
  assert.equal(effects.snapshot.visibleLights, 0);
  effects.configure({ preset: 'low', effects: { muzzle: false, muzzleLight: false, hitParticles: false } });
  assert.ok(effects.snapshot.blastClouds > 0, 'changing settings must not erase the main grenade explosion');
});

test('many simulation events share one presentation pass and retain catch-up birth flashes', () => {
  const { effects } = fixture(), before = effects.snapshot.presentationPasses;
  for (let i = 0; i < 10; i++) effects.hit(impact(-20), .25);
  effects.muzzle(new THREE.Vector3(0, 1.5, -2), new THREE.Vector3(0, 0, -1), .25);
  effects.explosion(new THREE.Vector3(0, .1, -20), .25);
  assert.equal(effects.snapshot.presentationPasses, before, 'emission does not upload the whole pool after every event');
  effects.render(.25);
  const snapshot = effects.snapshot;
  assert.equal(snapshot.presentationPasses, before + 1);
  assert.equal(snapshot.renderedFragments, snapshot.fragments);
  assert.ok(snapshot.visibleLights > 0 && snapshot.renderedClouds > 0);
  assert.equal(snapshot.shaderLights, 2, 'culling must not churn shader light-count variants');
});

test('offscreen particles skip instance uploads and return immediately at their real age, not their birth pose', () => {
  const away = fixture(), reference = fixture(), position = new THREE.Vector3(0, .1, 50);
  reference.camera.rotation.y = Math.PI;
  for (const { effects } of [away, reference]) effects.explosion(position, 0);
  const version = away.fragments.instanceMatrix.version;
  for (const time of [.05, .2, .5]) {
    away.effects.render(time);
    reference.effects.render(time);
    const snapshot = away.effects.snapshot;
    assert.ok(snapshot.fragments > 0 && snapshot.clouds > 0);
    assert.equal(snapshot.renderedFragments + snapshot.renderedClouds + snapshot.visibleLights, 0);
    assert.equal(snapshot.shaderLights, 2);
  }
  assert.equal(away.fragments.instanceMatrix.version, version, 'hidden fragments perform zero matrix uploads');
  away.camera.rotation.y = Math.PI;
  away.effects.render(.5);
  reference.effects.render(.5);
  assert.ok(away.effects.snapshot.renderedFragments > 0 && away.effects.snapshot.renderedClouds > 0);
  assert.equal(away.fragments.instanceMatrix.version, version + 1);
  assert.deepEqual(away.fragments.instanceMatrix.array, reference.fragments.instanceMatrix.array);
  const visibleClouds = fixture => fixture.scene.children.filter(object => object.isSprite && object.visible)
    .map(object => ({ position: object.position.toArray(), scale: object.scale.toArray(), opacity: object.material.opacity }));
  assert.deepEqual(visibleClouds(away), visibleClouds(reference), 'returning smoke matches an always-visible reference');
  const queries = away.queries;
  away.effects.render(.5);
  assert.equal(away.queries, queries, 'paused presentation does not repeat terrain integration');
});

test('hidden expired fragments are retired without terrain catch-up and never replay on return', () => {
  const sample = fixture();
  sample.effects.explosion(new THREE.Vector3(0, .1, 50), 0);
  sample.effects.render(5);
  assert.equal(sample.queries, 0);
  sample.camera.rotation.y = Math.PI;
  sample.effects.render(5);
  const snapshot = sample.effects.snapshot;
  assert.equal(snapshot.fragments + snapshot.clouds + snapshot.lights + snapshot.renderedFragments + snapshot.renderedClouds, 0);
});

test('offscreen light volumes still illuminate the image and quality toggles remain immediate', () => {
  const { effects, camera } = fixture();
  effects.muzzle(new THREE.Vector3(0, camera.position.y, 1), new THREE.Vector3(0, 0, -1), 0);
  effects.render(0);
  assert.equal(effects.snapshot.visibleLights, 1);
  effects.configure({ ...settings, preset: 'low' });
  assert.equal(effects.snapshot.visibleLights, 0);
  assert.equal(effects.snapshot.shaderLights, 0);
  effects.configure({ ...settings, effects: { muzzle: false, muzzleLight: false, hitParticles: false } });
  assert.equal(effects.snapshot.fragments + effects.snapshot.clouds + effects.snapshot.lights, 0);
  effects.clear();
  effects.configure(settings);
  effects.render(0);
  assert.equal(effects.snapshot.fragments + effects.snapshot.clouds + effects.snapshot.lights, 0);
});

test('automatic optional-light reduction zeros illumination without changing the shader light count', () => {
  const { effects, camera } = fixture();
  effects.muzzle(new THREE.Vector3(0, camera.position.y, 1), new THREE.Vector3(0, 0, -1), 0);
  effects.render(0);
  assert.equal(effects.snapshot.shaderLights, 2);
  effects.configure({ ...settings, effects: { ...settings.effects, muzzleLight: false } });
  assert.equal(effects.snapshot.visibleLights, 0);
  assert.equal(effects.snapshot.shaderLights, 2, 'automatic shedding must not recompile every lit material');
});
