import * as THREE from 'three';

// Benchmark adapter for the former per-shot construction and immediate disposal.
export function createTracerPool() {
  const active = new Set();
  let created = 0, disposed = 0;
  return {
    acquire(start, end, color) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8 }));
      active.add(line); created++;
      return line;
    },
    release(line) {
      if (!active.delete(line)) throw new Error('Cannot release an inactive or foreign tracer');
      line.geometry.dispose(); line.material.dispose();
      disposed++;
    },
    reset() {
      if (active.size) throw new Error('Release active tracers before resetting their pool');
      created = disposed = 0;
    },
    get snapshot() {
      return { capacity: 0, active: active.size, retained: 0, idle: 0, created, reused: 0, disposed };
    },
  };
}
