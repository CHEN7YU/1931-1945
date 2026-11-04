import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFacingSector, missionMarkerPosition } from '../src/minimap-view.js';
import { missionTargets } from '../src/mission-targets.js';

test('facing indicator is a 90-degree sector aligned with world camera heading', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 9]) {
    const calls = [];
    const ctx = Object.fromEntries(['save', 'beginPath', 'moveTo', 'arc', 'closePath', 'fill', 'stroke', 'restore']
      .map(name => [name, (...args) => calls.push({ name, args })]));
    drawFacingSector(ctx, 50, 70, heading);
    const [x, z, radius, start, end] = calls.find(call => call.name === 'arc').args;
    assert.deepEqual([x, z, radius], [50, 70, 48]);
    assert.ok(Math.abs(end - start - Math.PI / 2) < 1e-12);
    const center = (start + end) / 2;
    assert.ok(Math.abs(Math.cos(center) + Math.sin(heading)) < 1e-12);
    assert.ok(Math.abs(Math.sin(center) + Math.cos(heading)) < 1e-12);
    assert.deepEqual(calls.find(call => call.name === 'moveTo').args, [50, 70]);
    assert.equal(calls.at(-1).name, 'restore');
    assert.equal(ctx.fillStyle, '#f6e0a970');
    assert.equal(calls.filter(call => call.name === 'stroke').length, 1);
  }
});

test('invalid sector inputs fail explicitly', () => {
  assert.throws(() => drawFacingSector({}, 0, 0, NaN), RangeError);
  assert.throws(() => drawFacingSector({}, 0, 0, 0, 0), RangeError);
});

test('mission flags remain on the map edge and point toward an off-map objective', () => {
  assert.deepEqual(missionMarkerPosition(88, 88, 176), { x: 88, y: 88, offscreen: false, angle: 0 });
  const marker = missionMarkerPosition(-120, 40, 176);
  assert.equal(marker.x, 22); assert.equal(marker.offscreen, true);
  assert.ok(marker.y >= 22 && marker.y <= 154);
  assert.ok(Math.cos(marker.angle) < 0);
  assert.throws(() => missionMarkerPosition(NaN, 0, 176), RangeError);
});

test('map flags follow the actual gate/dock and east-gate mission instead of stale capture ownership', () => {
  const objectives = [{ id: 'gate', x: -6, z: 12 }, { id: 'dock', x: -66, z: -80 }];
  for (const stage of ['gate-defense', 'withdrawal', 'dock-defense', 'withdrawal-to-boats']) {
    const targets = missionTargets({ map: 'nanjing', stage, objectives });
    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, stage === 'gate-defense' ? 'gate' : 'dock');
  }
  const target = missionTargets({ map: 'taierzhuang-fort', phase: 2, objectives: [],
    eastGate: { x: 56, z: 3 } })[0];
  assert.equal(target.shortName, '东门阻击'); assert.equal(target.x, 56);
});
