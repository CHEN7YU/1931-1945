import * as THREE from 'three';

export function createTracerPool(capacity = 64) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('Tracer retention capacity must be a nonnegative integer');
  const idle = [], retained = new Set(), active = new Set();
  let created = 0, reused = 0, disposed = 0;
  const dispose = line => { line.geometry.dispose(); line.material.dispose(); disposed++; };
  return {
    acquire(start, end, color) {
      let line = idle.pop();
      if (line) reused++;
      else {
        line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: .8 }));
        created++;
        // Overflow cannot evict the retained material references that keep programs reusable.
        if (retained.size < capacity) retained.add(line);
      }
      line.geometry.setFromPoints([start, end]);
      line.geometry.boundingSphere = line.geometry.boundingBox = null;
      line.material.color.setHex(color);
      line.material.opacity = .8;
      active.add(line);
      return line;
    },
    release(line) {
      if (!active.delete(line)) throw new Error('Cannot release an inactive or foreign tracer');
      if (retained.has(line)) idle.push(line);
      else dispose(line);
    },
    reset() {
      if (active.size) throw new Error('Release active tracers before resetting their pool');
      for (const line of idle) dispose(line);
      idle.length = 0;
      retained.clear();
      created = reused = disposed = 0;
    },
    get snapshot() {
      return { capacity, active: active.size, retained: retained.size, idle: idle.length, created, reused, disposed };
    },
  };
}
