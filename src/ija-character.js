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
  const motionProfile = { ...source.motion, crouched: postures.crouched.carry, prone: postures.prone.carry };
  const clips = new Map(asset.animations.map(clip => [clip.name, clip]));
  for (const name of ['idle', 'walk', 'run']) if (!clips.get(name)?.validate()) throw new Error(`Japanese character lacks valid ${name} animation`);

  function createView(level = 'near') {
    const root = new THREE.Group(), avatar = clone(normalized), meshes = [];
    root.add(avatar);
    avatar.getObjectByName('near').visible = level === 'near';
    avatar.getObjectByName('far').visible = level === 'far';
    avatar.traverseVisible(node => { if (node.isSkinnedMesh) meshes.push(node); });
    const bones = new Map(meshes[0].skeleton.bones.map(bone => [bone.name, bone]));
    const gun = rifleWorldModel(), bolt = gun.getObjectByName('bolt'), pose = createNraRiflePose(root, bones, gun);
    const mixer = new THREE.AnimationMixer(meshes[0]);
    const actions = Object.fromEntries(['idle', 'walk', 'run'].map(name => [name, mixer.clipAction(clips.get(name))]));
    for (const stance of ['crouched', 'prone']) actions[stance] = mixer.clipAction(postures[stance].clip);
    for (const action of Object.values(actions)) { action.play(); action.paused = true; }
    let actorId = null, actor = null, initialized = false, active = 'idle', motion = null, drawBatches = 0;
    for (const object of [root, gun]) object.traverseVisible(node => { if (node.isMesh) drawBatches += Array.isArray(node.material) ? node.geometry.groups.length : 1; });
    root.visible = false;
    return {
      root, motionProfile, drawBatches, createView,
      createFarView: () => createView('far'),
      bind(id) {
        actorId = id; actor = null; initialized = false; root.visible = false; motion = null;
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
        const upright = 1 - motion.crouched - motion.prone;
        actions.idle.time = motion.idleTime; actions.walk.time = motion.walkTime; actions.run.time = motion.runTime;
        actions.idle.setEffectiveWeight((1 - motion.weight) * upright);
        actions.walk.setEffectiveWeight(motion.weight * (1 - motion.jog) * upright);
        actions.run.setEffectiveWeight(motion.weight * motion.jog * upright);
        for (const stance of ['crouched', 'prone']) { actions[stance].time = 0; actions[stance].setEffectiveWeight(motion[stance]); }
        if (actor.health > 0 || !initialized) mixer.update(0);
        root.position.copy(actor.position); root.rotation.set(0, actor.heading, actor.health > 0 ? 0 : Math.PI / 2);
        root.updateMatrixWorld(true);
        if (actor.health > 0 || !initialized) pose.update(motion);
        initialized = true;
        const weapon = rifleActionPose(actor.rifle);
        bolt.rotation.z = weapon.boltLift; bolt.position.z = weapon.boltTravel;
      },
      get snapshot() {
        const point = name => bones.get(name).getWorldPosition(new THREE.Vector3()).toArray();
        return { actorId, uniform: 'ija1938', level, active, visible: root.visible, stance: actor?.stance ?? 'standing',
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
