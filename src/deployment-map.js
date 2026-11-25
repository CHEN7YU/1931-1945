import { SIHANG_MAP_BOUNDS } from './sihang-layout.js';

export function deploymentMapView(stage) {
  if (stage === 'sihang') return { x: 0, z: (SIHANG_MAP_BOUNDS.minZ + SIHANG_MAP_BOUNDS.maxZ) / 2, span: 220 };
  if (stage === 'gate-defense') return { x: 0, z: 5, span: 76 };
  if (stage === 'dock-defense' || stage === 'withdrawal-to-boats') return { x: -80, z: -76, span: 68 };
  return { x: 0, z: 0, span: 220 };
}

export function deploymentMapPoint(view, x, z, size = 176) {
  return [(x - view.x) / view.span * size + size / 2,
    (z - view.z) / view.span * size + size / 2];
}
