export function makeOutskirtsLayout() {
  const buildings = [];
  const add = (x, z, near = false) => {
    const index = buildings.length;
    buildings.push({ id: `outskirts-${index}`, x, z, w: 12 + index % 3 * 2,
      d: 12 + index % 2 * 2, height: 3.4 + index % 4 * .65, ruined: index % 5 === 1, near });
  };
  for (const x of [-86, 86]) for (const z of [-63, -42, 0, 22, 44, 65]) add(x, z, true);
  for (const x of [-43, -29, 33, 49]) add(x, -66, true);
  for (const distance of [118, 139, 164]) {
    for (const side of [-1, 1]) {
      for (const z of [-126, -104, -82, -60, -38, -2, 20, 42, 64, 86, 108, 130]) add(side * distance, z);
      for (const x of [-94, -73, -52, -31, -10, 11, 32, 53, 74, 95]) add(x, side * distance);
    }
  }
  return { buildings, hills: [
    { x: -286, z: 278, w: 210, d: 144, height: 30, phase: 0 },
    { x: -215, z: 326, w: 184, d: 128, height: 23, phase: 1.7 },
    { x: -354, z: 220, w: 168, d: 150, height: 27, phase: 3.1 },
  ] };
}

export function outskirtsObstacles(layout) {
  return layout.buildings.map(building => ({
    minX: building.x - building.w / 2 - .07, maxX: building.x + building.w / 2 + .07,
    minZ: building.z - building.d / 2 - .07, maxZ: building.z + building.d / 2 + .07,
    height: building.height + (building.near && building.ruined ? .5 : 3),
  }));
}
