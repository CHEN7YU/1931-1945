import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CORPSE_RULES, createCasualtyState, expiredCorpses, casualtyProgress, casualtyRotation } from '../src/casualties.js';

function corpse(index, time = 0) {
  const actor = { id: `soldier-${index}`, health: 0, heading: .5, position: new Vector3(), deathTime: time };
  actor.casualty = createCasualtyState(actor, time);
  return actor;
}

test('casualty variants and retained/released guns are stable per original identity without rerolling battle randomness', () => {
  const samples = Array.from({ length: 60 }, (_, i) => corpse(i));
  assert.equal(new Set(samples.map(actor => actor.casualty.variant)).size, 4);
  assert.equal(new Set(samples.map(actor => actor.casualty.retainGun)).size, 2);
  for (const actor of samples) {
    assert.deepEqual(createCasualtyState(actor, 0), actor.casualty);
    assert.equal(casualtyProgress(actor.casualty, 0), 0);
    assert.equal(casualtyProgress(actor.casualty, 12), 1);
    assert.deepEqual(casualtyRotation(actor.casualty, 1).toArray(), casualtyRotation(actor.casualty, casualtyProgress(actor.casualty, 12)).toArray());
    assert.throws(() => { actor.casualty.retainGun = true; }, TypeError);
  }
});

test('bodies and their guns remain for at least 180 simulation seconds, then only excess oldest bodies are removed', () => {
  const bodies = Array.from({ length: 125 }, (_, i) => corpse(i, i));
  const before = JSON.stringify(bodies);
  assert.deepEqual(expiredCorpses(bodies, 179), []);
  assert.deepEqual(expiredCorpses(bodies, 182), bodies.slice(0, 3));
  assert.deepEqual(expiredCorpses(bodies, 200), bodies.slice(0, 5));
  assert.deepEqual(expiredCorpses(bodies.slice(0, CORPSE_RULES.softLimit), 1000), []);
  assert.deepEqual(expiredCorpses([...bodies].reverse(), 200), bodies.slice(0, 5));
  assert.equal(JSON.stringify(bodies), before);
  assert.deepEqual(expiredCorpses(bodies, 182), expiredCorpses(bodies, 182), 'pause and repeated reads do not age corpses');
});

test('casualties reject living actors, invalid variants and future simulation timestamps', () => {
  const actor = corpse(1);
  assert.throws(() => createCasualtyState({ ...actor, health: 1 }, 0), /dead soldier/);
  assert.throws(() => createCasualtyState(actor, 0, null, { variant: 5 }), /variation/);
  assert.throws(() => expiredCorpses([corpse(2, 10)], 9), /invalid casualty/);
  assert.throws(() => expiredCorpses([{ ...actor, casualty: null }], 10), /invalid casualty/);
  assert.throws(() => expiredCorpses([], NaN), /simulation time/);
});
