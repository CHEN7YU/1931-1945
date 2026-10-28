import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CORPSE_RULES, createCasualtyState, expiredCorpses, casualtyProgress, casualtyRotation, placeCasualty } from '../src/casualties.js';
import { circleBlocked } from '../src/core.js';

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

test('falling body envelopes select a clear direction and bounded floor slide beside walls, corners and narrow passages', () => {
  const bounds = variant => variant < 2 ? { min: [-1.1, 0, -.40], max: [1.1, .6, .40] }
    : { min: [-.40, 0, -1.1], max: [.40, .6, 1.1] };
  for (const [position, obstacles] of [
    [new Vector3(.43, 0, 0), [{ minX: -2, maxX: 0, minZ: -8, maxZ: 8, height: 3 }]],
    [new Vector3(.43, 0, .43), [{ minX: -2, maxX: 0, minZ: -8, maxZ: 8, height: 3 },
      { minX: -8, maxX: 8, minZ: -2, maxZ: 0, height: 3 }]],
    [new Vector3(0, 0, 0), [{ minX: -.9, maxX: -.675, minZ: -8, maxZ: 8, height: 3 },
      { minX: .675, maxX: .9, minZ: -8, maxZ: 8, height: 3 }]],
  ]) {
    const actor = corpse(2); actor.position.copy(position); actor.heading = .3;
    const blocked = (point, radius, height) => circleBlocked(point.x, point.z, radius, obstacles, point.y, height);
    const state = placeCasualty(actor, actor.casualty, bounds, blocked);
    assert.equal(state.wallLimited, false);
    assert.ok(Math.hypot(state.offset.x, state.offset.z) <= 2.001);
    assert.deepEqual(placeCasualty(actor, actor.casualty, bounds, blocked), state, 'sampling cannot reroll or advance a corpse');
    const box = bounds(state.variant), heading = actor.heading + state.yaw;
    for (let x = box.min[0]; x <= box.max[0]; x += .1) for (let z = box.min[2]; z <= box.max[2]; z += .1) {
      const point = { x: actor.position.x + state.offset.x + x * Math.cos(heading) + z * Math.sin(heading),
        y: 0, z: actor.position.z + state.offset.z - x * Math.sin(heading) + z * Math.cos(heading) };
      assert.equal(blocked(point, .12, .75), false);
    }
    assert.deepEqual(actor.position, position, 'presentation correction does not move the registered death/hit location');
  }
});
