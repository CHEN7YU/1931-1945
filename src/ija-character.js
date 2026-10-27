import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createNraRiflePose } from './nra-rifle-pose.js';
import { createNativePosturePoses } from './nra-posture-pose.js';
import { sampleNraMotion } from './nra-motion.js';
import { rifleWorldModel } from './rifle-model.js';
import { riflePose as rifleActionPose } from './rifle-action.js';
import { soldierRifleMuzzle } from './entities.js';
import { createNraForceRenderer } from './nra-force-renderer.js';
import { FIRING_POSES } from './combat-posture.js';
import { createNativeGaitProfile, applyNativeFootCycle, applyNativeBodyLean } from './nra-gait.js';
import { groundHeight } from './ground.js';

export async function loadIjaCharacter() {
  const base = '/assets/game/ija-1938/';
  const response = await fetch(`${base}source.json`);
  if (!response.ok) throw new Error(`Japanese character manifest: HTTP ${response.status}`);
  const source = await response.json();
  if (source.permission?.basis !== 'user-reported-author-phone-consent' || source.historicalAcceptance !== false ||
    source.sourceClothingTexturesIncluded !== false || source.sourceInsigniaIncluded !== false) {
    throw new Error('Japanese adaptation provenance is incomplete');
  }
  const asset = await new GLTFLoader().loadAsync(`${base}character.glb`);
  const normalized = asset.scene, skins = [];
  normalized.rotation.y = Math.PI;
  normalized.traverse(node => { if (node.isSkinnedMesh) { skins.push(node); node.castShadow = node.receiveShadow = true; node.frustumCulled = false; } });
  if (!skins.length || skins[0].skeleton.bones.length !== 65 || !normalized.getObjectByName('near') || !normalized.getObjectByName('far')) {
    throw new Error('Japanese character lacks its inspected skeleton or LODs');
  }
  const canonical = new Map(skins[0].skeleton.bones.map(bone => [bone.name, bone]));
  const postures = createNativePosturePoses(normalized, canonical);
  const motionProfile = { ...createNativeGaitProfile(source.motion.idle),
    leanPivot: canonical.get('Spine').getWorldPosition(new THREE.Vector3()).toArray(),
    ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, value.carry])) };
  const clips = new Map(asset.animations.map(clip => [clip.name, clip]));
  if (!clips.get('idle')?.validate()) throw new Error('Japanese character lacks valid native idle');

  function createView(level = 'near') {
    const root = new THREE.Group(), avatar = clone(normalized), meshes = [];
    root.add(avatar);
    avatar.getObjectByName('near').visible = level === 'near';
    avatar.getObjectByName('far').visible = level === 'far';
    avatar.traverseVisible(node => { if (node.isSkinnedMesh) meshes.push(node); });
    const bones = new Map(meshes[0].skeleton.bones.map(bone => [bone.name, bone]));
    root.updateMatrixWorld(true);
    const restFeet = Object.fromEntries(['Left', 'Right'].map(side =>
      [side, root.worldToLocal(bones.get(`${side}Foot`).getWorldPosition(new THREE.Vector3()))]));
    const animated = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'Spine', 'Head']
      .map(name => ({ bone: bones.get(name), rotation: bones.get(name).quaternion.clone(), position: bones.get(name).position.clone() }));
    const gun = rifleWorldModel(), bolt = gun.getObjectByName('bolt'), pose = createNraRiflePose(root, bones, gun);
    const mixer = new THREE.AnimationMixer(meshes[0]);
    const actions = { idle: mixer.clipAction(clips.get('idle')),
      ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, mixer.clipAction(value.clip)])) };
    for (const action of Object.values(actions)) { action.play(); action.paused = true; }
    let actorId = null, actor = null, initialized = false, active = 'idle', motion = null, legPose = null, drawBatches = 0;
    for (const object of [root, gun]) object.traverseVisible(node => { if (node.isMesh) drawBatches += Array.isArray(node.material) ? node.geometry.groups.length : 1; });
    root.visible = false;
    return {
      root, motionProfile, drawBatches, createView,
      createFarView: () => createView('far'),
      bind(id) {
        actorId = id; actor = null; initialized = false; root.visible = false; motion = null;
        mixer.stopAllAction();
        for (const joint of animated) { joint.rotation.copy(joint.bone.quaternion); joint.position.copy(joint.bone.position); }
        for (const [name, action] of Object.entries(actions)) { action.reset().play(); action.paused = true; action.setEffectiveWeight(name === 'idle' ? 1 : 0); }
      },
      get actorId() { return actorId; },
      get issue() { return pose.issue; },
      update(person, now, controlledId) {
        if (person.team !== 'enemy') throw new Error('Japanese appearance cannot replace a friendly identity');
        actor = person;
        root.visible = !actor.vehicleId && (actor.health > 0 ? actor.id !== controlledId : now - actor.deathTime <= 12);
        motion = sampleNraMotion(actor);
        active = motion.weight > .5 ? motion.jog > .5 ? 'run' : 'walk' : 'idle';
        actions.idle.time = motion.idleTime; actions.idle.setEffectiveWeight(motion.upright);
        for (const stance of Object.keys(FIRING_POSES)) { actions[stance].time = 0; actions[stance].setEffectiveWeight(motion[stance]); }
        if (actor.health > 0 || !initialized) {
          for (const joint of animated) { joint.bone.quaternion.copy(joint.rotation); joint.bone.position.copy(joint.position); }
          mixer.update(0);
          for (const joint of animated) { joint.rotation.copy(joint.bone.quaternion); joint.position.copy(joint.bone.position); }
        }
        root.position.copy(actor.position); root.rotation.set(0, actor.heading, actor.health > 0 ? 0 : Math.PI / 2);
        root.updateMatrixWorld(true);
        if (actor.health > 0) {
          legPose = applyNativeFootCycle(root, bones, motion, restFeet, groundHeight);
          applyNativeBodyLean(root, bones, motion);
        }
        if (actor.health > 0 || !initialized) pose.update(motion);
        initialized = true;
        const weapon = rifleActionPose(actor.rifle);
        bolt.rotation.z = weapon.boltLift; bolt.position.z = weapon.boltTravel;
      },
      get snapshot() {
        const point = name => bones.get(name).getWorldPosition(new THREE.Vector3()).toArray();
        return { actorId, uniform: 'ija1938', level, active, visible: root.visible, stance: actor?.stance ?? 'standing',
          animationSources: Object.values(actions).map(action => action.getClip().name),
          gait: motion ? { source: 'native-foot-cycle', weight: motion.weight, speed: motion.speed, bodyLean: motion.bodyLean, legPose } : null,
          position: root.position.toArray(), head: point('Head'), hips: point('Hips'),
          leftFoot: point('LeftFoot'), rightFoot: point('RightFoot'),
          riflePose: pose.snapshot, issue: pose.issue, logicalMuzzle: actor ? soldierRifleMuzzle(actor) : null,
          soldier: actor ? { id: actor.id, health: actor.health, ammo: actor.rifle.ammo, shots: actor.rifle.shots } : null,
          geometry: source.levels[level], historicalAcceptance: false };
      },
    };
  }
  return createView();
}

export function createIjaForceRenderer(scene, camera, template, capacity = 330) {
  return createNraForceRenderer(scene, camera, template, capacity, { team: 'enemy', uniform: 'ija1938' });
}
