import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTICLE_LIMITS, createParticleState, emitCombatParticles, advanceCombatParticles, clearCombatParticles, trimCombatParticles } from '../src/combat-particles.js';

const options = { fragmentCount: 8, fragmentLimit: 96, clouds: true, cloudLimit: 18, lightLimit: 2 };
const position = { x: 8, y: .45, z: -16 }, normal = { x: 0, y: 1, z: 0 };
test('effects are bounded and reuse preallocated state objects through long firing sequences', () => {
  const state = createParticleState();
  const identities = Object.fromEntries(Object.keys(PARTICLE_LIMITS).map(name => [name, new Set(state.free[name])]));
  for (let i = 0; i < 300; i++) {
    emitCombatParticles(state, position, normal, i % 2 ? 'stone' : 'muzzle', options);
    advanceCombatParticles(state, .01, () => .45);
    for (const [name, limit] of Object.entries(PARTICLE_LIMITS)) {
      assert.ok(state[name].length <= limit);
      assert.equal(state[name].length + state.free[name].length, limit);
      assert.ok(state[name].every(item => identities[name].has(item)));
    }
  }
  advanceCombatParticles(state, 2, () => .45);
  assert.equal(state.fragments.length + state.clouds.length + state.lights.length, 0);
});
test('short muzzle lights are visible on their birth frame even at a 50ms simulation step', () => {
  const state = createParticleState();
  emitCombatParticles(state, position, normal, 'muzzle', { ...options, fragmentCount: 0, time: .05 });
  advanceCombatParticles(state, .05, () => 0, .05);
  assert.equal(state.lights.length, 1);
  assert.equal(state.lights[0].age, 0);
  advanceCombatParticles(state, .05, () => 0, .1);
  assert.equal(state.lights.length, 0);
});
test('world fragments stay above the shared bridge support and fully reset between battles', () => {
  const state = createParticleState();
  emitCombatParticles(state, position, normal, 'soil', options);
  for (let i = 0; i < 30; i++) {
    advanceCombatParticles(state, .016, () => .45);
    assert.ok(state.fragments.every(item => item.y >= .45 + item.size - 1e-10));
  }
  clearCombatParticles(state);
  assert.equal(state.time, 0);
  assert.equal(state.emitted, 0);
  for (const [name, limit] of Object.entries(PARTICLE_LIMITS)) assert.equal(state.free[name].length, limit);
});
test('lower quality and independent disable immediately recycle effects without allocating replacements', () => {
  const state = createParticleState();
  for (let i = 0; i < 20; i++) emitCombatParticles(state, position, normal, 'muzzle', options);
  trimCombatParticles(state, { fragments: 32, clouds: 6, lights: 0 }, cloud => cloud.kind !== 'muzzle');
  assert.ok(state.fragments.length <= 32);
  assert.equal(state.clouds.length, 0);
  assert.equal(state.lights.length, 0);
  for (const [name, limit] of Object.entries(PARTICLE_LIMITS)) assert.equal(state[name].length + state.free[name].length, limit);
});
test('visual input errors are explicit and do not poison the pool', () => {
  const state = createParticleState();
  assert.throws(() => emitCombatParticles(state, position, { x: 0, y: 0, z: 0 }, 'stone', options), RangeError);
  assert.throws(() => emitCombatParticles(state, position, normal, 'unknown', options), RangeError);
  assert.throws(() => emitCombatParticles(state, position, normal, 'soil', { ...options, fragmentLimit: 1000 }), RangeError);
  assert.throws(() => advanceCombatParticles(state, -1, () => 0), RangeError);
});
