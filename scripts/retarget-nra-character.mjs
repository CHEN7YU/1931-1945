import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareNraRig, connectSharedSkinRig } from '../src/nra-rig.js';

const original = resolve('public', 'assets', 'game', 'nra-88');
const directory = process.argv[2] ? resolve(process.argv[2]) : resolve('asset-research', 'nra-88', 'calibrated');
for (const root of [resolve('public'), resolve('dist')]) {
  if (directory === root || directory.startsWith(root + sep)) throw new Error('Generate privately, validate, then promote; do not overwrite production assets');
}
cpSync(original, directory, { recursive: true });
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
const bindBounds = new THREE.Box3().setFromObject(target, true), floor = bindBounds.min.y;
const actorSpace = new THREE.Matrix4().makeRotationY(Math.PI)
  .multiply(new THREE.Matrix4().makeScale(...Array(3).fill(1.78 / bindBounds.getSize(new THREE.Vector3()).y)))
  .multiply(new THREE.Matrix4().makeTranslation(0, -floor, 0));
const chest = rig.canonical.get('Spine2');
const chestReferenceInverse = actorSpace.clone().multiply(chest.matrixWorld).invert();
const baseGun = new THREE.Matrix4().makeTranslation(.13, 1.39, .02);
const nativeRotations = new Map([...rig.canonical].map(([name, bone]) => [name, bone.quaternion.clone()]));
function appendCarry(track) {
  const matrix = actorSpace.clone().multiply(chest.matrixWorld).multiply(chestReferenceInverse).multiply(baseGun);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  if ([scale.x, scale.y, scale.z].some(value => Math.abs(value - 1) > 1e-4)) throw new Error('Native rifle carry must remain rigid');
  track.positions.push(...position.toArray()); track.quaternions.push(...quaternion.normalize().toArray());
}
function closeCycle(values, size) {
  for (let index = 0; index < size; index++) values[values.length - size + index] = values[index];
}
const shoes = rig.meshes.find(mesh => mesh.name === '\u978b\u5b50');
if (!shoes) throw new Error('Inspected shoe skin is missing');
const source = load(resolve('public', 'assets', 'characters', 'kenney-survivor', 'character.fbx'));
let sourceMesh;
source.traverse(node => { if (node.isSkinnedMesh) sourceMesh = node; });
const sourceBones = new Map(sourceMesh.skeleton.bones.map(bone => [bone.name, bone]));
auxiliaryPose(sourceBones); auxiliaryPose(rig.canonical);
const sourceRest = new Map([...sourceBones].map(([name, bone]) => [name, worldRotation(bone)]));
const targetRest = new Map([...rig.canonical].map(([name, bone]) => [name, worldRotation(bone)]));
const targetAuxiliary = new Map([...rig.canonical].map(([name, bone]) => [name, bone.quaternion.clone()]));
const sourceHip = worldPosition(sourceBones.get('Hips')), targetHip = worldPosition(rig.canonical.get('Hips'));
const legHeight = bones => worldPosition(bones.get('Hips')).y -
  (worldPosition(bones.get('LeftFoot')).y + worldPosition(bones.get('RightFoot')).y) / 2;
const targetLegLength = legHeight(rig.canonical), scale = targetLegLength / legHeight(sourceBones);
if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid calibrated leg/hip scale');
const aliases = { Spine1: 'Chest', Spine2: 'UpperChest', LeftToeBase: 'LeftToes', RightToeBase: 'RightToes' };
const mapped = [...rig.canonical].filter(([name]) => sourceBones.has(aliases[name] ?? name));
const ordered = [];
target.traverse(bone => { if (rig.canonical.get(bone.name) === bone) ordered.push(bone); });
const output = {}, carry = {};
const idleTimes = Array.from({ length: 9 }, (_, index) => index * .75);
const idleRotations = new Map([...rig.canonical.keys()].map(name => [name, []])), idlePositions = [];
carry.idle = { duration: 6, times: idleTimes, positions: [], quaternions: [] };
for (const time of idleTimes) {
  rig.meshes[0].skeleton.pose();
  chest.quaternion.copy(nativeRotations.get('Spine2'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(time / 6 * Math.PI * 2) * .003));
  target.updateMatrixWorld(true);
  for (const [name, bone] of rig.canonical) bone.quaternion.toArray(idleRotations.get(name), idleRotations.get(name).length);
  rig.canonical.get('Hips').position.toArray(idlePositions, idlePositions.length);
  appendCarry(carry.idle);
}
for (const values of idleRotations.values()) closeCycle(values, 4);
closeCycle(idlePositions, 3); closeCycle(carry.idle.positions, 3); closeCycle(carry.idle.quaternions, 4);
const nativeIdleTracks = [...idleRotations].map(([name, values]) => new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, idleTimes, values));
nativeIdleTracks.push(new THREE.VectorKeyframeTrack('.bones[Hips].position', idleTimes, idlePositions));
output.idle = THREE.AnimationClip.toJSON(new THREE.AnimationClip('NRA88_idle_native_breath', 6, nativeIdleTracks));
console.log('idle: native reference stance, stationary hips/knees, 6s subtle chest breathing');
for (const mode of ['run']) {
  const animation = load(resolve('public', 'assets', 'characters', 'kenney-survivor', `${mode}.fbx`))
    .animations.find(clip => clip.name === (mode === 'idle' ? 'Root|Idle' : 'Root|Run'));
  if (!animation) throw new Error(`Missing approved ${mode} source animation`);
  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(animation).play();
  const frames = Math.ceil(animation.duration * 30), times = [], rotations = new Map(mapped.map(([name]) => [name, []])), positions = [];
  carry[mode] = { duration: animation.duration, times, positions: [], quaternions: [] };
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
    appendCarry(carry[mode]);
  }
  for (const values of rotations.values()) closeCycle(values, 4);
  closeCycle(positions, 3); closeCycle(carry[mode].positions, 3); closeCycle(carry[mode].quaternions, 4);
  const tracks = [...rotations].map(([name, values]) => new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, times, values));
  tracks.push(new THREE.VectorKeyframeTrack('.bones[Hips].position', times, positions));
  const clip = new THREE.AnimationClip(`NRA88_${mode}_rest_calibrated`, animation.duration, tracks);
  if (!clip.validate()) throw new Error(`Invalid calibrated ${mode} animation`);
  output[mode] = THREE.AnimationClip.toJSON(clip);
  mixer.stopAllAction(); mixer.uncacheRoot(source);
  console.log(`${mode}: ${mapped.length} mapped bones, ${tracks.length} tracks`);
}
const walkName = process.argv[3] ?? process.env.NRA_WALK_CLIP ?? 'Walking_C';
const evaluatedSources = {
  Walking_A: 'movement-basic.glb', Walking_B: 'movement-basic.glb', Walking_C: 'movement-basic.glb',
  Crouching: 'movement-advanced.glb', Crawling: 'movement-advanced.glb', Running_HoldingRifle: 'movement-advanced.glb',
  Death_A: 'general.glb', Death_B: 'general.glb',
};
if (!Object.hasOwn(evaluatedSources, walkName)) throw new Error('Uninspected source clip selection');
const walkBytes = readFileSync(resolve('asset-research', 'walk-candidates', evaluatedSources[walkName]));
const walkLoader = new GLTFLoader();
const walkAsset = await walkLoader.parseAsync(walkBytes.buffer.slice(walkBytes.byteOffset, walkBytes.byteOffset + walkBytes.byteLength), '');
const walking = walkAsset.scene;
const walkRig = connectSharedSkinRig(walking, 6, 23);
const walkNames = { Hips: 'hips', Spine: 'spine', Spine2: 'chest', Head: 'head',
  LeftArm: 'upperarml', LeftForeArm: 'lowerarml', LeftHand: 'wristl',
  RightArm: 'upperarmr', RightForeArm: 'lowerarmr', RightHand: 'wristr',
  LeftUpLeg: 'upperlegl', LeftLeg: 'lowerlegl', LeftFoot: 'footl', LeftToeBase: 'toesl',
  RightUpLeg: 'upperlegr', RightLeg: 'lowerlegr', RightFoot: 'footr', RightToeBase: 'toesr' };
const walkBones = new Map(Object.entries(walkNames).map(([name, alias]) => [name, walkRig.canonical.get(alias)]));
auxiliaryPose(walkBones);
const walkRest = new Map([...walkBones].map(([name, bone]) => [name, worldRotation(bone)]));
const walkHip = worldPosition(walkBones.get('Hips')), walkScale = targetLegLength / legHeight(walkBones);
const walkClip = walkAsset.animations.find(clip => clip.name === walkName);
if (!walkClip || !Number.isFinite(walkScale) || walkScale <= 0) throw new Error('Inspected CC0 walking source is not usable');
for (const [name, bone] of rig.canonical) bone.quaternion.copy(targetAuxiliary.get(name));
const walkMixer = new THREE.AnimationMixer(walking); walkMixer.clipAction(walkClip).play();
const walkFrames = Math.ceil(walkClip.duration * 30), walkTimes = [], walkPositions = [];
const walkRotations = new Map([...walkBones.keys()].map(name => [name, []]));
carry.walk = { duration: walkClip.duration, times: walkTimes, positions: [], quaternions: [] };
for (let frame = 0; frame <= walkFrames; frame++) {
  const time = Math.min(frame / 30, walkClip.duration - 1e-6);
  walkMixer.setTime(time); walking.updateMatrixWorld(true); walkTimes.push(frame === walkFrames ? walkClip.duration : time);
  for (const bone of ordered) {
    if (!walkBones.has(bone.name)) continue;
    const rotation = worldRotation(walkBones.get(bone.name)).multiply(walkRest.get(bone.name).clone().invert()).multiply(targetRest.get(bone.name));
    setWorldRotation(bone, rotation);
    bone.quaternion.toArray(walkRotations.get(bone.name), walkRotations.get(bone.name).length);
  }
  const hip = rig.canonical.get('Hips'), position = targetHip.clone();
  position.y += (worldPosition(walkBones.get('Hips')).y - walkHip.y) * walkScale;
  hip.position.copy(hip.parent.worldToLocal(position)); target.updateMatrixWorld(true);
  const penetration = floor - new THREE.Box3().setFromObject(shoes, true).min.y;
  if (penetration > 0) {
    const corrected = worldPosition(hip); corrected.y += penetration;
    hip.position.copy(hip.parent.worldToLocal(corrected)); target.updateMatrixWorld(true);
  }
  hip.position.toArray(walkPositions, walkPositions.length); appendCarry(carry.walk);
}
for (const values of walkRotations.values()) closeCycle(values, 4);
closeCycle(walkPositions, 3); closeCycle(carry.walk.positions, 3); closeCycle(carry.walk.quaternions, 4);
const walkTracks = [...walkRotations].map(([name, values]) => new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, walkTimes, values));
walkTracks.push(new THREE.VectorKeyframeTrack('.bones[Hips].position', walkTimes, walkPositions));
output.walk = THREE.AnimationClip.toJSON(new THREE.AnimationClip(`NRA88_walk_KayKit_${walkName}`, walkClip.duration, walkTracks));
console.log(`walk: KayKit ${walkName}, ${walkBones.size} mapped bones, scale=${walkScale}`);
output.motion = { ...carry, strideMeters: 2.1, walkStrideMeters: 1.65, muzzle: [0, 0, -.891] };
writeFileSync(join(directory, 'animations.json'), JSON.stringify(output));
const manifest = JSON.parse(readFileSync(join(directory, 'source.json'), 'utf8'));
manifest.motionSource.method = 'Matched auxiliary T poses; world-space rest rotation differences; hip/leg reference-height scale; preserve target hip baseline; disable root XZ movement; bake shoe-sole nonpenetration';
manifest.motionSource.clips = { idle: 'Project-authored native reference stance with 6-second subtle chest breathing, no cyclic knee/hip bob',
  run: 'Calibrated Kenney CC0 run; closed loop; playback phase tied to actual travelled distance',
  walk: `KayKit Character Animations 1.1 ${evaluatedSources[walkName]} ${walkName}, CC0; calibrated reference poses and hip scale; FBX rotation-key truncation avoided` };
manifest.motionSource.carry = 'Chest-relative rifle carry sampled offline into plain transform tracks; simulation and rendering share the same profile';
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
