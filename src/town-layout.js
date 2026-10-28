import { damagedTownPieces } from './war-damage-layout.js';

export const STREET_BLOCK = Object.freeze({
  streetWidth: 8.76,
  doorWidth: 1.9,
  wallThickness: .24,
  rows: [62, 43, 10, -38, -68],
});

export function makeTownLayout() {
  const buildings = [], pieces = [], covers = [], passages = [];
  const add = (id, x, y, z, w, h, d, material, extra = {}) => {
    const piece = { id, x, y, z, w, h, d, material, ...extra };
    pieces.push(piece);
    return piece;
  };
  function wall(id, axis, fixed, from, to, height, openings = [], material = 'plaster') {
    let cursor = from;
    let serial = 0;
    const segment = (a, b, bottom, top) => {
      if (b - a < .001 || top - bottom < .001) return;
      add(`${id}-${serial++}`, axis === 'z' ? fixed : (a + b) / 2, (bottom + top) / 2,
        axis === 'z' ? (a + b) / 2 : fixed,
        axis === 'z' ? .24 : b - a, top - bottom, axis === 'z' ? b - a : .24, material,
        { collision: bottom < 1.8, wall: true });
    };
    for (const opening of openings.toSorted((a, b) => a.center - b.center)) {
      const a = opening.center - opening.width / 2, b = opening.center + opening.width / 2;
      segment(cursor, a, 0, height);
      segment(a, b, 0, opening.sill);
      segment(a, b, opening.top, height);
      cursor = b;
      const door = opening.sill === 0;
      if (door) passages.push({ id: `${id}-door`, x: axis === 'z' ? fixed : opening.center, z: axis === 'z' ? opening.center : fixed,
        width: opening.width, height: opening.top, openAngle: opening.openAngle, axis });
      for (const offset of [-opening.width / 2 - .045, opening.width / 2 + .045]) {
        add(`${id}-frame-${serial++}`, axis === 'z' ? fixed : opening.center + offset,
          (opening.sill + opening.top) / 2, axis === 'z' ? opening.center + offset : fixed,
          axis === 'z' ? .3 : .09, opening.top - opening.sill, axis === 'z' ? .09 : .3, 'timber', { collision: false });
      }
      if (opening.top < height) add(`${id}-lintel-${serial++}`, axis === 'z' ? fixed : opening.center, opening.top + .045,
        axis === 'z' ? opening.center : fixed, axis === 'z' ? .32 : opening.width + .18,
        .09, axis === 'z' ? opening.width + .18 : .32, 'timber', { collision: false });
      if (!door) {
        for (const offset of [-.35, .35]) add(`${id}-lattice-${serial++}`,
          axis === 'z' ? fixed : opening.center + offset, (opening.sill + opening.top) / 2,
          axis === 'z' ? opening.center + offset : fixed, axis === 'z' ? .065 : .035,
          opening.top - opening.sill, axis === 'z' ? .035 : .065, 'timber', { collision: false });
        add(`${id}-sill-${serial++}`, axis === 'z' ? fixed : opening.center, opening.sill - .05,
          axis === 'z' ? opening.center : fixed, axis === 'z' ? .46 : opening.width + .22, .1,
          axis === 'z' ? opening.width + .22 : .46, 'stone', { collision: false });
      }
    }
    segment(cursor, to, 0, height);
  }
  function shop(id, x, z, facing, name, { kind = 'shop', height = 3.6, w = 8, d = 14, riverSide = 0 } = {}) {
    const building = { id, x, z, w, d, height, facing, name, kind, riverSide, doorZ: z + 2 };
    buildings.push(building);
    const door = { center: z + 2, width: STREET_BLOCK.doorWidth, sill: 0, top: 2.45 };
    const window = { center: z - 3.4, width: 1.65, sill: .88, top: 2.32 };
    wall(`${id}-east`, 'z', x + w / 2, z - d / 2, z + d / 2, height, [door, window]);
    wall(`${id}-west`, 'z', x - w / 2, z - d / 2, z + d / 2, height, [door, window]);
    for (const side of [-1, 1]) wall(`${id}-${side}`, 'x', z + side * d / 2, x - w / 2, x + w / 2, height,
      side === riverSide
        ? [{ center: x, width: kind === 'warehouse' ? 2.6 : 1.9, sill: 0, top: 2.45, openAngle: side * Math.PI / 2 }]
        : [{ center: x, width: 1.8, sill: .88, top: 2.32 }]);
    wall(`${id}-partition`, 'x', z - .9, x - w / 2, x + w / 2, 3.1,
      [{ center: x, width: 1.9, sill: 0, top: 2.45 }]);
    add(`${id}-floor`, x, -.055, z, w - .24, .1, d - .24, 'floor', { collision: false });
    if (kind === 'home') {
      add(`${id}-bed`, x - facing * (w / 2 - 1.5), .24, z - d / 2 + 2.6, 1.45, .48, 2.4, 'timber', { collision: true });
      add(`${id}-table`, x + facing * 2.2, .36, z + Math.max(4, d / 2 - 2.2), 1.3, .72, 1.1, 'timber', { collision: true });
    } else if (kind === 'warehouse') {
      const cargoWidth = Math.min(1.4, (w - 4) / 2);
      for (const side of [-1, 1]) {
        const cargoX = x + side * (w / 2 - cargoWidth / 2 - .3);
        add(`${id}-cargo-${side}`, cargoX, .55, z - d / 2 + 2, cargoWidth, 1.1, 1.5, 'timber', { collision: true });
        add(`${id}-cargo-band-${side}`, cargoX, .55, z - d / 2 + 2, cargoWidth + .08, .12, 1.58, 'charred', { collision: false });
      }
    } else {
      add(`${id}-counter`, x + facing * 1.8, .42, z - 4, 1.5, .84, .8, 'timber', { collision: true });
      add(`${id}-shelf`, x - facing * 3.2, 1.05, z - 4.6, .55, 2.1, 2, 'timber', { collision: true });
      for (const y of [.15, .75, 1.4, 1.98]) add(`${id}-shelf-edge-${y}`, x - facing * 3.2, y, z - 4.6, .66, .065, 2.08, 'charred', { collision: false });
    }
    add(`${id}-bench`, x - facing * (riverSide === 1 ? w / 2 - 1.6 : 1.5), .23, z + d / 2 - 1.2, 2.4, .46, .55, 'timber', { collision: true });
    for (const side of [-1, 1]) {
      const face = x + side * w / 2;
      for (const dz of [-1.55, 1.55]) covers.push({ id: `${id}-door-${side}-${dz}`, x: face - side * .64, z: z + 2 + dz,
        peek: { x: face - side * .64, z: z + 2 + Math.sign(dz) * .72 }, kind: 'door', buildingId: id });
      covers.push({ id: `${id}-window-${side}`, x: face - side * .64, z: z - 3.4, kind: 'window', buildingId: id });
      for (const dz of [-d / 2 - .55, d / 2 + .55]) covers.push({ id: `${id}-corner-${side}-${dz}`, x: face + side * .64, z: z + dz, kind: 'corner', buildingId: id });
    }
    if (riverSide) for (const side of [-1, 1]) {
      covers.push({ id: `${id}-river-door-${side}`, x: x + side * 1.8, z: z + riverSide * (d / 2 - .64),
        peek: { x: x + side * .72, z: z + riverSide * (d / 2 - .64) }, kind: 'door', buildingId: id });
    }
  }
  for (const [index, z] of STREET_BLOCK.rows.entries()) {
    const center = z < -20 ? 8 : 0;
    shop(`west-${index}`, center - 8.5, z, 1, ['同德糧行', '濟民藥舖', '運河茶館', '魯南客棧', '瑞和商號'][index]);
    shop(`east-${index}`, center + 8.5, z, -1, ['永安布莊', '南街食肆', '瑞和商號', '同德糧行', '濟民藥舖'][index]);
  }
  shop('courtyard-shop', -23.5, 62, 1, '後院作坊');
  for (const z of [55, 69]) wall(`courtyard-${z}`, 'x', z, -19.5, -12.5, 1.55,
    [{ center: -16, width: 1.9, sill: 0, top: 1.55, openAngle: z === 55 ? -Math.PI / 2 : Math.PI / 2 }]);
  add('courtyard-well-base', -17.8, .35, 59, 1.1, .7, 1.1, 'stone', { collision: true });
  for (const [index, z] of [62, 43].entries()) {
    shop(`west-home-${index}`, -35.5, z, 1, '西巷民居', { kind: 'home', height: 3.2 + index * .15 });
    shop(`east-home-${index}`, 25.5, z, -1, '東院民居', { kind: 'home', height: 3.35 - index * .15 });
    shop(`east-lane-home-${index}`, 38, z, -1, '背巷民居', { kind: 'home', height: 3.1 + index * .3 });
  }
  for (const z of [55, 69]) {
    wall(`west-lane-gate-${z}`, 'x', z, -31.5, -27.5, 1.9,
      [{ center: -29.5, width: 2.4, sill: 0, top: 1.9, openAngle: z === 55 ? -Math.PI / 2 : Math.PI / 2 }]);
  }
  for (const z of [36, 50]) {
    wall(`west-yard-gate-${z}`, 'x', z, -31.5, -12.5, 1.9,
      [{ center: z === 50 ? -18 : -22, width: 2.4, sill: 0, top: 1.9, openAngle: z === 36 ? -Math.PI / 2 : Math.PI / 2 }]);
  }
  for (const z of [36, 50, 55, 69]) {
    wall(`east-yard-gate-${z}`, 'x', z, 12.5, 21.5, 1.9,
      [{ center: 17, width: 2.4, sill: 0, top: 1.9, openAngle: z === 36 || z === 55 ? -Math.PI / 2 : Math.PI / 2 }]);
  }
  for (const [id, x, z, w, d, height, kind, riverSide, name] of [
    ['canal-south-granary', -36, 0, 16, 12, 4, 'warehouse', -1, '運河糧倉'],
    ['canal-south-workshop', -19, -1, 6, 10, 3.3, 'warehouse', -1, '碼頭作坊'],
    ['canal-south-home', 26, 0, 10, 12, 3.2, 'home', -1, '沿河民居'],
    ['canal-south-depot', 43, 0, 14, 12, 4.2, 'warehouse', -1, '河埠貨棧'],
    ['canal-north-home', -20, -35, 10, 12, 3.2, 'home', 1, '河街民居'],
    ['canal-north-granary', -39, -35, 16, 12, 3.8, 'warehouse', 1, '沿河糧棧'],
    ['canal-north-depot', 32, -35, 12, 12, 4, 'warehouse', 1, '運河貨棧'],
    ['canal-north-east-home', 47, -34, 10, 10, 3.25, 'home', 1, '東岸民居'],
  ]) shop(id, x, z, x < 8 ? 1 : -1, name, { w, d, height, kind, riverSide });

  // Broken perimeters describe former buildings and loading yards, not anonymous empty ground.
  for (const [index, [axis, fixed, from, to, height]] of [
    ['z', -44, 12, 16, 2.1], ['z', -44, 19, 24, 1.4],
    ['z', -28, 12, 17, 1.1], ['z', -28, 20, 24, 1.8],
    ['x', 12, -44, -38, 1.9], ['x', 12, -35, -28, .9],
    ['x', 24, -44, -39, 1.1], ['x', 24, -35, -28, 1.7],
    ['z', 20, 10, 14, 1.8], ['z', 20, 17, 23, .9],
    ['z', 34, 10, 16, 1.1], ['z', 34, 19, 23, 1.9],
    ['x', 10, 20, 25, 1.2], ['x', 10, 28, 34, 1.7],
    ['x', 23, 20, 24, 1.7], ['x', 23, 28, 34, 1],
    ['z', -12, -40, -37, 2], ['z', -12, -33, -29, 1],
    ['z', -7, -40, -38, 1.3], ['z', -7, -34.5, -29, 1.8],
    ['x', -29, -12, -11, 1.4], ['x', -29, -8, -7, 1.8],
    ['x', -40, -12, -10.8, 1.2], ['x', -40, -8.2, -7, 2],
  ].entries()) {
    wall(`canal-ruin-${index}`, axis, fixed, from, to, height, [], 'brick');
    add(`canal-ruin-${index}-cap`, axis === 'z' ? fixed : (from + to) / 2, height,
      axis === 'z' ? (from + to) / 2 : fixed,
      axis === 'z' ? .3 : to - from, .12, axis === 'z' ? to - from : .3, 'brick', { collision: false });
    add(`canal-ruin-${index}-debris`, axis === 'z' ? fixed : from + .6, .12,
      axis === 'z' ? from + .6 : fixed, .72, .24, .65, index % 2 ? 'charred' : 'brick', { collision: false });
  }
  for (const [index, x, z, length] of [[0, -43.5, 14, 3], [1, 33.5, 20, 3], [2, -11.5, -38.5, 2]]) {
    add(`canal-charred-post-${index}`, x, 1.2, z, .18, 2.4, .18, 'charred', { collision: true });
    add(`canal-charred-beam-${index}`, x, .18, z, .24, .18, length, 'charred', { collision: false });
  }
  for (const piece of pieces.filter(piece => piece.wall && piece.y - piece.h / 2 < 1.1 && piece.y + piece.h / 2 > 1.6)) {
    const alongZ = piece.w < piece.d, length = alongZ ? piece.d : piece.w;
    for (const side of [-1, 1]) for (const fraction of length > 3 ? [.2, .5, .8] : [.5]) {
      const x = piece.x + (alongZ ? side * (piece.w / 2 + .52) : (fraction - .5) * length);
      const z = piece.z + (alongZ ? (fraction - .5) * length : side * (piece.d / 2 + .52));
      covers.push({ id: `support-${piece.id}-${side}-${fraction}`, x, z, peek: { x, z }, kind: 'wall-support', wallId: piece.id });
    }
  }
  const damagedPieces = damagedTownPieces(pieces, buildings);
  const obstacles = damagedPieces.filter(p => p.collision).map(p => ({
    id: p.id, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2, height: p.y + p.h / 2,
  }));
  return { streetWidth: STREET_BLOCK.streetWidth, buildings, pieces: damagedPieces, obstacles, covers, passages, courtyard: { minX: -19.5, maxX: -12.5, minZ: 55, maxZ: 69 } };
}
