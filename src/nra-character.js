import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from './nra-rig.js';
import { rifleWorldModel } from './rifle-model.js';
import { createNraRiflePose } from './nra-rifle-pose.js';
import { soldierRifleMuzzle } from './entities.js';
import { riflePose as rifleActionPose } from './rifle-action.js';
import { sampleNraMotion } from './nra-motion.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createNraAppearanceApplicator } from './nra-appearance.js';
import { createNativePosturePoses } from './nra-posture-pose.js';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';
import { createNativeGaitProfile, applyNativeLowStep, applyNativeBodyLean } from './nra-gait.js';
import { groundHeight } from './ground.js';

export function configureNraTexture(texture, id) {
  texture.colorSpace = THREE.SRGBColorSpace;
  if (id === 'eye') texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function attachNraHelmet(head, helmet, texture, settings) {
  const meshes = [];
  helmet.traverse(node => { if (node.isMesh) meshes.push(node); });
  if (!head?.isBone || meshes.length !== 1 || meshes[0].isSkinnedMesh || !settings) throw new Error('Inspected helmet attachment differs from its source prefab');
  helmet.position.fromArray(settings.position);
  meshes[0].quaternion.fromArray(settings.meshQuaternion).normalize();
  meshes[0].scale.fromArray(settings.meshScale);
  meshes[0].material = new THREE.MeshStandardMaterial({ map: texture, roughness: .7, metalness: .2 });
  meshes[0].castShadow = meshes[0].receiveShadow = true;
  head.add(helmet);
  return helmet;
}

export async function loadNraCharacter() {
  const base = '/assets/game/nra-88/';
  const response = await fetch(`${base}source.json`);
  if (!response.ok) throw new Error(`Character manifest: HTTP ${response.status}`);
  const source = await response.json();
  if (source.permission?.basis !== 'user-reported-author-phone-consent') throw new Error('Character permission record missing');
  if (source.evaluation?.status !== 'prototype-friendly-force') throw new Error('Character has not passed the shared-uniform prototype checks');
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const [model, animationResponse, loadedTextures, helmet] = await Promise.all([
    new FBXLoader(manager).loadAsync(`${base}character.fbx`),
    fetch(`${base}animations.json`),
    Promise.all(Object.entries(source.textures).map(async ([id, file]) => {
      const texture = await new THREE.TextureLoader().loadAsync(`${base}${file}`);
      return [id, configureNraTexture(texture, id)];
    })),
    new FBXLoader(manager).loadAsync(`${base}${source.helmet.file}`),
  ]);
  if (!animationResponse.ok) throw new Error(`Character animations: HTTP ${animationResponse.status}`);
  const textures = new Map(loadedTextures), inspected = prepareNraRig(model);
  for (const mesh of inspected.meshes) {
    const slots = source.meshMaterials[mesh.name];
    if (!slots || slots.length !== (Array.isArray(mesh.material) ? mesh.material.length : 1)) throw new Error(`Unmapped character material: ${mesh.name}`);
    const materials = slots.map(id => {
      if (!textures.has(id)) throw new Error(`Missing character texture: ${id}`);
      return new THREE.MeshStandardMaterial({ map: textures.get(id), roughness: id === 'eye' ? .45 : .9, metalness: 0, side: THREE.DoubleSide });
    });
    mesh.material = materials.length === 1 ? materials[0] : materials;
    mesh.castShadow = mesh.receiveShadow = true;
  }
  // Locomotion is generated from foot targets; the rejected walk/run clips never enter the mixer.
  const clips = await animationResponse.json(), idle = THREE.AnimationClip.parse(clips.idle);
  if (!idle.validate()) throw new Error('Invalid native idle animation');
  if (!clips.motion?.idle) throw new Error('Native idle/carry profile missing');
  idle.tracks = idle.tracks.filter(track => !/\.bones\[(?:Left|Right)(?:Arm|ForeArm|Hand)/.test(track.name));
  const normalized = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(model), height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Invalid character dimensions');
  normalized.scale.setScalar(1.78 / height); normalized.rotation.y = Math.PI;
  model.position.y -= bounds.min.y; normalized.add(model);
  attachNraHelmet(inspected.canonical.get('Head'), helmet, textures.get('helmet'), source.helmet);
  const postures = createNativePosturePoses(normalized, inspected.canonical);
  const motionProfile = { ...createNativeGaitProfile(clips.motion.idle),
    leanPivot: inspected.canonical.get('Spine').getWorldPosition(new THREE.Vector3()).toArray(),
    ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, value.carry])) };
  const appearanceCache = { geometries: new Map(), materials: new Map() };
  function createView() {
  const root = new THREE.Group(), avatar = clone(normalized), meshes = [];
  root.add(avatar);
  avatar.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  const canonical = new Map(meshes[0].skeleton.bones.map(bone => [bone.name, bone]));
  root.updateMatrixWorld(true);
  const restFeet = Object.fromEntries(['Left', 'Right'].map(side =>
    [side, root.worldToLocal(canonical.get(`${side}Foot`).getWorldPosition(new THREE.Vector3()))]));
  const animatedLegs = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'Spine', 'Head']
    .map(name => ({ bone: canonical.get(name), rotation: canonical.get(name).quaternion.clone(), position: canonical.get(name).position.clone() }));
  const appearance = createNraAppearanceApplicator(meshes, appearanceCache);
  const sharedSkeleton = meshes[0].skeleton;
  for (const mesh of meshes) {
    if (mesh.skeleton.bones.every((bone, index) => bone === sharedSkeleton.bones[index]) &&
      mesh.skeleton.boneInverses.every((matrix, index) => matrix.equals(sharedSkeleton.boneInverses[index]))) {
      mesh.skeleton = sharedSkeleton;
    }
  }
  const gun = rifleWorldModel(), bolt = gun.getObjectByName('bolt');
  const riflePose = createNraRiflePose(root, canonical, gun);
  const mixer = new THREE.AnimationMixer(meshes[0]);
  const actions = { idle: mixer.clipAction(idle),
    ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, mixer.clipAction(value.clip)])) };
  let drawBatches = 0;
  root.traverse(node => { if (node.isMesh) drawBatches += Array.isArray(node.material) ? node.geometry.groups.length : 1; });
  let actorId = null, active = 'idle', speed = 0, motion = null, resets = 0;
  let observedActor = null, initialized = false, legPose = null;
  for (const action of Object.values(actions)) { action.play(); action.paused = true; }
  for (const pose of Object.keys(postures)) actions[pose].setEffectiveWeight(0);
  root.visible = false;
  return {
    root,
    drawBatches,
    createView,
    bind(id) {
      actorId = id; observedActor = null; initialized = false; speed = 0; active = 'idle'; motion = null; resets++;
      mixer.stopAllAction();
      for (const leg of animatedLegs) { leg.rotation.copy(leg.bone.quaternion); leg.position.copy(leg.bone.position); }
      for (const action of Object.values(actions)) { action.reset().play(); action.paused = true; }
      actions.idle.setEffectiveWeight(1); root.visible = false;
      for (const pose of Object.keys(postures)) actions[pose].setEffectiveWeight(0);
      appearance.apply(null);
    },
    get actorId() { return actorId; },
    get motionProfile() { return motionProfile; },
    get issue() { return riflePose.issue; },
    update(actor, now, controlledId) {
      observedActor = actor ?? null;
      root.visible = Boolean(actor && !actor.vehicleId && (actor.health > 0 ? actor.id !== controlledId : now - actor.deathTime <= 12));
      if (!actor) return;
      appearance.apply(actor.avatarAppearance ?? null);
      motion = sampleNraMotion(actor); speed = motion.speed; active = motion.weight > .5 ? motion.jog > .5 ? 'run' : 'walk' : 'idle';
      actions.idle.time = motion.idleTime;
      const upright = motion.upright;
      actions.idle.setEffectiveWeight(upright);
      for (const pose of Object.keys(FIRING_POSES)) { actions[pose].time = 0; actions[pose].setEffectiveWeight(motion[pose]); }
      if (actor.health > 0 || !initialized) {
        for (const leg of animatedLegs) { leg.bone.quaternion.copy(leg.rotation); leg.bone.position.copy(leg.position); }
        mixer.update(0);
        for (const leg of animatedLegs) { leg.rotation.copy(leg.bone.quaternion); leg.position.copy(leg.bone.position); }
      }
      root.position.copy(actor.position); root.rotation.set(0, actor.heading, actor.health > 0 ? 0 : Math.PI / 2);
      root.updateMatrixWorld(true);
      if (actor.health > 0) {
        legPose = applyNativeLowStep(root, canonical, motion, restFeet, groundHeight);
        applyNativeBodyLean(root, canonical, motion);
      }
      if (actor.health > 0 || !initialized) riflePose.update(motion);
      initialized = true;
      const weaponPose = rifleActionPose(actor.rifle);
      bolt.rotation.z = weaponPose.boltLift; bolt.position.z = weaponPose.boltTravel;
    },
    get snapshot() {
      const point = name => canonical.get(name).getWorldPosition(new THREE.Vector3()).toArray();
      return { actorId, visible: root.visible, active, stance: observedActor?.stance ?? 'standing', speed, position: root.position.toArray(),
        animationSources: Object.values(actions).map(action => action.getClip().name),
        firingPose: observedActor ? ownedFiringPose(observedActor) : null,
        gait: motion ? { source: 'native-low-step', legLift: motion.legLift, strideScale: observedActor.nativeMotion.strideScale,
          bodyLean: motion.bodyLean, runLean: observedActor.nativeMotion.runLean, fireLean: observedActor.nativeMotion.fireLean, legPose } : null,
        hips: point('Hips'), head: point('Head'), leftKnee: point('LeftLeg'), rightKnee: point('RightLeg'),
        leftFoot: point('LeftFoot'), rightFoot: point('RightFoot'), rightToes: point('RightToeBase'),
        rightHand: point('RightHand'), leftHand: point('LeftHand'), riflePose: riflePose.snapshot,
        heading: root.rotation.y, issue: riflePose.issue,
        appearance: observedActor?.avatarAppearance ? { ...observedActor.avatarAppearance } : null,
        motion: motion ? { weight: motion.weight, jog: motion.jog, ...motion.postures,
          idleTime: motion.idleTime, runTime: motion.runTime, walkTime: motion.walkTime, resets } : null,
        logicalMuzzle: observedActor ? soldierRifleMuzzle(observedActor) : null,
        soldier: observedActor ? { id: observedActor.id, health: observedActor.health, ammo: observedActor.rifle.ammo,
          shots: observedActor.rifle.shots, action: observedActor.rifle.action, weaponId: observedActor.rifle.id } : null,
        hypothesis: source.evaluation.hypothesis };
    },
  };
  }
  return createView();
}
