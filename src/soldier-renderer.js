import * as THREE from 'three';
import { soldierModel } from './world.js';

export function createSoldierRenderer(scene, camera, capacity = 330) {
  const groups = new Map(), matrix = new THREE.Matrix4(), root = new THREE.Matrix4(), projection = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  let summary = { visible: 0, near: 0, far: 0, batches: 0 };
  const groupFor = (friendly, detail) => {
    const key = `${friendly}-${detail}`;
    if (!groups.has(key)) {
      const template = soldierModel(friendly, detail);
      const parts = template.children.map(source => {
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = detail === 'near';
        mesh.receiveShadow = true; mesh.count = 0;
        scene.add(mesh);
        return mesh;
      });
      groups.set(key, { parts, count: 0 });
    }
    return groups.get(key);
  };
  return {
    update(actors, preset, now) {
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      for (const group of groups.values()) group.count = 0;
      summary = { visible: 0, near: 0, far: 0, batches: 0 };
      for (const actor of actors) {
        if (actor.position) actor.model.position.copy(actor.position);
        if (actor.heading !== undefined) actor.model.rotation.y = actor.heading;
        const roll = actor.health <= 0 ? Math.PI / 2 : 0;
        if (actor.model.rotation.z !== roll) actor.model.rotation.z = roll;
        if (actor.health <= 0) actor.model.visible = !actor.vehicleId && now - actor.deathTime <= 12;
        if (!actor.model.visible || (actor.health <= 0 && now - actor.deathTime > 12)) continue;
        const distance = camera.position.distanceTo(actor.model.position);
        sphere.center.copy(actor.model.position); sphere.center.y += .85;
        if (distance > 18 && !frustum.intersectsSphere(sphere)) continue;
        const detail = distance < (preset === 'low' ? 20 : 35) ? 'near' : 'far';
        const group = groupFor(actor.friendly, detail);
        if (group.count >= capacity) throw new Error('Soldier instance capacity exceeded; no combatants were silently removed');
        if (group.parts.length !== actor.model.children.length) throw new Error('Soldier LOD hierarchy is inconsistent');
        actor.model.updateMatrix(); root.copy(actor.model.matrix);
        actor.model.children.forEach((part, index) => {
          part.updateMatrix();
          matrix.multiplyMatrices(root, part.matrix);
          group.parts[index].setMatrixAt(group.count, matrix);
        });
        group.count++; summary.visible++; summary[detail]++;
      }
      for (const group of groups.values()) for (const mesh of group.parts) {
        mesh.count = group.count;
        mesh.instanceMatrix.needsUpdate = true;
        if (group.count) summary.batches++;
      }
    },
    get snapshot() { return { ...summary, capacityPerSide: capacity }; },
  };
}
// ---模块结束---
