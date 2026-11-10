import test from 'node:test';
import assert from 'node:assert/strict';
import { circleBlocked } from '../src/core.js';
import { createCivilianCrowdPlanner, civilianWaypointReached, moveCivilianInCrowd } from '../src/civilian-crowd.js';

const houses = [
  { minX: -8, maxX: -.65, minZ: -2, maxZ: 2, height: 4 },
  { minX: .65, maxX: 8, minZ: -2, maxZ: 2, height: 4 },
];

function simulate(people, seconds = 45) {
  const planner = createCivilianCrowdPlanner();
  let minimum = Infinity, maximumStep = 0;
  for (let frame = 0; frame < seconds * 20; frame++) {
    planner.beginStep();
    for (let offset = 0; offset < people.length; offset++) {
      const person = people[(frame + offset) % people.length];
      const data = person.userData, target = data.route[data.waypoint];
      if (!target) continue;
      const before = { ...person.position };
      moveCivilianInCrowd(person, target, Math.min(.075, Math.hypot(target.x - before.x, target.z - before.z)),
        people, houses, houses, null, planner);
      maximumStep = Math.max(maximumStep, Math.hypot(person.position.x - before.x, person.position.z - before.z));
      assert.equal(circleBlocked(person.position.x, person.position.z, .36, houses), false);
      if (civilianWaypointReached(person.position, data.route, data.waypoint, houses)) data.waypoint++;
    }
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++)
      minimum = Math.min(minimum, Math.hypot(people[i].position.x - people[j].position.x,
        people[i].position.z - people[j].position.z));
  }
  assert.ok(maximumStep <= .075 + 1e-8, 'No teleporting or extra movement allowance');
  assert.ok(minimum >= .72 - 1e-6, `Body separation is preserved: ${minimum}`);
  assert.ok(planner.stats.maxExpandedPerSlice <= 256 && planner.stats.maxGridCellsPerSlice <= 512);
  return people.filter(person => person.userData.waypoint < person.userData.route.length)
    .map(person => ({ id: person.userData.civilianId, position: person.position, waypoint: person.userData.waypoint }));
}

test('twenty refugees queue through a single-file alley rather than remaining in a mutually blocked cluster', () => {
  const people = Array.from({ length: 20 }, (_, id) => ({
    position: { x: (id % 5 - 2) * .85, y: 0, z: -4 - Math.floor(id / 5) * .85 },
    userData: { civilianId: id, waypoint: 0, route: [{ x: 0, z: -2.6 }, { x: 0, z: 2.6 },
      { x: (id % 5 - 2) * 1.6, z: 5 + Math.floor(id / 5) * 1.6 }] },
  }));
  assert.deepEqual(simulate(people), []);
});

test('opposing pedestrians yield outside a single-file alley and both groups eventually pass', () => {
  const people = Array.from({ length: 8 }, (_, id) => {
    const side = id < 4 ? -1 : 1, index = id % 4;
    return { position: { x: (index % 2 - .5) * .9, y: 0, z: side * (4 + Math.floor(index / 2) * .9) },
      userData: { civilianId: id, waypoint: 0, route: [{ x: 0, z: side * 2.6 },
        { x: 0, z: -side * 2.6 }, { x: (index % 2 - .5) * .9, z: -side * (5 + Math.floor(index / 2) * .9) }] } };
  });
  assert.deepEqual(simulate(people), []);
});

test('a compressed pair can gently separate without accepting any new overlap or passing through a wall', () => {
  const people = [0, .6].map((x, id) => ({ position: { x, y: 0, z: 0 }, userData: { civilianId: id } }));
  let separation = .6;
  for (let frame = 0; frame < 40; frame++) {
    for (const [id, person] of people.entries())
      moveCivilianInCrowd(person, { x: id ? 2 : -2, z: -2 }, .04, people, []);
    const next = Math.hypot(people[0].position.x - people[1].position.x, people[0].position.z - people[1].position.z);
    assert.ok(next >= separation - 1e-8, 'An already compressed pair must not become more compressed');
    separation = next;
  }
  assert.ok(separation > .72);
});
