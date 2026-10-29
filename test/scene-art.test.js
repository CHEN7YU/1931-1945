import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_ART_MATERIALS, weatheredWallPiece } from '../src/scene-art.js';
import { makeTownLayout } from '../src/town-layout.js';

const manifest = JSON.parse(await readFile(new URL('../public/assets/materials/ai-scene/source.json', import.meta.url), 'utf8'));

test('generated maps have original-source, usage, budget and processing evidence, not CC0 claims', () => {
  assert.equal(manifest.license, 'Azure-generated-images');
  assert.equal(manifest.isCC0, false);
  const names = Object.keys(SCENE_ART_MATERIALS);
  assert.equal(manifest.files.length, names.length * 3 + 1);
  assert.equal(manifest.textures.length, names.length + 1);
  assert.deepEqual(manifest.textures.map(texture => texture.id).sort(), [...names, 'wall-grime'].sort());
  assert.ok(manifest.conservativeEstimatedTotalUsd > 0 && manifest.conservativeEstimatedTotalUsd < 50);
  assert.equal(manifest.conservativeEstimatedTotalUsd,
    manifest.textures.reduce((sum, texture) => sum + texture.conservativeEstimatedUsd, 0));
  const original = new Set(['weathered-plaster', 'door-timber', 'burlap', 'crate-timber', 'wall-grime']);
  const bytes = files => files.reduce((sum, file) => sum + file.bytes, 0);
  assert.ok(bytes(manifest.files.filter(file => original.has(file.file.split('/')[0]))) < 4 * 1024 * 1024);
  assert.ok(bytes(manifest.files.filter(file => !original.has(file.file.split('/')[0]))) < 6 * 1024 * 1024);
  assert.match(manifest.processing, /No measured height/);
  for (const texture of manifest.textures) {
    assert.match(texture.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(texture.usage.output_tokens > 0);
    assert.equal(texture.request.n, 1);
    assert.ok(texture.request.prompt.length > 100);
    if (texture.id === 'wall-grime') assert.match(texture.processing, /transparent border check/);
    else for (const error of Object.values(texture.decodedColorEdgeMeanAbsoluteDifference)) assert.ok(error < 8);
  }
  for (const file of manifest.files) {
    const color = /\/(color|atlas)\.webp$/.test(file.file);
    assert.equal(file.width, color ? 1024 : 512);
    assert.equal(file.height, file.width);
    assert.equal(file.colorSpace, color ? 'sRGB' : 'linear');
    if (file.file.endsWith('/atlas.webp')) assert.equal(file.transparentCellBorders, true);
  }
});

test('nature materials keep world scale, restrained normals, and distinct bark sources', () => {
  for (const name of ['bark-elm', 'bark-poplar', 'bark-willow']) {
    assert.equal(SCENE_ART_MATERIALS[name].metersPerTile, .8);
    assert.equal(SCENE_ART_MATERIALS[name].surface, 'timber');
    assert.ok(SCENE_ART_MATERIALS[name].normalStrength <= .35);
  }
  assert.equal(new Set(manifest.textures.filter(texture => texture.id.startsWith('bark-')).map(texture => texture.sourceSha256)).size, 3);
  assert.equal(SCENE_ART_MATERIALS['root-litter'].metersPerTile, 1.6);
  assert.equal(SCENE_ART_MATERIALS['dry-silt'].metersPerTile, 2);
});

test('weathering is confined to five existing exterior frontages, not partitions or all walls', () => {
  const town = makeTownLayout(), original = structuredClone(town);
  const selected = town.pieces.filter(piece => weatheredWallPiece(piece, town.buildings));
  assert.ok(selected.length > 15);
  assert.ok(selected.length < town.pieces.filter(piece => piece.material === 'plaster').length / 2);
  const buildings = new Set();
  for (const piece of selected) {
    const building = town.buildings.find(item => piece.id.startsWith(`${item.id}-`));
    buildings.add(building.id);
    assert.ok(piece.wall);
    assert.equal(piece.material, 'plaster');
    assert.ok(Math.abs(piece.x - building.x - building.facing * building.w / 2) < .01);
    assert.ok(!piece.id.includes('partition'));
  }
  assert.equal(buildings.size, 5);
  assert.deepEqual(town, original, 'material selection must never mutate physical layout or collision');
});
