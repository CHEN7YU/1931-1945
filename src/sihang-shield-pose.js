import * as THREE from 'three';
import { addSupportGrip, createSupportWeaponPose, supportWeaponTargets } from './support-weapon-pose.js';

export const SIHANG_SHIELD_POSES = Object.freeze([
  Object.freeze({ mode: 'roof', slot: 0, active: true, handTarget: Object.freeze([-.3, 1.856, .055]) }),
  Object.freeze({ mode: 'front', slot: 0, active: true, handTarget: Object.freeze([-.3, 1.068, -.263]) }),
]);

export const SIHANG_SHIELD_BANKS = Object.freeze([
  ...SIHANG_SHIELD_POSES,
  ...SIHANG_SHIELD_POSES.map(pose => Object.freeze({ ...pose, installing: true })),
]);

export function sihangShieldInstalling(actor) {
  return actor?.sihangShield?.installing === true && sihangShieldPoseIndex(actor) >= 0;
}

export function sihangShieldWalkWeights(phase, weight) {
  const cycle = ((phase - .25) % 1 + 1) % 1;
  const opposite = cycle < .5 ? cycle * 2 : 2 - cycle * 2;
  const strength = THREE.MathUtils.clamp(weight, 0, 1);
  return [(1 - opposite) * strength, opposite * strength];
}

export function createSihangSatchel() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.32, .24, .14),
    new THREE.MeshStandardMaterial({ color: '#65553b', roughness: .95 }));
  mesh.name = 'sihang-demolition-satchel';
  mesh.userData.supportWeapon = { grips: Object.fromEntries(['left', 'right'].map(side => {
    const sign = side === 'left' ? -1 : 1;
    return [side, addSupportGrip(mesh, `${side}-charge`, { center: [sign * .16, 0, 0],
      radius: 0, normal: [sign, 0, 0], forward: [0, 1, 0] })];
  })) };
  mesh.visible = false;
  return mesh;
}

export function sihangShieldPoseIndex(actor) {
  const shield = actor?.sihangShield;
  if (actor?.team !== 'enemy' || !(actor.health > 0) || actor.casualty || shield?.active !== true ||
    !Number.isInteger(shield.slot) || shield.slot < 0 || shield.slot >= 20 ||
    !Array.isArray(shield.handTarget) || shield.handTarget.length !== 3 ||
    !shield.handTarget.every(Number.isFinite)) return -1;
  return SIHANG_SHIELD_POSES.findIndex(pose => pose.mode === shield.mode);
}

// Targets are wrist positions in the actor root's metre-space, not the imported avatar's rotated space.
export function createSihangShieldPose(root, bones, satchel = null) {
  let snapshot = null;
  const targetsFor = actor => {
    if (sihangShieldInstalling(actor)) {
      if (!satchel) throw new Error('Installing sapper requires the authored charge hand anchors');
      satchel.position.set(0, .86, -.32); satchel.quaternion.identity();
      satchel.updateWorldMatrix(true, true);
      return supportWeaponTargets(satchel, root);
    }
    if (actor.sihangShield.targets) return actor.sihangShield.targets;
    const shield = actor.sihangShield, roof = shield.mode === 'roof';
    const forward = roof ? [0, 0, -1] : [0, -Math.sin(1.15), -Math.cos(1.15)];
    const normal = roof ? [0, -1, 0] : [0, -Math.cos(1.15), Math.sin(1.15)];
    return Object.fromEntries(['left', 'right'].map(side => {
      const wrist = shield.handTarget.slice(); wrist[0] = side === 'left' ? -Math.abs(wrist[0]) : Math.abs(wrist[0]);
      return [side, { wrist, palm: wrist.map((value, index) => value + forward[index] * .055), forward, normal }];
    }));
  };
  const gripPose = createSupportWeaponPose(root, bones, {
    poseIndex: sihangShieldPoseIndex,
    readMarker: actor => ({ kind: `shield-${actor.sihangShield.mode}`,
      phase: sihangShieldInstalling(actor) ? 'loading' : 'operate', targets: targetsFor(actor) }),
  });
  return {
    reset(options) { gripPose.reset(options); snapshot = null; if (satchel) satchel.visible = false; },
    update(actor, now) {
      const index = sihangShieldPoseIndex(actor);
      if (index < 0) { this.reset({ preservePose: actor?.health <= 0 || Boolean(actor?.casualty) }); return null; }
      const installing = sihangShieldInstalling(actor);
      if (satchel) satchel.visible = installing;
      const result = gripPose.update(actor, now), left = result.hands.left, right = result.hands.right;
      snapshot = { mode: actor.sihangShield.mode, slot: actor.sihangShield.slot,
        handTarget: left.anchor.slice(), localTarget: left.anchor.slice(),
        worldTarget: root.localToWorld(new THREE.Vector3(...left.anchor)).toArray(),
        wrist: root.localToWorld(new THREE.Vector3(...left.wrist)).toArray(),
        upperOrigin: root.localToWorld(new THREE.Vector3(...left.shoulder)).toArray(),
        clavicle: bones.get('LeftShoulder').getWorldPosition(new THREE.Vector3()).toArray(),
        reachable: left.reachable && right.reachable, error: Math.max(left.wristError, right.wristError),
        upperLength: left.lengths[0], lowerLength: left.lengths[1], hands: result.hands,
        contactLimited: result.contactLimited,
        ...(installing ? { installation: { error: Math.max(left.wristError, right.wristError), reachable: !result.contactLimited } } : {}) };
      return snapshot;
    },
    get snapshot() { return snapshot; },
  };
}
