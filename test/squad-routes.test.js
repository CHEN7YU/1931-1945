import test from 'node:test';
import assert from 'node:assert/strict';
import { createSquadRoutes } from '../src/squad-routes.js';

const actor = (x = 0, patch = {}) => ({ position: { x, y: 0, z: 0 }, stuckTime: 0, tactics: {},
  formation: { id: 'squad', generation: 1, type: 'infantry' }, ...patch });
const line = (start, end) => [{ x: end.x, y: end.y ?? 0, z: end.z }];
const flat = (_x, _z, y) => y;

test('eleven compatible soldiers share a route trunk but own independently consumable local paths', () => {
  const routes = createSquadRoutes(flat), goal = { x: 30, y: 0, z: 0 };
  let searches = 0;
  const paths = Array.from({ length: 11 }, (_, i) => routes.find(actor(i * .2), goal, i * .01,
    () => { searches++; return line(null, goal); }, line));
  assert.equal(searches, 1);
  assert.equal(routes.snapshot.shared, 10);
  paths[0].shift(); paths[1][0].x = -999;
  const next = routes.find(actor(1), goal, 1, () => { throw new Error('Unnecessary search'); }, line);
  assert.equal(next.at(-1).x, 30);
  assert.ok(next.every(p => p.x >= 0));
});

test('blocked local joins, floor changes, new goals and expired routes receive genuine individual searches', () => {
  for (const [person, goal, time, connector] of [
    [actor(1), { x: 30, y: 0, z: 0 }, 1, () => []],
    [actor(1, { position: { x: 1, y: 8.4, z: 0 } }), { x: 30, y: 8.4, z: 0 }, 1, line],
    [actor(1), { x: -30, y: 0, z: 0 }, 1, line],
    [actor(1), { x: 30, y: 0, z: 0 }, 5, line],
    [actor(1, { stuckTime: 1 }), { x: 30, y: 0, z: 0 }, 1, line],
  ]) {
    const routes = createSquadRoutes(flat);
    routes.find(actor(), { x: 30, y: 0, z: 0 }, 0, () => line(null, { x: 30, y: 0, z: 0 }), line);
    let searches = 0;
    routes.find(person, goal, time, () => { searches++; return line(null, goal); }, connector);
    assert.equal(searches, 1);
  }
});

test('route ownership survives a leader casualty, but generation, door changes and reset cannot reuse stale routes', () => {
  const routes = createSquadRoutes(flat), goal = { x: 30, y: 0, z: 0 };
  routes.find(actor(), goal, 0, () => line(null, goal), line);
  routes.find(actor(1), goal, 1, () => { throw new Error('A new leader should inherit a safe squad route'); }, line);
  let searches = 0;
  const search = () => { searches++; return line(null, goal); };
  routes.find(actor(1, { formation: { id: 'squad', generation: 2, type: 'infantry' } }), goal, 1, search, line);
  routes.clear();
  routes.find(actor(1), goal, 1, search, line);
  assert.equal(searches, 2);
  routes.reset(); assert.deepEqual(routes.snapshot, { searches: 0, shared: 0, rejected: 0, groups: 0 });
});

test('equal-height bridge endpoints cannot flatten shared waypoints into the curved walking surface', () => {
  const arch = x => Math.sin(Math.PI * x / 30), routes = createSquadRoutes(arch);
  const goal = { x: 30, y: 0, z: 0 };
  routes.find(actor(), goal, 0, () => line(null, goal), line);
  const shared = routes.find(actor(.2), goal, .1, () => { throw new Error('Expected the shared bridge trunk'); }, line);
  assert.ok(shared.some(point => point.y > .9));
  for (const point of shared) assert.ok(Math.abs(point.y - arch(point.x)) < .001);
  assert.throws(() => createSquadRoutes(), /walking surface/);
});

test('precise formation slots never route through an occupied squadmate endpoint', () => {
  for (const flag of ['assembly', 'parade']) {
    const routes = createSquadRoutes(flat), goal = { x: 30, y: 0, z: 0 };
    routes.find(actor(), goal, 0, () => line(null, goal), line);
    let searches = 0;
    routes.find(actor(1), { ...goal, x: 32, [flag]: true }, 1,
      () => { searches++; return line(null, { ...goal, x: 32 }); }, line);
    assert.equal(searches, 1);
    assert.equal(routes.snapshot.shared, 0);
  }
});
