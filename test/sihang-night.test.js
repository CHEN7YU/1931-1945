import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSihangCampaign, advanceSihangCampaign, SIHANG_RULES } from '../src/sihang-campaign.js';
import { createSihangNight, sihangFlareState, sihangNightVisibility } from '../src/sihang-night.js';
import { sihangEnemyRayRange, sihangEnemyTargetAllowed, sihangSpawns, SIHANG_EMPLACEMENTS } from '../src/sihang-roster.js';
import { sihangBlastClearOfSouthBank } from '../src/sihang-layout.js';
import { addSihangBridgeDefenses } from '../src/sihang-bridge-defenses.js';
import { makeWorld } from '../src/battlefield.js';
import { campaignLayout } from '../src/campaign-layout.js';
import { formationPositions } from '../src/battle-roster.js';
import { circleBlocked } from '../src/core.js';
import { pointSegmentDistance } from '../src/tactics.js';
import { createEmplacement, emplacementPose, emplacementCanAimAt, emplacementLook } from '../src/emplacements.js';
import { sihangAssemblyPosition, sihangAssemblyApproach, sihangParadePosition, sihangParadeExit, createProceduralStaticFormation } from '../src/sihang-formation.js';

function nightCampaign() {
  const state = createSihangCampaign();
  advanceSihangCampaign(state, 240);
  state.stageElapsed = SIHANG_RULES.nightfallSeconds;
  return state;
}

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
  state.stageElapsed = 10; night.update(state);
  const halfway = sun.intensity;
  assert.ok(halfway > 0 && halfway < 2);
  const paused = night.snapshot; night.update(state);
  assert.deepEqual(night.snapshot, paused); assert.equal(sun.intensity, halfway);
  state.stageElapsed = 20; night.update(state);
  assert.equal(night.snapshot.transition, 1); assert.ok(sun.intensity > 0 && sun.intensity < halfway);
  assert.ok(fill.intensity >= 1 && scene.environmentIntensity >= .4);
  assert.equal(night.snapshot.visible, 0);
  night.update(createSihangCampaign());
  assert.equal(sun.intensity, 2); assert.equal(fill.intensity, 1);
  const world = makeWorld(scene, (_kind, color) => new THREE.MeshStandardMaterial({ color }), campaignLayout('sihang'));
  world.setNightLighting(.5);
  assert.equal(world.concessionLighting.windowIntensity, .35);
  assert.equal(world.concessionLighting.streetLamps, 8);
  assert.equal(world.concessionLighting.streetLightIntensity, 17.5);
  world.setNightLighting(1);
  assert.ok(world.concessionLighting.signIntensity > 0);
  world.setNightLighting(0);
  assert.equal(world.concessionLighting.streetLightIntensity, 0);
});

test('the entire south bank remains a military ceasefire zone even after the counterattack', () => {
  const state = nightCampaign(), origin = { x: 90, z: -30 }, direction = { x: 0, z: 1 };
  assert.equal(sihangEnemyTargetAllowed({ position: origin }, state), false);
  assert.equal(sihangEnemyRayRange(origin, direction, 100, state), 0);
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
  assert.equal(bags.count, 72); assert.equal(world.obstacles.filter(box => box.id?.includes('-sandbags-')).length, 6);
  assert.ok(world.obstacles.some(box => box.id === 'sihang-cover-gun:obstacle-0'),
    'mobile cannon reset and movement require its registered physical collider');
  const occupied = [];
  for (const spawn of sihangSpawns().filter(point => point.id.startsWith('sihang-retreat-') || point.id === 'sihang-bridge-cover')) {
    const members = formationPositions(spawn, 11, world.obstacles, occupied);
    assert.equal(members.length, 11, spawn.id);
    for (const member of members) {
      assert.equal(world.walkHeight(member.x, member.z, 0), 0, spawn.id);
      occupied.push({ ...member, y: 0 });
    }
  }
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
  for (let slot = 0; slot < 6; slot++) for (let index = 0; index < 11; index++) {
    const position = sihangAssemblyPosition(slot, index);
    assert.equal(circleBlocked(position.x, position.z, .42, world.obstacles, 0), false, `assembly ${slot}/${index}`);
    assert.equal(world.walkHeight(position.x, position.z, 0), 0);
  }
  const slots = Array.from({ length: 66 }, (_, i) => sihangAssemblyPosition(Math.floor(i / 11), i % 11));
  const aislePath = world.elevatedPath({ x: 22, y: 0, z: -2.9 },
    { x: -11, y: 0, z: -2.9, assembly: true });
  assert.ok(aislePath.length > 0);
  assert.ok(aislePath.every(point => Math.abs(point.z + 2.9) < .001),
    'the real path planner must preserve the rank aisle instead of snapping through a settled row');
  const besideStair = new THREE.Vector3(-34.71912664444806, 0, -32.09155838187848);
  const stairExit = world.elevatedPath(besideStair, sihangAssemblyPosition(5, 10));
  assert.ok(stairExit.length, 'a real ground-level sidestep beside a stair must retain a walkable exit');
  for (const point of stairExit) {
    world.moveInfantry(besideStair, point.x - besideStair.x, point.z - besideStair.z);
    assert.ok(besideStair.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) < .025,
      'escaping an artificial stair cutout must not cross masonry or unsupported steps');
  }
  const player = { x: 8, y: 0, z: -4 }, approachStart = { x: 7.5, y: 0, z: -5.2 };
  const approach = sihangAssemblyApproach(approachStart, sihangAssemblyPosition(5, 4), [player]);
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
      circular: true, cx: slot.x, cz: slot.z, radius: .45, height: 1.8,
      minX: slot.x - .45, maxX: slot.x + .45, minZ: slot.z - .45, maxZ: slot.z + .45,
    }));
    let previous = { x: 22.6, y: 0, z: -5.3 };
    for (const next of sihangAssemblyApproach(previous, goal)) {
      const count = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.z - previous.z) / .1));
      for (let step = 0; step <= count; step++) {
        const x = previous.x + (next.x - previous.x) * step / count;
        const z = previous.z + (next.z - previous.z) * step / count;
        assert.equal(circleBlocked(x, z, .42, peers, 0), false,
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
