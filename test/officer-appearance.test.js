import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createOfficerAppearance, isNativeOfficer, officerSlot, nativeOfficerRegions, officerRegionShader,
  OFFICER_PROVENANCE } from '../src/officer-appearance.js';
import { bakeNraGeometry, createNraForceRenderer } from '../src/nra-force-renderer.js';
import { createNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';
import { nativeDischargerPresentation } from '../src/native-weapon-presentation.js';

test('tube operation hides rifles only while alive, stationary and in the support-owned operation mode', () => {
  const actor = { health: 100, discharger: { phase: 'ready', presentationActive: true }, tactics: { mode: 'operate-grenade-discharger' } };
  assert.equal(nativeDischargerPresentation(actor), true);
  assert.equal(nativeDischargerPresentation({ ...actor, health: 0 }), false);
  assert.equal(nativeDischargerPresentation({ ...actor, discharger: { phase: 'carrying' } }), false);
  assert.equal(nativeDischargerPresentation({ ...actor, discharger: { phase: 'setting-up', presentationActive: true } }), true);
  assert.equal(nativeDischargerPresentation({ ...actor, discharger: { phase: 'ready', presentationActive: false } }), false);
  assert.equal(nativeDischargerPresentation({ ...actor, tactics: { mode: 'evade' } }), false);
  assert.equal(nativeDischargerPresentation({ health: 100 }), false);
});

test('one original officer slot per whole squad, not each eleven men or each living remainder', () => {
  for (const team of ['friendly', 'enemy']) for (const count of [1, 2, 11, 14, 20, 22]) {
    const formation = { memberCount: count, members: [] };
    const people = Array.from({ length: count }, (_, index) => ({ id: `${team}-${index}`, index, team, formation, health: 100 }));
    formation.members = people;
    assert.equal(people.filter(isNativeOfficer).length, 1);
    const officer = people.find(isNativeOfficer);
    assert.equal(officer.index, count <= 2 || count === 20 ? 0 : 2);
    officer.health = 0;
    assert.equal(isNativeOfficer(officer), true);
    assert.equal(people.filter(person => person.health > 0).filter(isNativeOfficer).length, 0);
    formation.members = people.map(person => ({ ...person, id: `replacement-${person.id}`, health: 100 }));
    assert.equal(formation.members.filter(isNativeOfficer).length, 1);
  }
  assert.equal(officerSlot({ members: Array(4), type: 'vehicle-crew' }), 0);
  assert.equal(officerSlot({ members: Array(3), type: 'pilot' }), 0);
  assert.equal(officerSlot({ memberCount: 6, type: 'plane' }), 0);
  assert.equal(officerSlot({ memberCount: 4, type: 'tank' }), 0);
  assert.equal(isNativeOfficer({ team: 'friendly', index: 0 }), false, 'unowned pose-bake actors are not promoted');
  assert.equal(isNativeOfficer({ team: 'civilian', index: 0, formation: { memberCount: 1 } }), false);
});

async function nativeIja() {
  const binary = await readFile(new URL('../public/assets/game/ija-1938/character.glb', import.meta.url));
  const json = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
  json.materials = json.materials.map(() => ({}));
  delete json.textures; delete json.images; delete json.extensionsUsed; delete json.extensionsRequired;
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const payload = binary.subarray(20 + binary.readUInt32LE(12)), packed = Buffer.alloc(20 + padded.length + payload.length);
  packed.writeUInt32LE(0x46546c67, 0); packed.writeUInt32LE(2, 4); packed.writeUInt32LE(packed.length, 8);
  packed.writeUInt32LE(padded.length, 12); packed.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(packed, 20); payload.copy(packed, 20 + padded.length);
  const asset = await new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), '');
  asset.scene.rotation.y = Math.PI;
  return asset.scene;
}

async function nativeNra() {
  const binary = await readFile(new URL('../public/assets/game/nra-88/character.fbx', import.meta.url));
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const avatar = new FBXLoader(manager).parse(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), '');
  const root = new THREE.Group();
  const box = new THREE.Box3().setFromObject(avatar);
  root.scale.setScalar(1.78 / (box.max.y - box.min.y)); root.rotation.y = Math.PI;
  avatar.position.y -= box.min.y; root.add(avatar);
  // Supplied helmet is a separate Head attachment in production.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(10, 8, 6), new THREE.MeshStandardMaterial());
  helmet.name = '國民革命軍M35鋼盔'; avatar.getObjectByName('Head').add(helmet);
  return root;
}

for (const team of ['friendly', 'enemy']) test(`${team}: native helmet replacement, shared costume resources and all bones survive pose/death/rebinding`, async () => {
  const avatar = team === 'enemy' ? await nativeIja() : await nativeNra();
  const root = new THREE.Group(); root.add(avatar); root.updateMatrixWorld(true);
  const meshes = [];
  avatar.traverse(node => { if (node.isMesh) meshes.push(node); });
  const skins = meshes.filter(mesh => mesh.isSkinnedMesh), bones = new Map(skins[0].skeleton.bones.map(b => [b.name, b]));
  assert.equal(bones.size, 65);
  const source = meshes.map(mesh => ({ geometry: mesh.geometry, material: mesh.material,
    positions: mesh.geometry.attributes.position.array.slice(), indices: mesh.geometry.index?.array.slice() }));
  const before = [...bones.values()].map(bone => bone.matrixWorld.toArray());
  const costume = createOfficerAppearance(root, bones, meshes, team);
  const actor = { team, index: 2, health: 100, formation: { memberCount: 22 } };
  costume.apply({ ...actor, index: 1 });
  assert.equal(costume.mesh.visible, false);
  assert.deepEqual([...bones.values()].map(bone => bone.matrixWorld.toArray()), before);
  costume.apply(actor);
  assert.equal(costume.snapshot.officer, true);
  assert.equal(costume.snapshot.badge, team === 'friendly' ? 'ROC-white-sun' : 'gold-star-red-band');
  assert.equal(costume.snapshot.decorativeSword, team === 'enemy');
  assert.ok(costume.snapshot.triangles < 1000, 'single bounded accessory submission');
  assert.equal(costume.mesh.skeleton.bones.length, 65);
  let removedHelmetTriangles = 0;
  for (let i = 0; i < meshes.length; i++) {
    const originalCount = source[i].indices?.length ?? source[i].positions.length / 3;
    const officerCount = meshes[i].geometry.index?.count ?? meshes[i].geometry.attributes.position.count;
    removedHelmetTriangles += (originalCount - officerCount) / 3;
    assert.deepEqual(source[i].geometry.attributes.position.array, source[i].positions);
  }
  assert.ok(removedHelmetTriangles > 20, 'native steel shell is removed, not hidden under a field cap');
  const sharedGeometry = costume.mesh.geometry, sharedMaterial = costume.mesh.material;
  assert.ok(sharedGeometry.boundingBox.max.y > bones.get('HeadTop_End').getWorldPosition(new THREE.Vector3()).y,
    'field cap is fitted to skull crown, not the Head pivot at the base of the face');
  assert.equal(sharedGeometry.userData.officerProvenance, OFFICER_PROVENANCE);
  assert.equal(OFFICER_PROVENANCE.historicalAcceptance, false);
  for (const [boneName, angle] of [['Spine2', -.8], ['Head', .2], ['LeftLeg', 1.2], ['Hips', 1.4]]) {
    const bone = bones.get(boneName); bone.rotation.x += angle; root.updateMatrixWorld(true);
    const baked = bakeNraGeometry(costume.mesh), index = costume.mesh.geometry.attributes.skinIndex;
    const weights = costume.mesh.geometry.attributes.skinWeight;
    for (let at = 0; at < index.count; at += 23) {
      const expected = new THREE.Vector3().fromBufferAttribute(sharedGeometry.attributes.position, at);
      costume.mesh.applyBoneTransform(at, expected); costume.mesh.localToWorld(expected);
      assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(baked.attributes.position, at)) < 1e-5);
      assert.equal(weights.getX(at), 1);
    }
    baked.dispose();
  }
  costume.restore(); costume.apply({ ...actor, health: 0 });
  assert.equal(costume.mesh.visible, true, 'dead original officer keeps his clothes');
  costume.restore();
  for (let i = 0; i < meshes.length; i++) {
    assert.equal(meshes[i].geometry, source[i].geometry); assert.equal(meshes[i].material, source[i].material);
  }
  const next = createOfficerAppearance(root, bones, meshes, team);
  // Different posed landmarks intentionally create a new fit; repeated identical fits reuse it.
  const same = createOfficerAppearance(root, bones, meshes, team);
  assert.equal(next.mesh.geometry, same.mesh.geometry); assert.equal(next.mesh.material, sharedMaterial);
  assert.ok(sharedGeometry.attributes.position.count > 0);
});

test('far shader replaces helmet fragments and colors only officers, preserving original soldier material paths', () => {
  for (const team of ['friendly', 'enemy']) {
    const shader = { vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>' };
    officerRegionShader(shader, { instanced: true, team });
    assert.match(shader.vertexShader, /attribute float nativeOfficer;/);
    assert.match(shader.fragmentShader, /vOfficer > 0.5/);
    assert.match(shader.fragmentShader, /discard/);
  }
});

test('instanced officer attachment follows every morph bank without extra near slots, survives culling and removal', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(72, 1, .07, 650);
  camera.position.set(0, 1, 0);
  const track = { duration: 1, times: [0, 1], positions: [0, 0, 0, 0, 0, 0], quaternions: [0, 0, 0, 1, 0, 0, 0, 1] };
  const profile = { idle: track, run: track, crouched: track, prone: track, strideMeters: 2, muzzle: [0, 0, -.8] };
  const geometry = new THREE.BoxGeometry(.4, 1.7, .3), material = new THREE.MeshStandardMaterial();
  function view() {
    const root = new THREE.Group(), body = new THREE.Mesh(geometry, material), kit = new THREE.Mesh(geometry, material);
    kit.name = 'test-officer'; root.add(body, kit);
    const gun = new THREE.Group(); gun.userData.personalWeapon = true; root.add(gun);
    return { root, motionProfile: profile, officerAppearance: true, createView: view,
      optionalAttachments: [{ mesh: kit, enabled: isNativeOfficer, poseFollowing: true }],
      bind() {}, issue: null, update(actor) {
        kit.position.y = -actor.nativeMotion.posture.prone * .6 - actor.nativeMotion.posture.crouched * .3;
        root.position.copy(actor.position); root.updateMatrixWorld(true);
      } };
  }
  const force = createNraForceRenderer(scene, camera, view(), 22, { team: 'enemy' });
  const formation = { memberCount: 22 };
  const people = Array.from({ length: 22 }, (_, index) => {
    const actor = { id: `officer-test-${index}`, index, formation, team: 'enemy', unitId: 'test',
      position: new THREE.Vector3((index % 5 - 2) * .5, 0, -40 - Math.floor(index / 5)),
      heading: 0, health: 100, walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
    actor.nativeMotion = createNraMotion(profile, actor); return actor;
  });
  const instances = () => force.root.children.filter(mesh => mesh.name === 'test-officer').reduce((n, mesh) => n + mesh.count, 0);
  force.update(people, 0, null, 'high', { detailLimit: 0 });
  assert.equal(force.counts.near, 0); assert.equal(force.counts.far, 22); assert.equal(instances(), 1);
  assert.equal(force.snapshot.members.filter(member => member.officer).length, 1);
  const body = force.root.children.find(mesh => mesh.count === 22 && mesh.geometry?.attributes.nativeOfficer);
  assert.equal([...body.geometry.attributes.nativeOfficer.array].filter(Boolean).length, 1);
  people[2].nativeMotion.posture.prone = .7; people[2].nativeMotion.posture.crouched = .3;
  force.update(people, .25, null, 'high', { detailLimit: 0 });
  const proneKit = force.root.children.find(mesh => mesh.name === 'test-officer' && mesh.count === 1);
  assert.equal(proneKit.geometry.morphAttributes.position.length, 2);
  const weights = { morphTargetInfluences: [0, 0] }; proneKit.getMorphAt(0, weights);
  assert.ok(Math.abs(weights.morphTargetInfluences[1] - .3) < 1e-6);
  assert.ok(Math.abs(proneKit.geometry.morphAttributes.position[0].getY(0) -
    proneKit.geometry.attributes.position.getY(0)) > .5, 'kit is baked in each actual posture, not frozen upright');
  people[2].nativeMotion.posture.prone = 0; people[2].nativeMotion.posture.crouched = 0;
  people[0].discharger = { phase: 'ready', presentationActive: true };
  people[0].tactics = { mode: 'operate-grenade-discharger' };
  force.update(people, .5, null, 'high', { detailLimit: 0 });
  assert.ok(force.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle').every(mesh => mesh.count === 21));
  people[0].tactics.mode = 'evade';
  force.update(people, .75, null, 'high', { detailLimit: 0 });
  assert.ok(force.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle').every(mesh => mesh.count === 22));
  people[2].health = 0;
  force.update(people, 1, null, 'low', { detailLimit: 0 }); assert.equal(instances(), 1);
  camera.rotation.y = Math.PI; force.update(people, 2, null, 'low'); assert.equal(instances(), 0);
  force.remove(people); force.update([], 3, null, 'high'); assert.equal(instances(), 0);
});
