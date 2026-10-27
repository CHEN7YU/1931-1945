import { readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from '../src/nra-rig.js';

const original = resolve('public', 'assets', 'game', 'nra-88');
const directory = process.argv[2] ? resolve(process.argv[2]) : resolve('asset-research', 'nra-88', 'calibrated');
for (const root of [resolve('public'), resolve('dist')]) {
  if (directory === root || directory.startsWith(root + sep)) throw new Error('Generate privately, validate, then promote; do not overwrite production assets');
}
if (!existsSync(join(directory, 'character.fbx'))) cpSync(original, directory, { recursive: true, errorOnExist: true });
function load(file) {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const bytes = readFileSync(file);
  return new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
function worldRotation(node) { return node.getWorldQuaternion(new THREE.Quaternion()); }
function worldPosition(node) { return node.getWorldPosition(new THREE.Vector3()); }
function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(worldRotation(bone.parent).invert().multiply(rotation));
  bone.updateMatrixWorld(true);
}
function align(bones, name, child, direction) {
  const bone = bones.get(name), end = bones.get(child);
  const delta = new THREE.Quaternion().setFromUnitVectors(worldPosition(end).sub(worldPosition(bone)).normalize(), direction);
  setWorldRotation(bone, delta.multiply(worldRotation(bone)));
}
function auxiliaryPose(bones) {
  for (const side of ['Left', 'Right']) {
    const horizontal = new THREE.Vector3(side === 'Left' ? 1 : -1, 0, 0);
    align(bones, `${side}Arm`, `${side}ForeArm`, horizontal);
    align(bones, `${side}ForeArm`, `${side}Hand`, horizontal);
    align(bones, `${side}UpLeg`, `${side}Leg`, new THREE.Vector3(0, -1, 0));
    align(bones, `${side}Leg`, `${side}Foot`, new THREE.Vector3(0, -1, 0));
  }
}
const target = load(join(directory, 'character.fbx')), rig = prepareNraRig(target);
const floor = new THREE.Box3().setFromObject(target, true).min.y;
const shoes = rig.meshes.find(mesh => mesh.name === '\u978b\u5b50');
if (!shoes) throw new Error('Inspected shoe skin is missing');
const source = load(resolve('public', 'assets', 'characters', 'kenney-survivor', 'character.fbx'));
let sourceMesh;
source.traverse(node => { if (node.isSkinnedMesh) sourceMesh = node; });
const sourceBones = new Map(sourceMesh.skeleton.bones.map(bone => [bone.name, bone]));
auxiliaryPose(sourceBones); auxiliaryPose(rig.canonical);
const sourceRest = new Map([...sourceBones].map(([name, bone]) => [name, worldRotation(bone)]));
const targetRest = new Map([...rig.canonical].map(([name, bone]) => [name, worldRotation(bone)]));
const sourceHip = worldPosition(sourceBones.get('Hips')), targetHip = worldPosition(rig.canonical.get('Hips'));
const legHeight = bones => worldPosition(bones.get('Hips')).y -
  (worldPosition(bones.get('LeftFoot')).y + worldPosition(bones.get('RightFoot')).y) / 2;
const scale = legHeight(rig.canonical) / legHeight(sourceBones);
if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid calibrated leg/hip scale');
const aliases = { Spine1: 'Chest', Spine2: 'UpperChest', LeftToeBase: 'LeftToes', RightToeBase: 'RightToes' };
const mapped = [...rig.canonical].filter(([name]) => sourceBones.has(aliases[name] ?? name));
const ordered = [];
target.traverse(bone => { if (rig.canonical.get(bone.name) === bone) ordered.push(bone); });
const output = {};
for (const mode of ['idle', 'run']) {
  const animation = load(resolve('public', 'assets', 'characters', 'kenney-survivor', `${mode}.fbx`))
    .animations.find(clip => clip.name === (mode === 'idle' ? 'Root|Idle' : 'Root|Run'));
  if (!animation) throw new Error(`Missing approved ${mode} source animation`);
  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(animation).play();
  const frames = Math.ceil(animation.duration * 30), times = [], rotations = new Map(mapped.map(([name]) => [name, []])), positions = [];
  for (let frame = 0; frame <= frames; frame++) {
    const time = Math.min(frame / 30, animation.duration - 1e-6);
    mixer.setTime(time); source.updateMatrixWorld(true); times.push(frame === frames ? animation.duration : time);
    for (const bone of ordered) {
      const name = aliases[bone.name] ?? bone.name;
      if (!sourceBones.has(name)) continue;
      const rotation = worldRotation(sourceBones.get(name)).multiply(sourceRest.get(name).clone().invert())
        .multiply(targetRest.get(bone.name));
      setWorldRotation(bone, rotation);
      bone.quaternion.toArray(rotations.get(bone.name), rotations.get(bone.name).length);
    }
    const hip = rig.canonical.get('Hips');
    const position = targetHip.clone();
    position.y += (worldPosition(sourceBones.get('Hips')).y - sourceHip.y) * scale;
    hip.position.copy(hip.parent.worldToLocal(position));
    target.updateMatrixWorld(true);
    const penetration = floor - new THREE.Box3().setFromObject(shoes, true).min.y;
    if (penetration > 0) {
      const corrected = worldPosition(hip); corrected.y += penetration;
      hip.position.copy(hip.parent.worldToLocal(corrected)); target.updateMatrixWorld(true);
    }
    hip.position.toArray(positions, positions.length);
  }
  const tracks = [...rotations].map(([name, values]) => new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, times, values));
  tracks.push(new THREE.VectorKeyframeTrack('.bones[Hips].position', times, positions));
  const clip = new THREE.AnimationClip(`NRA88_${mode}_rest_calibrated`, animation.duration, tracks);
  if (!clip.validate()) throw new Error(`Invalid calibrated ${mode} animation`);
  output[mode] = THREE.AnimationClip.toJSON(clip);
  mixer.stopAllAction(); mixer.uncacheRoot(source);
  console.log(`${mode}: ${mapped.length} mapped bones, ${tracks.length} tracks`);
}
writeFileSync(join(directory, 'animations.json'), JSON.stringify(output));
const manifest = JSON.parse(readFileSync(join(directory, 'source.json'), 'utf8'));
manifest.motionSource.method = 'Matched auxiliary T poses; world-space rest rotation differences; hip/leg reference-height scale; preserve target hip baseline; disable root XZ movement; bake shoe-sole nonpenetration';
manifest.motionSource.references = [
  'https://github.com/upf-gti/retargeting-threejs/blob/main/docs/Algorithm.md',
  'https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js',
];
manifest.evaluation = { status: 'candidate-not-approved', hypothesis: 'reference-pose-and-hip-calibration', scale, mappedBones: mapped.length };
for (const file of manifest.files) {
  const bytes = readFileSync(join(directory, file.file));
  file.bytes = bytes.length; file.sha256 = createHash('sha256').update(bytes).digest('hex');
}
writeFileSync(join(directory, 'source.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ scale, sourceHip: sourceHip.toArray(), targetHip: targetHip.toArray(), directory }));
