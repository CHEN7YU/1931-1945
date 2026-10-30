import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { circleBlocked, setCollisionDiagnostics, MAP_LIMIT } from '../src/core.js';
import { circleBlocked as legacy, setCollisionDiagnostics as setLegacyDiagnostics } from '../scripts/fixtures/circle-blocked-legacy.js';
import { createQueryDiagnostics } from '../src/query-diagnostics.js';
import { seededRandom } from '../src/benchmark.js';
import { collisionKernelBaseline } from '../scripts/benchmark.mjs';

const wall = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 2 };

test('ordered kernel preserves exact tangency, map bounds, heights and rotated/circular shapes', () => {
  const shapes = [
    wall,
    { circular: true, cx: 0, cz: 0, radius: 1 },
    { oriented: true, cx: 0, cz: 0, hx: 1, hz: 1, angle: .7 },
    { door: true, cx: 0, cz: 0, hx: 1, hz: .02, angle: 0, cos: 1, sin: 0 },
  ];
  for (const shape of shapes) {
    for (const x of [0, 1, 1.46, 1.46 - 1e-10, 1.46 + 1e-10, MAP_LIMIT - .46, MAP_LIMIT - .46 + 1e-10]) {
      for (const feetY of [-2, 0, 1.975, 2, 5]) {
        for (const bodyHeight of [0, 1.75, 4]) {
          assert.equal(circleBlocked(x, 0, .46, [shape], feetY, bodyHeight), legacy(x, 0, .46, [shape], feetY, bodyHeight));
        }
      }
    }
  }
  assert.equal(circleBlocked(1.5, 0, .5, [wall]), false, 'tangency is not penetration');
  assert.equal(circleBlocked(0, 0, .5, [{ ...wall, minY: 1.75 }]), false);
  assert.equal(circleBlocked(0, 0, .5, [{ ...wall, height: .025 }]), false);
  assert.equal(circleBlocked(MAP_LIMIT - .5, 0, .5, []), false);
  assert.equal(circleBlocked(MAP_LIMIT - .5 + 1e-10, 0, .5, []), true);
  for (const value of [NaN, Infinity, -Infinity, -0]) {
    assert.equal(circleBlocked(value, 0, value, [wall]), legacy(value, 0, value, [wall]));
  }
});

test('100000 seeded mixed-shape queries match both outcomes and exact diagnostic counters', () => {
  const random = seededRandom(1938), obstacles = [];
  for (let i = 0; i < 80; i++) {
    const cx = random() * 40 - 20, cz = random() * 40 - 20;
    const hx = random() * 3, hz = random() * 3, angle = random() * Math.PI * 2;
    const shape = i % 3 === 0 ? { circular: true, cx, cz, radius: hx }
      : i % 3 === 1 ? { oriented: true, door: i % 2 === 0, cx, cz, hx, hz, angle,
        ...(i % 2 ? {} : { cos: Math.cos(angle), sin: Math.sin(angle) }) }
      : { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
    if (i % 4) { shape.minY = random() * 8 - 1; shape.height = shape.minY + random() * 4; }
    obstacles.push(shape);
  }
  const currentProbe = createQueryDiagnostics(true), oldProbe = createQueryDiagnostics(true);
  setCollisionDiagnostics(currentProbe); setLegacyDiagnostics(oldProbe);
  try {
    for (let i = 0; i < 100000; i++) {
      const args = [random() * 220 - 110, random() * 220 - 110, random() * 2, obstacles, random() * 10 - 2, random() * 3];
      assert.equal(circleBlocked(...args), legacy(...args), `query ${i}`);
    }
    assert.deepEqual(currentProbe.snapshot.rows, oldProbe.snapshot.rows);
  } finally { setCollisionDiagnostics(null); setLegacyDiagnostics(null); }
});

test('sparse arrays, inherited entries, early returns and length mutation retain Array.some behavior', () => {
  for (const query of [circleBlocked, legacy]) {
    const sparse = new Array(8);
    assert.equal(query(0, 0, .4, sparse), false);
    sparse[7] = wall;
    assert.equal(query(0, 0, .4, sparse), true);
    const inherited = new Array(2), prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, '1', { value: wall });
    Object.setPrototypeOf(inherited, prototype);
    assert.equal(query(0, 0, .4, inherited), true);
    const early = [wall];
    Object.defineProperty(early, '1', { get() { throw new Error('must not visit after hit'); } });
    assert.equal(query(0, 0, .4, early), true);
    const grow = [{ get minY() { grow.push(wall); return 10; } }];
    assert.equal(query(0, 0, .4, grow), false, 'snapshot the original length');
    const shrink = [{ get minY() { shrink.length = 1; return 10; } }, wall];
    assert.equal(query(0, 0, .4, shrink), false, 'skip deleted entries');
    assert.throws(() => query(0, 0, .4, [undefined]), TypeError, 'present invalid entries must not become holes');
    assert.throws(() => query(0, 0, .4, [{ get height() { throw new Error('geometry failure'); } }]), /geometry failure/);
  }
});

test('full-battle baseline replaces only the kernel, not adjacent navigation or diagnostics', async () => {
  const current = await readFile(new URL('../src/core.js', import.meta.url), 'utf8');
  const fixture = await readFile(new URL('../scripts/fixtures/circle-blocked-legacy.js', import.meta.url), 'utf8');
  const baseline = collisionKernelBaseline(current, fixture);
  const start = current.indexOf('export function circleBlocked('), end = current.indexOf('\nexport function moveGround(');
  assert.equal(baseline.slice(0, start), current.slice(0, start));
  assert.ok(baseline.endsWith(current.slice(end)));
  assert.ok(baseline.includes('obstacles.some(intersects)'));
  assert.throws(() => collisionKernelBaseline('', fixture), /replace only the circle kernel/);
});
