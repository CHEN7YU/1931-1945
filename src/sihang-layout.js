// Three playable storeys are an adaptation, not a reconstruction of every historical floor.
export const SIHANG_WAREHOUSE = Object.freeze({
  x: -4, z: -25, width: 64, depth: 34,
  minX: -36, maxX: 28, minZ: -42, maxZ: -8,
  floorHeight: 4.2, floors: 3, roofY: 12.6,
  bounds: Object.freeze({ minX: -36, maxX: 28, minZ: -42, maxZ: -8 }),
});
export const SIHANG_RIVER = Object.freeze({ northZ: 8, southZ: 32, waterY: -1 });
export const SIHANG_BRIDGE = Object.freeze({ x: 48, width: 8, northZ: 8, southZ: 32 });
export const SIHANG_CAPTURE_AREA = Object.freeze({
  minX: -34, maxX: 26, minZ: -40, maxZ: -10, maxY: 2.4,
});
export const SIHANG_DEMOLITION_POINT = Object.freeze({ x: 0, y: 0, z: -43.5 });
export const SIHANG_EVACUATION = Object.freeze({ x: 48, z: 48, radius: 12, southZ: 36 });
export const SIHANG_DEFENSE_POSTS = Object.freeze([
  { x: -24, y: 4.2, z: -40 }, { x: 16, y: 4.2, z: -40 },
  { x: -24, y: 4.2, z: -10 }, { x: 16, y: 4.2, z: -10 },
].map(Object.freeze));
export const SIHANG_SQUAD_ORIGINS = Object.freeze([
  { x: -18, y: 4.2, z: -31 }, { x: 18, y: 4.2, z: -31 },
  { x: -18, y: 4.2, z: -18 }, { x: 18, y: 4.2, z: -18 },
].map(Object.freeze));
export const SIHANG_ENEMY_APPROACHES = Object.freeze([
  { x: -78, y: 0, z: -88 }, { x: 0, y: 0, z: -94 }, { x: 78, y: 0, z: -88 },
].map(Object.freeze));
export const SIHANG_TANK_ORIGINS = Object.freeze([
  { x: -70, y: 0, z: -90 }, { x: 70, y: 0, z: -90 },
].map(Object.freeze));
export const SIHANG_STAIRWELLS = Object.freeze([-32, 24].map(x => Object.freeze({
  x, minX: x - 2.5, maxX: x + 2.5, minZ: -36, maxZ: -16,
  bottomZ: -37, topZ: -15, width: 5,
})));
// Each flight shares the same slope, with a full-height return corridor beside its cutout.
export const SIHANG_STAIR_ROUTES = Object.freeze(SIHANG_STAIRWELLS.flatMap(stair =>
  [0, 1, 2].map(floor => Object.freeze({
    floor, x: stair.x,
    bottom: Object.freeze({ x: stair.x, y: floor * 4.2, z: stair.bottomZ }),
    top: Object.freeze({ x: stair.x, y: (floor + 1) * 4.2, z: stair.topZ }),
  }))));
