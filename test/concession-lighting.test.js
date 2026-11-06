import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeSihangBattlefield } from '../src/sihang-battlefield.js';

test('concession windows and actual light strips are off by day, on at night, without rebuilding the city', () => {
  const scene = new THREE.Scene(), world = makeSihangBattlefield(scene,
    (_kind, color) => new THREE.MeshStandardMaterial({ color }));
  const before = [];
  scene.traverse(node => { if (node.isMesh) before.push([node.uuid, node.geometry.uuid]); });
  const day = world.concessionLighting;
  assert.equal(day.night, false);
  for (const key of ['windowIntensity', 'redIntensity', 'greenIntensity', 'signIntensity']) assert.equal(day[key], 0);
  world.setNightLighting(true);
  const night = world.concessionLighting;
  assert.equal(night.night, true);
  assert.notEqual(night.windowColor, day.windowColor, 'day glass must not retain the bright yellow night tint');
  for (const key of ['windowIntensity', 'redIntensity', 'greenIntensity', 'signIntensity']) assert.ok(night[key] > 0);
  for (let index = 0; index < 20; index++) world.setNightLighting(index % 2 === 0);
  world.setNightLighting(false);
  assert.deepEqual(world.concessionLighting, day);
  const after = [];
  scene.traverse(node => { if (node.isMesh) after.push([node.uuid, node.geometry.uuid]); });
  assert.deepEqual(after, before);
  assert.equal(scene.children.some(node => node.isPointLight), false);
  assert.throws(() => world.setNightLighting('night'), TypeError);
});
