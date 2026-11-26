import * as THREE from 'three';
import { GRENADE, grenadePose, throwableProfile } from './grenades.js';
import { grenadeModel, explosivePackModel, grenadeHand, poseGrenadeHand, grenadeSleeve } from './grenade-model.js';
import { isNativeOfficer, isBlueUniform } from './officer-appearance.js';

const vector = values => new THREE.Vector3(...values);
const orientation = values => new THREE.Quaternion().setFromEuler(new THREE.Euler(...values));

function handFrame(view) {
  const forward = vector(view.forward).normalize(), palm = vector(view.palm);
  palm.addScaledVector(forward, -palm.dot(forward)).normalize();
  const rotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(forward.clone().cross(palm).normalize(), forward, palm));
  return { ...view, wrist: vector(view.wrist), pole: vector(view.pole), rotation, palm, forward };
}

export function throwableViewPose(action, kind = 'grenade') {
  const view = grenadePose(action ?? { phase: 'idle', elapsed: 0, kind }).view;
  return { ...handFrame(view), guide: handFrame(view.guide) };
}

function diagnosticSleeve() {
  const sleeve = grenadeSleeve(), mesh = sleeve.children[0], indices = [], uv = [];
  mesh.geometry.dispose();
  const geometry = new THREE.BufferGeometry(), rings = 13, sides = 16;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rings * (sides + 1) * 3), 3));
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side <= sides; side++) {
    uv.push(side / sides, ring / (rings - 1));
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (let ring = 0; ring < rings - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * (sides + 1) + side, b = a + sides + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  geometry.setIndex(indices); mesh.geometry = geometry; mesh.frustumCulled = false;
  sleeve.pose = (shoulder, wrist, pole) => {
    const direction = wrist.clone().sub(shoulder), d = direction.length(), a = .234, b = .251;
    direction.normalize();
    const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    const path = new THREE.CatmullRomCurve3([shoulder, shoulder.clone().lerp(elbow, .75), elbow,
      elbow.clone().lerp(wrist, .25), wrist]);
    const frames = path.computeFrenetFrames(rings - 1, false), positions = geometry.attributes.position;
    for (let ring = 0; ring < rings; ring++) {
      const t = ring / (rings - 1), center = path.getPointAt(t), radius = THREE.MathUtils.lerp(.054, .027, t);
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const point = center.clone().addScaledVector(frames.normals[ring], Math.cos(angle) * radius)
          .addScaledVector(frames.binormals[ring], Math.sin(angle) * radius);
        positions.setXYZ(ring * (sides + 1) + side, point.x, point.y, point.z);
      }
    }
    positions.needsUpdate = true; geometry.computeVertexNormals();
  };
  return sleeve;
}

export function createGrenadeRenderer(scene, camera, createHand = grenadeHand) {
  const views = new Map(), handView = new THREE.Group(), heldGrenade = grenadeModel(), heldPack = explosivePackModel(), hands = [], sleeves = [];
  const restBounds = new THREE.Box3();
  camera.add(handView); handView.add(heldGrenade, heldPack);
  for (const side of ['left', 'right']) {
    const hand = createHand(side), sleeve = hand.poseArm ? null : diagnosticSleeve();
    hands.push(hand); sleeves.push(sleeve); handView.add(hand);
    if (sleeve) handView.add(sleeve);
  }
  handView.visible = false;
  return {
    update(grenades, actor, playing, selected = false, selectedKind = 'grenade') {
      const ids = new Set(grenades.map(grenade => grenade.id));
      for (const [id, mesh] of views) if (!ids.has(id)) { scene.remove(mesh); views.delete(id); }
      for (const grenade of grenades) {
        let mesh = views.get(grenade.id);
        if (!mesh) { mesh = grenade.kind === 'explosive-pack' ? explosivePackModel('world') : grenadeModel('world'); mesh.userData.grenadeId = grenade.id; scene.add(mesh); views.set(grenade.id, mesh); }
        mesh.visible = !grenade.holderId || grenade.holderId !== actor?.id;
        if (grenade.kind === 'grenade') {
          mesh.getObjectByName('safety-ring').visible = grenade.detonateAt === null;
          mesh.getObjectByName('safety-lever').visible = Boolean(grenade.holderId) || grenade.detonateAt === null;
        }
        mesh.position.copy(grenade.position);
        mesh.rotation.set(grenade.phase === 'flight' && !grenade.resting ? grenade.position.x * 2 : 0, 0, grenade.position.z * 2);
        if (grenade.resting) {
          if (mesh.userData.restOffset === undefined) {
            mesh.updateMatrixWorld(true); restBounds.makeEmpty();
            mesh.traverseVisible(part => { if (part.isMesh) restBounds.expandByObject(part); });
            mesh.userData.restOffset = grenade.position.y - throwableProfile(grenade.kind).size - restBounds.min.y + .003;
          }
          mesh.position.y += mesh.userData.restOffset;
        } else delete mesh.userData.restOffset;
      }
      const action = actor?.grenades.action;
      const pack = (action?.kind ?? selectedKind) === 'explosive-pack', held = pack ? heldPack : heldGrenade;
      heldPack.visible = heldGrenade.visible = false;
      const pose = grenadePose(action);
      const stock = pack ? actor?.grenades.packs : actor?.grenades.ammo;
      handView.visible = Boolean(playing && actor?.health > 0 && !actor.vehicleId && (pose || selected && stock > 0));
      if (!handView.visible) return;
      for (const hand of hands) hand.setOfficerAppearance?.(isNativeOfficer(actor), isBlueUniform(actor));
      const drawing = action?.phase === 'drawing', kind = pack ? 'explosive-pack' : 'grenade';
      const motion = throwableViewPose(action, kind);
      held.visible = (pose ? pose.visible : (pack ? actor.grenades.packs : actor.grenades.ammo) > 0);
      const place = (side, target, rotation, elbowPole = null) => {
        const hand = hands[side], sign = side ? 1 : -1;
        const shoulder = vector([sign * .20, -.25, -.03]), pole = elbowPole ?? vector([sign * .8, -.65, .25]);
        hand.visible = true;
        if (hand.poseArm) hand.poseArm(shoulder, target, rotation, pole);
        else {
          hand.position.copy(target); hand.quaternion.copy(rotation);
          const cuff = target.clone().add(vector([0, -.045, .006]).applyQuaternion(rotation));
          sleeves[side].pose(shoulder, cuff, pole);
        }
      };
      place(1, motion.wrist, motion.rotation, motion.pole);
      if (hands[1].poseGrip) hands[1].poseGrip(1 - motion.opening, 0, kind);
      else poseGrenadeHand(hands[1], 1 - motion.opening);
      const frame = hands[1].attachmentFrame ?? hands[1];
      handView.updateMatrixWorld(true);
      const relative = handView.matrixWorld.clone().invert().multiply(frame.matrixWorld);
      const scale = new THREE.Vector3();
      relative.decompose(held.position, held.quaternion, scale);
      const grip = hands[1].userData.throwableGrips?.[pack ? 'explosive-pack' : 'grenade'] ??
        hands[1].userData.grenadeGrip ?? [0, .065, -.04];
      held.position.add(vector(grip).applyQuaternion(held.quaternion));
      if (pack) held.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
      const pullOffset = vector(pack ? [0, 0, -.035 * motion.pull] : [-.035 * motion.pull, 0, 0]);
      const handle = held.getObjectByName(pack ? 'pull-handle' : 'safety-ring');
      handle.position.copy(pack ? vector([0, .04, -.17]) : new THREE.Vector3()).add(pullOffset);
      if (pack) {
        const stem = held.getObjectByName('pull-handle-stem');
        stem.position.z = -.13 - .0175 * motion.pull; stem.scale.y = 1 + .035 / .075 * motion.pull;
      }
      if (!pack) handle.visible = !action || drawing;
      handView.updateMatrixWorld(true);
      const preparation = vector(pack ? [0, .04, -.17] : [.009, .067, .011]).add(pullOffset)
        .applyQuaternion(held.quaternion).add(held.position);
      const helperRotation = orientation([-1.3, .1, -.8]);
      const helperGrip = vector(hands[0].userData.preparationGrip ?? [0, .115, -.025]);
      const contactWrist = preparation.clone().sub(helperGrip.applyQuaternion(helperRotation));
      const left = vector([-.26, -.62, -.12]).lerp(motion.guide.wrist, motion.guiding).lerp(contactWrist, motion.preparation);
      const leftRotation = motion.guide.rotation.clone().slerp(helperRotation, motion.preparation);
      place(0, left, leftRotation, motion.guide.pole);
      if (hands[0].poseGuide) hands[0].poseGuide(motion.preparation, motion.guide.closure);
      else if (hands[0].posePreparation) hands[0].posePreparation(motion.preparation);
      else poseGrenadeHand(hands[0], motion.guide.closure, motion.preparation);
      handView.updateMatrixWorld(true);
    },
    clear() {
      for (const mesh of views.values()) scene.remove(mesh);
      views.clear(); handView.visible = false;
    },
    get snapshot() { return { views: views.size, handVisible: handView.visible, size: GRENADE.size,
      handDetail: { fingersPerHand: 5, articulatedSegmentsPerHand: hands[1].poseGrip ? 15 : 14,
        nails: hands[1].poseGrip ? 'source-texture' : 5, palm: hands[1].poseGrip ? 'source-skinned-palm' : 'tapered-rounded-palm', cuff: true },
      handSource: hands[1].userData.handSource ?? 'procedural-articulated-hand',
      armSource: hands[1].userData.armSource ?? 'continuous-diagnostic-sleeve',
      arms: hands.map(hand => hand.armSnapshot ?? null),
      guideGrip: hands[0].gripSnapshot ?? null,
      grip: hands[1].gripSnapshot ?? null,
      heldVisible: handView.visible && (heldGrenade.visible || heldPack.visible),
      heldKind: heldPack.visible ? 'explosive-pack' : heldGrenade.visible ? 'grenade' : null }; },
  };
}
