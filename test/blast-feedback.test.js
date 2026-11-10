import test from 'node:test';
import assert from 'node:assert/strict';
import { BLAST_PROFILES, blastExposure } from '../src/blast-profiles.js';
import { createBlastFeedback } from '../src/blast-feedback.js';
import { GRENADE, EXPLOSIVE_PACK } from '../src/grenades.js';
import { MORTAR } from '../src/mortar.js';
import { GRENADE_DISCHARGER } from '../src/grenade-discharger.js';
import { damageForTarget } from '../src/combat-targets.js';
import { blastDamage } from '../src/core.js';
import { createParticleState, emitExplosionParticles, advanceCombatParticles, PARTICLE_LIMITS } from '../src/combat-particles.js';

const origin = { x: 0, y: .1, z: 0 };
const styles = ['grenade', 'mortar', 'grenade-discharger', 'explosive-pack'];
test('owned weapon facts match graded damage, radius, exposure and ballistic blast profiles', () => {
  for (const [style, actual] of [['grenade', GRENADE], ['mortar', MORTAR], ['grenade-discharger', GRENADE_DISCHARGER], ['explosive-pack', EXPLOSIVE_PACK]]) {
    assert.equal(actual.damage, BLAST_PROFILES[style].damage);
    assert.equal(actual.radius, BLAST_PROFILES[style].radius);
  }
  for (const field of ['damage', 'radius', 'impulse', 'reach', 'flash', 'ringing']) {
    assert.ok(BLAST_PROFILES.grenade[field] < BLAST_PROFILES.mortar[field], field);
    assert.equal(BLAST_PROFILES.mortar[field], BLAST_PROFILES['grenade-discharger'][field], field);
    assert.ok(BLAST_PROFILES.mortar[field] < BLAST_PROFILES['explosive-pack'][field], field);
  }
  for (const distance of [0, 3, 6, 7.5]) {
    const amounts = ['grenade', 'mortar', 'explosive-pack'].map(style => {
      const { radius, damage } = BLAST_PROFILES[style];
      return blastDamage(distance, radius, damage);
    });
    assert.ok(amounts[0] < amounts[1] && amounts[1] < amounts[2]);
  }
  for (const kind of ['mortar', 'grenade-discharger']) {
    assert.equal(damageForTarget(kind, 'person', 210), 210);
    assert.equal(damageForTarget(kind, 'closed-armor', 210), 0);
  }
});

test('all blast tiers retain flash, flame, dust, wave and bounded original particle identities on low/high', () => {
  for (const low of [false, true]) {
    const flashes = [];
    for (const style of styles) {
      const state = createParticleState();
      const identities = new Set(Object.values(state.free).flat());
      const emit = time => emitExplosionParticles(state, origin, time, { style, low, radius: BLAST_PROFILES[style].radius });
      emit(0);
      for (const kind of ['blast-flash', 'blast-fire', 'blast-dust', 'blast-smoke', 'blast-wave']) {
        assert.ok(state.clouds.some(cloud => cloud.kind === kind), `${style}/${low}/${kind}`);
      }
      flashes.push(state.clouds.find(cloud => cloud.kind === 'blast-flash').size);
      for (let i = 0; i < 80; i++) emit(0);
      for (const [name, cap] of Object.entries(PARTICLE_LIMITS)) {
        assert.ok(state[name].every(item => identities.has(item)));
        assert.equal(state[name].length + state.free[name].length, cap);
      }
      advanceCombatParticles(state, 8, () => 0, 8);
      assert.equal(state.fragments.length + state.clouds.length + state.lights.length, 0);
    }
    assert.ok(flashes[0] < flashes[1] && flashes[1] === flashes[2] && flashes[2] < flashes[3]);
  }
});

test('one bounded impulse respects distance, motion zero, simulation pause, decay, retrigger and reset', () => {
  const feedback = createBlastFeedback();
  for (const style of styles) {
    assert.equal(blastExposure(origin, { ...origin, x: 100 }, style).strength, 0);
    assert.ok(blastExposure(origin, { ...origin, x: 3 }, style).strength < blastExposure(origin, origin, style).strength);
  }
  feedback.trigger(origin, origin, 'explosive-pack');
  const zero = feedback.update(.05, 0);
  for (const key of ['x', 'y', 'pitch', 'yaw', 'roll']) assert.equal(Math.abs(zero[key]), 0);
  const sample = feedback.update(.03, 1);
  assert.ok(Math.abs(sample.x) > 0 && Math.abs(sample.roll) > 0);
  assert.deepEqual(feedback.update(0, 1), sample, 'paused samples are identical');
  for (let i = 0; i < 100; i++) feedback.trigger(origin, origin, 'explosive-pack');
  assert.equal(feedback.snapshot.strength, 1);
  assert.equal(feedback.update(2).strength, 0);
  feedback.trigger(origin, origin, 'grenade'); feedback.reset();
  assert.equal(feedback.update(0).strength, 0);
});
