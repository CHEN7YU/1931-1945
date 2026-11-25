import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentMapPoint, deploymentMapView } from '../src/deployment-map.js';
import { NANJING_SPAWNS, isNanjingSpawnAvailable } from '../src/nanjing-campaign.js';
import { NANJING_BATTLE_AREA } from '../src/battle-boundary.js';

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

test('the dock marker and deployment zone are on the safe side of the drawn northern boundary', () => {
  const point = NANJING_SPAWNS.find(spawn => spawn.id === 'nanjing-west-dock');
  for (const stage of ['dock-defense', 'withdrawal-to-boats']) {
    const view = deploymentMapView(stage);
    const [, boundary] = deploymentMapPoint(view, point.x, NANJING_BATTLE_AREA.minZ);
    const [markerX, markerY] = deploymentMapPoint(view, point.x, point.z);
    const [, zoneTop] = deploymentMapPoint(view, point.x, point.deploymentZone.minZ);
    assert.ok(boundary >= 0 && markerX >= 0 && markerX <= 176 && markerY <= 176);
    assert.ok(markerY > zoneTop && zoneTop > boundary);
  }
});

test('compact Sihang maps center the retained terrain without changing other campaigns', () => {
  const view = deploymentMapView('sihang');
  assert.deepEqual(view, { x: 0, z: -17, span: 220 });
  assert.deepEqual(deploymentMapPoint(view, 0, -17), [88, 88]);
  assert.equal(deploymentMapView(null).z, 0);
});
