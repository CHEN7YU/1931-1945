import { MAP_LIMIT } from '../../src/core.js';

let collisionDiagnostics = null;
export function setCollisionDiagnostics(diagnostics) {
  collisionDiagnostics = diagnostics;
}

export function circleBlocked(x, z, radius, obstacles, feetY = 0, bodyHeight = 1.75) {
  const probe = collisionDiagnostics?.current;
  if (probe) {
    probe.circleCalls++; probe.candidates += obstacles.length;
    const count = obstacles.length;
    probe.candidateHistogram[count === 0 ? 0 : count <= 8 ? 1 : count <= 32 ? 2 : count <= 128 ? 3 : count <= 512 ? 4 : 5]++;
  }
  if (Math.abs(x) > MAP_LIMIT - radius || Math.abs(z) > MAP_LIMIT - radius) {
    if (probe) { probe.boundaryHits++; probe.blocked++; }
    return true;
  }
  const intersects = b => {
    if ((b.minY ?? -Infinity) >= feetY + bodyHeight ||
      (b.height ?? Infinity) <= feetY + .025) return false;
    if (b.circular) return (x - b.cx) ** 2 + (z - b.cz) ** 2 < (radius + b.radius) ** 2;
    if (b.door || b.oriented) {
      const c = b.cos ?? Math.cos(b.angle), s = b.sin ?? Math.sin(b.angle);
      const dx = x - b.cx, dz = z - b.cz;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      const nx = Math.max(-b.hx, Math.min(b.hx, lx)), nz = Math.max(-b.hz, Math.min(b.hz, lz));
      return (lx - nx) ** 2 + (lz - nz) ** 2 < radius ** 2;
    }
    const nx = Math.max(b.minX, Math.min(b.maxX, x));
    const nz = Math.max(b.minZ, Math.min(b.maxZ, z));
    return (x - nx) ** 2 + (z - nz) ** 2 < radius ** 2;
  };
  const result = probe ? obstacles.some(b => { probe.checked++; return intersects(b); }) : obstacles.some(intersects);
  if (probe && result) probe.blocked++;
  return result;
}
