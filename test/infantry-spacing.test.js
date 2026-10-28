import test from 'node:test';
import assert from 'node:assert/strict';
import { infantrySteering } from '../src/infantry-spacing.js';
import { createTactics, objectiveDestination, objectiveAdvanceRequired } from '../src/tactics.js';

const person = (id, x, z, heading = 0) => ({ id: `person-${id}`, health: 100, position: { x, y: 0, z }, heading, tactics: { id } });
test('open-ground soldiers keep a consistent passing side instead of running into a shared stopping point', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1.6);
  const result = infantrySteering(actor, [actor, other], { x: 0, z: -1 }, { spacing: 2.2, constrained: false, blocked: () => false });
  assert.ok(result.x > 0 && result.z < 0 && result.speed < 1);
  assert.ok(Math.atan2(result.x, -result.z) < Math.PI / 6, 'bounded steering does not snap soldiers sideways');
});
test('a narrow bottleneck waits or yields backward, rather than trying to pass through a wall or another body', () => {
  const actor = person(2, 0, 0), other = person(1, 0, -1.2, Math.PI);
  const options = { spacing: 2.2, constrained: true, blocked: () => false };
  assert.ok(infantrySteering(actor, [other], { x: 0, z: -1 }, options).z > 0);
  other.position.z = -.8;
  assert.equal(infantrySteering(actor, [other], { x: 0, z: -1 }, { ...options, blocked: () => true }).speed, 0);
  other.health = 0;
  assert.equal(infantrySteering(actor, [other], { x: 0, z: -1 }, options).speed, 1);
});
test('all eleven members and all ten real friendly squad identifiers have distinct stable capture destinations', () => {
  const goal = { x: 0, z: 0, radius: 13 }, points = [];
  for (let squad = 100; squad < 110; squad++) for (let slot = 0; slot < 11; slot++) {
    const state = createTactics(slot, squad, slot), point = objectiveDestination(state, { x: 0, z: 70 }, goal);
    assert.ok(Math.hypot(point.x, point.z) < 12);
    for (const other of points) assert.ok(Math.hypot(point.x - other.x, point.z - other.z) > 1.5);
    points.push(point);
  }
});

test('a soldier already at its spread-out capture slot can fire instead of endlessly trying to advance toward the center', () => {
  const objective = { id: 'A', x: 0, z: 0, radius: 13 }, tactics = createTactics(1, 109, 10);
  const goal = objectiveDestination(tactics, { x: 0, z: 70 }, objective);
  assert.ok(Math.hypot(goal.x, goal.z) > objective.radius * .7);
  const actor = { friendly: true, playerUnit: false, position: goal, tactics };
  assert.equal(objectiveAdvanceRequired(actor, objective, 55), false);
  tactics.personalSlot = { objectiveId: 'A', point: { x: goal.x + 1, z: goal.z } };
  actor.position = { ...tactics.personalSlot.point };
  assert.equal(objectiveAdvanceRequired(actor, objective, 55), false);
});
