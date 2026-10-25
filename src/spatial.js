export class SpatialGrid {
  constructor(size = 8) {
    this.size = size;
    this.cells = new Map();
  }
  key(x, z) { return `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`; }
  clear() { this.cells.clear(); }
  insert(item, x, z) {
    const key = this.key(x, z);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(item);
  }
  rebuild(items, position = item => item.model.position) {
    this.clear();
    for (const item of items) if (item.health > 0) {
      const p = position(item);
      this.insert(item, p.x, p.z);
    }
  }
  near(x, z, radius) {
    const result = [];
    const minX = Math.floor((x - radius) / this.size), maxX = Math.floor((x + radius) / this.size);
    const minZ = Math.floor((z - radius) / this.size), maxZ = Math.floor((z + radius) / this.size);
    for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
      const cell = this.cells.get(`${ix},${iz}`);
      if (cell) result.push(...cell);
    }
    return result;
  }
}

export function obstacleLookup(obstacles, radius = .46, size = 8) {
  const cells = new Map(), empty = [];
  const rebuild = () => {
    cells.clear();
    for (const obstacle of obstacles) {
      const minX = Math.floor((obstacle.minX - radius) / size), maxX = Math.floor((obstacle.maxX + radius) / size);
      const minZ = Math.floor((obstacle.minZ - radius) / size), maxZ = Math.floor((obstacle.maxZ + radius) / size);
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(obstacle);
      }
    }
  };
  rebuild();
  return { rebuild, at: (x, z) => cells.get(`${Math.floor(x / size)},${Math.floor(z / size)}`) || empty };
}
// ---模块结束---
