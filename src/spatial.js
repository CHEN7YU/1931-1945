export class SpatialGrid {
  constructor(size = 8) {
    this.size = size;
    this.cells = new Map();
  }
  clear() { this.cells.clear(); }
  insert(item, x, z) {
    const ix = Math.floor(x / this.size), iz = Math.floor(z / this.size);
    let row = this.cells.get(iz);
    if (!row) { row = new Map(); this.cells.set(iz, row); }
    let cell = row.get(ix);
    if (!cell) { cell = []; row.set(ix, cell); }
    cell.push(item);
  }
  rebuild(items, position = item => item.position || item.model.position) {
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
    for (let iz = minZ; iz <= maxZ; iz++) {
      const row = this.cells.get(iz);
      if (!row) continue;
      for (let ix = minX; ix <= maxX; ix++) {
        const cell = row.get(ix);
        if (cell) result.push(...cell);
      }
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
      for (let z = minZ; z <= maxZ; z++) {
        let row = cells.get(z);
        if (!row) { row = new Map(); cells.set(z, row); }
        for (let x = minX; x <= maxX; x++) {
          let cell = row.get(x);
          if (!cell) { cell = []; row.set(x, cell); }
          cell.push(obstacle);
        }
      }
    }
  };
  rebuild();
  return { rebuild, at: (x, z) => cells.get(Math.floor(z / size))?.get(Math.floor(x / size)) || empty };
}
// ---模块结束---
