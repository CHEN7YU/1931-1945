import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from './nra-rig.js';
import { rifleWorldModel, syncWorldWeapon } from './rifle-model.js';
import { createNraRiflePose } from './nra-rifle-pose.js';
import { soldierRifleMuzzle } from './entities.js';
import { sampleNraMotion } from './nra-motion.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createNraAppearanceApplicator, nraAppearanceResourceBudget } from './nra-appearance.js';
import { createNativePosturePoses } from './nra-posture-pose.js';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';
import { createNativeGaitProfile, createNativeGaitProjection, applyNativeUpperBody } from './nra-gait.js';
import { walkHeight } from './ground.js';
import { createHitPoseSampler, readAnatomicalBones } from './soldier-hit-zones.js';
import { createHeadAimProfile, createHeadAimProbe } from './head-aim.js';
import { createCasualtyPose, sampleCasualtyMotion } from './casualties.js';
import { blastCasualty } from './blast-reaction.js';
import { createNraGrenadeHand } from './nra-hand.js';
import { createNraDadaoPose } from './nra-dadao-pose.js';
import { shoulderPocket } from './rifle-contacts.js';
import { createUniformReferencePose, createRemadeUniformGeometry, createRemadeUniformMaterials } from './nra-uniform.js';
import { createOfficerAppearance } from './officer-appearance.js';
import { nativeSupportWeaponPresentation, nativeEngineerPresentation } from './native-weapon-presentation.js';
import { engineerAssemblyTools } from './engineer.js';
import { createSupportWeaponPose } from './support-weapon-pose.js';
import { recoverCharacterPose } from './character-pose-recovery.js';

export function configureNraTexture(texture, id) {
  texture.colorSpace = THREE.SRGBColorSpace;
  if (id === 'eye' || id === 'hand') texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
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

export async function loadNraCharacter(walkHeightAt = walkHeight, { textureBudget = null, onPoseRecovery = null } = {}) {
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
      const loader = new THREE.TextureLoader();
      const texture = await (textureBudget ? textureBudget.load(loader, `${base}${file}`) : loader.loadAsync(`${base}${file}`));
      return [id, configureNraTexture(texture, id)];
    })),
    new FBXLoader(manager).loadAsync(`${base}${source.helmet.file}`),
  ]);
  if (!animationResponse.ok) throw new Error(`Character animations: HTTP ${animationResponse.status}`);
  const textures = new Map(loadedTextures), inspected = prepareNraRig(model);
  const referencePose = createUniformReferencePose(model), uniformGeometries = new Map(), materialIds = new Map();
  for (const mesh of inspected.meshes) {
    const slots = source.meshMaterials[mesh.name];
    if (!slots || slots.length !== (Array.isArray(mesh.material) ? mesh.material.length : 1)) throw new Error(`Unmapped character material: ${mesh.name}`);
    const materials = slots.map(id => {
      if (!textures.has(id)) throw new Error(`Missing character texture: ${id}`);
      const material = new THREE.MeshStandardMaterial({ map: textures.get(id), roughness: id === 'eye' ? .45 : .9, metalness: 0, side: THREE.DoubleSide });
      materialIds.set(material, id);
      return material;
    });
    mesh.material = materials.length === 1 ? materials[0] : materials;
    mesh.castShadow = mesh.receiveShadow = true;
    uniformGeometries.set(mesh.name, createRemadeUniformGeometry(mesh, referencePose));
  }
  const uniformMaterials = createRemadeUniformMaterials(materialIds, textures);
  const uniformVariants = new Map(inspected.meshes.map(mesh => [mesh.name, {
    geometry: uniformGeometries.get(mesh.name),
    material: Array.isArray(mesh.material) ? mesh.material.map(material => uniformMaterials.get(material)) : uniformMaterials.get(mesh.material),
  }]));
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
  const pocket = shoulderPocket(inspected.canonical.get('RightShoulder').getWorldPosition(new THREE.Vector3()).toArray(),
    inspected.canonical.get('RightArm').getWorldPosition(new THREE.Vector3()).toArray(), {
      leftClavicle: inspected.canonical.get('LeftShoulder').getWorldPosition(new THREE.Vector3()).toArray(),
      neck: inspected.canonical.get('Neck').getWorldPosition(new THREE.Vector3()).toArray(),
      chest: inspected.canonical.get('Spine2').getWorldPosition(new THREE.Vector3()).toArray() });
  const motionProfile = { ...createNativeGaitProfile(clips.motion.idle, inspected.canonical.get('RightArm').getWorldPosition(new THREE.Vector3()).toArray(), pocket),
    restFeet: Object.fromEntries(['Left', 'Right'].map(side => {
      const position = inspected.canonical.get(`${side}Foot`).getWorldPosition(new THREE.Vector3());
      return [side.toLowerCase(), { x: position.x, z: position.z }];
    })),
    rifleShoulderContacts: { standing: pocket, ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, value.pocket])) },
    rifleContacts: { standing: inspected.canonical.get('RightArm').getWorldPosition(new THREE.Vector3()).toArray(),
      ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, value.shoulder])) },
    riflePivots: { standing: inspected.canonical.get('Spine').getWorldPosition(new THREE.Vector3()).toArray(),
      ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, value.pivot])) },
    rifleReloadContacts: { standing: inspected.canonical.get('Hips').getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(.12, .11, -.03)).toArray(),
      ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, value.reloadContact])) },
    leanPivot: inspected.canonical.get('Spine').getWorldPosition(new THREE.Vector3()).toArray(),
    ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, value.carry])) };
  motionProfile.headAim = createHeadAimProfile(normalized, inspected.canonical, idle, postures, inspected.meshes);
  const appearanceCache = { geometries: new Map(), materials: new Map() };
  let dadaoGrip = null;
  function getDadaoGrip() {
    if (!dadaoGrip) {
      const grips = {};
      for (const side of ['right', 'left']) {
        const prefix = side === 'right' ? 'Right' : 'Left', hand = createNraGrenadeHand(normalized, side);
        hand.poseGrip(1, 0, 'dadao');
        const fingers = new Map();
        let wristRotation;
        hand.traverse(node => {
          if (node.isBone && node.name.startsWith(`${prefix}Hand`) && node.name !== `${prefix}Hand`)
            fingers.set(node.name, node.quaternion.clone());
          if (node.isBone && node.name === `${prefix}Hand`) wristRotation = node.getWorldQuaternion(new THREE.Quaternion());
        });
        grips[side] = { fingers, wristRotation, center: new THREE.Vector3(...hand.userData.throwableGrips.dadao) };
        hand.traverseVisible(node => { if (node.isMesh) node.geometry.dispose(); });
      }
      dadaoGrip = { ...grips.right, left: grips.left };
    }
    return dadaoGrip;
  }
  const sampleAnatomy = createHitPoseSampler(() => createView(true));
  function createView(collision = false) {
  const root = new THREE.Group(), avatar = clone(normalized), meshes = [];
  root.add(avatar);
  avatar.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  const canonical = new Map(meshes[0].skeleton.bones.map(bone => [bone.name, bone]));
  root.updateMatrixWorld(true);
  const restFeet = Object.fromEntries(['Left', 'Right'].map(side =>
    [side, root.worldToLocal(canonical.get(`${side}Foot`).getWorldPosition(new THREE.Vector3()))]));
  const animatedLegs = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'Spine', 'Neck', 'Head']
    .map(name => ({ bone: canonical.get(name), rotation: canonical.get(name).quaternion.clone(), position: canonical.get(name).position.clone() }));
  const appearance = createNraAppearanceApplicator(meshes, appearanceCache, uniformVariants);
  const clothingMeshes = [];
  avatar.traverse(node => { if (node.isMesh) clothingMeshes.push(node); });
  const officer = createOfficerAppearance(root, canonical, clothingMeshes, 'friendly');
  const headProbe = createHeadAimProbe(root, canonical, meshes);
  const sharedSkeleton = meshes[0].skeleton;
  for (const mesh of meshes) {
    if (mesh.skeleton.bones.every((bone, index) => bone === sharedSkeleton.bones[index]) &&
      mesh.skeleton.boneInverses.every((matrix, index) => matrix.equals(sharedSkeleton.boneInverses[index]))) {
      mesh.skeleton = sharedSkeleton;
    }
  }
  const gun = rifleWorldModel();
  const engineerTools = engineerAssemblyTools(); engineerTools.visible = false; root.add(engineerTools);
  const riflePose = createNraRiflePose(root, canonical, gun);
  const supportPose = createSupportWeaponPose(root, canonical);
  let dadaoPose = null;
  const groundAt = (x, z, referenceY = root.position.y) =>
    observedActor?.health <= 0 && observedActor.tactics?.corpseFerry
      ? observedActor.position.y : walkHeightAt(x, z, referenceY);
  const applyCasualty = createCasualtyPose(root, canonical, gun, groundAt);
  const projectGait = createNativeGaitProjection(root, canonical, restFeet, groundAt, onPoseRecovery, postures);
  const mixer = new THREE.AnimationMixer(meshes[0]);
  const actions = { idle: mixer.clipAction(idle),
    ...Object.fromEntries(Object.entries(postures).map(([pose, value]) => [pose, mixer.clipAction(value.clip)])) };
  let actorId = null, active = 'idle', speed = 0, motion = null, resets = 0;
  let observedActor = null, legPose = null, restStance = null, casualtyPose = null;
  for (const action of Object.values(actions)) { action.play(); action.paused = true; }
  for (const pose of Object.keys(postures)) actions[pose].setEffectiveWeight(0);
  root.visible = false;
  return {
    root, uniformMaterials, officerAppearance: true, supportWeaponPoses: true,
    optionalAttachments: [officer.attachment],
    get appearanceResources() {
      return { geometryIds: [...appearanceCache.geometries.values()].map(geometry => geometry.uuid),
        materialEntries: appearanceCache.materials.size, limits: nraAppearanceResourceBudget(meshes) };
    },
    get drawBatches() {
      let count = 0;
      root.traverseVisible(node => { if (node.isMesh) count += Array.isArray(node.material) ? node.geometry.groups.length : 1; });
      return count;
    },
    createView,
    createGrenadeHand: (side, { weaponRig = false } = {}) => createNraGrenadeHand(normalized, side, { fullArm: true, weaponRig }),
    createWeaponHand: side => createNraGrenadeHand(normalized, side, { fullArm: true, weaponRig: true }),
    bind(id) {
      supportPose.reset();
      officer.restore();
      actorId = id; observedActor = null; speed = 0; active = 'idle'; motion = null; casualtyPose = null; resets++;
      mixer.stopAllAction();
      for (const leg of animatedLegs) { leg.rotation.copy(leg.bone.quaternion); leg.position.copy(leg.bone.position); }
      for (const action of Object.values(actions)) { action.reset().play(); action.paused = true; }
      actions.idle.setEffectiveWeight(1); root.visible = false;
      for (const pose of Object.keys(postures)) actions[pose].setEffectiveWeight(0);
      appearance.apply(null);
    },
    get actorId() { return actorId; },
    get motionProfile() { return motionProfile; },
    get issue() { return observedActor?.health <= 0 ? null : supportPose.snapshot
      ? supportPose.issue : motion?.dadao ? dadaoPose?.issue : riflePose.issue; },
    update: recoverCharacterPose(root, onPoseRecovery)(function(actor, now, controlledId, rifleOperation = undefined) {
      supportPose.reset();
      observedActor = actor ?? null;
      root.visible = Boolean(actor && !actor.vehicleId && actor.id !== controlledId);
      if (!actor) return;
      officer.restore();
      if (!collision) appearance.apply(actor.avatarAppearance ?? null);
      if (!collision) officer.apply(actor);
      const blast = blastCasualty(actor);
      motion = (blast ? sampleCasualtyMotion(blast, 0) : actor.casualty && sampleCasualtyMotion(actor.casualty, now)) ?? sampleNraMotion(actor, true, rifleOperation); speed = motion.speed; active = motion.weight > .5 ? motion.jog > .5 ? 'run' : 'walk' : 'idle';
      actions.idle.time = motion.idleTime;
      const upright = motion.upright;
      actions.idle.setEffectiveWeight(upright);
      for (const pose of Object.keys(FIRING_POSES)) { actions[pose].time = 0; actions[pose].setEffectiveWeight(motion[pose]); }
      for (const leg of animatedLegs) { leg.bone.quaternion.copy(leg.rotation); leg.bone.position.copy(leg.position); }
      mixer.update(0);
      for (const leg of animatedLegs) { leg.rotation.copy(leg.bone.quaternion); leg.position.copy(leg.bone.position); }
      root.position.copy(actor.position); root.rotation.set(0, actor.heading, 0);
      root.updateMatrixWorld(true);
      const ferrySupport = actor.tactics?.nanjingFerry;
      ({ legPose, restStance } = projectGait(actor, motion,
        ferrySupport && ['boarding', 'aboard'].includes(ferrySupport.phase) ? () => actor.position.y : groundAt));
      applyNativeUpperBody(root, canonical, motion);
      syncWorldWeapon(gun, actor.rifle, motion.automaticReload);
      const engineering = nativeEngineerPresentation(actor);
      riflePose.update(engineering ? { ...motion, rifleOperation: null } :
        rifleOperation === undefined ? motion : { ...motion, rifleOperation });
      engineerTools.visible = engineering;
      engineerTools.position.copy(gun.position); engineerTools.quaternion.copy(gun.quaternion);
      if (motion.dadao && !dadaoPose) dadaoPose = createNraDadaoPose(root, canonical, getDadaoGrip());
      dadaoPose?.update(motion.dadao);
      supportPose.update(actor, now);
      gun.visible = !motion.dadao && !nativeSupportWeaponPresentation(actor);
      casualtyPose = blast ? applyCasualty({ ...actor, casualty: blast }, 0) : actor.casualty ? applyCasualty(actor, now) : null;
    }),
    sampleAnatomy,
    get anatomy() { return readAnatomicalBones(canonical); },
    get snapshot() {
      const point = name => canonical.get(name).getWorldPosition(new THREE.Vector3()).toArray();
      return { actorId, visible: root.visible, active, stance: observedActor?.stance ?? 'standing', speed, position: root.position.toArray(),
        animationSources: Object.values(actions).map(action => action.getClip().name),
        firingPose: observedActor ? ownedFiringPose(observedActor) : null,
        gait: motion ? { source: 'native-foot-cycle', style: motion.travelStyle, runStride: motion.runStride,
          walkStride: motion.walkStride, runContact: motion.runContact, legLift: motion.legLift, strideScale: observedActor.nativeMotion.strideScale,
          bodyLean: motion.bodyLean, runLean: observedActor.nativeMotion.runLean, fireLean: observedActor.nativeMotion.fireLean, legPose, restStance } : null,
        hips: point('Hips'), head: point('Head'), headTop: point('HeadTop_End'), leftKnee: point('LeftLeg'), rightKnee: point('RightLeg'),
        leftFoot: point('LeftFoot'), rightFoot: point('RightFoot'), rightToes: point('RightToeBase'),
        rightHand: point('RightHand'), leftHand: point('LeftHand'), riflePose: riflePose.snapshot,
        dadao: dadaoPose?.snapshot ?? null,
        heading: root.rotation.y, issue: this.issue, supportGrip: supportPose.snapshot,
        headAim: motion?.headAim && observedActor?.health > 0 ? headProbe(motion.headAim, motion) : null,
        casualty: casualtyPose,
        appearance: observedActor?.avatarAppearance ? { ...observedActor.avatarAppearance } : null,
        officer: officer.snapshot,
        uniformParts: meshes.filter(mesh => mesh.geometry.userData.uniformVariant === 'B').map(mesh => mesh.name),
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
