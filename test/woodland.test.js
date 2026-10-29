import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeSurfaceGeometry } from '../src/surface-uv.js';
import { WOODLAND_SPECIES, woodlandLayout, woodlandTreeGeometry, woodlandGroundContactGeometry } from '../src/woodland.js';
import { groundHeight } from '../src/ground.js';
import { makeOutskirtsLayout } from '../src/outskirts-layout.js';
import { stagingSpawns } from '../src/battle-roster.js';
import { makeBaseSpawns } from '../src/spawns.js';
import { japaneseArmorSpawns } from '../src/chi-ha.js';

test('tree placement and varied silhouettes are deterministic and clear of houses and riverbanks', () => {
  const buildings = makeOutskirtsLayout().buildings, trees = woodlandLayout(buildings);
  assert.deepEqual(woodlandLayout(buildings), trees);
  assert.ok(trees.length >= 24);
  assert.ok(Math.max(...trees.map(tree => tree.height)) - Math.min(...trees.map(tree => tree.height)) > 3);
  assert.ok(Math.max(...trees.map(tree => tree.height)) / Math.min(...trees.map(tree => tree.height)) > 3);
  for (const species of Object.keys(WOODLAND_SPECIES)) {
    assert.ok(trees.filter(tree => tree.species === species && !tree.dead).length >= 3);
  }
  assert.ok(trees.some(tree => tree.age === 'sapling'));
  assert.ok(trees.some(tree => tree.age === 'old'));
  assert.ok(trees.some(tree => tree.dead));
  assert.ok(trees.some(tree => tree.sparse));
  for (const tree of trees) {
    assert.ok(Math.abs(tree.z + 16) >= 10);
    assert.ok(!buildings.some(house => Math.abs(tree.x - house.x) < house.w / 2 + 5 &&
      Math.abs(tree.z - house.z) < house.d / 2 + 5));
    for (const spawn of [...makeBaseSpawns(), ...stagingSpawns(), ...japaneseArmorSpawns()]) {
      assert.ok(Math.hypot(tree.x - spawn.x, tree.z - spawn.z) >= 6, 'solid trunks must not block initial or reinforcement deployment');
    }
  }
});

test('trees have tapered outward-facing curved branches and individually folded, shaded leaves', () => {
  const tree = { seed: 1938, species: 'elm', age: 'adult', height: 8, radius: .28, heading: .7, sparse: false };
  const first = woodlandTreeGeometry(tree), second = woodlandTreeGeometry(tree);
  for (const name of ['bark', 'foliage']) {
    const geometry = first[name], positions = geometry.attributes.position;
    assert.deepEqual(positions.array, second[name].attributes.position.array);
    assert.ok(positions.array.every(Number.isFinite));
    assert.ok(geometry.attributes.normal.array.every(Number.isFinite));
    assert.ok(geometry.boundingBox.max.y > tree.height * .6);
    assert.ok(geometry.boundingBox.max.x - geometry.boundingBox.min.x > 3);
  }
  const barkPositions = first.bark.attributes.position, barkNormals = first.bark.attributes.normal;
  assert.ok(barkPositions.getX(0) * barkNormals.getX(0) + barkPositions.getZ(0) * barkNormals.getZ(0) > 0,
    'trunk faces outward rather than disappearing under back-face culling');
  const leaves = first.foliage.attributes.position, colors = first.foliage.attributes.color;
  assert.ok(leaves.count > 90000 && leaves.count < 150000, 'bounded leaf budget per full spreading tree');
  assert.equal(leaves.count, colors.count);
  assert.ok(new Set(Array.from(colors.array).map(value => value.toFixed(3))).size > 50);
  for (let i = 0; i < leaves.count; i += 18) {
    assert.ok(Math.hypot(leaves.getX(i + 1) - leaves.getX(i + 8), leaves.getY(i + 1) - leaves.getY(i + 8),
      leaves.getZ(i + 1) - leaves.getZ(i + 8)) < .3, 'individual leaves stay within broadleaf scale, not billboard cards');
  }
  const sparse = woodlandTreeGeometry({ ...tree, sparse: true });
  assert.ok(sparse.foliage.attributes.position.count <= leaves.count * .41);
  for (const geometry of [...Object.values(first), ...Object.values(second), ...Object.values(sparse)]) geometry.dispose();
});

test('species change branch architecture, crown proportions and leaf shape rather than just scale', () => {
  const tree = { seed: 1938, age: 'adult', height: 8, radius: .28, heading: .7, sparse: false };
  const shapes = Object.fromEntries(Object.keys(WOODLAND_SPECIES).map(species =>
    [species, woodlandTreeGeometry({ ...tree, species })]));
  const width = geometry => geometry.boundingBox.max.x - geometry.boundingBox.min.x;
  assert.ok(width(shapes.poplar.foliage) < width(shapes.elm.foliage) * .6, 'poplars have a narrow upright crown');
  assert.ok(shapes.willow.foliage.boundingBox.min.y < shapes.elm.foliage.boundingBox.min.y - 1, 'willow leaves hang below the spreading branches');
  assert.ok(shapes.poplar.bark.boundingBox.max.y > shapes.elm.bark.boundingBox.max.y, 'poplars retain a tall central leader');
  for (const shape of Object.values(shapes)) {
    assert.ok(shape.foliage.attributes.position.count < 150000);
    assert.ok(shape.bark.attributes.color.count > 0);
    shape.bark.dispose(); shape.foliage.dispose();
  }
  const dead = woodlandTreeGeometry({ ...tree, species: 'elm', dead: true });
  assert.equal(dead.foliage, null, 'dead trees do not keep green canopy clusters');
  assert.ok(dead.bark.attributes.position.array.every(Number.isFinite));
  dead.bark.dispose();
  assert.throws(() => woodlandTreeGeometry({ ...tree, species: 'unknown' }), /Unknown woodland species/);
});

test('root collars are buried and soil-tinted; contact dressing follows the actual terrain', () => {
  for (const species of Object.keys(WOODLAND_SPECIES)) {
    const tree = { seed: 1938, species, age: 'adult', height: 8, radius: .28,
      x: -90, z: 42, heading: .7, sparse: false };
    const { bark, foliage } = woodlandTreeGeometry(tree), positions = bark.attributes.position, colors = bark.attributes.color;
    assert.ok(bark.boundingBox.min.y < -.07, 'root tips extend beneath the visible ground, not along its top');
    let lowWarmth = 0, lowCount = 0, highWarmth = 0, highCount = 0;
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) < .5 && Math.hypot(positions.getX(i), positions.getZ(i)) > tree.radius * 1.1) {
        assert.ok(positions.getY(i) < tree.radius * .7, 'adult roots stay low instead of forming tall support legs');
      }
      const warmth = colors.getX(i) / colors.getZ(i);
      if (positions.getY(i) < .1) { lowWarmth += warmth; lowCount++; }
      if (positions.getY(i) > 1) { highWarmth += warmth; highCount++; }
    }
    assert.ok(lowWarmth / lowCount > highWarmth / highCount, 'soil contact warms the root color without recoloring all bark');
    const contact = woodlandGroundContactGeometry(tree), ground = contact.attributes.position;
    assert.equal(contact.attributes.uv1.count, ground.count, 'local feather mask has independent UVs from the meter-scaled ground material');
    assert.deepEqual(contact.attributes.uv1.array, contact.attributes.uv.array);
    const material = new THREE.MeshStandardMaterial();
    material.userData.metersPerTile = 1.6;
    const object = new THREE.Mesh(contact, material);
    object.updateMatrixWorld(true);
    const baked = bakeSurfaceGeometry(object);
    assert.deepEqual(baked.attributes.uv1.array, contact.attributes.uv1.array);
    for (let i = 0; i < ground.count; i++) {
      assert.ok(Math.abs(baked.attributes.uv.getX(i) - ground.getX(i) / 1.6) < 1e-5);
      assert.ok(Math.abs(baked.attributes.uv.getY(i) - ground.getZ(i) / 1.6) < 1e-5);
    }
    for (let i = 0; i < ground.count; i++) {
      assert.ok(Math.abs(ground.getY(i) - (groundHeight(ground.getX(i), ground.getZ(i)) - .024)) < 1e-6);
    }
    bark.dispose(); foliage.dispose(); contact.dispose(); baked.dispose(); material.dispose();
  }
});
