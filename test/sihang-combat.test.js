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

test('twenty overhead shields form four contiguous rows; turtle edges tilt while interior boards remain overhead', () => {
  const roof = Array.from({ length: 20 }, (_, slot) => sihangShieldLayout(slot, 20, false));
  assert.equal(new Set(roof.map(point => point.x)).size, 5);
  assert.equal(new Set(roof.map(point => point.z)).size, 4);
  assert.ok(roof.every(point => point.mode === 'roof' && point.height === 1.96));
  const turtle = roof.map((_, slot) => sihangShieldLayout(slot, 20, true));
  assert.equal(turtle.filter(point => point.mode === 'roof').length, 6);
  assert.equal(turtle.filter(point => point.mode === 'turtle').length, 14);
});

test('only actual friendly ground trajectories near the squad trigger turtle posture; upper-storey or unrelated shots do not', () => {
  const f = fixture();
  const step = (now, shots = []) => f.combat.update(.05, now, { ...f, shots });
  step(1); assert.equal(f.combat.snapshot.shields, 20);
  step(2, [{ id: 1, type: 'shot', source: { team: 'friendly' },
    start: { x: 30, y: 1.6, z: 0 }, end: { x: 30, y: 1.6, z: -100 } }]);
  assert.equal(f.combat.snapshot.mode, 'roof');
  step(3, [{ id: 2, type: 'shot', source: { team: 'friendly' },
    start: { x: 0, y: 6, z: 0 }, end: { x: 0, y: 6, z: -100 } }]);
  assert.equal(f.combat.snapshot.mode, 'roof');
  step(4, [{ id: 3, type: 'shot', source: { team: 'friendly' },
    start: { x: 0, y: 1.6, z: 0 }, end: { x: 0, y: 1.6, z: -100 } }]);
  assert.equal(f.combat.snapshot.mode, 'turtle');
  step(10); assert.equal(f.combat.snapshot.mode, 'roof');
  f.actors[0].health = 0; step(11);
  assert.equal(f.combat.snapshot.shields, 19);
  assert.equal(f.actors[0].sihangShield, undefined);
  assert.equal(f.world.solids.length, 20, 'replacement and death must not grow the mesh pool');
});

test('dynamic shields block real rays, disappear on reset, and require a real nearby living operator to install', () => {
  const f = fixture();
  f.combat.update(.05, 1, f);
  const ray = new THREE.Raycaster(new THREE.Vector3(f.actors[0].position.x, 5, f.actors[0].position.z),
    new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObjects(f.world.solids, false).length);
  assert.equal(f.campaign.demolition.state, 'idle');
  f.actors[2].position.set(SIHANG_DEMOLITION_POINT.x, 0, SIHANG_DEMOLITION_POINT.z - 1);
  assert.equal(f.combat.update(10, 11, f), 'armed');
  f.player.position.copy(f.actors[2].position); f.keys.add('KeyF');
  assert.ok(f.combat.prompt(f.campaign, f.player));
  assert.equal(f.combat.update(10, 21, f), 'disarmed');
  f.combat.reset();
  assert.equal(f.combat.snapshot.shields, 0);
  assert.equal(ray.intersectObjects(f.world.solids, false).length, 0);
});
