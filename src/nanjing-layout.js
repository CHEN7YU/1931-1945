export const NANJING_MAP_SCALE = .4;
export const NANJING_DETAIL_SCALE = NANJING_MAP_SCALE / .5;
const scaleMeters = meters => Number((meters * NANJING_MAP_SCALE).toFixed(2));
export const NANJING_GATE_WIDTH = scaleMeters(118.5);
const originalGateLength = scaleMeters(128);
export const NANJING_RAMPART_HEIGHT = scaleMeters(20.45);
export const NANJING_GATE_HEIGHT = scaleMeters(21.45);
export const NANJING_RAMPART_THICKNESS_METERS = 11;
export const NANJING_RAMPART_THICKNESS = scaleMeters(NANJING_RAMPART_THICKNESS_METERS);
export const NANJING_COURTYARD_WIDTH_METERS = 47.2;
export const NANJING_COURTYARD_WIDTH = scaleMeters(NANJING_COURTYARD_WIDTH_METERS);
export const NANJING_COURTYARD_HALF_WIDTH = NANJING_COURTYARD_WIDTH / 2;
export const NANJING_FLANKING_BUFFER_METERS = (118.5 -
  NANJING_RAMPART_THICKNESS_METERS * 2 - NANJING_COURTYARD_WIDTH_METERS) / 2;
export const NANJING_FLANKING_BUFFER_WIDTH = scaleMeters(NANJING_FLANKING_BUFFER_METERS);
export const NANJING_GATE_TUNNEL = Object.freeze({
  width: scaleMeters(8),
  height: scaleMeters(9.5),
  depth: scaleMeters(15),
});

const courtyardDepth = (originalGateLength - NANJING_RAMPART_THICKNESS * 2 -
  NANJING_GATE_TUNNEL.depth * 4) / 3;
const southInnerEdge = originalGateLength / 2 - NANJING_RAMPART_THICKNESS;
const gateCentersSouthToNorth = [];
const courtyards = [];
let cursor = southInnerEdge;
for (let index = 0; index < 4; index++) {
  gateCentersSouthToNorth.push(cursor - NANJING_GATE_TUNNEL.depth / 2);
  cursor -= NANJING_GATE_TUNNEL.depth;
  if (index < 3) {
    const southEdge = cursor;
    const northEdge = southEdge - courtyardDepth;
    courtyards.push(Object.freeze({
      id: `courtyard-${index + 1}`,
      index: index + 1,
      minX: -NANJING_COURTYARD_HALF_WIDTH,
      maxX: NANJING_COURTYARD_HALF_WIDTH,
      minZ: northEdge,
      maxZ: southEdge,
      centerZ: (northEdge + southEdge) / 2,
      width: NANJING_COURTYARD_WIDTH,
      depth: courtyardDepth,
    }));
    cursor = northEdge;
  }
}

export const NANJING_GATE_Z = gateCentersSouthToNorth[0];
export const NANJING_GATE_POSITIONS = Object.freeze(gateCentersSouthToNorth.slice(0, 3).sort((a, b) => a - b));
export const NANJING_COURTYARDS = Object.freeze(courtyards.slice(0, 2));
export const NANJING_GATE_NORTH_EDGE = NANJING_GATE_POSITIONS[0] - NANJING_GATE_TUNNEL.depth / 2;
export const NANJING_GATE_SOUTH_EDGE = originalGateLength / 2;
export const NANJING_GATE_LENGTH = NANJING_GATE_SOUTH_EDGE - NANJING_GATE_NORTH_EDGE;
export const NANJING_WALL_INNER_EDGE_X = NANJING_GATE_WIDTH / 2 - NANJING_RAMPART_THICKNESS;
export const NANJING_FLANKING_BUFFERS = Object.freeze([-1, 1].map(side => Object.freeze({
  side,
  minX: side < 0 ? -NANJING_WALL_INNER_EDGE_X : NANJING_COURTYARD_HALF_WIDTH,
  maxX: side < 0 ? -NANJING_COURTYARD_HALF_WIDTH : NANJING_WALL_INNER_EDGE_X,
  centerX: side * (NANJING_COURTYARD_HALF_WIDTH + NANJING_FLANKING_BUFFER_WIDTH / 2),
  width: NANJING_FLANKING_BUFFER_WIDTH,
})));
const wallCenterX = NANJING_GATE_WIDTH / 2 - NANJING_RAMPART_THICKNESS / 2;
const wallPathWidth = NANJING_RAMPART_THICKNESS + .4;
export const NANJING_WALL_WALK_HEIGHT = NANJING_GATE_HEIGHT;

export const NANJING_WALL_WALKS = Object.freeze([-1, 1].map(side => Object.freeze({
  minX: side * wallCenterX - wallPathWidth / 2,
  maxX: side * wallCenterX + wallPathWidth / 2,
  minZ: NANJING_GATE_NORTH_EDGE,
  maxZ: NANJING_GATE_SOUTH_EDGE,
  height: NANJING_WALL_WALK_HEIGHT,
})));
export const NANJING_WALL_WALK = NANJING_WALL_WALKS[1];

const rampWalkEdge = wallCenterX - wallPathWidth / 2;
const westRampLength = rampWalkEdge + .1 - NANJING_COURTYARD_HALF_WIDTH;
const eastRampLength = rampWalkEdge - NANJING_COURTYARD_HALF_WIDTH;
const centralCourtyard = NANJING_COURTYARDS[1];
export const NANJING_WALL_RAMPS = Object.freeze([
  Object.freeze({
    id: 'west',
    side: -1,
    minX: -rampWalkEdge - .1,
    maxX: -NANJING_COURTYARD_HALF_WIDTH,
    minZ: centralCourtyard.centerZ - 1.95 - 5.5 * NANJING_MAP_SCALE / 2,
    maxZ: centralCourtyard.centerZ - 1.95 + 5.5 * NANJING_MAP_SCALE / 2,
    centerZ: centralCourtyard.centerZ - 1.95,
    width: 5.5 * NANJING_MAP_SCALE,
    height: NANJING_WALL_WALK.height,
    length: westRampLength,
  }),
  Object.freeze({
    id: 'east',
    side: 1,
    minX: NANJING_COURTYARD_HALF_WIDTH,
    maxX: rampWalkEdge,
    minZ: centralCourtyard.centerZ + 1.95 - 4.5 * NANJING_MAP_SCALE / 2,
    maxZ: centralCourtyard.centerZ + 1.95 + 4.5 * NANJING_MAP_SCALE / 2,
    centerZ: centralCourtyard.centerZ + 1.95,
    width: 4.5 * NANJING_MAP_SCALE,
    height: NANJING_WALL_WALK.height,
    length: eastRampLength,
  }),
]);
export const NANJING_WALL_STAIR = NANJING_WALL_RAMPS[1];

const rampCaves = [];
for (const side of [-1, 1]) {
  for (const [courtyardIndex, count] of [3, 1].entries()) {
    const courtyard = NANJING_COURTYARDS[courtyardIndex];
    for (let index = 0; index < count; index++) {
      const offset = count === 1 ? 0 : (index - 1) * courtyard.depth * .28;
      const tier = count === 1 ? 2 : index + 1;
      rampCaves.push(Object.freeze({
        id: `${side < 0 ? 'west' : 'east'}-ramp-cave-${rampCaves.length % 7 + 1}`,
        level: 'ramp',
        tier,
        side,
        x: side * NANJING_COURTYARD_HALF_WIDTH,
        z: courtyard.centerZ + offset,
        y: [.65, 3.4, 6][tier - 1],
        face: side < 0 ? 'east' : 'west',
        width: 2.4 * NANJING_MAP_SCALE,
        height: 2.8 * NANJING_MAP_SCALE,
      }));
    }
  }
}

const mainGateSouthFaceZ = NANJING_GATE_Z + NANJING_GATE_TUNNEL.depth / 2;
const mainGateNorthFaceZ = NANJING_GATE_Z - NANJING_GATE_TUNNEL.depth / 2;
const firstLevelCaves = [-1, 1].flatMap(side => [0, 1, 2].map(index => Object.freeze({
  id: `main-gate-level-1-${side < 0 ? 'west' : 'east'}-${index + 1}`,
  level: 'main-gate-level-1',
  side,
  x: side * (NANJING_GATE_TUNNEL.width / 2 + 2.5 + index * 4.5),
  z: mainGateSouthFaceZ,
  y: .65,
  face: 'south',
  width: 1.1,
  height: 1.1,
})));
const secondLevelCaves = [-18, -12, -6, 0, 6, 12, 18].map((x, index) => Object.freeze({
  id: `main-gate-level-2-${index + 1}`,
  level: 'main-gate-level-2',
  side: 0,
  x,
  z: mainGateNorthFaceZ,
  y: 4.3,
  face: 'north',
  width: 1.1,
  height: 1.1,
}));

export const NANJING_SOLDIER_CAVES = Object.freeze([
  ...firstLevelCaves,
  ...secondLevelCaves,
  ...rampCaves,
]);

export const NANJING_SOLDIER_CAVE = Object.freeze({
  x: NANJING_COURTYARD_HALF_WIDTH + 5 / 2,
  z: NANJING_COURTYARDS[0].centerZ,
  width: 5,
  depth: 5.6,
  roomHeight: 2.8,
  floorHeight: .16,
  name: 'eastern-wall-soldier-cave',
});
