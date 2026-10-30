import * as THREE from 'three';
import { soldierModel } from './world.js';
import { casualtyProgress, casualtyRotation } from './casualties.js';

export function syncSoldierModelPose(actor, now = actor.deathTime) {
  if (!actor?.model || !actor.position || !Number.isFinite(actor.position.x) || !Number.isFinite(actor.position.y) ||
    !Number.isFinite(actor.position.z) || !Number.isFinite(actor.heading) || !Number.isFinite(actor.walkPhase) ||
    typeof actor.walkPoseReady !== 'boolean') throw new Error('Soldier projection requires its owned position, heading and gait state');
  const model = actor.model, swing = actor.walkPoseReady ? Math.sin(actor.walkPhase) * .35 : 0;
  const legs = model.userData.legs;
  if (!Array.isArray(legs) || legs.length !== 2) throw new Error('Soldier model requires its procedural leg bindings');
  model.position.copy(actor.position);
  if (model.rotation.y !== actor.heading) model.rotation.y = actor.heading;
  if (legs[0].rotation.x !== swing) legs[0].rotation.x = swing;
  if (legs[1].rotation.x !== -swing) legs[1].rotation.x = -swing;
  const roll = actor.health <= 0 ? Math.PI / 2 : 0;
  if (model.rotation.z !== roll) model.rotation.z = roll;
  if (actor.casualty) {
    const progress = casualtyProgress(actor.casualty, now);
    model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), actor.heading).multiply(casualtyRotation(actor.casualty, progress));
    model.position.y += .20 * progress;
  }
  return model;
}

export function createSoldierRenderer(scene, camera, capacity = 330) {
  const groups = new Map(), matrix = new THREE.Matrix4(), root = new THREE.Matrix4(), projection = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  let summary = { visible: 0, near: 0, far: 0, melee: 0, batches: 0 };
  const groupFor = (friendly, detail, weapon) => {
    const key = `${friendly}-${detail}-${weapon}`;
    if (!groups.has(key)) {
      const template = soldierModel(friendly, detail, weapon);
      const parts = template.children.map(source => {
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = detail === 'near';
        mesh.receiveShadow = true; mesh.count = 0;
        mesh.name = `procedural-${weapon}`;
        scene.add(mesh);
        return mesh;
      });
      groups.set(key, { parts, sources: template.children, count: 0, capacity });
    }
    return groups.get(key);
  };
  return {
    update(actors, preset, now, controlledId = null, separateViewId = null, renderVisible = true) {
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      for (const group of groups.values()) group.count = 0;
      summary = { visible: 0, near: 0, far: 0, melee: 0, batches: 0 };
      for (const actor of actors) {
        syncSoldierModelPose(actor, now);
        actor.model.visible = !actor.vehicleId && (actor.health <= 0 || actor.id !== controlledId);
        if (actor.id === separateViewId || separateViewId instanceof Set && separateViewId.has(actor.id)) continue;
        if (!actor.model.visible) continue;
        const distance = camera.position.distanceTo(actor.model.position);
        sphere.center.copy(actor.model.position); sphere.center.y += .85;
        if (distance > 18 && !frustum.intersectsSphere(sphere)) continue;
        const detail = distance < (preset === 'low' ? 20 : 35) ? 'near' : 'far';
        const sword = actor.friendly && actor.health > 0 && actor.dadao?.equipped;
        const pose = actor.dadao?.pose;
        const phase = pose && ['windup', 'cut', 'recover'].includes(pose.phase) ? pose.phase : 'ready';
        const frame = phase === 'ready' ? 0 : Math.min(3, Math.floor(pose.progress * 3) + 1);
        const group = groupFor(actor.friendly, detail, sword ? `dadao-${phase}-${frame}` : actor.rifle?.model ?? 'rifle');
        if (group.count >= group.capacity) {
          if (actor.health > 0) throw new Error('Soldier instance capacity exceeded; no combatants were silently removed');
          group.capacity *= 2;
          for (const mesh of group.parts) {
            const matrices = new Float32Array(group.capacity * 16); matrices.set(mesh.instanceMatrix.array);
            mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
          }
        }
        if (!sword && group.parts.length !== actor.model.children.length) throw new Error('Soldier LOD hierarchy is inconsistent');
        actor.model.updateMatrix(); root.copy(actor.model.matrix);
        const sources = sword ? group.sources : actor.model.children;
        sources.forEach((source, index) => {
          const part = sword && index < 2 ? actor.model.userData.legs[index] : source;
          part.updateMatrix();
          matrix.multiplyMatrices(root, part.matrix);
          group.parts[index].setMatrixAt(group.count, matrix);
        });
        group.count++; summary.visible++; summary[detail]++;
        if (sword) summary.melee++;
      }
      for (const group of groups.values()) for (const mesh of group.parts) {
        mesh.visible = renderVisible;
        mesh.count = group.count;
        mesh.instanceMatrix.needsUpdate = true;
        if (group.count) summary.batches++;
      }
    },
    get snapshot() { return { ...summary, capacityPerSide: capacity }; },
  };
}
// ---模块结束---
