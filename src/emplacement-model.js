import * as THREE from 'three';
import { EMPLACEMENT_PROFILES } from './emplacements.js';
import { sandbagGeometry } from './scene-details.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addSupportGrip } from './support-weapon-pose.js';

export function createEmplacementModel(point) {
  const profile = EMPLACEMENT_PROFILES[point.profile], cannon = point.profile === 'bofors75';
  const root = new THREE.Group(), swivel = new THREE.Group(), barrel = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x454c3c, roughness: .8, metalness: .3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x242823, roughness: .8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x68563d, roughness: 1 });
  const sand = new THREE.MeshStandardMaterial({ color: 0x968363, roughness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x9e8655, roughness: .48, metalness: .65 });
  const box = (parent, x, y, z, width, height, depth, material = steel) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const tube = (parent, x, y, z, radius, length, material = steel) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
    mesh.rotation.x = Math.PI / 2; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const rod = (parent, from, to, radius, material = steel) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material);
    mesh.position.copy(a).lerp(b, .5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    parent.add(mesh); return mesh;
  };
  const ring = (parent, x, y, z, radius, thickness, material = steel) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 24), material);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  root.position.set(point.x, 0, point.z);
  root.rotation.y = point.heading;
  swivel.position.y = profile.muzzleHeight; root.add(swivel); swivel.add(barrel);
  const grips = {}, loading = {};
  const trailConnections = [];
  if (cannon) {
    for (const sign of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(.48, .085, 8, 24), dark);
      wheel.rotation.y = Math.PI / 2; wheel.position.set(sign * .9, .51, .1); root.add(wheel);
      for (let spoke = 0; spoke < 8; spoke++) {
        const beam = box(wheel, 0, 0, 0, .035, .85, .045, wood); beam.rotation.z = spoke * Math.PI / 4;
      }
      const pivot = new THREE.Vector3(sign * .38, .57, .08);
      const end = new THREE.Vector3(sign * .95, .11, 1.9), direction = end.clone().sub(pivot);
      trailConnections.push({ side: sign < 0 ? 'left' : 'right', pivot: pivot.toArray(), end: end.toArray() });
      const trail = new THREE.Mesh(new THREE.BoxGeometry(.15, .18, direction.length()), steel);
      trail.name = sign < 0 ? 'bofors75-left-connected-trail' : 'bofors75-right-connected-trail';
      trail.position.copy(pivot).lerp(end, .5);
      trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
      root.add(trail);
      box(root, pivot.x, pivot.y, pivot.z, .24, .26, .28, dark);
      box(root, end.x, .06, end.z, .30, .12, .32, dark);
    }
    box(root, 0, .6, 0, 1.6, .18, .24);
    for (const sign of [-1, 1]) box(swivel, sign * .52, .12, -.18, .61, 1.05, .06);
    box(swivel, 0, -.26, -.18, .43, .28, .06);
    box(swivel, 0, .58, -.18, .43, .1, .06);
    tube(barrel, 0, 0, -.5, .10, 2.6);
    tube(barrel, 0, -.19, -.3, .11, 1.2);
    box(barrel, 0, 0, .5, .3, .3, .36);
    tube(barrel, 0, 0, -profile.barrel + .015, .068, .04, dark);
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const control = ring(swivel, sign * .29, -.04, .76, .095, .012, dark);
      control.rotation.y = Math.PI / 2;
      rod(swivel, [sign * .29, -.04, .76], [sign * .29, -.04, .85], .008);
      rod(swivel, [sign * .29, -.04, .85], [sign * .36, -.04, .85], .016, wood);
      grips[side] = addSupportGrip(swivel, `bofors75-${side}-${side === 'left' ? 'traverse' : 'elevation'}`,
        { center: [sign * .325, -.04, .85], radius: .016, axis: [1, 0, 0],
          normal: [0, 0, 1], forward: [0, 1, 0] });
    }
    rod(barrel, [.15, .02, .55], [.22, .02, .55], .012);
    rod(barrel, [.22, -.065, .55], [.22, .265, .55], .016, wood);
    loading.right = addSupportGrip(barrel, 'bofors75-right-breech-control',
      { center: [.22, .03, .55], radius: .016, normal: [1, 0, 0], forward: [0, 0, -1] });
  } else {
    const tall = profile.antiAircraft;
    for (let leg = 0; leg < 3; leg++) {
      const angle = Math.PI / 3 + leg * Math.PI * 2 / 3, x = Math.sin(angle) * .55, z = Math.cos(angle) * .55;
      rod(root, [0, tall ? 1 : .58, 0], [x, .06, z], .027);
      box(root, x, .025, z, .13, .05, .13, dark);
      rod(root, [0, .34, 0], [x * .7, .33, z * .7], .014);
    }
    rod(root, [0, .3, 0], [0, profile.muzzleHeight - .22, 0], .052);
    for (const y of [.36, profile.muzzleHeight - .26]) {
      const collar = ring(root, 0, y, 0, .063, .014, dark); collar.rotation.x = Math.PI / 2;
    }
    box(swivel, 0, -.26, 0, .4, .08, .27);
    for (const sign of [-1, 1]) {
      rod(swivel, [sign * .18, -.26, .08], [sign * .18, 0, 0], .022);
      const pivot = tube(swivel, sign * .18, 0, 0, .045, .045, dark);
      pivot.rotation.set(0, 0, Math.PI / 2);
    }
    const wheel = ring(swivel, .28, -.17, .14, .095, .012);
    wheel.rotation.y = Math.PI / 2;
    for (let spoke = 0; spoke < 4; spoke++) {
      const angle = spoke * Math.PI / 2;
      rod(swivel, [.28, -.17, .14], [.28, -.17 + Math.cos(angle) * .085, .14 + Math.sin(angle) * .085], .006);
    }
    rod(swivel, [.28, -.075, .14], [.35, -.075, .14], .012, wood);
    box(barrel, 0, 0, .04, .18, .18, .54);
    box(barrel, 0, .102, .015, .2, .025, .48, dark);
    box(barrel, 0, .12, -.17, .13, .022, .035);
    const jacket = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .92, 20, 1, true), steel);
    jacket.rotation.x = Math.PI / 2; jacket.position.z = -.65; barrel.add(jacket);
    for (const z of [-1.1, -.21]) ring(barrel, 0, 0, z, .055, .012, dark);
    const muzzle = tube(barrel, 0, 0, -1.18, .023, .14, dark);
    muzzle.geometry.dispose(); muzzle.geometry = new THREE.CylinderGeometry(.023, .023, .14, 16, 1, true);
    ring(barrel, 0, 0, -profile.barrel, .023, .005, dark);
    box(barrel, -.025, .067, -.26, .04, .035, .045, dark);
    rod(barrel, [.015, .04, -.23], [.015, .13, -.23], .012, brass);
    box(barrel, -.35, -.19, .12, .28, .29, .23);
    box(barrel, -.35, -.035, .12, .31, .035, .25, dark);
    box(barrel, -.35, -.01, .12, .12, .022, .08, wood);
    for (let round = 0; round < 8; round++) {
      const x = -.1 - round * .028, y = -.02 - .07 * Math.sin(round / 7 * Math.PI);
      tube(barrel, x, y, .06, .0055, .047, brass);
      tube(barrel, x, y, .025, .0035, .023, dark);
      box(barrel, x, y, .071, .024, .012, .012, wood);
    }
    box(barrel, 0, -.01, .36, .34, .045, .055);
    for (const sign of [-1, 1]) {
      rod(barrel, [sign * .14, -.08, .43], [sign * .14, .09, .43], .022, wood);
      rod(barrel, [sign * .14, -.07, .36], [sign * .14, -.07, .43], .012);
      for (let rivet = 0; rivet < 5; rivet++) {
        const head = tube(barrel, sign * .096, -.025, -.14 + rivet * .08, .008, .012, dark);
        head.rotation.set(0, 0, Math.PI / 2);
      }
      grips[sign < 0 ? 'left' : 'right'] = addSupportGrip(barrel,
        `${point.profile}-${sign < 0 ? 'left' : 'right'}-spade-handle`,
        { center: [sign * .14, 0, .43], radius: .022, normal: [0, 0, 1], forward: [0, 1, 0] });
    }
    box(barrel, 0, .015, .42, .035, .05, .035, dark);
    if (profile.antiAircraft) {
      rod(barrel, [.1, .04, -.43], [.1, .25, -.43], .009);
      const sight = ring(barrel, 0, .25, -.45, .09, .005, dark);
      sight.userData.sightReticle = true;
      for (const [width, height] of [[.17, .004], [.004, .17]])
        box(barrel, 0, .25, -.45, width, height, .004, dark).userData.sightReticle = true;
      root.userData.details = ['water-jacket', 'open-muzzle', 'receiver-cover', 'rivet-heads', 'feed-belt',
        'ammunition-box', 'spade-grips', 'trigger', 'trunnion-cradle', 'elevation-wheel',
        'tripod-braces', 'foot-plates', 'ring-sight'];
    }
    if (!profile.antiAircraft) for (const x of [-.9, -.45, 0, .45, .9]) for (let row = 0; row < 2; row++) {
      const bag = new THREE.Mesh(sandbagGeometry(), sand);
      bag.position.set(x, .18 + row * .32, -.65); bag.scale.set(.4, .3, .3); root.add(bag);
      bag.userData.emplacementCover = true;
    }
    if (!profile.antiAircraft) for (const side of [-1, 1]) for (const z of [0, .65]) for (let row = 0; row < 2; row++) {
      const bag = new THREE.Mesh(sandbagGeometry(), sand);
      bag.position.set(side * 1.55, .18 + row * .32, z);
      bag.scale.set(.35, .3, .4); root.add(bag);
      bag.userData.emplacementCover = true;
    }
  }
  root.userData.supportWeapon = { kind: point.profile, grips, loading,
    operator: { x: 0, y: 0, z: cannon ? 1.02 : profile.antiAircraft ? .68 : .76 },
    operatorFollowsTraverse: true,
    stance: profile.antiAircraft ? 'standing' : 'crouched',
    firingPose: profile.antiAircraft ? null : 'kneeling' };
  if (cannon) root.userData.artilleryTrails = trailConnections;
  root.userData.update = () => {
    root.position.x = point.x; root.position.z = point.z; root.rotation.y = point.heading;
    swivel.rotation.y = point.yaw - point.heading;
    barrel.rotation.x = point.pitch;
    const standing = profile.antiAircraft || cannon && point.position === 'march';
    root.userData.supportWeapon.stance = standing ? 'standing' : 'crouched';
    root.userData.supportWeapon.firingPose = standing ? null : 'kneeling';
    root.updateMatrixWorld(true);
  };
  root.userData.update();
  for (const group of [barrel, swivel, root]) {
    const batches = new Map(), inverse = group.matrixWorld.clone().invert();
    const collect = object => {
      if (object !== group && (object === swivel || object === barrel)) return;
      if (object.isMesh) {
        const key = `${object.material.uuid}:${Boolean(object.userData.emplacementCover)}:${Boolean(object.userData.sightReticle)}`;
        if (!batches.has(key)) batches.set(key, { material: object.material, data: { ...object.userData }, parts: [] });
        const batch = batches.get(key);
        batch.parts.push(object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld)));
      }
      for (const child of [...object.children]) collect(child);
      if (object.isMesh) object.removeFromParent();
    };
    collect(group);
    for (const { material, data, parts } of batches.values()) {
      const geometry = mergeGeometries(parts);
      parts.forEach(part => part.dispose());
      if (!geometry) throw new Error('Fixed-weapon detail geometry cannot be merged');
      const mesh = new THREE.Mesh(geometry, material);
      Object.assign(mesh.userData, data, { partCount: parts.length }); group.add(mesh);
    }
  }
  root.traverse(object => { if (object.isMesh) {
    object.castShadow = object.receiveShadow = true; object.userData.emplacementId = point.id;
    if (cannon) object.userData.dynamicCollision = true;
  } });
  swivel.traverse(object => { if (object.isMesh) object.userData.dynamicCollision = true; });
  return root;
}
