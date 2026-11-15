import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSihangCampaign, advanceSihangCampaign, SIHANG_RULES } from '../src/sihang-campaign.js';
import { createSihangNight, sihangFlareState, sihangNightVisibility, SIHANG_VISUAL_NIGHTFALL_SECONDS } from '../src/sihang-night.js';
import { sihangEnemyRayRange, sihangEnemyTargetAllowed, sihangSpawns, sihangEnemyRegroupPosts, SIHANG_EMPLACEMENTS } from '../src/sihang-roster.js';
import { sihangBlastClearOfSouthBank, sihangRiverBounds, sihangNorthBank, SIHANG_WAREHOUSE, SIHANG_TANK_ORIGINS } from '../src/sihang-layout.js';
import { SIHANG_SOUTH_BANK_LAMP_SPACING, sihangSouthBankStreetLampPositions } from '../src/sihang-city.js';
import { addSihangBridgeDefenses } from '../src/sihang-bridge-defenses.js';
import { makeWorld } from '../src/battlefield.js';
import { campaignLayout } from '../src/campaign-layout.js';
import { formationPositions } from '../src/battle-roster.js';
import { circleBlocked, createNavigator } from '../src/core.js';
import { pointSegmentDistance } from '../src/tactics.js';
import { createEmplacement, emplacementPose, emplacementCanAimAt, emplacementLook, emplacementObstacles } from '../src/emplacements.js';
import { SIHANG_ASSEMBLY_ARRIVAL, sihangAssemblyPosition, sihangRetreatFollowPosition, sihangAssemblyApproach, sihangParadePosition, sihangParadeExit, createProceduralStaticFormation } from '../src/sihang-formation.js';

test('the south-bank follow row transitions continuously back to normal following', () => {
  const desired = { x: 20, z: -6 }, actor = { index: 8 };
  const player = { index: 2, position: { x: 18, y: 0, z: -4 } };
  const row = sihangRetreatFollowPosition(actor, player, desired);
  assert.deepEqual(row, { x: 10.8, z: -6.7 });
  player.position.x = 22.74;
  const chokeRow = sihangRetreatFollowPosition(actor, player, desired);
  assert.ok(Math.abs(chokeRow.x - 15.54) < 1e-8);
  assert.equal(chokeRow.z, -6.7);
  player.position.x = 34;
  assert.deepEqual(sihangRetreatFollowPosition(actor, player, desired), desired);
  player.position.x = 18.001;
  const next = sihangRetreatFollowPosition(actor, player, desired);
  assert.ok(Math.hypot(next.x - row.x, next.z - row.z) < .01);
  player.position.y = 4;
  assert.deepEqual(sihangRetreatFollowPosition(actor, player, desired), desired);
  player.position.y = 0;
  player.index = 9;
  assert.notDeepEqual(sihangRetreatFollowPosition(actor, player, desired), next);
});

function nightCampaign() {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, 240);
  state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  return state;
}

test('bridge defenses isolate the artificially trapped tank fixture from its real spawn', () => {
  const scene = new THREE.Scene(), world = makeWorld(scene,
    (_kind, color) => new THREE.MeshStandardMaterial({ color }), campaignLayout('sihang'));
  const oldPositions = SIHANG_EMPLACEMENTS.filter(point =>
    ['sihang-cover-gun', 'sihang-cover-mg', 'sihang-cover-aa'].includes(point.id)).map(point => ({
    ...point, ...({
      'sihang-cover-gun': { x: 56, z: -26, heading: .65 },
      'sihang-cover-mg': { x: 64, z: -26, heading: .4 },
      'sihang-cover-aa': { x: 44, z: -26, heading: .5 },
    })[point.id],
  }));
  for (const point of oldPositions) {
    world.obstacles.push(...emplacementObstacles(createEmplacement(point)));
    for (const side of [-1, 1]) {
      const x = point.x + side * 2.3, z = point.z - 1.8;
      world.obstacles.push({ minX: x - 1.9, maxX: x + 1.9, minZ: z - .24, maxZ: z + .24,
        minY: 0, height: .75 });
    }
  }
  const navigate = createNavigator(world.armorObstacles, 1.5, 3.1);
  const isolated = { x: 50, z: -24 }, connected = { x: 50, z: -35 };
  assert.equal(circleBlocked(isolated.x, isolated.z, 3.1, world.armorObstacles), false);
  assert.equal(navigate(SIHANG_TANK_ORIGINS[1], isolated).length, 0);
  assert.equal(navigate(isolated, { x: 70, z: -55 }).length, 0);
  assert.ok(navigate(SIHANG_TANK_ORIGINS[1], connected).length > 0);
  assert.ok(navigate(connected, { x: 70, z: -55 }).length > 0);
});

test('retreat guns cover the northern approaches without pointing across the bridge route', () => {
  const scene = new THREE.Scene(), world = makeWorld(scene,
    (_kind, color) => new THREE.MeshStandardMaterial({ color }), campaignLayout('sihang'));
  const positions = SIHANG_EMPLACEMENTS.filter(point => point.retreatCover);
  addSihangBridgeDefenses(scene, world, positions);
  scene.updateMatrixWorld(true);
  const armorRoute = createNavigator(world.armorObstacles, 1.5, 3.1);
  assert.ok(armorRoute(SIHANG_TANK_ORIGINS[1], { x: 70, z: -30 }).length,
    'the new defenses must not cut off the eastern armored approach');
  const guns = positions.filter(point => point.profile !== 'maxim24aa');
  assert.equal(guns.filter(point => point.profile === 'bofors75').length, 2);
  assert.equal(guns.filter(point => point.profile === 'maxim24').length, 2);
  assert.ok(positions.every(point => point.z < -35));
  assert.ok(Math.max(...positions.map(point => point.x)) > 76 &&
    Math.min(...positions.map(point => point.x)) < 60 &&
    Math.max(...positions.map(point => point.z)) - Math.min(...positions.map(point => point.z)) >= 10,
  'positions form an arc around the northern bridge approach');
  const path = world.elevatedPath(sihangAssemblyPosition(4, 2),
    { x: 72, y: 0, z: -30, transit: true });
  assert.ok(path.length, 'the real planner must retain a route to the bridge');
  const route = [sihangAssemblyPosition(4, 2), ...path];
  for (const spec of guns) {
    const point = createEmplacement(spec), muzzle = emplacementPose(point, 0).muzzle;
    for (let i = 1; i < route.length; i++) {
      const start = route[i - 1], end = route[i];
      for (let step = 0; step <= 20; step++) {
        const t = step / 20, target = { x: start.x + (end.x - start.x) * t,
          y: 1.2, z: start.z + (end.z - start.z) * t };
        assert.ok(target.z > point.z, `${point.id}: withdrawal stays south of the firing line`);
        assert.equal(emplacementCanAimAt(point, target), false, `${point.id}: route is outside its traverse`);
      }
    }
    let visible = false;
    for (let z = -50; z >= -90 && !visible; z -= 5) for (let x = 28; x <= 84 && !visible; x += 2) {
      const target = { x, y: 1.2, z };
      if (!emplacementCanAimAt(point, target) || circleBlocked(x, z, .5, world.obstacles, 0)) continue;
      const origin = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
      const direction = new THREE.Vector3(x, target.y, z).sub(origin);
      const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0, direction.length());
      visible = !ray.intersectObjects(world.solids, true).some(hit => hit.object.visible);
    }
    assert.ok(visible, `${point.id}: a real unobstructed northern firing lane is required`);
  }
});

test('three fixed-count flare lights launch only after the first AI crossing, extinguish and repeat on simulation time', () => {
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), fill = new THREE.HemisphereLight();
  scene.fog = new THREE.Fog(0xffffff, 30, 200); scene.background = new THREE.Color(0xffffff);
  const background = scene.background, night = createSihangNight(scene, sun, fill), state = nightCampaign();
  night.update(state);
  assert.equal(scene.children.filter(child => child.isPointLight).length, 3);
  assert.equal(night.snapshot.night, true); assert.equal(night.snapshot.visible, 0);
  assert.ok(sun.intensity >= .5 && sun.intensity < 1);
  assert.ok(fill.intensity >= 1 && fill.intensity < 2);
  state.counterattack = true; state.counterattackAt = state.elapsed;
  for (const [age, visible, cycle] of [[3, 3, 0], [23, 3, 0], [25, 0, 0], [33, 0, 0], [37, 3, 1]]) {
    state.elapsed = 240 + age; night.update(state);
    assert.equal(night.snapshot.visible, visible); assert.equal(night.snapshot.cycle, cycle);
  }
  const paused = night.snapshot;
  night.update(state); assert.deepEqual(night.snapshot, paused);
  night.update(createSihangCampaign());
  assert.equal(scene.background, background); assert.equal(night.snapshot.visible, 0);
  assert.equal(scene.children.filter(child => child.isPointLight).length, 3);
});

test('night detection uses the same bounded moonlight and flare range for both teams', () => {
  const state = nightCampaign(), from = { x: 0, z: 0 };
  assert.equal(sihangNightVisibility(state, from, { x: 25, z: 0 }), false);
  assert.equal(sihangNightVisibility(state, from, { x: 24, z: 0 }), true);
  state.counterattack = true; state.counterattackAt = state.elapsed; state.elapsed += 4;
  assert.equal(sihangFlareState(state).intensity, 1);
  assert.equal(sihangNightVisibility(state, from, { x: 75, z: 0 }), true);
  state.elapsed += 24;
  assert.equal(sihangNightVisibility(state, from, { x: 75, z: 0 }), false);
});

test('nightfall and concession lights fade on simulation time without making the unflared battlefield black', () => {
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xfff0cc, 2),
    fill = new THREE.HemisphereLight(0xbadfff, 0x443322, 1);
  scene.background = new THREE.Color(0x99aabb); scene.environmentIntensity = 1;
  const night = createSihangNight(scene, sun, fill), state = nightCampaign();
  state.stageElapsed = 0; night.update(state);
  assert.equal(sun.intensity, 2); assert.equal(fill.intensity, 1);
  assert.equal(sihangNightVisibility(state, { x: 0, z: 0 }, { x: 70, z: 0 }), true);
  state.stageElapsed = 30; night.update(state);
  const halfway = sun.intensity;
  assert.ok(halfway > 0 && halfway < 2);
  const paused = night.snapshot; night.update(state);
  assert.deepEqual(night.snapshot, paused); assert.equal(sun.intensity, halfway);
  state.stageElapsed = SIHANG_VISUAL_NIGHTFALL_SECONDS; night.update(state);
  assert.equal(night.snapshot.transition, 1); assert.ok(sun.intensity > 0 && sun.intensity < halfway);
  assert.ok(fill.intensity >= 1 && scene.environmentIntensity >= .4);
  assert.equal(night.snapshot.visible, 0);
  night.update(createSihangCampaign());
  assert.equal(sun.intensity, 2); assert.equal(fill.intensity, 1);
  const world = makeWorld(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }), campaignLayout('sihang'));
  world.setNightLighting(.5);
  assert.equal(world.concessionLighting.windowIntensity, .35);
  assert.equal(world.concessionLighting.streetLamps, sihangSouthBankStreetLampPositions().length);
  assert.equal(world.concessionLighting.streetLampSpacing, 5);
  assert.equal(world.concessionLighting.streetLightSources, 2);
  assert.equal(world.concessionLighting.streetLightIntensity, 17.5);
  world.setNightLighting(1);
  assert.ok(world.concessionLighting.signIntensity > 0);
  world.setNightLighting(0);
  assert.equal(world.concessionLighting.streetLightIntensity, 0);
});

test('textured daytime sky remains continuous across sixty seconds while combat visibility retains its original timing', () => {
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), fill = new THREE.HemisphereLight();
  const background = new THREE.Texture();
  scene.background = background;
  const night = createSihangNight(scene, sun, fill), state = nightCampaign();
  const sky = scene.getObjectByName('sihang-night-sky');
  for (const [seconds, opacity] of [[0, 0], [30, .5], [60, 1]]) {
    state.stageElapsed = seconds; night.update(state);
    assert.equal(scene.background, background);
    assert.equal(sky.material.uniforms.opacity.value, opacity);
    assert.equal(sky.visible, seconds > 0);
  }
  state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  assert.equal(sihangNightVisibility(state, { x: 0, z: 0 }, { x: 25, z: 0 }), false);
  night.update(createSihangCampaign());
  assert.equal(sky.visible, false);
  assert.equal(scene.background, background);
});

test('south-bank street lamps follow the curved quay at five-metre intervals', () => {
  const lamps = sihangSouthBankStreetLampPositions();
  assert.ok(lamps.length > 30);
  assert.ok(lamps.length < 50);
  for (let i = 0; i < lamps.length; i++) {
    assert.ok(Math.abs(lamps[i].z - (sihangRiverBounds(lamps[i].x).southZ + 4)) < .02);
    if (i) assert.ok(Math.abs(Math.hypot(lamps[i].x - lamps[i - 1].x, lamps[i].z - lamps[i - 1].z) -
      SIHANG_SOUTH_BANK_LAMP_SPACING) < .025, 'adjacent lamp spacing should be five metres along the curved path');
  }
  const lastLamp = lamps[lamps.length - 1];
  const finalGap = Math.hypot(96 - lastLamp.x,
    sihangRiverBounds(96).southZ + 4 - lastLamp.z);
  assert.ok(finalGap < SIHANG_SOUTH_BANK_LAMP_SPACING);
});

test('the entire south bank remains a military ceasefire zone even after the counterattack', () => {
  const state = nightCampaign(), origin = { x: 90, z: -30 }, direction = { x: 0, z: 1 };
  assert.equal(sihangEnemyTargetAllowed({ position: origin }, state), true);
  assert.ok(sihangEnemyRayRange(origin, direction, 100, state) < 20);
  assert.equal(sihangEnemyTargetAllowed({ position: { x: 90, z: 30 } }, state), false);
  state.counterattack = true;
  assert.equal(sihangEnemyTargetAllowed({ position: { x: 94, z: -9 } }, state), false);
  assert.equal(sihangEnemyTargetAllowed({ civilian: true, position: { x: 94, z: -9 } }, state), false);
  assert.equal(sihangEnemyTargetAllowed({ position: { x: 90, z: 30 } }, state), false);
  assert.ok(sihangEnemyRayRange(origin, direction, 100, state) < 20);
  assert.equal(sihangBlastClearOfSouthBank({ x: 88, z: -5 }, 9), false);
  assert.equal(sihangBlastClearOfSouthBank({ x: 90, z: 12 }, 9), false);
});

test('all night spawn slots and bridgehead weapon operators use real dry collision-clear ground; cover AA can depress without altering rooftop AA', () => {
  const scene = new THREE.Scene(), world = makeWorld(scene,
    (kind, color) => new THREE.MeshStandardMaterial({ color }), campaignLayout('sihang'));
  const positions = SIHANG_EMPLACEMENTS.filter(point => point.retreatCover);
  const bags = addSihangBridgeDefenses(scene, world, positions);
  assert.equal(bags.count, 120); assert.equal(world.obstacles.filter(box => box.id?.includes('-sandbags-')).length, 10);
  assert.ok(world.obstacles.some(box => box.id === 'sihang-cover-gun:obstacle-0'),
    'mobile cannon reset and movement require its registered physical collider');
  const occupied = [];
  const playerSpawn = sihangSpawns().find(point => point.id === 'sihang-assembly-player');
  assert.equal(playerSpawn.playerOnly, true);
  assert.equal(playerSpawn.retreatOnly, true);
  const ranks = Array.from({ length: 110 }, (_, i) => sihangAssemblyPosition(Math.floor(i / 11), i % 11));
  assert.equal(formationPositions(playerSpawn, 11, world.obstacles, ranks).length, 11,
    'player deployment must find real free positions even with ten assembled squads');
  const simultaneous = [];
  for (const [slot, spawn] of sihangSpawns().filter(point => point.id.startsWith('sihang-retreat-')).entries()) {
    assert.ok(spawn.deploymentZone.maxX < SIHANG_WAREHOUSE.minX);
    assert.ok(spawn.deploymentZone.minZ >= SIHANG_WAREHOUSE.maxZ);
    const fullSquad = formationPositions(spawn, 11, world.obstacles, simultaneous);
    assert.equal(fullSquad.length, 11);
    for (const member of fullSquad) {
      assert.ok(sihangNorthBank(member, .5));
      simultaneous.push({ ...member, y: 0 });
    }
    for (let index = 0; index < 3; index++) occupied.push(sihangAssemblyPosition(slot, index));
    const members = formationPositions(spawn, 8, world.obstacles, occupied);
    assert.equal(members.length, 8, spawn.id);
    for (const [index, member] of members.entries()) {
      assert.equal(world.walkHeight(member.x, member.z, 0), 0, spawn.id);
      occupied.push(sihangAssemblyPosition(slot, index + 3));
    }
  }
  const cover = sihangSpawns().find(point => point.id === 'sihang-bridge-cover');
  if (cover) {
    const members = formationPositions(cover, 11, world.obstacles, occupied);
    for (const member of members) {
      assert.equal(world.walkHeight(member.x, member.z, 0), 0, cover.id);
      occupied.push({ ...member, y: 0 });
    }
  }
  const posts = sihangEnemyRegroupPosts(world.obstacles);
  assert.ok(posts.length >= 119);
  assert.ok(posts.every(post => post.z < SIHANG_WAREHOUSE.minZ &&
    !circleBlocked(post.x, post.z, .6, world.obstacles, 0) && world.walkHeight(post.x, post.z, 0) === 0));
  for (const spec of positions) {
    const point = createEmplacement(spec), pose = emplacementPose(point, 0);
    assert.equal(circleBlocked(pose.operator.x, pose.operator.z, .43, world.obstacles, 0), false, spec.id);
    assert.equal(world.walkHeight(pose.operator.x, pose.operator.z, 0), 0, spec.id);
  }
  const aa = createEmplacement(positions.find(spec => spec.profile === 'maxim24aa'));
  const roof = createEmplacement(SIHANG_EMPLACEMENTS.find(spec => spec.id === 'sihang-roof-aa'));
  emplacementLook(aa, aa.heading, -.2); emplacementLook(roof, roof.heading, -.2);
  assert.equal(aa.pitch, -.2); assert.equal(roof.pitch, .05);
  assert.equal(emplacementCanAimAt(aa, { x: 44, y: 1, z: -55 }), true);
  for (let slot = 0; slot < 11; slot++) for (let index = 0; index < 11; index++) {
    const position = sihangAssemblyPosition(slot, index);
    assert.equal(circleBlocked(position.x, position.z, .42, world.obstacles, 0), false, `assembly ${slot}/${index}`);
    assert.equal(world.walkHeight(position.x, position.z, 0), 0);
  }
  const slots = Array.from({ length: 121 }, (_, i) => sihangAssemblyPosition(Math.floor(i / 11), i % 11));
  assert.ok(.75 - 2 * SIHANG_ASSEMBLY_ARRIVAL > .7,
    'two accepted rank positions must not obstruct each other at the assembly clearance');
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++)
    assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z) > .7 + 2 * SIHANG_ASSEMBLY_ARRIVAL,
      `assembly slots ${i} and ${j} must not overlap`);
  const westStart = { x: -52, y: 0, z: -4 };
  const westApproach = sihangAssemblyApproach(westStart, slots[10]);
  assert.equal(westApproach[0].x, westStart.x);
  assert.equal(westApproach[0].z, -1.1, 'western reinforcements enter the riverside aisle before reaching the ranks');
  const physicalOrder = Array.from({ length: SIHANG_RULES.retreatSquads + 1 }, (_, slot) => slot)
    .sort((a, b) => sihangAssemblyPosition(a, 0).x - sihangAssemblyPosition(b, 0).x);
  for (let order = 0; order < physicalOrder.length; order++) {
    const slot = physicalOrder[order];
    const officer = sihangAssemblyPosition(slot, 2);
    const team = Array.from({ length: 11 }, (_, index) => sihangAssemblyPosition(slot, index));
    assert.ok(team.filter((_, index) => index !== 2).every(member => member.x < officer.x));
    for (const x of new Set(team.filter((_, index) => index !== 2).map(member => member.x))) {
      const row = team.filter(member => member.x === x).sort((a, b) => a.z - b.z);
      assert.equal(row.length, 5);
      for (let index = 1; index < row.length; index++)
        assert.ok(Math.abs(row[index].z - row[index - 1].z - .75) < 1e-9);
    }
    if (order) {
      const previousOfficer = sihangAssemblyPosition(physicalOrder[order - 1], 2);
      const nearestSoldier = Math.min(...team.filter((_, index) => index !== 2)
        .map(member => Math.hypot(member.x - previousOfficer.x, member.z - previousOfficer.z)));
      assert.ok(nearestSoldier >= 2 - 1e-9, 'adjacent blocks keep at least a two-metre officer-to-soldier gap');
      if (Math.abs(sihangAssemblyPosition(slot, 0).x -
        sihangAssemblyPosition(physicalOrder[order - 1], 0).x - 5.2) < 1e-9)
        assert.ok(Math.abs(nearestSoldier - 2) < 1e-9, 'closely spaced blocks retain their exact two-metre gap');
    }
  }
  const aislePath = world.elevatedPath({ x: 22, y: 0, z: -2.9 },
    { x: -11, y: 0, z: -2.9, assembly: true });
  assert.ok(aislePath.length > 0);
  assert.ok(aislePath.every(point => Math.abs(point.z + 2.9) < .001),
    'the real path planner must preserve the rank aisle instead of snapping through a settled row');
  const besideStair = new THREE.Vector3(-34.71912664444806, 0, -32.09155838187848);
  const stairExit = world.elevatedPath(besideStair, sihangAssemblyPosition(10, 10));
  assert.ok(stairExit.length, 'a real ground-level sidestep beside a stair must retain a walkable exit');
  for (const point of stairExit) {
    world.moveInfantry(besideStair, point.x - besideStair.x, point.z - besideStair.z);
    assert.ok(besideStair.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) < .025,
      'escaping an artificial stair cutout must not cross masonry or unsupported steps');
  }
  const player = { x: 8, y: 0, z: -4 }, approachStart = { x: 7.5, y: 0, z: -5.2 };
  const approach = sihangAssemblyApproach(approachStart, sihangAssemblyPosition(10, 4), [player]);
  for (let i = 0; i < approach.length; i++)
    assert.ok(pointSegmentDistance(player, i ? approach[i - 1] : approachStart, approach[i]).distance >= .95,
      'a stationary player in one column aisle must not prevent use of the other actual aisle');
  const temporary = { minX: -.2, maxX: .2, minZ: -7.2, maxZ: -3.2, minY: 0, height: 2 };
  const from = new THREE.Vector3(-10, 0, -5.3), to = { x: 10, y: 0, z: -5.3, assembly: true };
  world.elevatedPath(from, to);
  const builds = world.navigationStats.builds;
  world.obstacles.push(temporary); world.refreshNavigation([temporary]);
  const detour = world.elevatedPath(from, to);
  assert.ok(detour.length, 'new ground fortifications require an actual alternate route');
  for (const point of detour) {
    world.moveInfantry(from, point.x - from.x, point.z - from.z);
    assert.ok(from.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) < .025,
      'cached floor navigation and its physical connectors must include newly built equipment');
  }
  assert.equal(world.navigationStats.builds, builds, 'equipment refresh must not rebuild entire floor grids');
  world.obstacles.splice(world.obstacles.indexOf(temporary), 1); world.refreshNavigation([temporary]);
  for (const goal of slots) {
    const peers = slots.filter(slot => slot !== goal).map(slot => ({
      circular: true, cx: slot.x, cz: slot.z, radius: .35, height: 1.8,
      minX: slot.x - .35, maxX: slot.x + .35, minZ: slot.z - .35, maxZ: slot.z + .35,
    }));
    let previous = { x: -34, y: 0, z: -1.1 };
    for (const next of sihangAssemblyApproach(previous, goal)) {
      const count = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.z - previous.z) / .1));
      for (let step = 0; step <= count; step++) {
        const x = previous.x + (next.x - previous.x) * step / count;
        const z = previous.z + (next.z - previous.z) * step / count;
        assert.equal(circleBlocked(x, z, .35, peers, 0), false,
          `rank approach must not cross a settled squadmate: ${goal.x}/${goal.z}`);
        assert.equal(circleBlocked(x, z, .42, world.obstacles, 0), false,
          `rank aisle must clear warehouse walls and river railing: ${x}/${z}`);
      }
      previous = next;
    }
  }
  const display = createProceduralStaticFormation(scene);
  let batches = 0;
  for (let i = 0; i < 40; i++) {
    const position = sihangParadePosition(i);
    assert.equal(circleBlocked(position.x, position.z, .42, world.obstacles, 0), false, `parade ${i}`);
    assert.equal(world.walkHeight(position.x, position.z, 0), 0, `parade ${i}`);
    display.add({}, new THREE.Vector3(position.x, 0, position.z));
    if (!i) batches = display.batches;
  }
  assert.equal(display.count, 40); assert.equal(display.batches, batches);
  const exitStart = sihangParadeExit(true), exitEnd = sihangParadeExit();
  assert.ok(exitEnd.z > 72 && exitEnd.z < 74, 'the fade position is genuinely outside the combat boundary');
  const exitPath = world.elevatedPath(exitStart, exitEnd);
  assert.ok(exitPath.length, 'overflow evacuees must physically walk beyond the parade tail');
  const walker = new THREE.Vector3(exitStart.x, 0, exitStart.z);
  for (const point of exitPath) {
    world.moveInfantry(walker, point.x - walker.x, point.z - walker.z);
    assert.ok(walker.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) < .025);
  }
  assert.ok(display.batches <= 64, 'shared original rifle materials do not add draws per soldier');
  assert.throws(() => display.add({}, new THREE.Vector3()), RangeError);
  display.reset(); assert.equal(display.count, 0);
});
