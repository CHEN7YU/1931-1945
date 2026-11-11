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

test('sappers retain enclosed turtle cover while advancing, installing and withdrawing', () => {
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
      const distance = Math.hypot(dx, dz), step = Math.min(.05, distance);
      if (distance) f.world.moveInfantry(actor.position, dx / distance * step, dz / distance * step);
    }
    if (event === 'armed') armedAt = now;
  }
  assert.notEqual(armedAt, null);
  assert.equal(f.combat.snapshot.phase, 'withdraw');
  const installed = f.combat.snapshot.anchor.z;
  for (let index = 1; index <= 40; index++) {
    f.combat.update(.05, armedAt + index * .05, f);
    for (const actor of f.actors) {
      const goal = f.combat.goalFor(actor);
      assert.equal(goal.backwards, true);
      const distance = Math.hypot(goal.x - actor.position.x, goal.z - actor.position.z);
      if (distance) f.world.moveInfantry(actor.position, (goal.x - actor.position.x) / distance * Math.min(.05, distance),
        (goal.z - actor.position.z) / distance * Math.min(.05, distance));
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
  assert.equal(new Set(lanes).size, 5);
});

test('closed turtle steel intercepts low, body, head and overhead projectile rays from every outside direction', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  const center = new THREE.Vector3(0, 1, -60), ray = new THREE.Raycaster();
  for (const height of [.15, 1, 1.8]) for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI / 16;
    const origin = new THREE.Vector3(Math.cos(angle) * 12, height, -60 + Math.sin(angle) * 12);
    const target = center.clone().setY(height);
    ray.set(origin, target.sub(origin).normalize()); ray.far = 12;
    assert.ok(ray.intersectObjects(f.world.solids, false).length, `${height}/${i}`);
  }
  for (const x of [-.9, 0, .9]) for (const z of [-3.4, 0, 3.4]) {
    ray.set(new THREE.Vector3(x, 15, -60 + z), new THREE.Vector3(0, -1, 0)); ray.far = 15;
    assert.ok(ray.intersectObjects(f.world.solids, false).length, `roof ${x}/${z}`);
  }
});
