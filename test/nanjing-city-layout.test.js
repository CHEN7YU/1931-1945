import test from 'node:test';
import assert from 'node:assert/strict';
import { cityStreetIntersectsLot, createNanjingCityLayout } from '../src/nanjing-city-layout.js';

test('city layout is deterministic, varied and street-facing rather than aligned rows of identical lots', () => {
  const layout = createNanjingCityLayout();
  assert.deepEqual(layout, createNanjingCityLayout());
  const homes = layout.lots.filter(lot => lot[1] < -12);
  assert.ok(layout.lots.length >= Math.ceil(117 * 1.15), 'density increases by at least 15 percent');
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
