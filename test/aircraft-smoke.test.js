import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AIRCRAFT_SMOKE, createAircraftSmokeState, advanceAircraftSmoke, createAircraftSmokeEffects } from '../src/aircraft-smoke.js';

const plane = () => ({ id: 'hit-plane', type: 'plane', team: 'enemy', health: 180,
  position: new THREE.Vector3(10, 30, 0), heading: 0, pitch: 0, roll: 0 });

test('a hit aircraft starts a black engine trail before death and keeps the trail in world space while falling', () => {
  const aircraft = plane(), state = createAircraftSmokeState();
  advanceAircraftSmoke(state, [aircraft], 0);
  assert.equal(state.puffs.length, 0);
  aircraft.health = 140;
  const owned = JSON.stringify(aircraft);
  advanceAircraftSmoke(state, [aircraft], 1);
  assert.equal(JSON.stringify(aircraft), owned);
  assert.equal(state.puffs.length, 1);
  assert.deepEqual(state.puffs[0].position.toArray(), [10, 30.35, -3.1]);
  const initial = state.puffs[0].position.clone();
  aircraft.position.set(12, 27, -6); aircraft.health = 0;
  aircraft.pitch = -.4; aircraft.fall = { grounded: false };
  advanceAircraftSmoke(state, [aircraft], 1.24);
  assert.ok(state.puffs.length >= 4);
  assert.deepEqual(state.puffs[0].position, initial, 'the old smoke cannot follow the plane as an attached object');
  assert.ok(state.puffs.at(-1).intensity > state.puffs[0].intensity, 'destroyed aircraft produce a denser trail');
  const paused = JSON.stringify(state.puffs);
  advanceAircraftSmoke(state, [aircraft], 1.24);
  assert.equal(JSON.stringify(state.puffs), paused);
});

test('ground and water impacts end emission, old puffs fade, and low quality remains bounded across multiple planes', () => {
  for (const fall of [{ grounded: true }, { sinking: true }, { sunk: true }]) {
    const aircraft = plane(), state = createAircraftSmokeState(); aircraft.health = 0;
    advanceAircraftSmoke(state, [aircraft], 1);
    aircraft.fall = fall; advanceAircraftSmoke(state, [aircraft], 1.1);
    assert.equal(state.sources.size, 0);
    advanceAircraftSmoke(state, [aircraft], 1 + AIRCRAFT_SMOKE.life + .01);
    assert.equal(state.puffs.length, 0);
  }
  for (const low of [false, true]) {
    const state = createAircraftSmokeState(), fleet = Array.from({ length: 10 }, (_, index) =>
      ({ ...plane(), id: `damaged-${index}`, health: 40 }));
    for (let frame = 0; frame < 600; frame++) advanceAircraftSmoke(state, fleet, frame / 30, low);
    assert.ok(state.puffs.length <= (low ? AIRCRAFT_SMOKE.lowLimit : AIRCRAFT_SMOKE.limit));
    advanceAircraftSmoke(state, [], 30, low);
    assert.equal(state.puffs.length, 0); assert.equal(state.sources.size, 0);
  }
});

test('smoke is one dark billboard batch, obeys effects settings, freezes on pause and clears for redeployment', () => {
  const scene = new THREE.Scene(), effects = createAircraftSmokeEffects(scene, new THREE.Texture());
  const aircraft = plane(); aircraft.health = 0;
  effects.configure({ preset: 'low', effects: { hitParticles: true } });
  effects.update([aircraft], 1);
  const mesh = scene.getObjectByName('aircraft-damage-black-smoke');
  assert.ok(mesh.isInstancedMesh && mesh.visible && mesh.count > 0);
  assert.equal(mesh.material.depthWrite, false);
  assert.match(mesh.material.fragmentShader, /0\.035, 0\.032, 0\.030/);
  const first = Array.from(mesh.instanceMatrix.array), snapshot = effects.snapshot;
  effects.update([aircraft], 1);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), first);
  assert.deepEqual(effects.snapshot, snapshot);
  effects.configure({ preset: 'high', effects: { hitParticles: false } });
  assert.equal(mesh.count, 0); assert.equal(mesh.visible, false);
  effects.configure({ preset: 'high', effects: { hitParticles: true } });
  effects.update([aircraft], 2); assert.ok(mesh.count > 0);
  effects.clear(); assert.deepEqual(effects.snapshot, { sources: [], puffs: 0, visible: false, oldestAge: 0 });
  assert.throws(() => effects.update([aircraft], NaN), /simulation time/);
});
