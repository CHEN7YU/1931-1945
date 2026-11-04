import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGrenadeSupport } from '../src/grenade-support.js';
import { GRENADE, EXPLOSIVE_PACK, createGrenadeSystem, createGrenadeInventory, advanceGrenadeFlight } from '../src/grenades.js';

function fixture() {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10, .1, 10), new THREE.MeshBasicMaterial());
  floor.updateMatrixWorld(true);
  const solids = [floor];
  let clear = true, height = .05, queries = 0;
  const support = createGrenadeSupport(solids, () => height, () => clear);
  const trace = (from, to, radius, checkingSupport) => {
    queries++;
    return solids.length && to.y < height + radius ? {
      position: { x: to.x, y: height + radius, z: to.z }, normal: { x: 0, y: 1, z: 0 },
      ...(checkingSupport ? { staticSupport: support.mesh(floor, from, radius) } : {}),
    } : null;
  };
  return { floor, solids, support, trace, get queries() { return queries; },
    set clear(value) { clear = value; }, set height(value) { height = value; } };
}

for (const kind of ['grenade', 'explosive-pack']) {
  test(`${kind}: cached static support eliminates repeated substeps without moving the body or changing its source`, () => {
    const f = fixture(), radius = kind === 'grenade' ? GRENADE.size : EXPLOSIVE_PACK.size;
    const originalSource = Object.freeze({ soldierId: 'original' });
    const grenade = { kind, position: { x: 0, y: .05 + radius, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, resting: true, source: originalSource, collisions: 3 };
    advanceGrenadeFlight(grenade, 1, f.trace);
    assert.equal(f.queries, 1, 'one confirmed support query replaces 120 identical queries');
    const before = structuredClone(grenade);
    advanceGrenadeFlight(grenade, 1, f.trace);
    assert.equal(f.queries, 1, 'unchanged static support reuses the result on later simulation steps');
    assert.deepEqual(grenade, before);
    assert.equal(grenade.source, originalSource);
    advanceGrenadeFlight(grenade, 0, f.trace);
    assert.equal(f.queries, 1);
    grenade.position.x += .1;
    advanceGrenadeFlight(grenade, .05, f.trace);
    assert.equal(f.queries, 2, 'movement invalidates the old contact');
    f.clear = false;
    advanceGrenadeFlight(grenade, .05, f.trace);
    assert.equal(f.queries, 3, 'a vehicle/door entering the region forces one fresh query in this simulation step');
    f.clear = true;
    advanceGrenadeFlight(grenade, .05, f.trace);
    f.solids.length = 0;
    advanceGrenadeFlight(grenade, .05, f.trace);
    assert.equal(grenade.resting, false);
    assert.ok(grenade.velocity.y < 0, 'removing the supporting collider resumes falling');
  });
}

test('static support tokens reject mesh/geometry/transform/side/range changes and disposal', () => {
  for (const change of [
    f => { f.floor.position.x = 1; f.floor.updateMatrixWorld(true); },
    f => { f.floor.geometry.attributes.position.needsUpdate = true; },
    f => { f.floor.geometry.setAttribute('position', f.floor.geometry.attributes.position.clone()); },
    f => { f.floor.geometry.index.needsUpdate = true; },
    f => { f.floor.geometry.setDrawRange(0, 3); },
    f => { f.floor.geometry.groups[0].materialIndex = 5; },
    f => { f.floor.material.side = THREE.DoubleSide; },
    f => { f.floor.material = f.floor.material.clone(); },
    f => { f.floor.geometry.dispose(); },
    f => { f.floor.geometry = new THREE.BoxGeometry(); },
    f => { f.solids[0] = f.floor.clone(); },
  ]) {
    const f = fixture(), valid = f.support.mesh(f.floor, { x: 0, y: .2, z: 0 }, .065);
    assert.equal(valid(), true);
    change(f);
    assert.equal(valid(), false);
  }
});

test('doors, moving vehicles, skins and dynamic geometry never become static support', () => {
  const f = fixture(), location = { x: 0, y: .2, z: 0 };
  for (const mark of [
    floor => { floor.userData.doorId = 'door'; },
    floor => { floor.userData.vehicleId = 'tank'; },
    floor => { floor.isInstancedMesh = true; },
    floor => { floor.isSkinnedMesh = true; },
    floor => { floor.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage); },
  ]) {
    const copy = fixture();
    mark(copy.floor);
    assert.equal(copy.support.mesh(copy.floor, location, .065), null);
  }
  const valid = f.support.ground(location, .065);
  assert.equal(valid(), true);
  f.height = -.2;
  assert.equal(valid(), false, 'analytic terrain changes invalidate ground contact');
});

test('dynamic support rechecks each simulation step, not six identical substeps, and tracer or velocity changes invalidate reuse', () => {
  const grenade = { position: { x: 0, y: GRENADE.size, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, resting: true, collisions: 0 };
  let queries = 0, present = true;
  const dynamicTrace = () => { queries++; return present ? { normal: { x: 0, y: 1, z: 0 } } : null; };
  advanceGrenadeFlight(grenade, .05, dynamicTrace);
  assert.equal(queries, 1);
  const resting = structuredClone(grenade);
  advanceGrenadeFlight(grenade, .05, dynamicTrace);
  assert.equal(queries, 2, 'uncacheable supports are still queried again on the next simulation step');
  assert.deepEqual(grenade, resting);
  present = false;
  advanceGrenadeFlight(grenade, .05, dynamicTrace);
  assert.equal(grenade.resting, false);
  const f = fixture();
  grenade.position.y = .05 + GRENADE.size; grenade.velocity = { x: 0, y: 0, z: 0 }; grenade.resting = true;
  advanceGrenadeFlight(grenade, .05, f.trace);
  let otherQueries = 0;
  const other = (...args) => { otherQueries++; return f.trace(...args); };
  advanceGrenadeFlight(grenade, .05, other);
  assert.equal(otherQueries, 1, 'cached contacts belong to their actual world tracer');
  grenade.resting = false; grenade.velocity.x = 1;
  advanceGrenadeFlight(grenade, .05, other);
  assert.ok(grenade.position.x > 0);
});

test('cached and original paths preserve flight/bounce/fuse/explosion source at 30/60/144Hz', () => {
  for (const fps of [30, 60, 144]) for (const kind of ['grenade', 'explosive-pack']) {
    const run = cache => {
      const f = fixture(), system = createGrenadeSystem(), inventory = createGrenadeInventory(), blasts = [];
      const source = { soldierId: 'a', unitId: 'squad', weaponId: `a:${kind}`, team: 'friendly', credit: 'player' };
      system.begin('a', inventory, source, 0, kind); system.release('a', .01);
      const trace = (from, to, radius, checkingSupport) => f.trace(from, to, radius, cache && checkingSupport);
      const hooks = { pose: () => ({ position: { x: 0, y: .2, z: 0 }, direction: { x: 0, y: -1, z: 0 } }),
        trace, explode: event => blasts.push(event) };
      for (let frame = 1; frame <= 7 * fps; frame++) system.advance(frame / fps, 1 / fps, hooks);
      assert.equal(blasts.length, 1);
      return { blasts, history: system.history, queries: f.queries, inventory };
    };
    const original = run(false), cached = run(true);
    assert.deepEqual(cached.blasts, original.blasts, 'same deadline, position, collisions and immutable source');
    assert.deepEqual(cached.history, original.history);
    assert.deepEqual(cached.inventory, original.inventory);
    assert.ok(cached.queries < original.queries,
      'static reuse still saves queries against the newly optimized once-per-step uncached path');
  }
});

test('invalid support validity fails explicitly instead of pretending success', () => {
  const grenade = { position: { x: 0, y: .1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, resting: true };
  assert.throws(() => advanceGrenadeFlight(grenade, .01, () =>
    ({ normal: { x: 0, y: 1, z: 0 }, staticSupport: () => 'true' })), /validity must be explicit/);
});
