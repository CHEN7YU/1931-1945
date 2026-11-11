export function createMovementObstacles(lookup, vehicles, collider) {
  let dynamic = null, merged = null;
  const capture = () => [...vehicles.values()].filter(item => item.type === 'tank').map(collider);
  return {
    snapshot() {
      const colliders = capture(), buckets = new WeakMap();
      return (x, z) => {
        const base = lookup.at(x, z);
        if (!colliders.length) return base;
        if (!buckets.has(base)) buckets.set(base, [...base, ...colliders]);
        return buckets.get(base);
      };
    },
    beginStablePass() {
      if (dynamic !== null) throw new Error('Movement obstacle passes cannot nest');
      dynamic = capture();
      merged = new WeakMap();
    },
    endStablePass() { dynamic = merged = null; },
    at(x, z, ignoreVehicleId = null) {
      const base = lookup.at(x, z);
      if (dynamic === null) {
        if (!vehicles.size) return base;
        return [...base, ...[...vehicles.values()].filter(item => item.id !== ignoreVehicleId && item.type === 'tank').map(collider)];
      }
      if (!dynamic.length) return base;
      if (ignoreVehicleId !== null) return [...base, ...dynamic.filter(item => item.id !== ignoreVehicleId)];
      let candidates = merged.get(base);
      if (!candidates) {
        candidates = [...base, ...dynamic];
        merged.set(base, candidates);
      }
      return candidates;
    },
  };
}
