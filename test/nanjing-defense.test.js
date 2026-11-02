import test from 'node:test';
import assert from 'node:assert/strict';
import { assignNanjingDefense, nanjingDefenseGoal, nanjingWallEntryWaypoint } from '../src/nanjing-defense.js';
import { NANJING_WALL_RAMPS } from '../src/nanjing-layout.js';

function defenders() {
  return [1, 2].flatMap(index => {
    const formation = { index, reserve: false };
    return Array.from({ length: 11 }, (_, slot) => ({ id: `${index}-${slot}`, index: slot,
      friendly: true, playerUnit: false, formation, health: 100, tactics: {} }));
  });
}
const counts = actors => Object.fromEntries(['wall', 'courtyard', 'reserve'].map(role =>
  [role, actors.filter(actor => actor.health > 0 && actor.tactics.nanjingDefense?.role === role).length]));

test('two autonomous squads split eight wall, ten courtyard and four reserve posts without taking player control', () => {
  const actors = defenders();
  const player = { ...actors[0], tactics: {}, playerUnit: true };
  assignNanjingDefense([...actors, player], 0);
  assert.deepEqual(counts(actors), { wall: 8, courtyard: 10, reserve: 4 });
  assert.equal(player.tactics.nanjingDefense, undefined);
  assert.ok(actors.filter(actor => [9, 10].includes(actor.index)).every(actor => actor.tactics.nanjingDefense.role === 'wall'));
  const duties = actors.map(actor => ({ ...actor.tactics.nanjingDefense }));
  assignNanjingDefense(actors, 60);
  assert.deepEqual(actors.map(actor => actor.tactics.nanjingDefense), duties, 'unchanged situations must not churn assignments');
  for (const situation of [{}, { breached: true }, { breached: true, emergency: true }]) {
    const goals = actors.map(actor => nanjingDefenseGoal(actor, situation));
    for (let index = 0; index < goals.length; index++) for (const other of goals.slice(index + 1)) {
      if (Math.abs(other.y - goals[index].y) < 1) assert.ok(
        Math.hypot(other.x - goals[index].x, other.z - goals[index].z) >= 1.4,
        `each soldier owns a separated post: ${JSON.stringify({ a: goals[index], b: other, situation })}`);
    }
    assert.ok(goals.filter(point => point.y > 7).length >= 6, 'an emergency cannot empty the walls');
    assert.ok(goals.filter(point => point.y === 0 && Math.hypot(point.x + 6.2, point.z) < 2.6).length >= 2,
      'the ground objective always has a dedicated guard from each squad');
  }
});

test('losses reduce overwatch before draining the courtyard and replacements fill vacancies', () => {
  const actors = defenders();
  assignNanjingDefense(actors, 0);
  for (const actor of actors.filter(actor => actor.index < 6)) actor.health = 0;
  assignNanjingDefense(actors, 30);
  assert.deepEqual(counts(actors), { wall: 2, courtyard: 8, reserve: 0 });
  for (const actor of actors) actor.health = 100;
  assignNanjingDefense(actors, 50);
  assert.deepEqual(counts(actors), { wall: 8, courtyard: 10, reserve: 4 });
});

test('wall entry uses the assigned side ramp instead of aiming straight through a wall', () => {
  for (const side of [-1, 1]) {
    const ramp = NANJING_WALL_RAMPS.find(candidate => candidate.side === side);
    const approach = nanjingWallEntryWaypoint({ x: 0, y: 0, z: 27 }, side);
    assert.equal(approach.z, ramp.centerZ);
    assert.equal(Math.sign(approach.x), side);
    const ascent = nanjingWallEntryWaypoint({ ...approach, z: approach.z + .2 }, side);
    assert.equal(ascent.ramp, true);
    assert.equal(ascent.y, ramp.height);
    assert.equal(nanjingWallEntryWaypoint({ x: side * 21.5, y: ramp.height, z: ramp.centerZ }, side), null);
  }
});
