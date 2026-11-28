import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';
import { NANJING_MAP_BOUNDS } from '../src/nanjing-campaign.js';

test('southern villages, farms, winter trees and wrecks render beyond the battle without new collision', () => {
  const scene = new THREE.Scene(), earthMap = new THREE.Texture(), materials = [];
  const surface = (name, color = 0xffffff, metersPerTile = 3) => {
    const material = new THREE.MeshStandardMaterial({ color, map: name === 'earth' ? earthMap : null });
    material.userData = { source: name, metersPerTile };
    materials.push(material);
    return material;
  };
  const world = makeNanjingBattlefield(scene, surface);
  const backdrop = world.landmarks.southBackdrop;
  const southHouses = backdrop.houses.filter(house => house.district !== 'southwest');
  const convertedFields = backdrop.fields.filter(field => field.formerHouse);
  assert.ok(southHouses.length >= 15 && southHouses.length < 30, 'southern homes are scattered rather than forming dense rows');
  assert.ok(convertedFields.length >= 12, 'former house sites become visible fields');
  assert.ok(backdrop.trees.length >= 20);
  for (const field of convertedFields) {
    assert.ok(southHouses.every(house => Math.abs(field.x - house.x) >= (field.width + house.width) / 2 ||
      Math.abs(field.z - house.z) >= (field.depth + house.depth) / 2), 'new fields must not cover standing houses');
    assert.ok(Math.abs(field.x - 2) > field.width / 2 + 3, 'new fields leave the central road clear');
  }
  assert.ok(backdrop.wrecks.some(wreck => wreck.type === 'tank'));
  assert.ok(backdrop.wrecks.some(wreck => wreck.type === 'truck'));
  assert.ok(backdrop.fixtures.some(fixture => fixture.kind === 'streetlamp'));
  assert.ok(backdrop.houses.filter(house => house.district === 'southwest').length >= 15);
  assert.ok(backdrop.fields.some(field => field.district === 'southwest'));
  assert.ok(backdrop.trees.some(tree => tree.district === 'southwest'));
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(backdrop.root);
  assert.ok(bounds.min.z > NANJING_MAP_BOUNDS.maxZ + 6, 'all visuals must stay beyond the playable boundary');
  assert.ok(backdrop.root.children.every(object => !world.solids.includes(object)));
  assert.ok(backdrop.wrecks.every(wreck => !world.obstacles.some(obstacle => obstacle.id === `wreck-${wreck.id}`)));
  const ground = scene.children.find(mesh => mesh.userData.nanjingFeature === 'south-distant-ground');
  for (const feature of ['dry-ground-surface', 'north-distant-ground'])
    assert.equal(scene.children.find(mesh => mesh.userData.nanjingFeature === feature).material, ground.material);
  const earthMaterials = materials.filter(material => material.userData.source === 'earth');
  const farmMaterials = backdrop.root.children.filter(mesh => mesh.isMesh && mesh.material.userData.source === 'earth')
    .map(mesh => mesh.material);
  assert.ok(farmMaterials.length >= 4, 'field, furrow and farm-road batches must use the corrected earth');
  for (const material of earthMaterials) {
    const shader = { fragmentShader: '#include <map_fragment>' };
    material.onBeforeCompile(shader);
    assert.match(shader.fragmentShader, /nanjingEarthLight/);
    assert.match(material.customProgramCacheKey(), /nanjing-earth-neutral/);
    assert.equal(material.map, earthMap, 'retain the original soil texture and its surface detail');
  }
  const crater = world.solids.find(mesh => mesh.name.startsWith('battlefield-crater-'));
  assert.ok(crater && crater.material !== ground.material && crater.material.vertexColors);
  assert.equal(crater.material.onBeforeCompile, ground.material.onBeforeCompile,
    'cloned crater soil must keep the same map correction');
  assert.equal(crater.material.customProgramCacheKey(), ground.material.customProgramCacheKey());
  for (const parcel of [...backdrop.houses, ...backdrop.trees, ...backdrop.fixtures]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(parcel.x, 100, parcel.z), new THREE.Vector3(0, -1, 0));
    assert.ok(Math.abs(ray.intersectObject(ground)[0].point.y - parcel.base) < .00001,
      'props must follow the real elevated terrain, not float at y=0');
  }
  assert.ok(backdrop.rendering.batches <= 24, 'pure distant scenery must not add hundreds of draw calls');
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 28), new THREE.Vector3(0, 0, 1));
  assert.ok(ray.intersectObjects(backdrop.root.children, true).length,
    'the actual south-facing gate view must see backdrop geometry, not just layout metadata');
});
