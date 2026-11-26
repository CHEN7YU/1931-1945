import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSihangCombat, sihangShieldLayout, sihangShieldSpawnPositions } from '../src/sihang-combat.js';
import { createSihangCampaign } from '../src/sihang-campaign.js';
import { SIHANG_DEMOLITION_POINT } from '../src/sihang-layout.js';

const soldier = (index, z = -60) => {
  const pose = sihangShieldLayout(index, 20);
  return { id: `sapper-${index}`, index, health: 100, heading: pose.facing,
    position: new THREE.Vector3(pose.x, 0, z + pose.z),
    formation: { sihangDemolition: true }, tactics: {} };
};
const fixture = () => {
  const scene = new THREE.Scene(), world = { solids: [],
    elevatedPath: (_from, to) => [{ ...to }],
    moveInfantry(position, dx, dz) { position.x += dx; position.z += dz; } };
  const combat = createSihangCombat(scene, world), campaign = createSihangCampaign();
  campaign.northWallBreached = false;
  const actors = Array.from({ length: 20 }, (_, index) => soldier(index));
  const player = { id: 'player', health: 100, position: new THREE.Vector3(10, 0, 0), tactics: {} };
  const keys = new Set();
  return { scene, world, combat, campaign, actors, player, keys };
};

test('twenty sappers form front, rear, side and roof cover without overlapping soldier capsules', () => {
  const poses = Array.from({ length: 20 }, (_, slot) => sihangShieldLayout(slot, 20));
  assert.equal(poses.filter(pose => pose.role === 'roof').length, 4);
  assert.equal(new Set(poses.filter(pose => pose.role !== 'roof').map(pose => pose.facing)).size, 4);
  for (let i = 0; i < poses.length; i++) for (let j = 0; j < i; j++)
    assert.ok(Math.hypot(poses[i].x - poses[j].x, poses[i].z - poses[j].z) >= 1);
});

test('casualty layouts retain balanced cover and compact without overlapping soldiers', () => {
  for (let count = 1; count <= 20; count++) {
    const poses = Array.from({ length: count }, (_, slot) => sihangShieldLayout(slot, count));
    const sides = role => poses.filter(pose => pose.role === role).length;
    assert.ok(Math.abs(sides('left') - sides('right')) <= 1);
    if (count >= 4) {
      assert.equal(sides('front'), 2);
      assert.equal(sides('rear'), 2);
    }
    for (let i = 0; i < poses.length; i++) for (let j = 0; j < i; j++)
      assert.ok(Math.hypot(poses[i].x - poses[j].x, poses[i].z - poses[j].z) >= 1,
        `${count} survivors: slots ${i} and ${j} overlap`);
  }
  assert.ok(sihangShieldLayout(0, 12).z < sihangShieldLayout(0, 20).z);
});

test('a casualty causes nearby survivors to regroup without reshuffling every slot', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  f.actors[0].health = 0;
  f.combat.update(.05, .05, f);
  const reassigned = f.actors.filter(actor => actor.health > 0 &&
    Math.hypot(actor.position.x - f.combat.goalFor(actor).x, actor.position.z - f.combat.goalFor(actor).z) > .05);
  assert.ok(reassigned.length < 10, `${reassigned.length} survivors moved after one casualty`);
  assert.equal(f.combat.snapshot.shields, 19);
  assert.equal(f.actors.filter(actor => actor.sihangShield?.role === 'front').length, 2);
  for (const actor of f.actors) if (actor.health > 0) {
    const goal = f.combat.goalFor(actor);
    actor.position.set(goal.x, goal.y, goal.z);
  }
  f.combat.update(.05, 1.1, f);
  assert.equal(f.combat.formed, true);
});

test('the original rear spawn deploys the complete turtle, or waits without scattering roles around an obstruction', () => {
  const spawn = { id: 'demolition', x: 0, z: -72, altitude: 0, permanent: true };
  const positions = sihangShieldSpawnPositions(spawn, 20, []);
  for (let i = 0; i < positions.length; i++) {
    const pose = sihangShieldLayout(i, 20);
    assert.deepEqual(positions[i], { x: spawn.x + pose.x, z: spawn.z + pose.z });
  }
  assert.throws(() => sihangShieldSpawnPositions(spawn, 20, [], [positions[0]]), /完整爆破龟壳/);
  assert.throws(() => sihangShieldSpawnPositions(spawn, 20, [], [],
    [{ health: 100, position: { ...positions[0], y: 0 } }]), /完整爆破龟壳/);
});

test('sappers retain individually carried turtle plates while advancing, installing and withdrawing', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  assert.equal(f.combat.snapshot.mode, 'turtle');
  let armedAt = null;
  for (let index = 1; index < 1200 && armedAt === null; index++) {
    const now = index * .05;
    const event = f.combat.update(.05, now, f);
    assert.equal(f.actors.filter(actor => actor.sihangShield.mode === 'roof').length, 4);
    for (const actor of f.actors) {
      const goal = f.combat.goalFor(actor), dx = goal.x - actor.position.x, dz = goal.z - actor.position.z;
      const distance = Math.hypot(dx, dz), step = Math.min(.05 * 3.35, distance);
      if (distance) f.world.moveInfantry(actor.position, dx / distance * step, dz / distance * step);
    }
    if (event === 'armed') armedAt = now;
  }
  assert.notEqual(armedAt, null);
  assert.ok(armedAt < 25, `the squad must run to the wall, then finish installation: ${armedAt}s`);
  assert.equal(f.combat.snapshot.phase, 'withdraw');
  const installed = f.combat.snapshot.anchor.z;
  for (let index = 1; index <= 40; index++) {
    f.combat.update(.05, armedAt + index * .05, f);
    for (const actor of f.actors) {
      const goal = f.combat.goalFor(actor);
      assert.equal(goal.backwards, true);
      const distance = Math.hypot(goal.x - actor.position.x, goal.z - actor.position.z);
      if (distance) f.world.moveInfantry(actor.position, (goal.x - actor.position.x) / distance * Math.min(.05 * 3.35, distance),
        (goal.z - actor.position.z) / distance * Math.min(.05 * 3.35, distance));
    }
  }
  assert.equal(f.combat.snapshot.mode, 'turtle');
  assert.ok(f.combat.snapshot.anchor.z < installed);
  assert.ok(f.actors.every(actor => actor.sihangShield.targets.left && actor.sihangShield.targets.right));
  f.actors[0].health = 0; f.combat.update(.05, armedAt + 3, f);
  assert.equal(f.combat.snapshot.shields, 19);
  assert.equal(f.actors[0].sihangShield, undefined);
  assert.equal(f.world.solids.length, 20, 'replacement and death must not grow the mesh pool');
});

test('stage two reverses an in-progress advance and waits for physical return even without a breach', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  const followGoals = () => {
    for (const actor of f.actors) {
      const goal = f.combat.goalFor(actor);
      actor.position.set(goal.x, goal.y, goal.z);
    }
  };
  for (let frame = 1; frame <= 60; frame++) {
    f.combat.update(.05, frame * .05, f);
    followGoals();
  }
  const start = f.combat.snapshot.anchor.z;
  f.campaign.stage = 'sihang-retreat';
  f.campaign.demolition.state = 'installing';
  assert.equal(f.combat.update(.05, 3.05, f), null);
  assert.ok(f.combat.snapshot.anchor.z < start, 'discard the old advance path immediately');
  assert.equal(f.combat.snapshot.chargeVisible, false);
  let event;
  for (let frame = 62; frame < 150 && event !== 'withdrawn'; frame++) {
    followGoals();
    event = f.combat.update(.05, frame * .05, f);
  }
  assert.equal(event, 'withdrawn');
  assert.equal(f.campaign.northWallBreached, false);
});

test('dynamic shields block real rays, disappear on reset, and require a real nearby living operator to install', () => {
  const f = fixture();
  f.combat.update(.05, 1, f);
  const ray = new THREE.Raycaster(new THREE.Vector3(f.actors[0].position.x, 1.06, f.actors[0].position.z + 4),
    new THREE.Vector3(0, 0, -1));
  assert.ok(ray.intersectObjects(f.world.solids, false).length);
  assert.equal(f.campaign.demolition.state, 'idle');
  f.combat.reset();
  for (const actor of f.actors) {
    const pose = sihangShieldLayout(actor.index, 20);
    actor.position.set(pose.x, 0, SIHANG_DEMOLITION_POINT.z - sihangShieldLayout(0, 20).z - .7 + pose.z);
  }
  assert.equal(f.combat.update(10, 11, f), 'armed');
  f.player.position.set(SIHANG_DEMOLITION_POINT.x + 1.7, 0, SIHANG_DEMOLITION_POINT.z); f.keys.add('KeyF');
  assert.ok(f.combat.prompt(f.campaign, f.player));
  assert.equal(f.combat.update(10, 21, f), 'disarmed');
  f.combat.reset();
  assert.equal(f.combat.snapshot.shields, 0);
  assert.equal(ray.intersectObjects(f.world.solids, false).length, 0);
});

test('a breach keeps living sappers until their actual return and routes other infantry through real entry lanes', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  f.campaign.northWallBreached = true;
  assert.equal(f.combat.update(.05, 1, f), 'withdrawn');
  assert.equal(f.combat.snapshot.shields, 20);
  for (const actor of f.actors) actor.formation.sihangDemolition = false;
  f.combat.update(0, 1, f);
  assert.equal(f.combat.snapshot.shields, 0); assert.equal(f.combat.snapshot.phase, 'breached');
  assert.ok(f.actors.every(actor => !actor.sihangShield));
  const lanes = [];
  for (let index = 0; index < 5; index++) {
    const actor = { index, team: 'enemy', health: 100, position: new THREE.Vector3(12, 0, -65) };
    const approach = f.combat.goalFor(actor, f.campaign);
    assert.ok(approach.z < -42); lanes.push(approach.x);
    actor.position.set(approach.x, 0, approach.z);
    assert.ok(f.combat.goalFor(actor, f.campaign).z > -42);
    for (const z of [-44.2, -43, -42.6, -42.4, -41]) {
      actor.position.z = z;
      assert.ok(f.combat.goalFor(actor, f.campaign).z > -42, 'an aligned soldier must not turn back just before crossing the breach');
    }
    actor.team = 'friendly';
    assert.equal(f.combat.goalFor(actor, f.campaign), null);
  }
  f.campaign.stage = 'sihang-retreat';
  assert.equal(f.combat.goalFor({ index: 0, team: 'enemy', health: 100,
    formation: {}, position: new THREE.Vector3(0, 0, -35) }, f.campaign), null,
  'the first-stage breach goal must not override second-stage pursuit');
  assert.equal(new Set(lanes).size, 5);
});

test('individual steel plates block hits while the formed turtle retains gaps at the side and roof', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  const ray = new THREE.Raycaster();
  ray.far = 4;
  for (const [z, hits] of [[-63.75, true], [-63, false]]) {
    ray.set(new THREE.Vector3(-4, 1, z), new THREE.Vector3(1, 0, 0));
    assert.equal(ray.intersectObjects(f.world.solids, false).length > 0, hits);
  }
  for (const [z, hits] of [[-60 - 5.8 / 6, true], [-60, false]]) {
    ray.set(new THREE.Vector3(0, 3, z), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObjects(f.world.solids, false).length > 0, hits);
  }
});

test('a cannon-broken steel plate stays hidden and stops protecting its assigned sapper', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  const plate = f.world.solids.find(mesh => mesh.visible);
  const slot = f.world.solids.indexOf(plate);
  const actor = f.actors.find(candidate => candidate.sihangShield?.slot === slot);
  assert.ok(plate && actor?.sihangShield?.active);
  assert.equal(f.combat.breakShield(plate), true);
  assert.equal(plate.visible, false);
  assert.equal(actor.sihangShield.active, false);
  f.combat.update(.05, .05, f);
  assert.equal(plate.visible, false);
  assert.equal(actor.sihangShield.active, false);
  assert.equal(f.combat.snapshot.shields, 19);
  assert.equal(f.combat.breakShield(plate), false);
});
