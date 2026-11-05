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
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 1, 100);
  const renderer = { capabilities: { maxTextureSize: 8192 }, shadowMap: { enabled: true },
    getPixelRatio: () => ratio, setPixelRatio(value) { ratio = value; },
    domElement: { width: 1280, height: 720 }, info: { memory: { textures: 0 } } };
  const settings = createQualitySettings({ renderer, scene, sun: new THREE.DirectionalLight(),
    smoke: Array.from({ length: 30 }, () => ({ visible: true })), grain: {}, deviceRatio: () => 1.5 });
  const manual = settings.snapshot.requested;
  settings.setAutomaticLevel(1);
  assert.equal(settings.snapshot.pixelRatio, 1);
  assert.equal(settings.snapshot.shadowSize, 1024);
  settings.setAutomaticLevel(2);
  assert.equal(settings.snapshot.pixelRatio, .8);
  assert.equal(settings.snapshot.shadowsEnabled, false);
  settings.setAutomaticLevel(3);
  assert.equal(settings.snapshot.pixelRatio, .6);
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
