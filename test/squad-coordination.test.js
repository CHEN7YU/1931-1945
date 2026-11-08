import test from 'node:test';
import assert from 'node:assert/strict';
import { squadBoundDecision, SQUAD_BOUND } from '../src/squad-coordination.js';

function fixture() {
  const formation = { type: 'infantry', members: [] };
  formation.members = Array.from({ length: 6 }, (_, index) => ({ id: `soldier-${index}`, index, formation,
    health: 100, position: { x: index, z: 0 }, locomotion: { speed: 0 }, rifleReady: true,
    tactics: { threatSense: 'vision', observedAt: 0 } }));
  return formation;
}
test('a moving element needs a genuinely observed stationary covering soldier and advances at most four metres before alternating', () => {
  const formation = fixture(), [guard, mover] = formation.members;
  assert.equal(squadBoundDecision(guard, 0).hold, true);
  assert.equal(squadBoundDecision(mover, 0).role, 'bound');
  for (const person of formation.members.filter((_, index) => index % 2 === 0)) person.rifleReady = false;
  assert.equal(squadBoundDecision(mover, .1).role, 'await-cover');
  for (const person of formation.members) person.rifleReady = true;
  mover.position.z = SQUAD_BOUND.metres;
  assert.equal(squadBoundDecision(mover, .2).hold, true);
  for (const person of formation.members.filter((_, index) => index % 2 === 1)) person.position.z = SQUAD_BOUND.metres;
  assert.equal(squadBoundDecision(guard, 1).role, 'bound');
  assert.equal(formation.coordination.completedBounds, 1);
  assert.equal(squadBoundDecision(mover, 1).role, 'cover');
});
test('casualties rebalance surviving people, timeout releases blocked groups, and controlled players are never held', () => {
  const formation = fixture(), actor = formation.members[1];
  squadBoundDecision(actor, 0);
  formation.members[0].health = 0;
  squadBoundDecision(actor, .5);
  assert.equal(formation.coordination.regroupings, 2);
  for (const person of formation.members) person.tactics.observedAt = 6;
  assert.equal(squadBoundDecision(actor, 6.6).role, 'regroup');
  assert.equal(squadBoundDecision(actor, 6.7).hold, false);
  assert.equal(squadBoundDecision(actor, 6.7, actor.id).hold, false);
});
test('stale observations, special crews and tiny remnants use existing independent movement rather than fabricated cover', () => {
  const formation = fixture();
  assert.equal(squadBoundDecision(formation.members[0], 3).role, 'independent');
  formation.type = 'tank';
  assert.equal(squadBoundDecision(formation.members[0], 0).role, 'independent');
  formation.type = 'infantry'; formation.members[0].health = formation.members[1].health = formation.members[2].health = 0;
  assert.equal(squadBoundDecision(formation.members[3], 0).role, 'independent');
  assert.throws(() => squadBoundDecision(formation.members[3], NaN), RangeError);
});
