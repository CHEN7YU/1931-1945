import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSihangCombat, sihangShieldLayout } from '../src/sihang-combat.js';
import { createSihangCampaign } from '../src/sihang-campaign.js';
import { SIHANG_DEMOLITION_POINT } from '../src/sihang-layout.js';

const soldier = (index, z = -60) => ({ id: `sapper-${index}`, index, health: 100, heading: Math.PI,
  position: new THREE.Vector3((index % 5 - 2) * 1.02, 0, z - Math.floor(index / 5) * 1.46),
  formation: { sihangDemolition: true }, tactics: {} });
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

test('twenty two-handed shields retain four-by-five slots in forward and overhead carry modes', () => {
  const roof = Array.from({ length: 20 }, (_, slot) => sihangShieldLayout(slot, 20, 'roof'));
  assert.equal(new Set(roof.map(point => point.x)).size, 5);
  assert.equal(new Set(roof.map(point => point.z)).size, 4);
  assert.ok(roof.every(point => point.mode === 'roof' && point.height === 1.96));
  const front = roof.map((_, slot) => sihangShieldLayout(slot, 20, 'front'));
  assert.ok(front.every(point => point.mode === 'front' && point.rotationX < -1 && point.height < 1.2));
});

test('sappers advance behind slanted shields, lift them near the wall, then withdraw shielding their front', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  assert.equal(f.combat.snapshot.mode, 'front');
  let roof = false, armedAt = null;
  for (let index = 1; index < 1200 && armedAt === null; index++) {
    const now = index * .05;
    const event = f.combat.update(.05, now, f);
    roof ||= f.combat.snapshot.mode === 'roof';
    for (const actor of f.actors) {
      const goal = f.combat.goalFor(actor), dx = goal.x - actor.position.x, dz = goal.z - actor.position.z;
      const distance = Math.hypot(dx, dz), step = Math.min(.05, distance);
      if (distance) f.world.moveInfantry(actor.position, dx / distance * step, dz / distance * step);
    }
    if (event === 'armed') armedAt = now;
  }
  assert.equal(roof, true);
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
  assert.equal(f.combat.snapshot.mode, 'front');
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
  f.actors[2].position.set(SIHANG_DEMOLITION_POINT.x, 0, SIHANG_DEMOLITION_POINT.z - 1);
  assert.equal(f.combat.update(10, 11, f), 'armed');
  f.player.position.set(SIHANG_DEMOLITION_POINT.x + 1.7, 0, SIHANG_DEMOLITION_POINT.z); f.keys.add('KeyF');
  assert.ok(f.combat.prompt(f.campaign, f.player));
  assert.equal(f.combat.update(10, 21, f), 'disarmed');
  f.combat.reset();
  assert.equal(f.combat.snapshot.shields, 0);
  assert.equal(ray.intersectObjects(f.world.solids, false).length, 0);
});

test('the breach releases sapper shields and routes ordinary enemy infantry through five real entry lanes', () => {
  const f = fixture();
  f.combat.update(.05, 0, f);
  f.campaign.northWallBreached = true;
  f.combat.update(.05, 1, f);
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
