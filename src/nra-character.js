import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareNraRig } from './nra-rig.js';
import { rifleWorldModel } from './rifle-model.js';
import { createNraRiflePose } from './nra-rifle-pose.js';
import { soldierRifleMuzzle } from './entities.js';
import { riflePose as rifleActionPose } from './rifle-action.js';

export async function loadNraCharacter() {
  const base = '/assets/game/nra-88/';
  const response = await fetch(`${base}source.json`);
  if (!response.ok) throw new Error(`Character manifest: HTTP ${response.status}`);
  const source = await response.json();
  if (source.permission?.basis !== 'user-reported-author-phone-consent') throw new Error('Character permission record missing');
  if (source.evaluation?.status !== 'prototype-one-character') throw new Error('Character has not passed the one-soldier prototype checks');
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const [model, animationResponse, loadedTextures] = await Promise.all([
    new FBXLoader(manager).loadAsync(`${base}character.fbx`),
    fetch(`${base}animations.json`),
    Promise.all(Object.entries(source.textures).map(async ([id, file]) => {
      const texture = await new THREE.TextureLoader().loadAsync(`${base}${file}`);
      texture.colorSpace = THREE.SRGBColorSpace;
      return [id, texture];
    })),
  ]);
  if (!animationResponse.ok) throw new Error(`Character animations: HTTP ${animationResponse.status}`);
  const textures = new Map(loadedTextures), inspected = prepareNraRig(model);
  for (const mesh of inspected.meshes) {
    const slots = source.meshMaterials[mesh.name];
    if (!slots || slots.length !== (Array.isArray(mesh.material) ? mesh.material.length : 1)) throw new Error(`Unmapped character material: ${mesh.name}`);
    const materials = slots.map(id => {
      if (!textures.has(id)) throw new Error(`Missing character texture: ${id}`);
      return new THREE.MeshStandardMaterial({ map: textures.get(id), roughness: .9, metalness: 0, side: THREE.DoubleSide });
    });
    mesh.material = materials.length === 1 ? materials[0] : materials;
    mesh.castShadow = mesh.receiveShadow = true;
  }
  const clips = await animationResponse.json(), idle = THREE.AnimationClip.parse(clips.idle), run = THREE.AnimationClip.parse(clips.run);
  if (!idle.validate() || !run.validate()) throw new Error('Invalid character animation');
  for (const clip of [idle, run]) clip.tracks = clip.tracks.filter(track => !/\.bones\[(?:Left|Right)(?:Arm|ForeArm|Hand)/.test(track.name));
  const root = new THREE.Group(), normalized = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(model), height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Invalid character dimensions');
  normalized.scale.setScalar(1.78 / height); normalized.rotation.y = Math.PI;
  model.position.y -= bounds.min.y; normalized.add(model); root.add(normalized);
  const gun = rifleWorldModel(), bolt = gun.getObjectByName('bolt');
  const riflePose = createNraRiflePose(root, inspected.canonical, gun);
  const mixer = new THREE.AnimationMixer(inspected.meshes[0]);
  const actions = { idle: mixer.clipAction(idle), run: mixer.clipAction(run) };
  let actorId = null, previousTime = null, previousPhase = null, active = 'idle', speed = 0;
  let observedActor = null;
  actions.idle.play(); root.visible = false;
  return {
    root,
    bind(id) {
      actorId = id; observedActor = null; previousTime = previousPhase = null; speed = 0; active = 'idle';
      mixer.stopAllAction(); actions.idle.reset().play(); root.visible = false;
    },
    get actorId() { return actorId; },
    get issue() { return riflePose.issue; },
    update(actor, now, controlledId) {
      observedActor = actor ?? null;
      root.visible = Boolean(actor && !actor.vehicleId && (actor.health > 0 ? actor.id !== controlledId : now - actor.deathTime <= 12));
      if (!actor) return;
      const dt = previousTime === null ? 0 : Math.max(0, now - previousTime);
      speed = dt > 0 && previousPhase !== null ? Math.max(0, actor.walkPhase - previousPhase) / 2.5 / dt : 0;
      previousTime = now; previousPhase = actor.walkPhase;
      const next = actor.health > 0 && speed > .1 ? 'run' : 'idle';
      if (next !== active) { actions[next].reset().play().crossFadeFrom(actions[active], .15, false); active = next; }
      actions.run.setEffectiveTimeScale(Math.min(2, speed / 3.15));
      if (actor.health > 0) mixer.update(dt);
      root.position.copy(actor.position); root.rotation.set(0, actor.heading, actor.health > 0 ? 0 : Math.PI / 2);
      root.updateMatrixWorld(true);
      if (actor.health > 0) riflePose.update();
      const weaponPose = rifleActionPose(actor.rifle);
      bolt.rotation.z = weaponPose.boltLift; bolt.position.z = weaponPose.boltTravel;
    },
    get snapshot() {
      const point = name => inspected.canonical.get(name).getWorldPosition(new THREE.Vector3()).toArray();
      return { actorId, visible: root.visible, active, speed, position: root.position.toArray(),
        hips: point('Hips'), head: point('Head'), leftFoot: point('LeftFoot'), rightFoot: point('RightFoot'),
        rightHand: point('RightHand'), leftHand: point('LeftHand'), riflePose: riflePose.snapshot,
        heading: root.rotation.y, issue: riflePose.issue,
        logicalMuzzle: observedActor ? soldierRifleMuzzle(observedActor) : null,
        soldier: observedActor ? { id: observedActor.id, health: observedActor.health, ammo: observedActor.rifle.ammo,
          shots: observedActor.rifle.shots, action: observedActor.rifle.action, weaponId: observedActor.rifle.id } : null,
        hypothesis: source.evaluation.hypothesis };
    },
  };
}
