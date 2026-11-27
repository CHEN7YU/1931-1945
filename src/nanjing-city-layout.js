const streets = [
  { id: 'gate-high-street', width: 4.8, points: [[0, -108], [2, -86], [-2, -64], [2, -41], [0, -12]] },
  { id: 'dock-approach', width: 3, points: [[-10, -16], [-25, -33], [-38, -47], [-48, -60], [-56, -73], [-56, -92]] },
  { id: 'west-gate-dock-road', width: 5, points: [[-56, NANJING_WEST_GATE_Z], [-72, NANJING_WEST_GATE_Z], [-82, -66], [-91, -80], [NANJING_DOCK_ENTRY_X - 2, -80]] },
  { id: 'cross-market-lane', width: 2.6, points: [[-68, -60], [-48, -60], [-29, -63], [-12, -59],
    [6, -58], [25, -62], [44, -59], [66, -64], [103, -60]] },
  { id: 'east-neighborhood-lane', width: 3.2, points: [[18, -12], [27, -31], [38, -44], [43, -60],
    [53, -78], [61, -104]] },
  { id: 'north-bank-lane', width: 5.5, points: [[-68, -96], [-40, -94], [-19, -98], [0, -94],
    [26, -98], [51, -93], [79, -97], [104, -93]] },
];
const streetFixtures = [
  { id: 'utility-west-north', kind: 'utility', x: -6, z: -85 },
  { id: 'utility-west-south', kind: 'utility', x: -6, z: -40 },
  { id: 'utility-east-north', kind: 'utility', x: 6, z: -85 },
  { id: 'utility-east-south', kind: 'utility', x: 7, z: -30 },
  { id: 'utility-market-west', kind: 'utility', x: -45, z: -65 },
  { id: 'utility-market-east', kind: 'utility', x: 65, z: -67 },
  { id: 'utility-outside-west-gate', kind: 'utility', x: -102, z: -58 },
  { id: 'streetlamp-west', kind: 'streetlamp', x: -6, z: -102.5 },
  { id: 'streetlamp-east', kind: 'streetlamp', x: 7, z: -15 },
  { id: 'streetlamp-market', kind: 'streetlamp', x: -39, z: -57 },
  { id: 'streetlamp-outside-west-gate', kind: 'streetlamp', x: -87, z: -58 },
];

export function cityStreetIntersectsLot(lot, street, clearance = 0) {
  const [x, z, width, depth] = lot;
  const margin = street.width / 2 + clearance;
  const bounds = [x - width / 2 - margin, x + width / 2 + margin,
    z - depth / 2 - margin, z + depth / 2 + margin];
  return street.points.slice(1).some(([bx, bz], index) => {
    const [ax, az] = street.points[index];
    let start = 0, end = 1;
    for (const [origin, delta, min, max] of [
      [ax, bx - ax, bounds[0], bounds[1]], [az, bz - az, bounds[2], bounds[3]],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < min || origin > max) return false;
      } else {
        const a = (min - origin) / delta, b = (max - origin) / delta;
        start = Math.max(start, Math.min(a, b));
        end = Math.min(end, Math.max(a, b));
        if (start > end) return false;
      }
    }
    return true;
  });
}

export function createNanjingCityLayout() {
  const lots = [];
  const assaultSpawns = NANJING_SPAWNS.filter(spawn => NANJING_DOCK_ASSAULT_SPAWNS.includes(spawn.id));
  const reserves = NANJING_SPAWNS.filter(spawn => spawn.id.startsWith('nanjing-reserve-'));
  let seed = 19371212;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Keep the historical-defense play space fixed; only the residential parcels are repacked.
  for (const z of [-6, 4]) for (const x of [-62, -52, -42, -32, 32, 42, 52, 62, 76, 86, 96]) {
    lots.push([x + (random() - .5) * 1.2, z + (random() - .5) * 1.2,
      5 + random(), 5 + random(), 1 + (Math.abs(x) / 2 + z + 6) % 2]);
  }
  for (const z of [29, 75]) for (const x of [-45, -9, 18, 43]) {
    if (z !== 29 || x !== -9) lots.push([x, z, 6.5, 6, 1]);
  }
  for (let attempt = 0; attempt < 120000; attempt++) {
    const infill = attempt >= 20000;
    const x = -67 + random() * 168, z = -101 + random() * 111;
    const width = infill ? 3.6 + random() * 2 : 6 + random() * 3;
    const depth = infill ? 3.6 + random() * 2 : 6 + random() * 3;
    const lot = [x, z, width, depth];
    if (x - width / 2 < -45 && z - depth / 2 < -65 && z + depth / 2 > -92 ||
      z + depth / 2 > -14 && x - width / 2 < 30 && x + width / 2 > -34 ||
      x - width / 2 < -70 || x + width / 2 > 104 ||
      z - depth / 2 < -105 ||
      assaultSpawns.some(spawn => Math.abs(x - spawn.x) < width / 2 + 5 &&
        Math.abs(z - spawn.z) < depth / 2 + 5) ||
      reserves.some(spawn => Math.abs(x - spawn.x) < width / 2 + 4 &&
        Math.abs(z - spawn.z) < depth / 2 + 4) ||
      Math.abs(x - 90) < width / 2 + 4 && Math.abs(z + 93) < depth / 2 + 4 ||
      streets.some(street => cityStreetIntersectsLot(lot, street, .65)) ||
      lots.some(([lx, lz, w, d]) => Math.abs(x - lx) < (width + w) / 2 + 1.8 &&
        Math.abs(z - lz) < (depth + d) / 2 + 1.8)) continue;
    const floors = z < -60 || x < -50 ? 1 : 1 + Math.floor(random() * 4);
    lots.push([...lot, floors]);
  }
  lots.push([-81, -49, 5, 5, 1], [-88, -49, 5, 5, 1], [-98, -46, 5, 5, 1], [-97, -66, 5, 5, 1],
    [-81, -103, 5, 5, 1], [-81, -96, 5, 5, 1]);
  for (const lot of lots) {
    const [x, z] = lot;
    let nearest = Infinity, facing = 0;
    if (z < -12) for (const street of streets) for (let index = 1; index < street.points.length; index++) {
      const [ax, az] = street.points[index - 1], [bx, bz] = street.points[index];
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) /
        ((bx - ax) ** 2 + (bz - az) ** 2)));
      const dx = ax + t * (bx - ax) - x, dz = az + t * (bz - az) - z;
      const distance = Math.hypot(dx, dz);
      if (distance < nearest) {
        nearest = distance;
        facing = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 1 : 3) : dz < 0 ? 0 : 2;
      }
    }
    lot.push(facing);
  }
  return {
    lots,
    streets: streets.map(street => ({ ...street, points: street.points.map(point => [...point]) })),
    streetFixtures: streetFixtures.map(fixture => ({ ...fixture })),
  };
}
import { NANJING_DOCK_ASSAULT_SPAWNS, NANJING_DOCK_ENTRY_X, NANJING_SPAWNS, NANJING_WEST_GATE_Z } from './nanjing-campaign.js';
