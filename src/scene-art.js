export const SCENE_ART_MATERIALS = Object.freeze({
  'weathered-plaster': Object.freeze({ surface: 'plaster', metersPerTile: 2.4, normalStrength: .32 }),
  'door-timber': Object.freeze({ surface: 'timber', metersPerTile: 1.9, normalStrength: .45 }),
  burlap: Object.freeze({ surface: 'burlap', metersPerTile: .35, normalStrength: .55 }),
  'crate-timber': Object.freeze({ surface: 'timber', metersPerTile: .8, normalStrength: .38 }),
  'bark-elm': Object.freeze({ surface: 'timber', metersPerTile: .8, normalStrength: .35 }),
  'bark-poplar': Object.freeze({ surface: 'timber', metersPerTile: .8, normalStrength: .2 }),
  'bark-willow': Object.freeze({ surface: 'timber', metersPerTile: .8, normalStrength: .35 }),
  'root-litter': Object.freeze({ surface: 'earth', metersPerTile: 1.6, normalStrength: .18 }),
  'dry-silt': Object.freeze({ surface: 'earth', metersPerTile: 2, normalStrength: .28 }),
});

export const SCENE_GRIME_ATLAS = '/assets/materials/ai-scene/wall-grime/atlas.webp';

const weatheredFronts = new Set(['west-0', 'east-1', 'west-3', 'courtyard-shop', 'canal-south-workshop']);

export function weatheredWallPiece(piece, buildings) {
  if (!piece.wall || piece.material !== 'plaster') return false;
  return buildings.some(building => weatheredFronts.has(building.id) &&
    piece.id.startsWith(`${building.id}-`) &&
    Math.abs(piece.x - (building.x + building.facing * building.w / 2)) < .01);
}
