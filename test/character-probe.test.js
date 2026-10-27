import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createCharacterProbe, inspectCharacter } from '../src/character-probe.js';

const base = new URL('../public/assets/characters/kenney-survivor/', import.meta.url);
function load(file) {
  const bytes = readFileSync(new URL(file, base));
  return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
function fixture() {
  const model = load('character.fbx');
  const clips = {
    idle: load('idle.fbx').animations.find(clip => clip.name === 'Root|Idle'),
    run: load('run.fbx').animations.find(clip => clip.name === 'Root|Run'),
  };
  const weapon = new THREE.Object3D();
  weapon.userData.referenceLength = 1.11;
  return { model, clips, weapon };
}
test('selected assets match their exact CC0 package files, sizes and checksums', () => {
  for (const path of ['characters/kenney-survivor/', 'audio/kenney-impact/']) {
    const directory = new URL(`../public/assets/${path}`, import.meta.url);
    const source = JSON.parse(readFileSync(new URL('source.json', directory), 'utf8'));
    assert.equal(source.license, 'CC0-1.0');
    assert.match(source.source, /^https:\/\/kenney\.nl\/assets\//);
    assert.match(readFileSync(new URL(source.licenseFile, directory), 'utf8'), /Creative Commons Zero, CC0/);
    for (const file of source.files) {
      const bytes = readFileSync(new URL(file.file, directory));
      assert.equal(bytes.length, file.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
  }
});
test('real FBX skinning and both clips bind without retargeting or a rigid-part substitute', () => {
  const { model, clips } = fixture(), info = inspectCharacter(model, clips);
  assert.equal(info.skins.length, 1);
  assert.equal(info.bones.length, 58);
  assert.ok(info.skins[0].geometry.attributes.skinWeight);
  assert.equal(clips.idle.tracks.length, 138);
  assert.equal(clips.run.tracks.length, 138);
});
test('actual vertices deform while the actor root stays fixed and metre-sized weapons follow the hand', () => {
  const { model, clips, weapon } = fixture(), probe = createCharacterProbe(model, clips, weapon);
  const position = new THREE.Vector3(), idle = { speed: 0, vx: 0, vz: 0 };
  probe.update(.2, position, idle);
  const before = probe.snapshot;
  probe.update(.3, position, { speed: 3.15, vx: 0, vz: 3.15 });
  const running = probe.snapshot;
  assert.deepEqual(running.position, before.position);
  assert.notDeepEqual(running.vertices, before.vertices, 'skin deformation is not just a translated/rotated model');
  assert.notDeepEqual(running.hand, before.hand);
  assert.ok(Math.abs(running.normalizedRestHeight - 1.75) < 1e-9);
  assert.ok(Math.abs(running.weaponReferenceLength - 1.11) < 1e-5);
  assert.ok(new THREE.Vector3(...running.hand).distanceTo(new THREE.Vector3(...running.weaponOrigin)) < 1e-5);
  probe.update(.2, new THREE.Vector3(2, 0, 4), idle);
  assert.equal(probe.snapshot.active, 'idle');
  assert.deepEqual(probe.snapshot.position, [2, 0, 4]);
  probe.dispose();
});
test('missing skinning, missing clips and mismatched bone tracks fail instead of pretending import succeeded', () => {
  const { model, clips } = fixture();
  assert.throws(() => inspectCharacter(new THREE.Group(), clips), /genuinely skinned/);
  assert.throws(() => inspectCharacter(model, { idle: clips.idle }), /run animation/);
  const broken = clips.run.clone();
  broken.tracks[0].name = 'MissingBone.position';
  assert.throws(() => inspectCharacter(model, { ...clips, run: broken }), /Unbound or ambiguous/);
});
