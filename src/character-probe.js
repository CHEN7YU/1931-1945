import * as THREE from 'three';

export function inspectCharacter(model, clips) {
  const names = new Map(), skins = [], bones = [];
  model.traverse(node => {
    names.set(node.name, (names.get(node.name) || 0) + 1);
    if (node.isBone) bones.push(node);
    if (node.isSkinnedMesh) skins.push(node);
  });
  if (!skins.length || !bones.length) throw new Error('The probe requires a genuinely skinned character, not rigid animated parts');
  if (!model.getObjectByName('RightHand')?.isBone) throw new Error('Required RightHand bone is missing');
  for (const name of ['idle', 'run']) {
    const clip = clips[name];
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= .1 || !clip.tracks.length || !clip.validate()) {
      throw new Error(`Missing or invalid ${name} animation`);
    }
    for (const track of clip.tracks) {
      const node = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
      if (names.get(node) !== 1) throw new Error(`Unbound or ambiguous animation track: ${track.name}`);
    }
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Character bounds must have positive finite height');
  return { skins, bones, bounds, height };
}

export function createCharacterProbe(model, clips, weapon) {
  const inspected = inspectCharacter(model, clips);
  if (!Number.isFinite(weapon.userData.referenceLength) || weapon.userData.referenceLength <= 0) {
    throw new Error('Weapon requires its metre-based reference length');
  }
  const root = new THREE.Group(), normalized = new THREE.Group();
  const scale = 1.75 / inspected.height;
  normalized.scale.setScalar(scale);
  model.position.y -= inspected.bounds.min.y;
  normalized.add(model); root.add(normalized);
  const hand = model.getObjectByName('RightHand'), mount = new THREE.Group(), handScale = new THREE.Vector3();
  mount.name = 'RifleAttachmentProbe';
  hand.add(mount); mount.add(weapon);
  const mixer = new THREE.AnimationMixer(model);
  const actions = { idle: mixer.clipAction(clips.idle), run: mixer.clipAction(clips.run) };
  let active = 'idle';
  actions.idle.play();
  function update(dt, position, motion) {
    if (!Number.isFinite(dt) || dt < 0 || !['x', 'y', 'z'].every(axis => Number.isFinite(position[axis])) ||
        !Number.isFinite(motion.speed) || motion.speed < 0 || !Number.isFinite(motion.vx) || !Number.isFinite(motion.vz)) {
      throw new RangeError('Character projection requires finite pose, movement and non-negative time');
    }
    root.position.copy(position);
    if (motion.speed > .1) root.rotation.y = Math.atan2(motion.vx, motion.vz);
    const next = motion.speed > .1 ? 'run' : 'idle';
    if (next !== active) {
      actions[next].reset().play().crossFadeFrom(actions[active], .15, false);
      active = next;
    }
    actions.run.setEffectiveTimeScale(Math.min(2, motion.speed / 3.15));
    mixer.update(dt);
    root.updateMatrixWorld(true);
    hand.getWorldScale(handScale);
    if (![handScale.x, handScale.y, handScale.z].every(value => Number.isFinite(value) && Math.abs(value) > 1e-8)) {
      throw new Error('Animated hand has an invalid attachment scale');
    }
    // FBX bone units must not resize the existing metre-based rifle.
    mount.scale.set(1 / handScale.x, 1 / handScale.y, 1 / handScale.z);
    root.updateMatrixWorld(true);
  }
  update(0, new THREE.Vector3(), { speed: 0, vx: 0, vz: 0 });
  return {
    root, update,
    get snapshot() {
      const mesh = inspected.skins[0], vertex = new THREE.Vector3();
      const origin = weapon.localToWorld(new THREE.Vector3());
      const end = weapon.localToWorld(new THREE.Vector3(0, 0, -weapon.userData.referenceLength));
      return {
        skinnedMeshes: inspected.skins.length, bones: inspected.bones.length,
        clips: { idle: clips.idle.name, run: clips.run.name }, active, mixerTime: mixer.time,
        position: root.position.toArray(), sourceHeight: inspected.height, scale, normalizedRestHeight: inspected.height * scale,
        hand: hand.getWorldPosition(new THREE.Vector3()).toArray(), weaponOrigin: origin.toArray(),
        weaponReferenceLength: origin.distanceTo(end),
        vertices: [0, 60, 360, 1800].filter(index => index < mesh.geometry.attributes.position.count)
          .map(index => mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld).toArray()),
      };
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); hand.remove(mount); },
  };
}
