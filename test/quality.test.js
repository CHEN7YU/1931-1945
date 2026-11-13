import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createQualitySettings, qualityProfile } from '../src/quality.js';

test('high/low profiles cap actual DPR, shadow resolution and smoke counts independently', () => {
  assert.deepEqual(qualityProfile('high', 2, 8192), { pixelRatioCap: 1.6, pixelRatio: 1.6, shadowSize: 4096, smokeBudget: 30 });
  assert.deepEqual(qualityProfile('low', 2, 8192), { pixelRatioCap: 1, pixelRatio: 1, shadowSize: 1024, smokeBudget: 10 });
  assert.equal(qualityProfile('high', .8, 2048).pixelRatio, .8);
  assert.equal(qualityProfile('high', 2, 2048).shadowSize, 2048);
});
test('invalid graphics presets and capabilities are reported rather than silently defaulting', () => {
  assert.throws(() => qualityProfile('ultra', 1, 4096), RangeError);
  assert.throws(() => qualityProfile('high', NaN, 4096), RangeError);
  assert.throws(() => qualityProfile('low', 1, 0), RangeError);
});

test('saved graphics settings apply on construction without first allocating the default high profile', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1, 100);
  const sun = new THREE.DirectionalLight();
  const ratios = [];
  let ratio = 2;
  const renderer = { capabilities: { maxTextureSize: 8192 }, shadowMap: { enabled: true },
    getPixelRatio: () => ratio, setPixelRatio(value) { ratio = value; ratios.push(value); },
    domElement: { width: 1440, height: 900 }, info: { memory: { textures: 0 } } };
  const options = { renderer, scene, sun, smoke: Array.from({ length: 30 }, () => ({ visible: true })),
    grain: { hidden: false }, deviceRatio: () => 2 };
  const settings = createQualitySettings({ ...options, initialPreset: 'low',
    initialEffects: { fog: false, shadows: false, grain: false, muzzle: false } });
  assert.deepEqual(ratios, [1]);
  assert.equal(settings.snapshot.preset, 'low');
  assert.equal(settings.snapshot.visibleSmoke, 10);
  assert.equal(settings.snapshot.fogEnabled, false);
  assert.equal(settings.snapshot.shadowsEnabled, false);
  assert.equal(settings.snapshot.grainEnabled, false);
  assert.equal(settings.snapshot.effects.muzzle, false);
  assert.equal(settings.snapshot.effects.hitParticles, true);
  settings.setPreset('high');
  assert.equal(settings.snapshot.effects.muzzle, false);
  assert.throws(() => createQualitySettings({ ...options, initialEffects: { unknown: true } }), RangeError);
  assert.throws(() => createQualitySettings({ ...options, initialEffects: { fog: 0 } }), RangeError);
});

test('automatic levels reduce actual pixels and optional effects while preserving manual preferences and combat feedback', () => {
  let ratio = 1.5;
  const sun = new THREE.DirectionalLight();
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 1, 100);
  const renderer = { capabilities: { maxTextureSize: 8192 }, shadowMap: { enabled: true },
    getPixelRatio: () => ratio, setPixelRatio(value) { ratio = value; },
    domElement: { width: 1280, height: 720 }, info: { memory: { textures: 0 } } };
  const settings = createQualitySettings({ renderer, scene, sun,
    smoke: Array.from({ length: 30 }, () => ({ visible: true })), grain: {}, deviceRatio: () => 1.5, initialPreset: 'high' });
  const manual = settings.snapshot.requested;
  settings.setAutomaticLevel(1);
  assert.equal(settings.snapshot.pixelRatio, 1.5);
  assert.equal(settings.snapshot.shadowSize, 2048);
  assert.equal(settings.snapshot.preset, 'high');
  settings.setAutomaticLevel(2);
  assert.equal(settings.snapshot.pixelRatio, 1.5);
  assert.equal(settings.snapshot.shadowsEnabled, true);
  settings.setAutomaticLevel(3);
  assert.equal(settings.snapshot.pixelRatio, .8);
  assert.equal(settings.snapshot.shadowsEnabled, true);
  assert.equal(settings.snapshot.shadowUpdateInterval, 4);
  assert.equal(sun.shadow.autoUpdate, false);
  sun.shadow.needsUpdate = false;
  for (let frame = 0; frame < 3; frame++) settings.beginFrame();
  assert.equal(sun.shadow.needsUpdate, false);
  settings.beginFrame(); assert.equal(sun.shadow.needsUpdate, true);
  assert.equal(settings.snapshot.visibleSmoke, 0);
  assert.equal(settings.snapshot.effects.muzzle, true);
  assert.equal(settings.snapshot.effects.hitParticles, true);
  assert.equal(settings.snapshot.effects.damageVignette, true);
  assert.equal(settings.snapshot.effects.fog, true);
  assert.deepEqual(settings.snapshot.requested, manual);
  settings.setAutomaticLevel(0);
  assert.equal(settings.snapshot.pixelRatio, 1.5);
  assert.equal(settings.snapshot.preset, 'high');
  assert.deepEqual(settings.snapshot.requested, manual);
  assert.throws(() => settings.setAutomaticLevel(4), RangeError);
});

test('restored automatic quality is applied before allocating any high-resolution frame or shadow target', () => {
  let ratio = 1.5;
  const ratios = [], sun = new THREE.DirectionalLight();
  const renderer = { capabilities: { maxTextureSize: 8192 }, shadowMap: { enabled: true },
    getPixelRatio: () => ratio, setPixelRatio(value) { ratio = value; ratios.push(value); },
    domElement: {}, info: { memory: { textures: 0 } } };
  const options = { renderer, scene: new THREE.Scene(), sun, smoke: [], grain: {}, deviceRatio: () => 1.5 };
  const settings = createQualitySettings({ ...options, initialPreset: 'high', initialAutomaticLevel: 3 });
  assert.deepEqual(ratios, [.8]);
  assert.equal(settings.snapshot.shadowsEnabled, true);
  assert.equal(settings.snapshot.preset, 'high');
  assert.equal(settings.snapshot.requested.preset, 'high');
  assert.throws(() => createQualitySettings({ ...options, initialAutomaticLevel: 4 }), RangeError);
});

test('Nanjing can retain bounded skyline smoke at automatic level two without overriding manual or memory safeguards', () => {
  let ratio = 1;
  const renderer = { capabilities: { maxTextureSize: 8192 }, shadowMap: { enabled: true },
    getPixelRatio: () => ratio, setPixelRatio(value) { ratio = value; },
    domElement: {}, info: { memory: { textures: 0 } } };
  const options = { renderer, scene: new THREE.Scene(), sun: new THREE.DirectionalLight(),
    smoke: Array.from({ length: 60 }, (_, index) => ({ visible: true, userData: { homeId: Math.floor(index / 5) } })),
    grain: {}, deviceRatio: () => 1,
    initialPreset: 'high', initialAutomaticLevel: 2, reducedSmokeAtLevel2: true };
  const settings = createQualitySettings(options);
  assert.equal(settings.snapshot.visibleSmoke, 10);
  const homes = options.smoke.filter(puff => puff.visible).map(puff => puff.userData.homeId);
  assert.deepEqual(homes, [0, 0, 0, 0, 0, 6, 6, 6, 6, 6],
    'the reduced budget retains complete plumes instead of isolated floating puffs');
  assert.equal(settings.snapshot.effects.smoke, false, 'expensive building-fire smoke remains reduced');
  settings.setEffect('smoke', false);
  assert.equal(settings.snapshot.visibleSmoke, 0);
  settings.setEffect('smoke', true);
  settings.setAutomaticLevel(3);
  assert.equal(settings.snapshot.visibleSmoke, 0);
  settings.setAutomaticLevel(2);
  assert.equal(settings.snapshot.visibleSmoke, 10);
  const lowMemory = createQualitySettings({ ...options, smoke: Array.from({ length: 60 }, () => ({})), lowMemory: true });
  assert.equal(lowMemory.snapshot.visibleSmoke, 0);
});
