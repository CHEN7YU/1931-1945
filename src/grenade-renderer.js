import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRENADE, grenadePose } from './grenades.js';

const body = new THREE.SphereGeometry(.052, 10, 7); body.scale(1, 1.15, 1);
const neck = new THREE.CylinderGeometry(.019, .025, .04, 8); neck.translate(0, .068, 0);
const lever = new THREE.BoxGeometry(.012, .09, .018); lever.rotateZ(.25); lever.translate(.035, .045, 0);
const geometry = mergeGeometries([body.toNonIndexed(), neck.toNonIndexed(), lever.toNonIndexed()]);
body.dispose(); neck.dispose(); lever.dispose();
const metal = new THREE.MeshStandardMaterial({ color: 0x4e5541, roughness: .85, metalness: .25 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x657069, roughness: .95 });
const skin = new THREE.MeshStandardMaterial({ color: 0xb89978, roughness: .9 });
const limbGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
const palmGeometry = new THREE.SphereGeometry(1, 8, 6);
const axis = new THREE.Vector3(0, 1, 0);
const model = () => new THREE.Mesh(geometry, metal);

export function createGrenadeRenderer(scene, camera) {
  const views = new Map(), handView = new THREE.Group(), held = model(), limbs = [], palms = [];
  camera.add(handView); handView.add(held);
  for (let side = 0; side < 2; side++) {
    const upper = new THREE.Mesh(limbGeometry, sleeve), lower = new THREE.Mesh(limbGeometry, sleeve);
    const palm = new THREE.Mesh(palmGeometry, skin);
    handView.add(upper, lower, palm); limbs.push([upper, lower]); palms.push(palm);
    palm.scale.set(.035, .046, .025);
  }
  handView.traverse(mesh => { if (mesh.isMesh) mesh.frustumCulled = false; });
  handView.visible = false;
  const segment = (mesh, a, b, radius) => {
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(axis, b.clone().sub(a).normalize());
    mesh.scale.set(radius, a.distanceTo(b), radius);
  };
  return {
    update(grenades, actor, playing) {
      const ids = new Set(grenades.map(grenade => grenade.id));
      for (const [id, mesh] of views) if (!ids.has(id)) { scene.remove(mesh); views.delete(id); }
      for (const grenade of grenades) {
        let mesh = views.get(grenade.id);
        if (!mesh) { mesh = model(); mesh.userData.grenadeId = grenade.id; scene.add(mesh); views.set(grenade.id, mesh); }
        mesh.visible = !grenade.holderId || grenade.holderId !== actor?.id;
        mesh.position.copy(grenade.position);
        mesh.rotation.set(grenade.phase === 'flight' && !grenade.resting ? grenade.position.x * 2 : 0, 0, grenade.position.z * 2);
      }
      const action = actor?.grenades.action, pose = grenadePose(action);
      handView.visible = Boolean(playing && actor?.health > 0 && !actor.vehicleId && pose);
      if (!handView.visible) return;
      const recovery = action.phase === 'recovering' ? 1 - pose.progress : 0;
      const draw = action.phase === 'drawing' ? 1 - pose.progress : 0;
      const swing = action.phase === 'throwing' ? pose.progress : 0;
      const right = new THREE.Vector3(.2, -.15 - draw * .35 - recovery * .45 + swing * .1, -.4 - swing * .18);
      const left = new THREE.Vector3(-.1, -.2 - recovery * .4, -.4);
      held.visible = pose.visible;
      held.position.copy(right).add(new THREE.Vector3(0, .035, -.035));
      held.rotation.z = -.25 + swing * .6;
      for (const [side, target] of [left, right].entries()) {
        const sign = side ? 1 : -1;
        const shoulder = new THREE.Vector3(sign * .23, -.42, .03);
        const elbow = new THREE.Vector3(sign * .31, -.38, -.2);
        segment(limbs[side][0], shoulder, elbow, .047);
        segment(limbs[side][1], elbow, target, .037);
        palms[side].position.copy(target);
      }
      // The left hand assists with preparation, then lowers during the throw.
      limbs[0].forEach(mesh => { mesh.visible = action.phase === 'drawing'; });
      palms[0].visible = action.phase === 'drawing';
    },
    clear() {
      for (const mesh of views.values()) scene.remove(mesh);
      views.clear(); handView.visible = false;
    },
    get snapshot() { return { views: views.size, handVisible: handView.visible, size: GRENADE.size }; },
  };
}
