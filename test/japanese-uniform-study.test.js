import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createUniformStudy as createStudy, disposeUniformStudy } from '../uniform-study/model.js';
import { bakeStudySkin, bakeStudyGarment } from '../uniform-study/skin.js';
import { createStudySurface } from '../uniform-study/surfaces.js';

const research = JSON.parse(readFileSync(new URL('../uniform-study/research.json', import.meta.url), 'utf8'));
let sourceModel;
function sourceFixture() {
  if (!sourceModel) {
    const manager = new THREE.LoadingManager();
    manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
    const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
    sourceModel = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
  return sourceModel;
}
const createUniformStudy = () => createStudy({ upperBody: bakeStudyGarment(sourceFixture()) });

function sectionBounds(mesh, height, triangleLimit = Infinity) {
  const geometry = mesh.geometry, positions = geometry.getAttribute('position');
  const count = Math.min(geometry.index?.count ?? positions.count, triangleLimit * 3);
  const bounds = new THREE.Box3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let at = 0; at < count; at += 3) for (let edge = 0; edge < 3; edge++) {
    const ia = at + edge, ib = at + (edge + 1) % 3;
    a.fromBufferAttribute(positions, geometry.index ? geometry.index.getX(ia) : ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions, geometry.index ? geometry.index.getX(ib) : ib).applyMatrix4(mesh.matrixWorld);
    if ((height - a.y) * (height - b.y) > 0) continue;
    if (Math.abs(b.y - a.y) < 1e-9) {
      bounds.expandByPoint(a); bounds.expandByPoint(b);
    } else bounds.expandByPoint(a.lerp(b, (height - a.y) / (b.y - a.y)));
  }
  assert.equal(bounds.isEmpty(), false, `${mesh.name} has no section at ${height}`);
  return bounds;
}

test('independent adapted uniform study is static and explicitly not historically accepted', () => {
  const { root, groups } = createUniformStudy();
  assert.equal(root.userData.studyOnly, true);
  assert.equal(root.userData.rigged, false);
  assert.equal(root.userData.historicalAcceptance, false);
  assert.deepEqual(Object.keys(groups), ['uniform', 'head', 'helmet', 'equipment']);
  let triangles = 0, meshes = 0;
  root.traverse(node => {
    assert.equal(Boolean(node.isBone || node.isSkinnedMesh), false);
    if (!node.isMesh) return;
    meshes++;
    const positions = node.geometry.getAttribute('position');
    for (const value of positions.array) assert.ok(Number.isFinite(value), node.name);
    assert.ok(positions.count > 0);
    triangles += (node.geometry.index?.count ?? positions.count) / 3;
    assert.ok(node.material.isMeshStandardMaterial);
  });
  assert.ok(meshes > 30);
  assert.ok(triangles < 200000, `Static study unexpectedly large: ${triangles} triangles`);
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.y > 1.70 && size.y < 1.80);
  assert.ok(bounds.min.y >= 0);
  const torso = root.getObjectByName('standing-collar-tunic').geometry;
  const ray = new THREE.Raycaster(new THREE.Vector3(.025, 1.20, .5), new THREE.Vector3(0, 0, -1), 0, 1);
  const hit = ray.intersectObject(root.getObjectByName('standing-collar-tunic'), false)[0];
  assert.ok(hit && hit.face.normal.z > .8, 'front of tunic must face outwards, not be backface-culled');
  assert.equal(torso.userData.hasGeometricFolds, true);
  assert.equal(root.getObjectByName('breast-pocket-outline'), undefined, 'internal pockets must not become protruding patch-pocket boxes');
  assert.equal(root.getObjectByName('leather-belt').geometry.userData.fittedToWaist, true);
  for (const name of ['canteen-sling', 'haversack-shoulder-strap']) {
    const geometry = root.getObjectByName(name).geometry, positions = geometry.getAttribute('position');
    assert.equal(geometry.userData.thicknessMetres, .0012);
    assert.ok(geometry.userData.fittedContactSamples >= 20);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let pair = 0; pair <= 100; pair++) {
      a.fromBufferAttribute(positions, pair * 2); b.fromBufferAttribute(positions, pair * 2 + 1);
      assert.ok(Math.abs(a.distanceTo(b) - geometry.userData.widthMetres) < 1e-6, 'conforming a shoulder strap must not stretch its edges into spikes');
    }
  }
  disposeUniformStudy(root);
});

test('upper body refits inspected source sleeves and reconstructs its panels instead of overlapping arm primitives', () => {
  assert.throws(() => createStudy(), /requires the inspected static garment/);
  assert.throws(() => bakeStudyGarment(new THREE.Group()), /missing the inspected garment/);
  const original = sourceFixture(), sourceGeometry = original.getObjectByName('衣服').geometry;
  const positionsBefore = sourceGeometry.getAttribute('position').array.slice();
  const { root } = createUniformStudy(), garment = root.getObjectByName('standing-collar-tunic');
  assert.equal(garment.userData.staticBaked, true);
  assert.equal(garment.userData.adaptedSourceGarment, true);
  assert.equal(garment.userData.sourceBodyReferenceTriangles, 2129);
  assert.equal(garment.userData.retainedSleeveTriangles, 1490);
  assert.equal(garment.userData.removedSourceDetailTriangles, 1148);
  assert.equal(garment.userData.sourceCollarIncluded, false);
  assert.equal(garment.userData.sourceBreastPocketsIncluded, false);
  assert.equal(garment.geometry.userData.rebuiltStandingCollar, true);
  assert.equal(garment.geometry.userData.waistJoined, true);
  assert.ok(garment.geometry.userData.measuredCoverage >= .60);
  assert.ok(garment.geometry.userData.reconstructedSamples > 0);
  assert.ok(garment.geometry.userData.attachedArmholeEdges >= 12);
  assert.ok(garment.geometry.userData.bodyTriangleCount > 0);
  assert.equal(garment.userData.sourceBadgesIncluded, false);
  assert.equal(garment.userData.sourceClothingTextureIncluded, false);
  assert.equal(garment.userData.isCC0, false);
  assert.equal(garment.userData.historicalAcceptance, false);
  for (const name of ['upper-sleeve', 'lower-sleeve', 'cuff', 'rank-detail-unresolved']) assert.equal(root.getObjectByName(name), undefined);
  const point = new THREE.Vector3(), positions = garment.geometry.getAttribute('position');
  for (const side of [-1, 1]) {
    const wrist = new THREE.Vector3(side * .248, .875, .035);
    let nearest = Infinity;
    for (let index = 0; index < positions.count; index++) nearest = Math.min(nearest, point.fromBufferAttribute(positions, index).distanceTo(wrist));
    assert.ok(nearest < .055, `Garment cuff misses the shared ${side} wrist: ${nearest}`);
  }
  assert.deepEqual(sourceGeometry.getAttribute('position').array, positionsBefore, 'shared source geometry must remain unchanged');
  disposeUniformStudy(root);
});

test('art-directed silhouette preserves chest depth and narrows thighs without separating the crotch', () => {
  const { root, groups } = createUniformStudy();
  const garment = root.getObjectByName('standing-collar-tunic'), core = garment.geometry.userData.bodyTriangleCount;
  const chest = sectionBounds(garment, 1.35, core).getSize(new THREE.Vector3());
  const waist = sectionBounds(garment, 1.065, core).getSize(new THREE.Vector3());
  assert.ok(chest.x > .35 && chest.x < .39, `Chest width: ${chest.x}`);
  assert.ok(chest.z > .25 && chest.z < .30, `Chest depth: ${chest.z}`);
  assert.ok(waist.x > .30 && waist.x < .34, `Waist width: ${waist.x}`);
  assert.ok(chest.x > waist.x * 1.10, 'torso must not taper into a narrow ribcage above the belt');
  const legs = groups.uniform.children.filter(mesh => mesh.name === 'trouser-leg').sort((a, b) => a.position.x - b.position.x);
  assert.equal(legs.length, 2);
  for (const leg of legs) {
    const thigh = sectionBounds(leg, .70).getSize(new THREE.Vector3());
    assert.ok(thigh.x > .15 && thigh.x < .176, `Thigh width: ${thigh.x}`);
    assert.ok(chest.x > thigh.x * 2, 'two trouser legs must not visually outweigh the chest');
  }
  const seam = (leg, column) => {
    const positions = leg.geometry.getAttribute('position');
    return new THREE.Vector3().fromBufferAttribute(positions, positions.count - 49 + column).applyMatrix4(leg.matrixWorld);
  };
  for (let column = 0; column <= 24; column++) {
    const left = seam(legs[0], column), right = seam(legs[1], 48 - column);
    assert.ok(Math.abs(left.x) < 1e-6);
    assert.ok(left.distanceTo(right) < 1e-6, 'left and right panels must meet along the entire curved crotch seam');
  }
  assert.ok(Math.abs(seam(legs[0], 12).y - .80) < 1e-6);
  disposeUniformStudy(root);
});

test('cloth folds stay localized above the belt and canvas equipment has actual sag rather than box-shaped shading', () => {
  const { root, materials } = createUniformStudy();
  const garment = root.getObjectByName('standing-collar-tunic'), details = garment.geometry.userData;
  assert.equal(details.localizedLoadFolds, true);
  assert.equal(details.sleeveSubdivision, 1);
  assert.deepEqual(details.foldZones, ['above-belt', 'underarm', 'upper-back', 'elbow', 'above-cuff', 'shoulder-strap-contact']);
  assert.equal(materials.cloth.color.getHex(), 0x927c42);
  const direction = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
  const radius = y => {
    const center = new THREE.Vector3(0, y, -.026);
    const ray = new THREE.Raycaster(center.clone().addScaledVector(direction, .45), direction.clone().negate(), 0, .9);
    const hit = ray.intersectObject(garment, false).find(item => item.faceIndex < details.bodyTriangleCount);
    assert.ok(hit, `Missing waist cloth at ${y}`);
    return .45 - hit.distance;
  };
  assert.ok(2 * radius(1.15) - radius(1.138) - radius(1.162) > .001, 'belt tension needs a localized raised fold, not uniform noise');
  const bag = root.getObjectByName('haversack-body'), flap = root.getObjectByName('haversack-flap');
  assert.equal(bag.geometry.userData.softCanvas, true);
  const middle = sectionBounds(bag, .86).getSize(new THREE.Vector3());
  const lower = sectionBounds(bag, .78).getSize(new THREE.Vector3());
  assert.ok(middle.x > lower.x * 1.1, 'loaded canvas must round into a narrower lower seam');
  const positions = flap.geometry.attributes.position, lastRow = 4 * 13;
  assert.ok(positions.getY(lastRow + 6) < positions.getY(lastRow) - .006, 'flap center must sag below its corners');
  assert.ok(positions.getZ(2 * 13 + 6) > positions.getZ(6) + .007, 'flap must bend away from its upper seam');
  assert.equal(flap.geometry.userData.thicknessMetres, .004);
  assert.equal(materials.steel.color.getHex(), 0x4e533e);
  assert.equal(materials.puttee.color.getHex(), 0x716b52);
  disposeUniformStudy(root);
});

test('puttees contain the underlying trousers and pouch loops stay below the belt edge', () => {
  const { root, groups } = createUniformStudy();
  for (const leg of groups.uniform.children.filter(mesh => mesh.name === 'trouser-leg')) {
    const puttee = groups.uniform.children.find(mesh => mesh.name === 'spiral-puttee' && Math.sign(mesh.position.x) === Math.sign(leg.position.x));
    for (const y of [.18, .27, .34, .39, .42]) {
      const center = sectionBounds(puttee, y).getCenter(new THREE.Vector3()).setX(puttee.position.x);
      for (let column = 0; column < 16; column++) {
        const angle = column / 16 * Math.PI * 2, direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        const ray = new THREE.Raycaster(center.clone().addScaledVector(direction, .3), direction.clone().negate(), 0, .6);
        const outer = ray.intersectObject(puttee, false)[0], inner = ray.intersectObject(leg, false)[0];
        assert.ok(outer && inner, `Missing lower-leg cloth at ${y}/${column}`);
        assert.ok(inner.distance > outer.distance + .0004, `Trousers penetrate puttee at ${y}/${column}: ${outer.distance}, ${inner.distance}`);
      }
    }
  }
  const beltTop = new THREE.Box3().setFromObject(root.getObjectByName('leather-belt')).max.y;
  root.traverse(node => {
    if (node.name === 'pouch-belt-loop') assert.ok(new THREE.Box3().setFromObject(node).max.y < beltTop - .001, 'belt loops must not stick up above the belt');
    if (!['pouch-flap', 'rear-pouch-flap'].includes(node.name)) return;
    const positions = node.geometry.getAttribute('position'), rear = [];
    for (let index = 0; index < positions.count; index++) if (positions.getZ(index) < -.02) rear.push(positions.getY(index));
    const thickness = Math.max(...rear) - Math.min(...rear);
    assert.ok(thickness > .0023 && thickness < .0027, `Pouch flap must be thin folded leather, not a solid block: ${thickness}`);
  });
  assert.equal(groups.uniform.children.filter(mesh => mesh.name === 'boot-vamp-seam').length, 2);
  assert.equal(groups.uniform.children.filter(mesh => mesh.name === 'boot-heel').length, 2);
  disposeUniformStudy(root);
});

test('helmet and waterbottle retain individually documented museum reference sizes', () => {
  const { root } = createUniformStudy();
  for (const [name, expected] of [['helmet-shell', [.230, .156, .266]], ['canteen-body', [.177, .215, .075]]]) {
    const mesh = root.getObjectByName(name);
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(size[axis] - expected[axis]) < 1e-6, `${name}/${axis}`);
  }
  assert.equal(root.userData.wearerRightAxis, '-X');
  assert.ok(root.getObjectByName('type-94-canteen').position.x < 0);
  assert.ok(root.getObjectByName('type-30-haversack').position.x > 0);
  disposeUniformStudy(root);
});

test('equipment visibility is isolated from tunic, mannequin and helmet geometry', () => {
  const { root, groups } = createUniformStudy();
  const before = [];
  groups.uniform.traverse(node => { if (node.isMesh) before.push(node.uuid); });
  groups.equipment.visible = false;
  assert.equal(groups.uniform.visible, true);
  assert.equal(groups.head.visible, true);
  assert.equal(groups.helmet.visible, true);
  const after = [];
  groups.uniform.traverse(node => { if (node.isMesh) after.push(node.uuid); });
  assert.deepEqual(after, before);
  const pouches = [];
  groups.equipment.traverse(node => { if (node.name === 'front-ammunition-pouch') pouches.push(node); });
  assert.equal(pouches.length, 2);
  assert.deepEqual(pouches.map(pouch => pouch.userData.referenceRounds), [30, 30]);
  disposeUniformStudy(root);
});

test('research preserves candidate blockers, source URLs and exclusions without copying media', () => {
  assert.equal(research.candidate.decision, 'not-imported');
  assert.equal(research.candidate.downloadApiStatus, 401);
  assert.equal(research.candidate.assetsCopied, false);
  assert.equal(research.authorship.externalMediaCopied, false);
  assert.equal(research.authorship.runtimeExternalRequests, false);
  assert.equal(research.authorship.reusedSkin.isCC0, false);
  assert.equal(research.authorship.reusedSkin.importedClothing, false);
  assert.equal(research.authorship.adaptedGarment.isCC0, false);
  assert.equal(research.authorship.adaptedGarment.sourceClothingTextureIncluded, false);
  assert.equal(research.authorship.adaptedGarment.clothSimulation, false);
  assert.ok(research.limitations.length >= 5);
  assert.ok(research.excluded.some(item => item.item === '九十九式步枪'));
  for (const source of research.sources) {
    assert.equal(new URL(source.url).protocol, 'https:');
    assert.ok(source.finding && source.application && source.uncertainty);
  }
  const main = readFileSync(new URL('../uniform-study/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /from ['"].*(?:battlefield|world|nra-|combat-|soldier-renderer)/);
});

test('licensed head and hands are baked into static meshes without importing bones, clothing or animation', () => {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const bytes = readFileSync(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const skin = bakeStudySkin(model, { face: new THREE.Texture(), eye: new THREE.Texture(), hand: new THREE.Texture() });
  assert.equal(skin.userData.staticBaked, true);
  assert.equal(skin.userData.importedClothing, false);
  assert.equal(skin.userData.importedAnimations, false);
  assert.equal(skin.userData.isCC0, false);
  assert.deepEqual(skin.children.map(mesh => mesh.name), ['study-face', 'study-eyes', 'study-left-hand', 'study-right-hand']);
  skin.traverse(node => {
    assert.equal(Boolean(node.isBone || node.isSkinnedMesh), false);
    if (!node.isMesh) return;
    assert.equal(node.geometry.hasAttribute('skinWeight'), false);
    for (const key of ['position', 'normal', 'uv']) {
      for (const value of node.geometry.getAttribute(key).array) assert.ok(Number.isFinite(value), `${node.name}/${key}`);
    }
  });
  const faceBounds = new THREE.Box3().setFromObject(skin.getObjectByName('study-face'));
  assert.ok(faceBounds.min.y > 1.39 && faceBounds.max.y < 1.71);
  for (const side of ['left', 'right']) {
    const bounds = new THREE.Box3().setFromObject(skin.getObjectByName(`study-${side}-hand`));
    assert.ok(bounds.min.y > .65 && bounds.max.y < 1.0, `${side} hand must meet the static sleeve`);
  }
  const study = createUniformStudy();
  study.groups.head.add(skin);
  const assembledBounds = new THREE.Box3().setFromObject(study.root);
  assert.ok(assembledBounds.min.y >= 0);
  assert.ok(assembledBounds.max.y > 1.70 && assembledBounds.max.y < 1.80);
  let triangles = 0;
  study.root.traverse(node => {
    if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
  });
  assert.ok(triangles < 200000, `Complete static character exceeds triangle budget: ${triangles}`);
  disposeUniformStudy(study.root); disposeUniformStudy(model);
});

test('fabric, leather and painted steel use deterministic low-contrast color with separate normal and roughness maps', () => {
  assert.throws(() => createStudySurface('unknown'), /Unknown study surface/);
  for (const kind of ['cloth', 'leather', 'paint']) {
    const surface = createStudySurface(kind), repeat = createStudySurface(kind);
    assert.equal(surface.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(surface.normalMap.colorSpace, THREE.NoColorSpace);
    assert.equal(surface.roughnessMap.colorSpace, THREE.NoColorSpace);
    assert.deepEqual(surface.map.image.data, repeat.map.image.data);
    if (kind === 'cloth') {
      const values = surface.map.image.data.filter((_, index) => index % 4 === 0);
      assert.ok(Math.max(...values) - Math.min(...values) <= 14, 'cloth color must not return to high-contrast sand-like noise');
    }
    for (const item of [surface, repeat]) {
      item.map.dispose(); item.normalMap.dispose(); item.roughnessMap.dispose();
    }
  }
});
