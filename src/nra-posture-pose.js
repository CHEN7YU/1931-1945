import * as THREE from 'three';
import { solveArm } from './nra-rifle-pose.js';
import { FIRING_POSES } from './combat-posture.js';

const position = bone => bone.getWorldPosition(new THREE.Vector3());
const rotation = bone => bone.getWorldQuaternion(new THREE.Quaternion());
function setRotation(bone, value) {
  bone.quaternion.copy(rotation(bone.parent).invert().multiply(value)); bone.updateMatrixWorld(true);
}

export function createNativePosturePoses(normalized, bones) {
  normalized.updateMatrixWorld(true);
  const saved = new Map([...bones.values()].map(bone => [bone, { position: bone.position.clone(), rotation: bone.quaternion.clone() }]));
  const hips = bones.get('Hips'), head = bones.get('Head'), chest = bones.get('Spine2');
  if (!hips || !head || !chest) throw new Error('Native posture requires the inspected body joints');
  const originalHips = position(hips), originalHipsRotation = rotation(hips), headRotation = rotation(head);
  const feet = new Map(['Left', 'Right'].map(side => [side, { position: position(bones.get(`${side}Foot`)), rotation: rotation(bones.get(`${side}Foot`)) }]));
  const restore = () => {
    for (const [bone, rest] of saved) { bone.position.copy(rest.position); bone.quaternion.copy(rest.rotation); }
    normalized.updateMatrixWorld(true);
  };
  const result = {};
  for (const stance of Object.keys(FIRING_POSES)) {
    restore();
    const prone = stance === 'prone', wall = stance.startsWith('wall'), kneeling = stance === 'kneeling' || stance === 'crouched';
    const lowered = originalHips.clone();
    lowered.y -= prone ? .77 : wall ? .08 : stance === 'kneeling' ? .53 : .60;
    hips.position.copy(hips.parent.worldToLocal(lowered));
    setRotation(hips, originalHipsRotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), prone ? Math.PI / 2 : .12)));
    if (wall) setRotation(bones.get('Spine'), rotation(bones.get('Spine')).premultiply(new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), stance === 'wallLeft' ? .25 : -.25)));
    for (const side of ['Left', 'Right']) {
      const foot = feet.get(side), target = foot.position.clone();
      if (prone) { target.y = .22; target.z = .84; }
      if (kneeling) {
        if (side === 'Right') {
          const upper = position(bones.get(`${side}UpLeg`)), knee = position(bones.get(`${side}Leg`));
          const thigh = upper.distanceTo(knee), shin = knee.distanceTo(position(bones.get(`${side}Foot`)));
          const drop = upper.y - .08;
          if (drop >= thigh) throw new Error('Kneeling hip is too high for ground contact');
          target.set(upper.x, .22, upper.z + Math.sqrt(thigh * thigh - drop * drop) + Math.sqrt(shin * shin - .14 * .14));
        } else target.z = -.32;
      }
      const solved = solveArm(bones.get(`${side}UpLeg`), bones.get(`${side}Leg`), bones.get(`${side}Foot`), target,
        prone || kneeling && side === 'Right' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1));
      if (!solved.reachable || solved.error > .01) throw new Error(`Native ${stance} leg pose is unreachable`);
      if (prone && position(bones.get(`${side}Leg`)).y < .03) throw new Error('Prone knee would intersect the ground');
      const rearFoot = prone || kneeling && side === 'Right';
      setRotation(bones.get(`${side}Foot`), rearFoot
        ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.75).multiply(foot.rotation)
        : foot.rotation);
    }
    setRotation(head, headRotation);
    normalized.updateMatrixWorld(true);
    const tracks = [...bones].map(([name, bone]) => new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, [0, 1],
      [...bone.quaternion.toArray(), ...bone.quaternion.toArray()]));
    tracks.push(new THREE.VectorKeyframeTrack('.bones[Hips].position', [0, 1], [...hips.position.toArray(), ...hips.position.toArray()]));
    const chestPosition = position(chest), weaponPosition = [chestPosition.x + .13, chestPosition.y + .03, chestPosition.z - .03];
    result[stance] = {
      clip: new THREE.AnimationClip(`NRA88_native_${stance}`, 1, tracks),
      carry: { duration: 1, times: [0, 1], positions: [...weaponPosition, ...weaponPosition],
        quaternions: [0, 0, 0, 1, 0, 0, 0, 1] },
    };
  }
  restore();
  return result;
}
