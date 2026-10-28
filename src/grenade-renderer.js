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
      const recovering = action?.phase === 'recovering', drawing = action?.phase === 'drawing';
      const swing = action?.phase === 'throwing' ? pose.progress : 0;
      const recovery = recovering ? 1 - pose.progress : 0, draw = drawing ? 1 - pose.progress : 0;
      const open = recovering ? 1 : swing > .65 ? (swing - .65) / .35 : 0;
      const right = new THREE.Vector3(.17 + swing * .025, -.26 - draw * .24 - recovery * .28 + Math.sin(swing * Math.PI) * .11,
        -.52 - swing * .20);
      const left = new THREE.Vector3(.04 - (drawing ? pose.progress * .08 : 0), pack ? -.30 : -.20, pack ? -.46 : -.43);
      held.visible = (pose ? pose.visible : (pack ? actor.grenades.packs : actor.grenades.ammo) > 0);
      if (!pack) held.getObjectByName('safety-ring').visible = !action || drawing && pose.progress < .7;
      for (const [side, target] of [left, right].entries()) {
        const sign = side ? 1 : -1, hand = hands[side];
        hand.visible = side === 1 || drawing;
        for (const mesh of sleeves[side]) mesh.visible = hand.visible;
        if (!hand.visible) continue;
        hand.position.copy(target);
        hand.rotation.set(-.15 + swing * .25, side ? pack ? -.25 : -.65 : .5, side ? -.4 : -.6);
        const closure = side ? 1 - open : .6, pinPull = side ? 0 : drawing ? pose.progress : 0;
        if (hand.poseGrip) hand.poseGrip(closure, pinPull, pack ? 'explosive-pack' : 'grenade');
        else poseGrenadeHand(hand, closure, pinPull);
        const shoulder = new THREE.Vector3(sign * .25, -.43, .06), elbow = new THREE.Vector3(sign * .28, -.34, -.16);
        alignGrenadeSleeve(sleeves[side][0], shoulder, elbow);
        alignGrenadeSleeve(sleeves[side][1], elbow, target.clone().add(new THREE.Vector3(0, -.04, 0)));
      }
      held.quaternion.copy(hands[1].quaternion);
      const grip = hands[1].userData.throwableGrips?.[pack ? 'explosive-pack' : 'grenade'] ??
        hands[1].userData.grenadeGrip ?? [0, .065, -.04];
      held.position.fromArray(grip);
      held.position.applyQuaternion(held.quaternion).add(right);
      if (pack) held.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    },
    clear() {
      for (const mesh of views.values()) scene.remove(mesh);
      views.clear(); handView.visible = false;
    },
    get snapshot() { return { views: views.size, handVisible: handView.visible, size: GRENADE.size,
      handDetail: { fingersPerHand: 5, articulatedSegmentsPerHand: hands[1].poseGrip ? 15 : 14,
        nails: hands[1].poseGrip ? 'source-texture' : 5, palm: hands[1].poseGrip ? 'source-skinned-palm' : 'tapered-rounded-palm', cuff: true },
      handSource: hands[1].userData.handSource ?? 'procedural-articulated-hand',
      grip: hands[1].gripSnapshot ?? null,
      heldVisible: handView.visible && (heldGrenade.visible || heldPack.visible),
      heldKind: heldPack.visible ? 'explosive-pack' : heldGrenade.visible ? 'grenade' : null }; },
  };
}
