import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentMapPoint, deploymentMapView } from '../src/deployment-map.js';
import { NANJING_SPAWNS, isNanjingSpawnAvailable } from '../src/nanjing-campaign.js';

test('deployment zoom follows the active defense while keeping its selectable spawns inside the map', () => {
  for (const stage of ['gate-defense', 'dock-defense', 'withdrawal-to-boats']) {
    const view = deploymentMapView(stage);
    assert.ok(view.span < 80);
    assert.deepEqual(deploymentMapPoint(view, view.x, view.z), [88, 88]);
    for (const spawn of NANJING_SPAWNS.filter(point => !point.aiOnly && point.team === 'friendly' &&
      isNanjingSpawnAvailable(point, stage !== 'gate-defense'))) {
      const pixels = deploymentMapPoint(view, spawn.x, spawn.z);
      assert.ok(pixels.every(value => value >= 10 && value <= 166));
    }
  }
  assert.equal(deploymentMapView('withdrawal').span, 220);
  assert.equal(deploymentMapView(null).span, 220, 'Taierzhuang retains its whole battlefield');
});

test('compact Sihang maps center the retained terrain without changing other campaigns', () => {
  const view = deploymentMapView('sihang');
  assert.deepEqual(view, { x: 0, z: -17, span: 220 });
  assert.deepEqual(deploymentMapPoint(view, 0, -17), [88, 88]);
  assert.equal(deploymentMapView(null).z, 0);
});
