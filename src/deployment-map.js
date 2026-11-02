export function deploymentMapView(stage) {
  if (stage === 'gate-defense') return { x: 0, z: 5, span: 76 };
  if (stage === 'dock-defense' || stage === 'withdrawal-to-boats') return { x: -64, z: -76, span: 68 };
  return { x: 0, z: 0, span: 220 };
}

export function deploymentMapPoint(view, x, z, size = 176) {
  return [(x - view.x) / view.span * size + size / 2,
    (z - view.z) / view.span * size + size / 2];
}
