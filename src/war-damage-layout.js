export const SHELL_CRATERS = Object.freeze([
  { id: 'south-street', x: -1, z: 46.5, radius: 1.65, depth: .5, rim: .15 },
  { id: 'south-objective', x: 1.3, z: 8, radius: 1.55, depth: .44, rim: .13 },
  { id: 'north-street', x: 8.6, z: -35, radius: 1.5, depth: .48, rim: .15 },
  { id: 'north-approach', x: 7, z: -63, radius: 1.7, depth: .55, rim: .16 },
  { id: 'western-yard', x: -27, z: 43, radius: 2.3, depth: .7, rim: .2 },
]);
export const CRATER_EDGE = 1.35;
export const RUINED_SHOPS = Object.freeze(['west-1', 'east-2', 'west-3']);
export const STATIC_WRECKS = Object.freeze([
  { id: 'south-truck', type: 'truck', x: -2.7, z: 31, heading: -.12 },
  { id: 'north-light-tank', type: 'tank', x: 10.6, z: -41, heading: -.08 },
  { id: 'yard-truck', type: 'truck', x: -25, z: 5, heading: .7 },
]);

export function craterHeight(x, z) {
  let height = 0;
  for (const crater of SHELL_CRATERS) {
    const dx = x - crater.x, dz = z - crater.z, edge = crater.radius * CRATER_EDGE;
    if (Math.abs(dx) >= edge || Math.abs(dz) >= edge) continue;
    const r = Math.hypot(dx, dz) / crater.radius;
    if (r >= CRATER_EDGE) continue;
    if (r < 1) height -= crater.depth * (1 - r * r) ** 2;
    if (r > .7) height += crater.rim * Math.sin(Math.PI * (r - .7) / (CRATER_EDGE - .7)) ** 2;
  }
  return height;
}

export function damagedTownPieces(pieces, buildings) {
  for (const building of buildings) building.ruined = RUINED_SHOPS.includes(building.id);
  return pieces.flatMap(piece => {
    const shop = buildings.find(building => building.ruined && piece.wall &&
      [ `${building.id}-west-`, `${building.id}-east-`, `${building.id}--1-` ].some(prefix => piece.id.startsWith(prefix)));
    if (!shop || !piece.wall || Math.abs(piece.z - shop.doorZ) < piece.d / 2 + 1.3) return [piece];
    const alongZ = piece.d > piece.w, length = alongZ ? piece.d : piece.w, divisions = Math.max(1, Math.ceil(length / .65));
    return Array.from({ length: divisions }, (_, index) => {
      const top = 1.35 + Math.sin(index * 3.7 + piece.z + piece.x) ** 2 * 1.3;
      const bottom = piece.y - piece.h / 2, height = Math.min(piece.h, top - bottom);
      if (height <= .02) return [];
      const part = { ...piece, id: `${piece.id}-fracture-${index}`, y: bottom + height / 2, h: height,
        x: alongZ ? piece.x : piece.x + (index + .5) * length / divisions - length / 2,
        z: alongZ ? piece.z + (index + .5) * length / divisions - length / 2 : piece.z,
        w: alongZ ? piece.w : length / divisions, d: alongZ ? length / divisions : piece.d };
      return [part, { ...part, id: `${part.id}-edge`, y: bottom + height - .04, h: .09,
        material: 'brick', wall: false }];
    }).flat();
  });
}
