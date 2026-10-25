import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planRifleTextures } from '../src/optional-rifle-textures.js';
import { RIFLE_PBR_ASSETS } from '../src/weapon-assets.js';

const asset = { license: 'CC0-1.0', source: 'original test fixture', normalFormat: 'OpenGL' };
test('empty optional configuration preserves the generated materials and requests nothing', () => {
  assert.deepEqual(planRifleTextures(RIFLE_PBR_ASSETS), []);
});
test('color is sRGB while normal and roughness/metallic sampling remains linear', () => {
  const plan = planRifleTextures({ steel: { ...asset, color: '/assets/test/color.png', normal: '/assets/test/normal.png',
    roughness: '/assets/test/arm.png', metalness: '/assets/test/arm.png' } });
  assert.deepEqual(plan.map(item => item.property), ['map', 'normalMap', 'roughnessMap', 'metalnessMap']);
  assert.equal(plan[0].colorSpace, THREE.SRGBColorSpace);
  assert.ok(plan.slice(1).every(item => item.colorSpace === THREE.NoColorSpace));
});
test('nonlocal resources, missing license/source, non-OpenGL normals and metal wood are rejected', () => {
  assert.throws(() => planRifleTextures({ steel: { ...asset, color: 'https://example.com/steel.png' } }), /本地/);
  assert.throws(() => planRifleTextures({ steel: { ...asset, color: '/assets/../steel.png' } }), /本地/);
  assert.throws(() => planRifleTextures({ wood: { color: '/assets/wood.png' } }), /CC0/);
  assert.throws(() => planRifleTextures({ wood: { ...asset, source: '', color: '/assets/wood.png' } }), /来源/);
  assert.throws(() => planRifleTextures({ wood: { ...asset, metalness: '/assets/wood-metal.png' } }), /非金属/);
  assert.throws(() => planRifleTextures({ steel: { ...asset, normalFormat: 'DirectX', normal: '/assets/n.png' } }), /OpenGL/);
  assert.throws(() => planRifleTextures({ steel: { ...asset, roughnes: '/assets/r.png' } }), /Unknown/);
  assert.throws(() => planRifleTextures({ steel: null }), /配置无效/);
});
