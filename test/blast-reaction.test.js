import test from 'node:test';
import assert from 'node:assert/strict';
import { beginBlastReaction, advanceBlastReaction, sampleBlastReaction, sampleBlastBlur, BLAST_REACTION, blastCasualty } from '../src/blast-reaction.js';
const person = () => ({ id: 'soldier-5', health: 40, heading: 0, stance: 'standing',
  position: { x: 2, y: 0, z: 3 } });
const motion = { weight: 0, speed: 0, prone: 0, postures: {}, headAim: null };
test('blast fall travels away from impact through a collision callback and recovers continuously on simulation time', () => {
  const actor = person(), origin = { x: 1, z: 2 };
  assert.equal(beginBlastReaction(actor, origin, 40, 0, motion), true);
  const before = JSON.stringify(actor);
  advanceBlastReaction(actor, 0, () => assert.fail()); assert.equal(JSON.stringify(actor), before);
  const phases = new Set(); let previous = 0, movement = { x: 0, z: 0 };
  for (let frame = 0; frame < 210; frame++) {
    const sample = sampleBlastReaction(actor);
    if (sample) {
      phases.add(sample.phase); assert.ok(Math.abs(sample.fall - previous) < .1);
      previous = sample.fall; assert.ok(Number.isFinite(blastCasualty(actor).time));
    }
    advanceBlastReaction(actor, 1 / 60, (x, z) => { movement.x += x; movement.z += z; });
  }
  assert.deepEqual([...phases], ['stagger', 'fall', 'roll', 'brace', 'rise', 'settle']);
  assert.ok(movement.x > 0 && movement.z > 0); assert.ok(Math.abs(movement.x - movement.z) < 1e-10);
  assert.equal(actor.blastReaction, null); assert.equal(actor.stance, 'standing');
  assert.equal(beginBlastReaction(actor, origin, 40, BLAST_REACTION.duration, motion), false);
});
test('weak blasts, seated actors and repeat impacts do not launch or endlessly restart people', () => {
  for (const patch of [{ health: 0 }, { vehicleId: 'tank' }, { stance: 'prone' }]) {
    assert.equal(beginBlastReaction({ ...person(), ...patch }, { x: 0, z: 0 }, 50, 0, motion), false);
  }
  const actor = person(); assert.equal(beginBlastReaction(actor, { x: 2, z: 3 }, 2, 0, motion), false);
  assert.equal(beginBlastReaction(actor, { x: 2, z: 3 }, 50, 0, motion), true);
  assert.equal(beginBlastReaction(actor, { x: 0, z: 0 }, 80, 1, motion), false);
  assert.ok(Number.isFinite(sampleBlastReaction(actor).roll));
});

test('a later fatal blast can topple a recovered soldier during ordinary knockdown cooldown', () => {
  const actor = person();
  beginBlastReaction(actor, { x: 0, z: 0 }, 40, 0, motion);
  advanceBlastReaction(actor, BLAST_REACTION.duration, () => {});
  assert.equal(actor.blastReaction, null);
  assert.equal(beginBlastReaction(actor, { x: 3, z: 3 }, 40, 4, motion), false);
  assert.equal(beginBlastReaction(actor, { x: 3, z: 3 }, 100, 4, motion, { force: true }), true);
  assert.ok(actor.blastReaction.direction.x < 0);
});

test('blast blur follows the same reaction clock, fades within two seconds and cannot be extended by repeated hits', () => {
  const actor = person(), origin = { x: 0, z: 0 };
  assert.equal(sampleBlastBlur(actor), 0);
  assert.equal(beginBlastReaction(actor, origin, 50, 0, motion), true);
  assert.equal(sampleBlastBlur(actor), 0);
  advanceBlastReaction(actor, .12, () => {});
  const peak = sampleBlastBlur(actor);
  assert.ok(peak > 0 && peak <= 2.5);
  assert.equal(beginBlastReaction(actor, origin, 80, .12, motion), false);
  advanceBlastReaction(actor, .88, () => {});
  assert.ok(sampleBlastBlur(actor) > 0 && sampleBlastBlur(actor) < peak);
  const paused = sampleBlastBlur(actor);
  advanceBlastReaction(actor, 0, () => assert.fail());
  assert.equal(sampleBlastBlur(actor), paused);
  advanceBlastReaction(actor, 1, () => {});
  assert.equal(sampleBlastBlur(actor), 0);
});
