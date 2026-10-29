import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkConfig, seededRandom, diagnosticRoster, diagnosticSpawns, createFrameTelemetry } from '../src/benchmark.js';
import { distribution, summarizeProfile } from '../scripts/benchmark.mjs';

test('benchmark overrides are development-only and explicit; production keeps the default army', () => {
  assert.equal(benchmarkConfig('?benchmark=duel&seed=1938', false), null);
  assert.equal(benchmarkConfig('', true), null);
  assert.deepEqual(benchmarkConfig('?benchmark=full&seed=1938', true), { scenario: 'full', seed: 1938, diagnostic: false });
  assert.throws(() => benchmarkConfig('?benchmark=unknown', true), RangeError);
  assert.throws(() => benchmarkConfig('?benchmark=duel&seed=-1', true), RangeError);
  assert.throws(() => benchmarkConfig('?benchmark=duel&seed=4294967296', true), RangeError);
});
test('a fixed simulation seed repeats without consuming audio or visual randomness', () => {
  const first = seededRandom(1938), second = seededRandom(1938), other = seededRandom(1939);
  const a = Array.from({ length: 100 }, first), b = Array.from({ length: 100 }, second);
  assert.deepEqual(a, b);
  assert.notEqual(a[0], other());
});
test('5v5 is a labelled diagnosis scene with registered origins, not a smaller default', () => {
  const roster = diagnosticRoster(), points = diagnosticSpawns();
  assert.equal(roster.length, 2);
  assert.ok(roster.every(unit => unit.memberCount === 5 && points.some(point => point.id === unit.spawnId && point.team === unit.team)));
});
test('bridge support fixture is separate from both fighting benchmarks and the production roster', () => {
  const config = benchmarkConfig('?benchmark=bridge&seed=1938', true);
  assert.equal(config.diagnostic, true);
  assert.equal(diagnosticRoster('bridge').length, 1);
  assert.equal(diagnosticSpawns('bridge')[0].z, -3);
  assert.equal(benchmarkConfig('?benchmark=bridge', false), null);
  assert.throws(() => diagnosticRoster('full'), RangeError);
  assert.throws(() => diagnosticSpawns('unknown'), RangeError);
});
test('tank ford fixture has a registered off-bridge origin and cannot alter production', () => {
  assert.equal(benchmarkConfig('?benchmark=ford', false), null);
  assert.equal(benchmarkConfig('?benchmark=ford', true).diagnostic, true);
  const roster = diagnosticRoster('ford'), points = diagnosticSpawns('ford');
  assert.equal(roster.length, 1);
  assert.equal(roster[0].type, 'tank');
  assert.equal(roster[0].spawnId, points[0].id);
  assert.equal(points[0].x, -48);
  assert.equal(points[0].kind, 'garage');
});
test('G2 diagnostic has two independent friendly infantry units and one tank crew, not an altered default roster', () => {
  assert.equal(benchmarkConfig('?benchmark=control', true).diagnostic, true);
  const roster = diagnosticRoster('control'), points = diagnosticSpawns('control');
  assert.equal(roster.filter(unit => unit.team === 'friendly' && !unit.player).length, 2);
  assert.equal(roster.find(unit => unit.player).type, 'tank');
  assert.ok(roster.every(unit => points.some(point => point.id === unit.spawnId && point.team === unit.team)));
  assert.equal(benchmarkConfig('?benchmark=control', false), null);
});
test('interior geometry fixture retains real squad AI but is isolated from autonomous battlefield traffic', () => {
  assert.equal(benchmarkConfig('?benchmark=interior', true).diagnostic, true);
  assert.equal(benchmarkConfig('?benchmark=interior', false), null);
  const roster = diagnosticRoster('interior'), points = diagnosticSpawns('interior');
  assert.equal(roster.length, 1);
  assert.equal(roster[0].memberCount, 5);
  assert.equal(roster[0].team, 'friendly');
  assert.ok(roster[0].player);
  assert.equal(points[0].x, 0);
  assert.equal(points[0].z, 78);
  assert.equal(roster[0].spawnId, points[0].id);
});
test('cover fixture uses the real map and a complete player squad without changing production', () => {
  assert.equal(benchmarkConfig('?benchmark=cover', true).diagnostic, true);
  assert.equal(benchmarkConfig('?benchmark=cover', false), null);
  const roster = diagnosticRoster('cover'), spawns = diagnosticSpawns('cover');
  assert.equal(roster.length, 1);
  assert.equal(roster[0].memberCount, 11);
  assert.equal(roster[0].spawnId, spawns[0].id);
  assert.deepEqual([spawns[0].x, spawns[0].z], [-12, 27]);
});
test('bounded raw timing ring retains exact frame intervals, simulation time and independent snapshots', () => {
  const telemetry = createFrameTelemetry(true, 2);
  for (let i = 1; i <= 3; i++) {
    telemetry.begin(i * 16, i * 16, .016);
    telemetry.add('aiMs', i);
    telemetry.end({ state: 'playing', shots: i });
  }
  const snapshot = telemetry.snapshot;
  assert.equal(snapshot.totalFrames, 3);
  assert.deepEqual(snapshot.frames.map(frame => frame.serial), [2, 3]);
  assert.equal(snapshot.frames[1].intervalMs, 48);
  snapshot.frames[1].aiMs = 100;
  assert.equal(telemetry.snapshot.frames[1].aiMs, 3);
  telemetry.reset(); assert.equal(telemetry.snapshot.frames.length, 0);
  const disabled = createFrameTelemetry(false);
  disabled.begin(0, 16, .016); disabled.add('aiMs', 1); disabled.end({});
  assert.equal(disabled.snapshot.totalFrames, 0);
});
test('percentiles use raw samples including long frames, and CPU inclusive time is labelled separately', () => {
  const result = distribution([16, 16, 16, 50, 200]);
  assert.equal(result.p50, 16); assert.equal(result.p95, 200); assert.equal(result.p99, 200);
  assert.equal(result.over50ms, 1);
  assert.equal(result.max, 200);
  const cpu = summarizeProfile({ nodes: [
    { id: 1, callFrame: { functionName: 'parent', url: 'test.js', lineNumber: 0 }, children: [2] },
    { id: 2, callFrame: { functionName: 'child', url: 'test.js', lineNumber: 1 } },
  ], samples: [2, 2], timeDeltas: [1000, 1000] });
  assert.equal(cpu.sampledMs, 2);
  assert.equal(cpu.self[0].selfMs, 2);
  assert.equal(cpu.inclusive.find(item => item.name.startsWith('parent')).inclusiveMs, 2);
});
