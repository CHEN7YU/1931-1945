import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NANJING_EMPLACEMENTS, createEmplacement, emplacementLook, emplacementPose,
  advanceEmplacement, fireEmplacement, reloadEmplacement, emplacementObstacles, aimEmplacement } from '../src/emplacements.js';
import { createEmplacementModel } from '../src/emplacement-model.js';
import { NANJING_SPAWNS } from '../src/nanjing-campaign.js';
import { spawnBlockReason } from '../src/spawns.js';
import { circleBlocked } from '../src/core.js';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';

test('bridge and dock each start with a usable shared-profile heavy machine gun and 75mm mountain gun', () => {
  assert.equal(NANJING_EMPLACEMENTS.length, 6);
  for (const place of ['bridge', 'dock']) {
    assert.deepEqual(NANJING_EMPLACEMENTS.filter(point => point.id.startsWith(place) && !point.id.endsWith('-aa')).map(point => point.profile),
      ['maxim24', 'bofors75']);
  }
  for (const spec of NANJING_EMPLACEMENTS) {
    const point = createEmplacement(spec), model = createEmplacementModel(point);
    point.operatorId = 'soldier';
    const shots = point.shots;
    assert.equal(fireEmplacement(point, 1), true);
    assert.equal(point.shots, shots + 1);
    assert.equal(fireEmplacement(point, 1), false, 'held input cannot bypass the firing interval');
    const look = emplacementLook(point, point.heading + 3, 1.5);
    assert.ok(look.yaw - point.heading <= point.weapon.settings.traverse + 1e-8);
    assert.equal(look.pitch, point.weapon.settings.maxPitch);
    model.userData.update(); model.updateMatrixWorld(true);
    const pose = emplacementPose(point);
    assert.ok(pose.muzzle.y > point.weapon.settings.muzzleHeight);
    assert.ok(model.children.length > 1);
  }
});

test('predefined weapons never obstruct the three opening squad assembly zones', () => {
  const obstacles = NANJING_EMPLACEMENTS.flatMap(emplacementObstacles);
  for (const spawn of NANJING_SPAWNS.filter(spawn => spawn.initialOnly))
    assert.equal(spawnBlockReason(spawn, 'infantry', [], obstacles), null, spawn.id);
  assert.equal(circleBlocked(-24, 31, .45, obstacles), false,
    'the existing bridge-to-gate civilian route must not start inside a new gun position');
  for (const spec of NANJING_EMPLACEMENTS) {
    const point = createEmplacement(spec), pose = emplacementPose(point, spec.altitude ?? 0);
    assert.equal(circleBlocked(pose.operator.x, pose.operator.z, .43, obstacles), false,
      'the operator cannot be blocked by the gun base or an adjacent fixed weapon');
  }
});

test('both anti-aircraft mounts share the Maxim weapon specification, traverse all directions and only fire after alignment', () => {
  const specs = NANJING_EMPLACEMENTS.filter(point => point.profile === 'maxim24aa');
  assert.equal(specs.length, 2);
  assert.ok(specs.some(point => point.id === 'gate-aa' && point.altitude > 8));
  assert.ok(specs.some(point => point.id === 'dock-aa'));
  for (const spec of specs) {
    const point = createEmplacement(spec), floor = spec.altitude ?? 0;
    const target = { x: point.x + 30, y: floor + 50, z: point.z - 30 };
    let ready = false;
    for (let frame = 0; frame < 600; frame++) ready = aimEmplacement(point, target, 1 / 60, floor);
    assert.equal(ready, true);
    assert.ok(point.pitch > .7 && point.pitch < 1.45);
    assert.equal(point.weapon.settings.magazine, 200);
  }
});

test('fixed guns have finite ammunition, simulated reloads and cooling; pausing cannot finish a reload', () => {
  const point = createEmplacement(NANJING_EMPLACEMENTS[0]);
  point.operatorId = 'operator'; point.weapon.ammo = 1;
  assert.equal(fireEmplacement(point, 0), true);
  assert.equal(reloadEmplacement(point, 0), true);
  const before = structuredClone(point.weapon);
  advanceEmplacement(point, 0, 0);
  assert.deepEqual(point.weapon, before);
  advanceEmplacement(point, 5, 5);
  assert.equal(point.weapon.ammo, 200);
  assert.equal(point.weapon.reserve, before.reserve - 200);
  point.heat = 1; point.overheated = true;
  assert.equal(fireEmplacement(point, 6), false);
  advanceEmplacement(point, 6, 11);
  assert.equal(point.overheated, false);
  assert.equal(fireEmplacement(point, 11), true);
  point.operatorId = null;
  assert.equal(fireEmplacement(point, 12), false);
});

test('fixed weapon barrels share the constrained sight direction and use only locally authored geometry', () => {
  const point = createEmplacement(NANJING_EMPLACEMENTS[1]);
  emplacementLook(point, 3.1, .2);
  const model = createEmplacementModel(point);
  model.updateMatrixWorld(true);
  const barrel = model.children[0].children[0];
  const direction = new THREE.Vector3(0, 0, -1).transformDirection(barrel.matrixWorld);
  const pose = emplacementPose(point);
  const expected = new THREE.Vector3(-Math.sin(point.yaw) * Math.cos(point.pitch), Math.sin(point.pitch),
    -Math.cos(point.yaw) * Math.cos(point.pitch));
  assert.ok(direction.distanceTo(expected) < 1e-10);
  assert.ok(Number.isFinite(pose.muzzle.x));
});

test('gunner sights remain open through the cannon shield and machine-gun nests retain rear access', () => {
  for (const spec of NANJING_EMPLACEMENTS) {
    const point = createEmplacement(spec), model = createEmplacementModel(point);
    const floor = spec.altitude ?? 0;
    model.position.y = floor; model.updateMatrixWorld(true);
    const pose = emplacementPose(point, floor), origin = new THREE.Vector3(pose.eye.x, pose.eye.y, pose.eye.z);
    const forward = new THREE.Vector3(-Math.sin(point.yaw) * Math.cos(point.pitch), Math.sin(point.pitch), -Math.cos(point.yaw) * Math.cos(point.pitch));
    const ray = new THREE.Raycaster(origin, forward, 0, 3);
    assert.equal(ray.intersectObject(model, true).filter(hit => !hit.object.userData.sightReticle).length, 0, spec.id);
    if (point.profile === 'maxim24') {
      const obstacles = emplacementObstacles(point), operator = pose.operator;
      assert.equal(circleBlocked(operator.x, operator.z, .43, obstacles), false);
      assert.ok(model.children.filter(mesh => mesh.userData.emplacementCover)
        .reduce((count, mesh) => count + mesh.userData.partCount, 0) >= 18);
    }
  }
});

test('AA detail includes the feed, controls, cradle and true tripod without excessive draw submissions', () => {
  const model = createEmplacementModel(createEmplacement(NANJING_EMPLACEMENTS.find(spec => spec.id === 'dock-aa')));
  for (const detail of ['water-jacket','open-muzzle','feed-belt','spade-grips','trunnion-cradle',
    'elevation-wheel','tripod-braces','ring-sight']) assert.ok(model.userData.details.includes(detail));
  let meshes = 0, parts = 0;
  model.traverse(object => { if (object.isMesh) { meshes++; parts += object.userData.partCount; } });
  assert.ok(parts > 70, 'measure the actual authored component geometry');
  assert.ok(meshes <= 12, 'merge detail by material and moving assembly instead of adding a draw call per rivet');
});

test('dock weapons face open streets instead of nearby houses and AA stays behind their firing line',()=>{
  const scene=new THREE.Scene(),world=makeNanjingBattlefield(scene,()=>new THREE.MeshStandardMaterial());
  for(const spec of NANJING_EMPLACEMENTS) {
    const point=createEmplacement(spec),pose=emplacementPose(point,spec.altitude??world.groundHeight(point.x,point.z));
    assert.equal(circleBlocked(pose.operator.x,pose.operator.z,.43,world.obstacles,pose.operator.y),false,
      `${point.id}: the real crew position must not be inside masonry, a house or another emplacement`);
  }
  for(const id of ['dock-mg','dock-gun']){
    const point=createEmplacement(NANJING_EMPLACEMENTS.find(spec=>spec.id===id));
    const pose=emplacementPose(point,world.groundHeight(point.x,point.z));
    const ray=new THREE.Raycaster(new THREE.Vector3(pose.muzzle.x,pose.muzzle.y,pose.muzzle.z),
      new THREE.Vector3(-Math.sin(point.yaw),0,-Math.cos(point.yaw)),0,25);
    const hits=ray.intersectObjects(world.solids,true);
    assert.equal(hits.length,0,`${id}: the actual muzzle must have 25 metres of unobstructed forward fire; `+
      JSON.stringify(hits.slice(0,1).map(hit=>({distance:hit.distance,feature:hit.object.userData.nanjingFeature}))));
  }
  const aa=NANJING_EMPLACEMENTS.find(point=>point.id==='dock-aa');
  assert.ok(aa.x<NANJING_EMPLACEMENTS.find(point=>point.id==='dock-mg').x-8);
});
