const floorY = 3.4, ceilingY = 6.15;
export const NANJING_CASEMATE = Object.freeze({
  id: 'west-wall-casemate', adaptation: true, floorY, ceilingY,
  entrance: Object.freeze({ x: -8.7, y: 0, z: 1.45 }),
  stairs: Object.freeze({ minX: -16.6, maxX: -9.3, minZ: .7, maxZ: 2.2, steps: 18 }),
  corridor: Object.freeze({ minX: -17.6, maxX: -15.4, minZ: .7, maxZ: 15.6 }),
  room: Object.freeze({ minX: -18.8, maxX: -13.2, minZ: 15.25, maxZ: 20.4 }),
  slit: Object.freeze({ minX: -18.175, maxX: -16.525, minZ: 20.35, maxZ: 21.25, minY: 3.95, maxY: 4.95 }),
  weapon: Object.freeze({ x: -16.7, z: 19.85, altitude: floorY, heading: Math.atan2(7.3, -18.15), enclosed: true }),
});
const C = NANJING_CASEMATE;
export const NANJING_CASEMATE_VOIDS = Object.freeze([
  { ...C.stairs, minY: 0, maxY: ceilingY },
  { ...C.corridor, minY: floorY - .2, maxY: ceilingY + .18 },
  { ...C.room, minY: floorY - .2, maxY: ceilingY + .18 },
  C.slit,
].map(Object.freeze));

const overlaps = (a, b) => ['X', 'Y', 'Z'].every(axis =>
  a[`min${axis}`] < b[`max${axis}`] && a[`max${axis}`] > b[`min${axis}`]);

export function subtractCasemateBox(box, holes = NANJING_CASEMATE_VOIDS) {
  let pieces = [box];
  for (const hole of holes) pieces = pieces.flatMap(part => {
    if (!overlaps(part, hole)) return [part];
    const cut = Object.fromEntries(['X', 'Y', 'Z'].flatMap(axis => [
      [`min${axis}`, Math.max(part[`min${axis}`], hole[`min${axis}`])],
      [`max${axis}`, Math.min(part[`max${axis}`], hole[`max${axis}`])],
    ]));
    const remaining = [
      { ...part, maxX: cut.minX }, { ...part, minX: cut.maxX },
      { ...part, minX: cut.minX, maxX: cut.maxX, maxY: cut.minY },
      { ...part, minX: cut.minX, maxX: cut.maxX, minY: cut.maxY },
      { ...part, minX: cut.minX, maxX: cut.maxX, minY: cut.minY, maxY: cut.maxY, maxZ: cut.minZ },
      { ...part, minX: cut.minX, maxX: cut.maxX, minY: cut.minY, maxY: cut.maxY, minZ: cut.maxZ },
    ];
    return remaining.filter(piece => ['X', 'Y', 'Z'].every(axis => piece[`max${axis}`] - piece[`min${axis}`] > .00001));
  });
  return pieces;
}

export function casemateGateSlices(minZ, maxZ) {
  const cuts = [...new Set([minZ, maxZ, ...NANJING_CASEMATE_VOIDS.flatMap(hole =>
    [hole.minZ, hole.maxZ].filter(z => z > minZ && z < maxZ))])].sort((a, b) => a - b);
  return cuts.slice(1).map((end, index) => {
    const start = cuts[index], middle = (start + end) / 2;
    const holes = NANJING_CASEMATE_VOIDS.filter(hole => middle > hole.minZ && middle < hole.maxZ);
    return { minZ: start, maxZ: end, holes: holes.filter(hole => !holes.some(other => other !== hole &&
      other.minX <= hole.minX && other.maxX >= hole.maxX && other.minY <= hole.minY && other.maxY >= hole.maxY)) };
  });
}

const inside = (x, z, bounds) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
export function casemateFloorAt(x, z) {
  if (inside(x, z, C.stairs)) {
    const fraction = (C.stairs.maxX - x) / (C.stairs.maxX - C.stairs.minX);
    return floorY * Math.min(C.stairs.steps, Math.floor(fraction * C.stairs.steps) + 1) / C.stairs.steps;
  }
  return inside(x, z, C.corridor) || inside(x, z, C.room) ? floorY : null;
}

export function inNanjingCasemate(point) {
  const floor = casemateFloorAt(point.x, point.z);
  return floor !== null && Number.isFinite(point.y) && point.y > .05 && Math.abs(point.y - floor) < .4;
}

export function nearNanjingCasemate(point) {
  return [C.stairs, C.corridor, C.room].some(bounds => point.x >= bounds.minX - .6 &&
    point.x <= bounds.maxX + .6 && point.z >= bounds.minZ - .6 && point.z <= bounds.maxZ + .6);
}

export function casemateRouteNodes() {
  const stairs = C.stairs;
  return [C.entrance, ...Array.from({ length: stairs.steps }, (_, index) => ({
    x: stairs.maxX - (index + .5) * (stairs.maxX - stairs.minX) / stairs.steps,
    y: floorY * (index + 1) / stairs.steps, z: C.entrance.z,
  })), { x: -16.5, y: floorY, z: 3 }, { x: -16.5, y: floorY, z: 15.6 },
  { x: -16.4, y: floorY, z: 18 }];
}

export function casemateRoute(start, goal, connect, routeToEntrance) {
  const source = inNanjingCasemate(start), destination = inNanjingCasemate(goal);
  if (!source && !destination) return null;
  const direct = source && destination ? connect(start, goal) : [];
  if (direct.length) return direct;
  const nodes = casemateRouteNodes();
  const connection = (point, outgoing) => {
    const candidates = nodes.map((node, index) => ({ node, index,
      distance: Math.hypot(point.x - node.x, point.y - node.y, point.z - node.z) }))
      .sort((a, b) => a.distance - b.distance);
    for (const { node, index } of candidates) {
      const path = outgoing ? connect(point, node) : connect(node, point);
      if (path.length) return { index, path };
    }
    return null;
  };
  const from = source ? connection(start, true) : { index: 0, path: routeToEntrance(start) };
  const outsideRoute = destination ? null : routeToEntrance(goal);
  const to = destination ? connection(goal, false) : outsideRoute.length
    ? { index: 0, path: [{ ...goal }, ...outsideRoute].toReversed() } : null;
  if (!from?.path.length || !to?.path.length) return [];
  const path = [...from.path], direction = Math.sign(to.index - from.index);
  for (let index = from.index; index !== to.index; index += direction) {
    const leg = connect(nodes[index], nodes[index + direction]);
    if (!leg.length) return [];
    path.push(...leg);
  }
  return [...path, ...to.path];
}
