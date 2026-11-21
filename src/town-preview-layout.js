import { makeTownLayout } from './town-layout.js';
import { TOWN_STOREYS } from './multistory.js';
import { BRIDGE } from './ground.js';

export const PREVIEW_BOUNDS = Object.freeze({ minX: -72, maxX: 72, minZ: -70, maxZ: 68 });
export const PREVIEW_BRIDGE = Object.freeze({ ...BRIDGE, height: .95 });
export const PREVIEW_OBJECTIVES = Object.freeze([
  Object.freeze({ id: 'A', name: '西侧粮栈高楼 · 补给点', x: -36, z: 12, radius: 11,
    captureArea: Object.freeze({ minX: -43.4, maxX: -28.6, minZ: 6.6, maxZ: 17.4, minY: -.05, maxY: 12.6 }),
    view: { x: -49, z: -6, yaw: -2.5, pitch: .2 } }),
  Object.freeze({ id: 'B', name: '运河石桥', x: 8, z: -16, radius: 10,
    view: { x: 8, z: -5, yaw: 0 } }),
  Object.freeze({ id: 'C', name: '东侧城门', x: 52, z: 3, radius: 10,
    view: { x: 44, z: 3, yaw: -Math.PI / 2, pitch: .1 } }),
]);
export const PREVIEW_BASES = Object.freeze([
  Object.freeze({ id: 'china', name: '中方拟定前沿集结地', team: 'friendly', x: -20, z: 40 }),
  Object.freeze({ id: 'japan', name: '日方拟定前沿集结地', team: 'enemy', x: -28, z: -46 }),
]);

export function makeTownPreviewLayout() {
  const town = makeTownLayout({ storeys: { ...TOWN_STOREYS, 'canal-south-granary': 4, 'canal-south-depot': 1 } });
  const towerId = 'canal-south-granary';
  const tower = town.buildings.find(building => building.id === towerId);
  tower.z += 12; tower.doorZ += 12; tower.name = '西城糧栈';
  for (const flight of tower.stairs) {
    // The flight endpoints are shared with its path.
    for (const point of new Set([flight.lower, flight.upper, ...flight.path])) point.z += 12;
  }
  const oldYard = id => /^canal-ruin-[0-7](?:-|$)/.test(id) || id.startsWith('canal-charred-post-0') ||
    id.startsWith('canal-charred-beam-0') || id.startsWith('canal-south-depot-');
  town.buildings = town.buildings.filter(building => building.id !== 'canal-south-depot');
  town.pieces = town.pieces.filter(piece => !oldYard(piece.id));
  for (const piece of town.pieces) if (piece.id.startsWith(`${towerId}-`)) piece.z += 12;
  town.passages = town.passages.filter(passage => !oldYard(passage.id));
  for (const passage of town.passages) if (passage.id.startsWith(`${towerId}-`)) passage.z += 12;
  const sealedPartition = `${towerId}-partition`;
  town.pieces = town.pieces.filter(piece => !piece.id.startsWith(`${sealedPartition}-`));
  town.passages = town.passages.filter(passage => passage.id !== `${sealedPartition}-door`);
  town.pieces.push({ id: `${sealedPartition}-sealed`, x: (tower.x - tower.w / 2 + tower.x + .95) / 2,
    y: 1.55, z: tower.z - .9, w: tower.w / 2 + .95, h: 3.1, d: .24,
    material: 'plaster', collision: true, wall: true });
  town.covers = town.covers.filter(cover => !oldYard(cover.wallId ?? cover.id) &&
    !cover.wallId?.startsWith(`${sealedPartition}-`));
  for (const cover of town.covers) if (cover.buildingId === towerId || cover.wallId?.startsWith(`${towerId}-`)) {
    cover.z += 12;
    if (cover.peek) cover.peek.z += 12;
  }

  const walls = [];
  const add = (id, x, bottom, z, w, h, d, material = 'brick') => {
    const piece = { id: `fort-${id}`, x, y: bottom + h / 2, z, w, h, d, material, collision: true };
    walls.push(piece); town.pieces.push(piece);
  };
  const wallRun = (axis, fixed, start, end, gaps, name) => {
    for (let cursor = start, i = 0; cursor < end; i++) {
      const length = Math.min(3, end - cursor), center = cursor + length / 2;
      if (!gaps.some(([a, b]) => cursor < b && cursor + length > a)) {
        const height = 3.8 + [0, .15, -.3, .05, -.15][i % 5];
        add(`${name}-${i}`, axis === 'x' ? center : fixed, 0,
          axis === 'x' ? fixed : center, axis === 'x' ? length : 1.6, height,
          axis === 'x' ? 1.6 : length);
        if (i % 5 !== 2) add(`${name}-merlon-${i}`, axis === 'x' ? center : fixed, height,
          axis === 'x' ? fixed : center, axis === 'x' ? 1.1 : 1.8, .6, axis === 'x' ? 1.8 : 1.1);
      }
      cursor += length;
    }
  };
  // Only the north and east sides enter this cropped battlefield.
  wallRun('x', -54, -112, 56, [[1, 15], [-53, -43]], 'north');
  wallRun('z', 56, -54, 112, [[-28, -5], [-2, 8], [28, 36]], 'east');
  for (const side of [-1, 1]) {
    const z = 3 + side * 6;
    add(`gate-pier-${side}`, 56, 0, z, 3.8, 6.4, 4.8, 'stone');
    add(`gate-tower-${side}`, 56, 6.4, z, 4.2, side < 0 ? 1.9 : 1.2, 5.1);
    for (const offset of [-1.4, 0, 1.4]) {
      if (side > 0 && offset === 0) continue;
      add(`gate-crown-${side}-${offset}`, 56 + offset, side < 0 ? 8.3 : 7.6, z, .7, .55, 5.1);
    }
  }
  // Box slices leave a real vaulted opening instead of an opaque decorative doorway.
  for (let i = 0; i < 96; i++) {
    const along = -3.6 + (i + .5) * .075;
    const bottom = 2.6 + Math.sqrt(Math.max(0, 3.6 ** 2 - along ** 2)) * .72;
    add(`gate-arch-${i}`, 56, bottom, 3 + along, 3.8, 6.4 - bottom, .075, 'stone');
  }
  for (let i = 0; i < 22; i++) {
    const z = 10 + (i % 6) * .65, x = 53.8 + Math.floor(i / 6) * .7;
    add(`gate-rubble-${i}`, x, 0, z, .4 + i % 3 * .13, .2 + i % 4 * .09, .45);
  }
  town.obstacles = town.pieces.filter(piece => piece.collision || piece.wall).map(piece => ({
    id: piece.id, minX: piece.x - piece.w / 2, maxX: piece.x + piece.w / 2,
    minZ: piece.z - piece.d / 2, maxZ: piece.z + piece.d / 2,
    minY: piece.y - piece.h / 2, height: piece.y + piece.h / 2,
    stair: Boolean(piece.stair), walkable: Boolean(piece.walkable),
  })).concat(town.streetFixtures.map(fixture => ({ id: fixture.id,
    minX: fixture.x - .3, maxX: fixture.x + .3, minZ: fixture.z - .3, maxZ: fixture.z + .3,
    minY: 0, height: 5.2 })));
  return { ...town, fortifications: { sides: 2, walls, gate: { x: 56, z: 3, width: 7.2 } } };
}
