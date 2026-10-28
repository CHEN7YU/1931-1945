import * as THREE from 'three';
import { GRENADE, grenadePose, throwableProfile } from './grenades.js';
import { grenadeModel, explosivePackModel, grenadeHand, poseGrenadeHand, grenadeSleeve, alignGrenadeSleeve } from './grenade-model.js';

export function createGrenadeRenderer(scene, camera, createHand = grenadeHand) {
  const views = new Map(), handView = new THREE.Group(), heldGrenade = grenadeModel(), heldPack = explosivePackModel(), hands = [], sleeves = [];
  const restBounds = new THREE.Box3();
  camera.add(handView); handView.add(heldGrenade, heldPack);
  for (const side of ['left', 'right']) {
    const hand = createHand(side), upper = grenadeSleeve(), lower = grenadeSleeve();
    hands.push(hand); sleeves.push([upper, lower]); handView.add(hand, upper, lower);
  }
  handView.visible = false;
  return {
    update(grenades, actor, playing, selected = false, selectedKind = 'grenade') {
      const ids = new Set(grenades.map(grenade => grenade.id));
      for (const [id, mesh] of views) if (!ids.has(id)) { scene.remove(mesh); views.delete(id); }
      for (const grenade of grenades) {
        let mesh = views.get(grenade.id);
        if (!mesh) { mesh = grenade.kind === 'explosive-pack' ? explosivePackModel() : grenadeModel(); mesh.userData.grenadeId = grenade.id; scene.add(mesh); views.set(grenade.id, mesh); }
        mesh.visible = !grenade.holderId || grenade.holderId !== actor?.id;
        mesh.position.copy(grenade.position);
        mesh.rotation.set(grenade.phase === 'flight' && !grenade.resting ? grenade.position.x * 2 : 0, 0, grenade.position.z * 2);
        if (grenade.resting) {
          if (mesh.userData.restOffset === undefined) {
            mesh.updateMatrixWorld(true); restBounds.setFromObject(mesh);
            mesh.userData.restOffset = grenade.position.y - throwableProfile(grenade.kind).size - restBounds.min.y + .003;
          }
          mesh.position.y += mesh.userData.restOffset;
        } else delete mesh.userData.restOffset;
      }
      const action = actor?.grenades.action;
      const pack = (action?.kind ?? selectedKind) === 'explosive-pack', held = pack ? heldPack : heldGrenade;
      heldPack.visible = heldGrenade.visible = false;
      const pose = grenadePose(action);
      handView.visible = Boolean(playing && actor?.health > 0 && !actor.vehicleId && (pose || selected));
      if (!handView.visible) return;
      const recovering = action?.phase === 'recovering', drawing = action?.phase === 'drawing';
      const swing = action?.phase === 'throwing' ? pose.progress : 0;
      const recovery = recovering ? 1 - pose.progress : 0, draw = drawing ? 1 - pose.progress : 0;
      const open = swing > .65 ? (swing - .65) / .35 : recovering ? recovery : 0;
      const right = new THREE.Vector3(.18 + swing * .025, -.26 - draw * .24 - recovery * .28 + Math.sin(swing * Math.PI) * .11,
        -.46 - swing * .20);
      const left = new THREE.Vector3(.04 - (drawing ? pose.progress * .08 : 0), pack ? -.30 : -.20, pack ? -.46 : -.43);
      held.visible = (pose ? pose.visible : (pack ? actor.grenades.packs : actor.grenades.ammo) > 0);
      if (!pack) held.getObjectByName('safety-ring').visible = !action || drawing && pose.progress < .7;
      for (const [side, target] of [left, right].entries()) {
        const sign = side ? 1 : -1, hand = hands[side];
        hand.position.copy(target);
        hand.rotation.set(-.15 + swing * .25, side ? -.85 : .5, side ? -.45 : -.6);
        const closure = side ? .85 * (1 - open) : .6, pinPull = side ? 0 : drawing ? pose.progress : 0;
        if (hand.poseGrip) hand.poseGrip(closure, pinPull);
        else poseGrenadeHand(hand, closure, pinPull);
        const shoulder = new THREE.Vector3(sign * .25, -.43, .06), elbow = new THREE.Vector3(sign * .28, -.34, -.16);
        alignGrenadeSleeve(sleeves[side][0], shoulder, elbow);
        alignGrenadeSleeve(sleeves[side][1], elbow, target.clone().add(new THREE.Vector3(0, -.04, 0)));
        hand.visible = side === 1 || drawing;
        for (const mesh of sleeves[side]) mesh.visible = hand.visible;
      }
      held.quaternion.copy(hands[1].quaternion);
      held.position.fromArray(hands[1].userData.grenadeGrip ?? [0, .065, -.04]).applyQuaternion(held.quaternion).add(right);
      if (pack) { held.rotation.set(.3 + swing * .3, 1.3, -.55); held.position.x -= .025; }
    },
    clear() {
      for (const mesh of views.values()) scene.remove(mesh);
      views.clear(); handView.visible = false;
    },
    get snapshot() { return { views: views.size, handVisible: handView.visible, size: GRENADE.size,
      handDetail: { fingersPerHand: 5, articulatedSegmentsPerHand: 14,
        nails: hands[1].poseGrip ? 'source-texture' : 5, palm: hands[1].poseGrip ? 'source-skinned-palm' : 'tapered-rounded-palm', cuff: true },
      handSource: hands[1].userData.handSource ?? 'procedural-articulated-hand',
      heldVisible: handView.visible && (heldGrenade.visible || heldPack.visible),
      heldKind: heldPack.visible ? 'explosive-pack' : heldGrenade.visible ? 'grenade' : null }; },
  };
}
