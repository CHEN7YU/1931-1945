import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NANJING_EMPLACEMENTS, createEmplacement, emplacementLook, emplacementPose, emplacementEntry,
  advanceEmplacement, fireEmplacement, reloadEmplacement, emplacementObstacles, aimEmplacement,
  moveArtillery, setArtilleryPosition, ARTILLERY_MARCH, emplacementCooldown,
  aiEmplacementCanAimAt, aimAIEmplacement } from '../src/emplacements.js';
import { FOOT_SPEEDS } from '../src/locomotion.js';
import { createEmplacementModel } from '../src/emplacement-model.js';
import { NANJING_MAP_BOUNDS, NANJING_SPAWNS } from '../src/nanjing-campaign.js';
import { spawnBlockReason } from '../src/spawns.js';
import { circleBlocked, createNavigator, setMapBounds } from '../src/core.js';
import { makeNanjingBattlefield } from '../src/nanjing-battlefield.js';

test('bridge and dock each include a shared-profile heavy machine gun and 75mm mountain gun', () => {
  assert.equal(NANJING_EMPLACEMENTS.length, 11);
  assert.equal(NANJING_EMPLACEMENTS.find(point => point.id === 'gate-wall-mg').enclosed, true);
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
  setMapBounds(NANJING_MAP_BOUNDS);
  try {
    const obstacles = NANJING_EMPLACEMENTS.flatMap(emplacementObstacles);
    for (const spawn of NANJING_SPAWNS.filter(spawn => spawn.initialOnly))
      assert.equal(spawnBlockReason(spawn, 'infantry', [], obstacles), null, spawn.id);
    assert.equal(circleBlocked(-24, 31, .45, obstacles), false,
      'the existing bridge-to-gate civilian route must not start inside a new gun position');
    for (const spec of NANJING_EMPLACEMENTS) {
      const point = createEmplacement(spec), pose = emplacementPose(point, spec.altitude ?? 0);
      assert.equal(circleBlocked(pose.operator.x, pose.operator.z, .43, obstacles), false,
        `${spec.id}: the operator cannot be blocked by the gun base or an adjacent fixed weapon`);
    }
  } finally {
    setMapBounds();
  }
});

test('anti-aircraft mounts share the Maxim weapon specification, traverse all directions and only fire after alignment', () => {
  const specs = NANJING_EMPLACEMENTS.filter(point => point.profile === 'maxim24aa');
  assert.equal(specs.length, 3);
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

test('AI machine gun elevation rejects high targets and settles after player handover without limiting player aim', () => {
  for (const profile of ['maxim24', 'maxim24aa']) {
    const point = createEmplacement({ id: profile, profile, x: 0, z: 0, heading: 0 });
    const target = pitch => ({ x: 0, y: point.weapon.settings.muzzleHeight + 20 * Math.tan(pitch), z: -20 });
    assert.equal(aiEmplacementCanAimAt(point, target(.49)), true);
    assert.equal(aiEmplacementCanAimAt(point, target(.51)), false);
    emplacementLook(point, 0, point.weapon.settings.maxPitch);
    assert.equal(point.pitch, point.weapon.settings.maxPitch, 'player can still use the full range');
    let previous = point.pitch;
    for (let frame = 0; frame < 100; frame++) {
      assert.equal(aimAIEmplacement(point, null, .02), false);
      assert.ok(point.pitch <= previous && previous - point.pitch <= .8 * .02 + 1e-10);
      previous = point.pitch;
    }
    assert.ok(Math.abs(point.pitch - .5) < 1e-10);
    assert.equal(aimAIEmplacement(point, target(.51), .1), false);
    emplacementLook(point, 0, .52);
    assert.equal(aimAIEmplacement(point, target(.49), .01), false,
      'AI must not fire just above its limit even within alignment tolerance');
    for (let frame = 0; frame < 100; frame++) aimAIEmplacement(point, target(.3), .02);
    assert.ok(Math.abs(point.pitch - .3) < 1e-10);
    assert.equal(aimAIEmplacement(point, target(.3), .02), true);
    emplacementLook(point, 0, point.weapon.settings.maxPitch);
    assert.equal(point.pitch, point.weapon.settings.maxPitch, 'player can retake control without an AI cap');
  }
  const cannon = createEmplacement({ id: 'gun', profile: 'bofors75', x: 0, z: 0, heading: 0 });
  const target = { x: 0, y: cannon.weapon.settings.muzzleHeight + 20 * Math.tan(.53), z: -20 };
  assert.equal(aiEmplacementCanAimAt(cannon, target), true, 'field guns retain their original range');
});

test('Nanjing anti-aircraft guns can be re-entered after every orientation without bypassing real obstacles', () => {
  const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
  for (const spec of NANJING_EMPLACEMENTS.filter(point => point.profile === 'maxim24aa')) {
    const point = createEmplacement(spec), floor = point.altitude ?? 0;
    for (let step = 0; step < 144; step++) {
      point.yaw = point.heading + step * Math.PI / 72;
      const currentYaw = point.yaw;
      const blocked = operator => circleBlocked(operator.x, operator.z, .43, world.obstacles, operator.y);
      const original = emplacementPose(point, floor);
      const entry = emplacementEntry(point, floor, blocked);
      assert.ok(entry, `${point.id} yaw ${currentYaw}`);
      assert.equal(blocked(entry.pose.operator), false);
      assert.equal(point.yaw, currentYaw, 'finding an entry does not mutate the gun');
      if (!blocked(original.operator)) assert.equal(entry.yaw, currentYaw, 'clear aim remains unchanged');
    }
    assert.equal(emplacementEntry(point, floor, () => true), null, 'real obstructions remain authoritative');
  }
  const ordinary = createEmplacement(NANJING_EMPLACEMENTS[0]);
  assert.equal(emplacementEntry(ordinary, 0, () => true), null);
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

test('machine gun cooling and belt reload share an exact simulation-driven progress display', () => {
  for (const profile of ['maxim24', 'maxim24aa']) {
    const point = createEmplacement({ id: profile, profile, x: 0, z: 0, heading: 0 });
    point.heat = 1; point.overheated = true;
    const start = emplacementCooldown(point, 10);
    assert.equal(start.mode, 'cooling');
    assert.ok(Math.abs(start.remaining - .65 / .12) < 1e-10);
    assert.equal(start.progress, 0);
    advanceEmplacement(point, 0, 10);
    assert.deepEqual(emplacementCooldown(point, 10), start, 'pause cannot cool the gun');
    advanceEmplacement(point, 2, 12);
    assert.ok(emplacementCooldown(point, 12).progress > .36);
    advanceEmplacement(point, 4, 16);
    assert.equal(emplacementCooldown(point, 16), null);
    point.weapon.ammo = 0; reloadEmplacement(point, 16);
    assert.equal(emplacementCooldown(point, 18).mode, 'reload');
    assert.equal(emplacementCooldown(point, 18).remaining, 3);
    advanceEmplacement(point, 3, 21);
    assert.equal(emplacementCooldown(point, 21), null);
  }
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

test('machine-gun recoil follows successful shots without changing the next shot origin or aim', () => {
  for (const profile of ['maxim24', 'maxim24aa']) {
    const point = createEmplacement({ id: profile, profile, x: 4, z: 7, heading: .6 });
    point.operatorId = 'operator';
    emplacementLook(point, .8, .3);
    const model = createEmplacementModel(point), barrel = model.children[0].children[0];
    const base = emplacementPose(point), before = point.weapon.ammo;
    assert.equal(fireEmplacement(point, 1), true);
    assert.equal(fireEmplacement(point, 1.01), false);
    advanceEmplacement(point, .05, 1.05);
    model.userData.update();
    const kick = emplacementPose(point);
    assert.ok(point.recoil > .024 && point.recoil <= .025);
    const tip = barrel.localToWorld(new THREE.Vector3(0, 0, -point.weapon.settings.barrel));
    assert.ok(tip.distanceTo(new THREE.Vector3(kick.muzzle.x, kick.muzzle.y, kick.muzzle.z)) < 1e-10);
    const eyeShift = new THREE.Vector3(kick.eye.x - base.eye.x, kick.eye.y - base.eye.y, kick.eye.z - base.eye.z);
    const muzzleShift = new THREE.Vector3(kick.muzzle.x - base.muzzle.x, kick.muzzle.y - base.muzzle.y, kick.muzzle.z - base.muzzle.z);
    assert.ok(eyeShift.distanceTo(muzzleShift) < 1e-10, 'camera and real muzzle recoil together along the aim axis');
    assert.equal(point.weapon.ammo, before - 1);
    advanceEmplacement(point, 0, 1.05);
    assert.ok(point.recoil > .024, 'pausing cannot advance recoil');
    advanceEmplacement(point, .05, 1.1);
    model.userData.update();
    assert.equal(point.recoil, 0);
    assert.deepEqual(emplacementPose(point), base);
    assert.equal(fireEmplacement(point, 1.1), true);
    assert.equal(point.weapon.ammo, before - 2);
  }
});

test('field gun recoil follows a shot and returns to the original firing pose before reload', () => {
  const point = createEmplacement({ id: 'gun', profile: 'bofors75', x: 4, z: 7, heading: .6 });
  point.operatorId = 'operator';
  emplacementLook(point, .8, .2);
  const model = createEmplacementModel(point), barrel = model.children[0].children[0];
  const base = emplacementPose(point), before = point.weapon.ammo;
  assert.equal(fireEmplacement(point, 1), true);
  advanceEmplacement(point, .275, 1.275);
  model.userData.update();
  const kick = emplacementPose(point);
  assert.ok(point.recoil > .179 && point.recoil <= .18);
  assert.ok(Math.abs(model.position.x - point.x - Math.sin(point.yaw) * .045) < 1e-10);
  assert.ok(Math.abs(model.position.z - point.z - Math.cos(point.yaw) * .045) < 1e-10);
  const tip = barrel.localToWorld(new THREE.Vector3(0, 0, -point.weapon.settings.barrel));
  assert.ok(tip.distanceTo(new THREE.Vector3(kick.muzzle.x, kick.muzzle.y, kick.muzzle.z)) < 1e-10);
  const eyeShift = new THREE.Vector3(kick.eye.x - base.eye.x, kick.eye.y - base.eye.y, kick.eye.z - base.eye.z);
  const muzzleShift = new THREE.Vector3(kick.muzzle.x - base.muzzle.x, kick.muzzle.y - base.muzzle.y, kick.muzzle.z - base.muzzle.z);
  assert.ok(eyeShift.distanceTo(muzzleShift) < 1e-10);
  advanceEmplacement(point, 0, 1.275);
  assert.ok(point.recoil > .179, 'pausing cannot advance recoil');
  advanceEmplacement(point, .275, 1.55);
  model.userData.update();
  assert.equal(point.recoil, 0);
  assert.equal(model.position.x, point.x);
  assert.equal(model.position.z, point.z);
  assert.deepEqual(emplacementPose(point), base);
  assert.equal(point.weapon.ammo, before - 1);
  assert.equal(fireEmplacement(point, 1.55), false, 'reload timing is unchanged');
  const coastal = createEmplacement({ id: 'coastal', profile: 'bofors75', x: 4, z: 7,
    heading: .6, cannonRecoil: false });
  coastal.operatorId = 'operator';
  assert.equal(fireEmplacement(coastal, 1), true);
  advanceEmplacement(coastal, .275, 1.275);
  assert.equal(coastal.recoil, 0, 'separate coastal models keep their existing motion');
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
      const coverParts = model.children.filter(mesh => mesh.userData.emplacementCover)
        .reduce((count, mesh) => count + mesh.userData.partCount, 0);
      if (point.enclosed) assert.equal(coverParts, 0, 'the wall room uses its own protection, not a sandbag nest');
      else assert.ok(coverParts >= 18);
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

test('northern dock weapons face clear eastern streets and AA stays behind their firing line',()=>{
  const scene=new THREE.Scene(),world=makeNanjingBattlefield(scene,()=>new THREE.MeshStandardMaterial());
  for(const spawn of NANJING_SPAWNS.filter(point=>point.id.startsWith('nanjing-west')))
    assert.equal(spawnBlockReason(spawn,'infantry',[],world.obstacles),null,
      `${spawn.id}: northern defensive weapons must not occupy existing dock deployment clearance`);
  for(const spec of NANJING_EMPLACEMENTS) {
    const point=createEmplacement(spec),pose=emplacementPose(point,spec.altitude??world.groundHeight(point.x,point.z));
    assert.equal(circleBlocked(pose.operator.x,pose.operator.z,.43,world.obstacles,pose.operator.y),false,
      `${point.id}: the real crew position must not be inside masonry, a house or another emplacement`);
  }
  for(const id of ['dock-mg','dock-gun']){
    const point=createEmplacement(NANJING_EMPLACEMENTS.find(spec=>spec.id===id));
    assert.ok(point.z<=-90);assert.equal(point.heading,-Math.PI/2);
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

test('the two new ferry machine guns have supported, reachable crew positions and clear outward fire', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const guns = NANJING_EMPLACEMENTS.filter(spec => ['ferry-north-mg', 'ferry-south-mg'].includes(spec.id));
  assert.equal(guns.length, 2);
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  for (const spec of guns) {
    const point = createEmplacement(spec), floor = spec.altitude ?? world.groundHeight(spec.x, spec.z);
    const pose = emplacementPose(point, floor);
    assert.equal(world.groundHeight(point.x, point.z), floor);
    assert.equal(world.isDeepWater(point.x, point.z), false);
    assert.ok(emplacementEntry(point, floor,
      operator => circleBlocked(operator.x, operator.z, .43, world.obstacles, operator.y)));
    const start = { x: -85, y: 0, z: -60 }, path = navigate(start, pose.operator);
    assert.ok(path.length, `${spec.id}: ${navigate.stats.reason}`);
    for (const waypoint of path)
      world.moveInfantry(start, waypoint.x - start.x, waypoint.z - start.z, .42);
    assert.ok(Math.hypot(start.x - pose.operator.x, start.z - pose.operator.z) < .05, `${spec.id}: physical approach`);
    assert.ok(Math.abs(start.y - floor) < .01);
    const ray = new THREE.Raycaster(new THREE.Vector3(pose.muzzle.x, pose.muzzle.y, pose.muzzle.z),
      new THREE.Vector3(-Math.sin(point.yaw), 0, -Math.cos(point.yaw)), 0, 15);
    assert.equal(ray.intersectObjects(world.solids, true).length, 0, `${spec.id}: outward fire`);
  }
});

test('southern ferry anti-aircraft gun and artillery are reachable and leave the deployment zone clear', () => {
  const scene = new THREE.Scene(), world = makeNanjingBattlefield(scene, () => new THREE.MeshStandardMaterial());
  scene.updateMatrixWorld(true);
  const navigate = createNavigator(world.doorSystem.navigationObstacles);
  for (const id of ['ferry-south-aa', 'ferry-south-gun']) {
    const spec = NANJING_EMPLACEMENTS.find(point => point.id === id);
    const point = createEmplacement(spec), floor = world.groundHeight(point.x, point.z);
    assert.ok(point.z > -70 && point.x < -101.2, `${id} must be south of the fence`);
    assert.equal(world.isDeepWater(point.x, point.z), false);
    const blocked = operator => circleBlocked(operator.x, operator.z, .43, world.obstacles, operator.y);
    const entry = emplacementEntry(point, floor, blocked);
    assert.ok(entry, `${id}: operator position`);
    const start = { x: -107, y: 0, z: -55 };
    const path = navigate(start, entry.pose.operator);
    assert.ok(path.length, `${id}: ${navigate.stats.reason}`);
    for (const waypoint of path) world.moveInfantry(start, waypoint.x - start.x, waypoint.z - start.z, .42);
    assert.ok(Math.hypot(start.x - entry.pose.operator.x, start.z - entry.pose.operator.z) < .05, id);
    assert.equal(spawnBlockReason(NANJING_SPAWNS.find(spawn => spawn.id === 'nanjing-west-dock-south'),
      'infantry', [], world.obstacles), null);
    if (spec.profile === 'bofors75') {
      const muzzle = entry.pose.muzzle;
      const ray = new THREE.Raycaster(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z),
        new THREE.Vector3(0, 0, 1), 0, 15);
      assert.equal(ray.intersectObjects(world.solids, false).length, 0, `${id}: clear forward fire`);
    }
  }
});

test('artillery has no original-position tether, cannot exceed walking speed and retains physical obstruction and reload time',()=>{
  const point=createEmplacement(NANJING_EMPLACEMENTS.find(point=>point.profile==='bofors75'));
  const start={x:point.x,z:point.z};
  point.operatorId='player';point.weapon.ammo=0;reloadEmplacement(point,0);
  assert.equal(setArtilleryPosition(point,'march'),true);
  assert.equal(fireEmplacement(point,0),false);
  for(let step=0;step<500;step++)moveArtillery(point,1,0,.1,()=>true);
  const travelled=Math.hypot(point.x-start.x,point.z-start.z);
  assert.ok(travelled>40,'the old fifteen-metre tether must not survive under a larger replacement limit');
  assert.ok(Math.abs(travelled-50*ARTILLERY_MARCH.speed)<1e-8);
  for(const profile of Object.values(FOOT_SPEEDS))assert.ok(travelled<=50*profile.walk);
  const before={x:point.x,z:point.z,heading:point.heading};
  moveArtillery(point,-1,1,.2,()=>false);
  assert.deepEqual({x:point.x,z:point.z,heading:point.heading},before);
  assert.equal(point.weapon.reloadUntil,5.5);
  advanceEmplacement(point,5.5,5.5);
  assert.equal(setArtilleryPosition(point,'gunner'),true);
  assert.equal(point.weapon.ammo,1);assert.equal(point.weapon.reserve,23);
});

test('pushing speed stays frame-rate independent for forward, reverse and simultaneous steering',()=>{
  for(const hz of [30,60,144])for(const forward of [-1,1]){
    const point=createEmplacement(NANJING_EMPLACEMENTS.find(point=>point.profile==='bofors75'));
    point.operatorId='player';setArtilleryPosition(point,'march');
    let distance=0;
    for(let frame=0;frame<hz*2;frame++){
      const before={x:point.x,z:point.z};
      moveArtillery(point,forward,1,1/hz,()=>true);
      distance+=Math.hypot(point.x-before.x,point.z-before.z);
    }
    assert.ok(Math.abs(distance-2*ARTILLERY_MARCH.speed)<1e-8);
    for(const profile of Object.values(FOOT_SPEEDS))assert.ok(distance<=2*profile.walk);
  }
});
