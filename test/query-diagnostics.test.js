import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryDiagnostics, queryDiagnosticsDelta } from '../src/query-diagnostics.js';
import { circleBlocked, moveGround, segmentClear, setCollisionDiagnostics } from '../src/core.js';

test('diagnostics are opt-in, nested, bounded and sampled once per 64 scope calls', () => {
  assert.equal(createQueryDiagnostics(false), null);
  let time = 0;
  const probe = createQueryDiagnostics(true, () => time++);
  const leaf = probe.wrap('leaf', function(a, b, c, d, e, f) {
    assert.equal(this.value, 7);
    probe.candidates(5, 2);
    return a + b + c + d + e + f;
  });
  const outer = probe.wrap('outer', () => leaf.call({ value: 7 }, 1, 2, 3, 4, 5, 6));
  for (let i = 0; i < 65; i++) assert.equal(outer(), 21);
  const rows = probe.snapshot.rows, leafRow = rows.find(row => row.name === 'leaf'), outerRow = rows.find(row => row.name === 'outer');
  assert.equal(outerRow.scopeCalls, 65);
  assert.equal(leafRow.callers.outer, 65);
  assert.equal(leafRow.returnedCandidates, 325);
  assert.equal(leafRow.dynamicCandidates, 130);
  assert.equal(leafRow.timingSamples, 2);
  assert.equal(outerRow.sampledMs, 6);
  assert.equal(probe.current.name, 'unscoped');
  const fail = probe.wrap('fail', () => { throw new Error('test failure'); });
  assert.throws(fail, /test failure/);
  assert.equal(probe.current.name, 'unscoped');
  leafRow.callers.outer = 0;
  leafRow.candidateHistogram[0] = 100;
  assert.equal(probe.snapshot.rows.find(row => row.name === 'leaf').callers.outer, 65);
  assert.equal(probe.snapshot.rows.find(row => row.name === 'leaf').candidateHistogram[0], 0);
  probe.reset();
  assert.ok(probe.snapshot.rows.every(row => row.scopeCalls === 0 && row.sampledMs === 0));
});

test('circle counters count actual visited objects, early exits and map bounds, including internal callers', () => {
  const wall = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 2 };
  const probe = createQueryDiagnostics(true);
  const query = probe.wrap('query', () => circleBlocked(0, 0, .4, [wall, wall, wall]));
  setCollisionDiagnostics(probe);
  try {
    assert.equal(query(), true);
    const row = probe.snapshot.rows[1];
    assert.equal(row.circleCalls, 1);
    assert.equal(row.candidates, 3);
    assert.equal(row.checked, 1);
    assert.equal(row.blocked, 1);
    const before = probe.snapshot;
    assert.equal(circleBlocked(10000, 0, .4, [wall]), true);
    moveGround({ x: 10, z: 10 }, .1, .1, .4, [wall]);
    assert.equal(segmentClear({ x: 10, z: 10 }, { x: 10.1, z: 10 }, .4, [wall]), true);
    const delta = queryDiagnosticsDelta(before, probe.snapshot).rows[0];
    assert.equal(delta.circleCalls, 5);
    assert.equal(delta.checked, 4);
    assert.equal(delta.boundaryHits, 1);
    assert.equal(delta.candidateHistogram.reduce((sum, n) => sum + n, 0), 5);
    assert.equal(queryDiagnosticsDelta(null, null), null);
    probe.reset();
    assert.throws(() => queryDiagnosticsDelta(before, probe.snapshot), /reset/);
  } finally { setCollisionDiagnostics(null); }
});

test('instrumentation preserves circle, rotated door, height, sparse-array and movement outcomes', () => {
  const obstacles = [
    { minX: -1, maxX: 1, minZ: -2, maxZ: 2, height: 2 },
    { circular: true, cx: 5, cz: 1, radius: 2, minY: 3, height: 5 },
    { oriented: true, door: true, cx: -5, cz: 1, hx: 2, hz: .2, angle: .7, height: 3 },
    { minX: -8, maxX: 8, minZ: -8, maxZ: 8, minY: 4, height: 4.2, walkable: true },
  ];
  const probe = createQueryDiagnostics(true), expected = [];
  for (let i = 0; i < 1000; i++) {
    const x = (i * 13 % 170) / 10 - 8.5, z = (i * 17 % 170) / 10 - 8.5;
    expected.push(circleBlocked(x, z, .43, obstacles, i % 5, 1.75));
  }
  const original = moveGround({ x: -3, z: -4 }, 8, 8, .43, obstacles);
  setCollisionDiagnostics(probe);
  try {
    for (let i = 0; i < 1000; i++) {
      const x = (i * 13 % 170) / 10 - 8.5, z = (i * 17 % 170) / 10 - 8.5;
      assert.equal(circleBlocked(x, z, .43, obstacles, i % 5, 1.75), expected[i]);
    }
    assert.deepEqual(moveGround({ x: -3, z: -4 }, 8, 8, .43, obstacles), original);
    probe.reset();
    const sparse = new Array(8);
    sparse[7] = obstacles[0];
    assert.equal(circleBlocked(0, 0, .4, sparse), true);
    assert.equal(probe.snapshot.rows[0].checked, 1);
    assert.equal(probe.snapshot.rows[0].candidates, 8);
  } finally { setCollisionDiagnostics(null); }
});
