// Three playable storeys are an adaptation, not a reconstruction of every historical floor.
const floorHeight = 7.2;
export const SIHANG_WAREHOUSE = Object.freeze({
  x: -4, z: -25, width: 64, depth: 34,
  minX: -36, maxX: 28, minZ: -42, maxZ: -8,
  floorHeight, floors: 3, roofY: floorHeight * 3,
  bounds: Object.freeze({ minX: -36, maxX: 28, minZ: -42, maxZ: -8 }),
});
export const SIHANG_RIVER = Object.freeze({ northZ: 0, southZ: 32, waterY: -1 });
export const SIHANG_MAP_BOUNDS = Object.freeze({ minX: -108, maxX: 108, minZ: -108, maxZ: 74 });
export const SIHANG_BATTLE_AREA = Object.freeze({ minX: -100, maxX: 100, minZ: -96, maxZ: 72 });
// The supplied overhead plan places the broad bay west of the warehouse, with a clear southern quay.
export function sihangRiverBounds(x) {
  if (!Number.isFinite(x)) throw new RangeError('Sihang river requires a finite x');
  const bounded = Math.max(-108, Math.min(108, x));
  const eastEntry = (bounded - 28) / 18, eastExit = (bounded - 46) / 18;
  const northZ = bounded < -72 ? 20 - 56 * ((bounded + 72) / 36) ** 2
    : bounded < -54 ? 20 - 10 * ((bounded + 72) / 18) ** 2
    : bounded < -36 ? 10 * ((bounded + 36) / 18) ** 2
    : bounded <= 28 ? 0
    : bounded < 46 ? -.86 * eastEntry ** 2
    : bounded < 64 ? -.86 - 1.72 * eastExit - 8.86 * eastExit ** 2
    : 8 - 96 * ((bounded - 28) / 80) ** 2;
  return { northZ, southZ: northZ + 32 };
}

export function sihangNorthBank(position, margin = 0) {
  return Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.z) &&
    Number.isFinite(margin) && position.z <= sihangRiverBounds(position.x).northZ - margin);
}

export function sihangSouthBank(position, margin = 0) {
  return Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.z) &&
    Number.isFinite(margin) && position.z >= sihangRiverBounds(position.x).southZ + margin);
}

export function sihangBlastClearOfSouthBank(position, radius) {
  if (!position || ![position.x, position.z, radius].every(Number.isFinite) || radius < 0) return false;
  const boundary = Math.min(sihangRiverBounds(position.x - radius).southZ,
    sihangRiverBounds(position.x + radius).southZ);
  return position.z + radius < boundary;
}

// Earliest crossing of a protected south bank. A bounded set of quadratic intervals,
// regardless of range or soldier count; even rays that enter then leave are clipped.
export function sihangRiverRayRange(origin, direction, range, margin = 0) {
  if (![origin?.x, origin?.z, direction?.x, direction?.z, range, margin].every(Number.isFinite) || range < 0)
    throw new RangeError('Sihang river ray requires finite coordinates and a nonnegative range');
  const distance = t => origin.z + direction.z * t -
    sihangRiverBounds(origin.x + direction.x * t).southZ + margin;
  if (distance(0) >= 0) return 0;
  const cuts = [0, range];
  if (direction.x !== 0) for (const x of [-108, -72, -54, -36, 28, 46, 64, 108]) {
    const t = (x - origin.x) / direction.x;
    if (t > 0 && t < range) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1], span = cuts[i] - start;
    if (!span) continue;
    const c = distance(start), mid = distance(start + span / 2), end = distance(start + span);
    const a = 2 * (end + c - 2 * mid), b = end - c - a;
    const roots = [];
    if (Math.abs(a) < 1e-10) {
      if (Math.abs(b) > 1e-12) roots.push(-c / b);
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= -1e-10) {
        const sqrt = Math.sqrt(Math.max(0, discriminant));
        // Avoid cancellation in the small root when the other root is distant.
        const q = -.5 * (b + (b < 0 ? -sqrt : sqrt));
        if (q) roots.push(q / a, c / q);
        else roots.push(-b / (2 * a));
      }
    }
    const crossing = roots.filter(s => s >= -1e-9 && s <= 1 + 1e-9).sort((a, b) => a - b)[0];
    if (crossing !== undefined) return Math.max(0, Math.min(range, start + span * crossing));
  }
  return range;
}

export const SIHANG_RESERVED_LANES = Object.freeze([
  { id: 'warehouse-south-quay', minX: -36, maxX: 28, minZ: -8, maxZ: 0 },
  { id: 'west-armor', minX: -74, maxX: -66, minZ: -108, maxZ: -20 },
  { id: 'east-armor', minX: 66, maxX: 74, minZ: -108, maxZ: -20 },
  { id: 'west-flank', minX: -74, maxX: -38, minZ: -29, maxZ: -21 },
  { id: 'east-flank', minX: 30, maxX: 74, minZ: -29, maxZ: -21 },
  { id: 'sapper-assembly', minX: -3.5, maxX: 3.5, minZ: -108, maxZ: -42.5 },
  { id: 'retreat-exit', minX: 31, maxX: 39, minZ: -45, maxZ: -5 },
  { id: 'retreat-approach', minX: 33, maxX: 81, minZ: -39, maxZ: -30 },
  { id: 'retreat-bridge', minX: 72, maxX: 98, minZ: -32, maxZ: 10 },
  { id: 'south-parade-approach', minX: 80, maxX: 98, minZ: 0, maxZ: 44 },
  { id: 'south-parade-square', minX: 54, maxX: 84, minZ: 34, maxZ: 68 },
].map(Object.freeze));
export const SIHANG_BRIDGE = Object.freeze({ name: '西藏路桥', x: 83, z: -22, width: 8,
  northX: 76, southX: 90, northZ: -28, southZ: -16, length: Math.hypot(14, 12) });
export function sihangBridgeCoordinates(position) {
  const dx = SIHANG_BRIDGE.southX - SIHANG_BRIDGE.northX, dz = SIHANG_BRIDGE.southZ - SIHANG_BRIDGE.northZ;
  const x = position.x - SIHANG_BRIDGE.northX, z = position.z - SIHANG_BRIDGE.northZ;
  return { along: (x * dx + z * dz) / SIHANG_BRIDGE.length,
    across: (x * dz - z * dx) / SIHANG_BRIDGE.length };
}
export function sihangBridgePoint(fraction, lateral = 0) {
  if (![fraction, lateral].every(Number.isFinite)) throw new RangeError('Invalid bridge coordinate');
  const dx = SIHANG_BRIDGE.southX - SIHANG_BRIDGE.northX, dz = SIHANG_BRIDGE.southZ - SIHANG_BRIDGE.northZ;
  return { x: SIHANG_BRIDGE.northX + fraction * dx + lateral * dz / SIHANG_BRIDGE.length,
    z: SIHANG_BRIDGE.northZ + fraction * dz - lateral * dx / SIHANG_BRIDGE.length };
}
export function sihangBridgeContains(position, margin = 0) {
  if (![position?.x, position?.z, margin].every(Number.isFinite)) return false;
  const local = sihangBridgeCoordinates(position);
  return local.along >= -1e-7 && local.along <= SIHANG_BRIDGE.length + 1e-7 &&
    Math.abs(local.across) <= SIHANG_BRIDGE.width / 2 - margin + 1e-7;
}
export const SIHANG_CAPTURE_AREA = Object.freeze({
  minX: -34, maxX: 26, minZ: -40, maxZ: -10, maxY: 2.4,
});
// Coordinates follow the supplied north-wall photograph; screen-right is world -X.
export const SIHANG_NORTH_APERTURES = Object.freeze([
  { id: 'north-main-lower', u: 0, bottom: 17.15, top: 21.3, width: 4.8,
    outline: [[-1.1,17.15],[1.3,17.15],[1.8,17.6],[2.25,18.05],[2.05,18.6],[2.4,19.1],
      [1.7,19.65],[1.5,20.2],[1.8,20.75],[.8,21.3],[-1.4,21.15],[-1.55,20.3],[-2.15,19.8],
      [-1.85,19.25],[-2.4,18.65],[-1.9,18.1],[-1.7,17.65]] },
  { id: 'north-main-upper', u: .2, bottom: 21.65, top: 25.05, width: 4.9,
    outline: [[-1.5,21.65],[.9,21.65],[1.15,22.2],[2.2,22.6],[1.7,23.1],[2.65,23.6],
      [2.4,24.4],[2.2,25.05],[-1.8,24.95],[-2.25,24.6],[-2.1,23.9],[-1.9,23.2],[-1.95,22.4]] },
  { id: 'north-center-lower', u: -13.1, bottom: 17.2, top: 20.7, width: 3.8,
    outline: [[-14.2,17.2],[-12.2,17.25],[-11.75,18.05],[-11.2,18.6],[-11.6,19.25],
      [-11.4,20.05],[-12.0,20.7],[-14.5,20.6],[-15,20.0],[-14.6,19.25],[-14.95,18.7],[-14.5,18.1]] },
  { id: 'north-center-upper', u: -12.9, bottom: 21.15, top: 23.45, width: 4.5,
    outline: [[-14.5,21.15],[-11.1,21.25],[-10.6,21.7],[-11.6,22.0],[-12.0,22.65],
      [-12.9,23.45],[-13.55,22.95],[-13.6,22.2],[-14.8,21.9],[-15.1,21.5]] },
  { id: 'north-center-small', u: -10.0, bottom: 21.4, top: 22.65, width: 1.4,
    outline: [[-10.55,21.4],[-9.35,21.45],[-9.55,22.0],[-9.85,22.65],[-10.4,22.3],[-10.65,21.8]] },
  { id: 'north-right-middle', u: -25.3, bottom: 9.05, top: 13.45, width: 3.2,
    outline: [[-26.35,9.05],[-24.4,9.1],[-24.0,10.05],[-23.7,10.7],[-24.05,11.3],
      [-23.8,12.25],[-24.1,13.45],[-26.5,13.35],[-26.9,12.85],[-26.4,12.1],[-26.65,11.35],[-26.2,10.7]] },
  { id: 'north-right-lower', u: -25.8, bottom: 6.7, top: 8.0, width: 2.45,
    outline: [[-26.5,6.7],[-25.35,6.85],[-24.6,7.35],[-24.8,8.0],[-26.6,7.95],[-27.05,7.5]] },
  { id: 'north-right-small', u: -20.3, bottom: 12.35, top: 13.65, width: 2.2,
    outline: [[-21.1,12.35],[-19.45,12.4],[-19.2,12.85],[-19.8,13.65],[-20.65,13.35],[-21.4,13.0]] },
].map(hole => Object.freeze({ ...hole, kind: 'breach', irregular: true,
  bottom: hole.bottom * floorHeight / 8.4, top: hole.top * floorHeight / 8.4,
  outline: Object.freeze(hole.outline.map(([x, y]) => Object.freeze([x, y * floorHeight / 8.4]))) })));
export const SIHANG_DEMOLITION_POINT = Object.freeze({ x: SIHANG_NORTH_APERTURES[0].u, y: 0, z: -43.5 });
export const SIHANG_EVACUATION = Object.freeze({ x: 92, z: 4, radius: 12, southZ: -14 });
export const SIHANG_EAST_DEFENSE_WINDOWS = Object.freeze([-39, -36, -21, -18, -15, -12]);
export const SIHANG_FIRING_POSTS = Object.freeze([
  ...[[0, [-1.35, -.45, .45, 1.35]], [2, [-.65, .65]], [5, [-.6, .6]]].flatMap(([index, offsets]) => {
    const hole = SIHANG_NORTH_APERTURES[index], floor = Math.floor(hole.bottom / floorHeight) * floorHeight;
    return offsets.map((offset, side) => ({ id: `north-firing-${hole.id}-${side}`, x: hole.u + offset,
      y: floor, z: -41, heading: 0, facade: 'north', apertureId: hole.id, sillY: hole.bottom,
      setback: 1, aimProbe: Object.freeze({ x: hole.u + offset, y: 1.2, z: -78 }) }));
  }),
  ...SIHANG_EAST_DEFENSE_WINDOWS.map((z, window) => ({
    id: `east-firing-${window}`, x: 27, y: floorHeight, z,
    heading: -Math.PI / 2, facade: 'east', apertureId: `east-1-${z}`,
    sillY: SIHANG_WAREHOUSE.floorHeight + .8, setback: 1, aimProbe: Object.freeze({ x: 62, y: 1.2, z: z - 10 }),
  })),
  ...[[-38, [-.85, 0, .85]], [-22, [-.85, 0, .85]], [-14, [-.6, .6]]].flatMap(([z, offsets]) =>
    offsets.map((offset, side) => ({ id: `east-upper-${z}-${side}`, x: 27, y: floorHeight * 2, z: z + offset,
      heading: -Math.PI / 2, facade: 'east', apertureId: `east-2-${z}`, sillY: floorHeight * 2 + .5,
      setback: 1, aimProbe: Object.freeze({ x: 62, y: 1.2, z: z + offset - 7 }) }))),
].map(Object.freeze));
export const SIHANG_DEFENSE_POSTS = SIHANG_FIRING_POSTS;
export const SIHANG_SQUAD_ORIGINS = Object.freeze([
  { x: -18, y: 0, z: -31 }, { x: 18, y: 0, z: -31 },
  { x: -18, y: 0, z: -18 }, { x: 18, y: 0, z: -18 },
].map(Object.freeze));
export const SIHANG_ENEMY_APPROACHES = Object.freeze([
  { x: -78, y: 0, z: -88 }, { x: 0, y: 0, z: -94 }, { x: 78, y: 0, z: -88 },
].map(Object.freeze));
export const SIHANG_TANK_ORIGINS = Object.freeze([
  { x: -70, y: 0, z: -90 }, { x: 70, y: 0, z: -90 },
].map(Object.freeze));
export const SIHANG_LEVELS = Object.freeze(Array.from({ length: 4 }, (_, floor) => floor * floorHeight));
export const SIHANG_STAIRWELLS = Object.freeze([-32, -2, 24].map((x, index) => Object.freeze({
  id: `sihang-stair-${index}`, x, minX: x - 3, maxX: x + 3, minZ: -33, maxZ: -23.8,
  entryZ: -34.2, turnZ: -24.8, width: 6, flightWidth: 2.4, run: 7.2, steps: 24,
})));
export const SIHANG_STAIR_ROUTES = Object.freeze(SIHANG_STAIRWELLS.flatMap(stair =>
  [0, 1, 2].map(floor => {
    const base = SIHANG_LEVELS[floor], middle = base + SIHANG_WAREHOUSE.floorHeight / 2, topY = SIHANG_LEVELS[floor + 1];
    const point = (x, y, z) => Object.freeze({ x, y, z });
    const flights = [
      { id: `${stair.id}-${floor}-up`, start: point(stair.x - 1.5, base, -33),
        end: point(stair.x - 1.5, middle, -25.8) },
      { id: `${stair.id}-${floor}-return`, start: point(stair.x + 1.5, middle, -25.8),
        end: point(stair.x + 1.5, topY, -33) },
    ].map(flight => Object.freeze({ ...flight, floor, stairId: stair.id, steps: stair.steps,
      width: stair.flightWidth, minX: flight.start.x - stair.flightWidth / 2,
      maxX: flight.start.x + stair.flightWidth / 2, minZ: -33, maxZ: -25.8 }));
    const bottom = point(stair.x - 1.5, base, stair.entryZ);
    const top = point(stair.x + 1.5, topY, stair.entryZ);
    const landing = Object.freeze({ minX: stair.minX, maxX: stair.maxX, minZ: -25.8,
      maxZ: stair.maxZ, height: middle });
    const waypoints = Object.freeze([bottom, flights[0].start, flights[0].end,
      point(stair.x - 1.5, middle, stair.turnZ), point(stair.x + 1.5, middle, stair.turnZ),
      flights[1].start, flights[1].end, top]);
    return Object.freeze({ floor, x: stair.x, stairId: stair.id, bottom, top,
      flights: Object.freeze(flights), landing, waypoints });
  })));

export function sihangStairHeight(flight, z) {
  if (!Number.isFinite(z) || !flight || !Number.isFinite(flight.start?.y) || !Number.isFinite(flight.end?.y) ||
    !Number.isFinite(flight.start?.z) || !Number.isFinite(flight.end?.z) ||
    flight.start.z === flight.end.z || !Number.isInteger(flight.steps) || flight.steps < 1)
    throw new RangeError('Sihang stair height requires a valid flight and finite z');
  const fraction = Math.max(0, Math.min(1, (z - flight.start.z) / (flight.end.z - flight.start.z)));
  const step = Math.ceil(fraction * flight.steps - 1e-8);
  return flight.start.y + step / flight.steps * (flight.end.y - flight.start.y);
}
