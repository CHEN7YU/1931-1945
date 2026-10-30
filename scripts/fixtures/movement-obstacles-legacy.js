// Benchmark-only adapter: the former per-query builder, without a stable-pass cache.
export function createMovementObstacles(lookup, vehicles, collider) {
  return {
    beginStablePass() {},
    endStablePass() {},
    at(x, z, ignoreVehicleId = null) {
      const base = lookup.at(x, z);
      if (!vehicles.size) return base;
      return [...base, ...[...vehicles.values()].filter(item => item.id !== ignoreVehicleId && item.type === 'tank').map(collider)];
    },
  };
}
