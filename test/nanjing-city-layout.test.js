import test from 'node:test';
import assert from 'node:assert/strict';
import { cityStreetIntersectsLot, createNanjingCityLayout } from '../src/nanjing-city-layout.js';
import { NANJING_SPAWNS } from '../src/nanjing-campaign.js';

function segmentDistance(point, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) /
    (dx * dx + dz * dz)));
  return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
}

test('city layout is deterministic, varied and street-facing rather than aligned rows of identical lots', () => {
  const layout = createNanjingCityLayout();
  assert.deepEqual(layout, createNanjingCityLayout());
  const homes = layout.lots.filter(lot => lot[1] < -12);
  assert.ok(layout.lots.length >= Math.ceil(117 * 1.15), 'density increases by at least 15 percent');
  assert.ok(layout.lots.reduce((area, lot) => area + lot[2] * lot[3], 0) >= 5000,
    'larger street blocks must replace empty ground, not just add more tiny buildings');
  assert.ok(layout.streets.find(street => street.id === 'gate-high-street').width < 6);
  assert.ok(layout.streets.find(street => street.id === 'north-bank-lane').width >= 5,
    'the narrower northern street still reserves an armored approach');
  assert.equal(new Set(homes.map(lot => lot[5])).size, 4, 'entrances must face different nearby streets');
  for (const dimension of [0, 1]) {
    const bins = new Map();
    for (const lot of homes) {
      const bin = Math.floor(lot[dimension] / 2);
      bins.set(bin, (bins.get(bin) || 0) + 1);
    }
    assert.ok(Math.max(...bins.values()) < homes.length * .15, 'no dominant two-metre row or column');
  }
  assert.ok(new Set(homes.map(lot => lot[2].toFixed(1))).size >= 15);
  assert.ok(new Set(homes.map(lot => lot[3].toFixed(1))).size >= 15);
  assert.ok(layout.streets.every(street => street.points.length >= 4));
  assert.ok(new Set(layout.streets.map(street => street.width)).size >= 4);
  for (const home of homes) {
    assert.ok(layout.streets.every(street => !cityStreetIntersectsLot(home, street, .65)),
      'street ribbons and their verge must never pass through houses');
  }
  assert.equal(layout.streetFixtures.filter(fixture => fixture.kind === 'utility').length, 4);
  assert.equal(layout.streetFixtures.filter(fixture => fixture.kind === 'streetlamp').length, 2);
  for (const fixture of layout.streetFixtures) {
    assert.ok(layout.streets.every(street => !cityStreetIntersectsLot(
      [fixture.x, fixture.z, .5, .5], street, .2)), `${fixture.id} stays off vehicle lanes`);
    assert.ok(layout.lots.every(([x, z, width, depth]) =>
      Math.abs(fixture.x - x) >= width / 2 + .55 || Math.abs(fixture.z - z) >= depth / 2 + .55),
    `${fixture.id} keeps clearance from buildings`);
    assert.ok(NANJING_SPAWNS.every(spawn => Math.hypot(fixture.x - spawn.x, fixture.z - spawn.z) > 5),
      `${fixture.id} stays clear of troop spawns`);
  }
  for (const [x, z, footprintWidth, footprintDepth, , facing] of layout.lots) {
    const depth = facing % 2 ? footprintWidth : footprintDepth;
    const transform = (px, pz) => {
      const cosine = [1, 0, -1, 0][facing], sine = [0, 1, 0, -1][facing];
      return { x: x + (px - x) * cosine + (pz - z) * sine,
        z: z - (px - x) * sine + (pz - z) * cosine };
    };
    const door = transform(x, z - depth / 2);
    const exit = transform(x, z - depth / 2 - .8);
    const length = Math.hypot(exit.x - door.x, exit.z - door.z);
    const direction = { x: (exit.x - door.x) / length, z: (exit.z - door.z) / length };
    const approach = { x: door.x + direction.x * 1.2, z: door.z + direction.z * 1.2 };
    const inside = { x: door.x - direction.x * .8, z: door.z - direction.z * .8 };
    for (const fixture of layout.streetFixtures) {
      assert.ok(segmentDistance(fixture, approach, inside) > .75,
        `${fixture.id} leaves the entrance route for a home facing ${facing} clear`);
    }
  }
  for (let i = 0; i < layout.lots.length; i++) for (const b of layout.lots.slice(i + 1)) {
    const a = layout.lots[i];
    assert.ok(Math.abs(a[0] - b[0]) >= (a[2] + b[2]) / 2 + 1.8 ||
      Math.abs(a[1] - b[1]) >= (a[3] + b[3]) / 2 + 1.8, 'every pair retains usable alley clearance');
  }
});

test('street reservation tests full segments, including diagonal edges and parallel misses', () => {
  const street = { width: 2, points: [[-10, -10], [10, 10]] };
  assert.equal(cityStreetIntersectsLot([0, 0, 2, 2], street), true);
  assert.equal(cityStreetIntersectsLot([0, 5, 2, 2], street), false);
  assert.equal(cityStreetIntersectsLot([0, 5, 2, 2], street, 1), true);
  assert.equal(cityStreetIntersectsLot([8, 0, 2, 2], { width: 2, points: [[0, -10], [0, 10]] }), false);
});
