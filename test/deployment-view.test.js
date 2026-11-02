import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentMarkerPositions } from '../src/deployment-view.js';
import { deploymentMapPoint, deploymentMapView } from '../src/deployment-map.js';

test('overlapping map markers separate without modifying actual spawn positions', () => {
  const points = [{ id: 'base', x: 0, z: 78 }, { id: 'front', x: .2, z: 78.2 },
    { id: 'other', x: 40, z: 0 }];
  const before = structuredClone(points), positions = deploymentMarkerPositions(points);
  assert.deepEqual(points, before);
  assert.equal(positions.length, 3);
  assert.ok(Math.abs(positions[0].x - positions[1].x) >= 9);
  assert.ok(positions.every(position => position.x >= 0 && position.x <= 100));
});

test('Nanjing spawn markers match the stage-specific tactical map instead of the full Taierzhuang projection', () => {
  for (const stage of ['gate-defense', 'dock-defense', 'withdrawal-to-boats']) {
    const view = deploymentMapView(stage);
    const point = { id: 'spawn', x: view.x - 3, z: view.z + 4 };
    const [x, y] = deploymentMapPoint(view, point.x, point.z, 100);
    assert.deepEqual(deploymentMarkerPositions([point], view), [{ id: point.id, x, y }]);
  }
});
