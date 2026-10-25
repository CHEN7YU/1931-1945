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
  function wall(id, axis, fixed, from, to, height, openings = []) {
    let cursor = from;
    let serial = 0;
    const segment = (a, b, bottom, top) => {
      if (b - a < .001 || top - bottom < .001) return;
      add(`${id}-${serial++}`, axis === 'z' ? fixed : (a + b) / 2, (bottom + top) / 2,
        axis === 'z' ? (a + b) / 2 : fixed,
        axis === 'z' ? .24 : b - a, top - bottom, axis === 'z' ? b - a : .24, 'plaster',
        { collision: bottom < 1.8, wall: true });
    };
    for (const opening of openings.toSorted((a, b) => a.center - b.center)) {
      const a = opening.center - opening.width / 2, b = opening.center + opening.width / 2;
      segment(cursor, a, 0, height);
      segment(a, b, 0, opening.sill);
      segment(a, b, opening.top, height);
      cursor = b;
      const door = opening.sill === 0;
      if (door) passages.push({ id: `${id}-door`, x: axis === 'z' ? fixed : opening.center, z: axis === 'z' ? opening.center : fixed, width: opening.width, axis });
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
  function shop(id, x, z, facing, name) {
    const w = 8, d = 14, height = 3.6;
    const building = { id, x, z, w, d, height, facing, name, doorZ: z + 2 };
    buildings.push(building);
    const door = { center: z + 2, width: STREET_BLOCK.doorWidth, sill: 0, top: 2.45 };
    const window = { center: z - 3.4, width: 1.65, sill: .88, top: 2.32 };
    wall(`${id}-east`, 'z', x + w / 2, z - d / 2, z + d / 2, height, [door, window]);
    wall(`${id}-west`, 'z', x - w / 2, z - d / 2, z + d / 2, height, [door, window]);
    for (const side of [-1, 1]) wall(`${id}-${side}`, 'x', z + side * d / 2, x - w / 2, x + w / 2, height,
      [{ center: x, width: 1.8, sill: .88, top: 2.32 }]);
    wall(`${id}-partition`, 'x', z - .9, x - w / 2, x + w / 2, 3.1,
      [{ center: x, width: 1.9, sill: 0, top: 2.45 }]);
    add(`${id}-floor`, x, -.055, z, w - .24, .1, d - .24, 'floor', { collision: false });
    add(`${id}-counter`, x + facing * 1.8, .42, z - 4, 1.5, .84, .8, 'timber', { collision: true });
    add(`${id}-shelf`, x - facing * 3.2, 1.05, z - 4.6, .55, 2.1, 2, 'timber', { collision: true });
    for (const y of [.15, .75, 1.4, 1.98]) add(`${id}-shelf-edge-${y}`, x - facing * 3.2, y, z - 4.6, .66, .065, 2.08, 'charred', { collision: false });
    add(`${id}-bench`, x - facing * 1.5, .23, z + 5.8, 2.4, .46, .55, 'timber', { collision: true });
    for (const side of [-1, 1]) {
      const face = x + side * w / 2;
      for (const dz of [-1.55, 1.55]) covers.push({ id: `${id}-door-${side}-${dz}`, x: face - side * .72, z: z + 2 + dz,
        peek: { x: face - side * .72, z: z + 2 + Math.sign(dz) * .55 }, kind: 'door', buildingId: id });
      covers.push({ id: `${id}-window-${side}`, x: face - side * .7, z: z - 3.4, kind: 'window', buildingId: id });
      for (const dz of [-d / 2 - .8, d / 2 + .8]) covers.push({ id: `${id}-corner-${side}-${dz}`, x: face + side * .7, z: z + dz, kind: 'corner', buildingId: id });
    }
  }
  for (const [index, z] of STREET_BLOCK.rows.entries()) {
    const center = z < -20 ? 8 : 0;
    shop(`west-${index}`, center - 8.5, z, 1, ['同德糧行', '濟民藥舖', '運河茶館', '魯南客棧', '瑞和商號'][index]);
    shop(`east-${index}`, center + 8.5, z, -1, ['永安布莊', '南街食肆', '瑞和商號', '同德糧行', '濟民藥舖'][index]);
  }
  shop('courtyard-shop', -23.5, 62, 1, '後院作坊');
  for (const z of [55, 69]) wall(`courtyard-${z}`, 'x', z, -19.5, -12.5, 1.55,
    [{ center: -16, width: 1.9, sill: 0, top: 1.55 }]);
  add('courtyard-well-base', -17.8, .35, 59, 1.1, .7, 1.1, 'stone', { collision: true });
  const obstacles = pieces.filter(p => p.collision).map(p => ({
    id: p.id, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2, height: p.y + p.h / 2,
  }));
  return { streetWidth: STREET_BLOCK.streetWidth, buildings, pieces, obstacles, covers, passages, courtyard: { minX: -19.5, maxX: -12.5, minZ: 55, maxZ: 69 } };
}
