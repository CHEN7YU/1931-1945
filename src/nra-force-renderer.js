import * as THREE from 'three';
import { createNraMotion, sampleNraMotion } from './nra-motion.js';
import { createRifleState } from './rifle-action.js';
import { createNraAtlas, mergeNraPose } from './nra-atlas.js';
import { isNraSkin } from './nra-appearance.js';

export function bakeNraGeometry(mesh) {
  const geometry = mesh.geometry.clone(), source = mesh.geometry.attributes;
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), temporary = new THREE.Vector3();
  const indices = new THREE.Vector4(), weights = new THREE.Vector4();
  const palettes = mesh.isSkinnedMesh ? mesh.skeleton.bones.map((bone, index) => {
    const matrix = new THREE.Matrix4().multiplyMatrices(mesh.bindMatrixInverse, bone.matrixWorld)
      .multiply(mesh.skeleton.boneInverses[index]).multiply(mesh.bindMatrix);
    return { position: matrix, normal: new THREE.Matrix3().setFromMatrix4(matrix) };
  }) : null;
  for (let index = 0; index < source.position.count; index++) {
    if (palettes) {
      indices.fromBufferAttribute(source.skinIndex, index); weights.fromBufferAttribute(source.skinWeight, index);
      point.set(0, 0, 0); normal.set(0, 0, 0);
      for (let influence = 0; influence < 4; influence++) {
        const weight = weights.getComponent(influence);
        if (!weight) continue;
        const palette = palettes[indices.getComponent(influence)];
        point.addScaledVector(temporary.fromBufferAttribute(source.position, index).applyMatrix4(palette.position), weight);
        normal.addScaledVector(temporary.fromBufferAttribute(source.normal, index).applyMatrix3(palette.normal), weight);
      }
    } else {
      point.fromBufferAttribute(source.position, index); normal.fromBufferAttribute(source.normal, index);
    }
    geometry.attributes.position.setXYZ(index, point.x, point.y, point.z);
    normal.normalize(); geometry.attributes.normal.setXYZ(index, normal.x, normal.y, normal.z);
  }
  geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
  geometry.applyMatrix4(mesh.matrixWorld); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function createNraForceRenderer(scene, camera, template, capacity = 330) {
  const root = new THREE.Group(), matrix = new THREE.Matrix4(), orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1), euler = new THREE.Euler(), projection = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const excludedIds = new Set(), slots = [], tiers = new Map(), banks = [];
  scene.add(root);
  const profile = template.motionProfile;
  const sampleActor = { id: 'pose-bake', team: 'friendly', unitId: 'pose-bake-unit', heading: 0,
    position: new THREE.Vector3(), walkPhase: 0, health: 100, deathTime: 0, vehicleId: null,
    locomotion: { speed: 0 }, rifle: { ...createRifleState(), id: 'pose-bake:rifle' } };
  sampleActor.nativeMotion = createNraMotion(profile, sampleActor);
  template.bind(sampleActor.id);
  template.update(sampleActor, 0, null);
  const atlas = createNraAtlas(template.root);
  const phases = 6, movingModes = profile.walk ? ['walk', 'run'] : ['run'];
  for (let bank = 0; bank <= phases * movingModes.length; bank++) {
    const mode = bank === 0 ? 'idle' : movingModes[Math.floor((bank - 1) / phases)];
    sampleActor.nativeMotion.weight = bank === 0 ? 0 : 1;
    sampleActor.nativeMotion.speed = mode === 'run' ? 3.15 : mode === 'walk' ? 1.75 : 0;
    sampleActor.nativeMotion.distance = bank === 0 ? 0 : ((bank - 1) % phases) / phases *
      (mode === 'walk' ? profile.walkStrideMeters : profile.strideMeters);
    template.update(sampleActor, 0, null);
    if (template.issue) throw new Error(`Distant uniform pose is unreachable: ${template.issue}`);
    const baked = [];
    template.root.traverse(mesh => {
      if (!mesh.isMesh) return;
      baked.push({ geometry: bakeNraGeometry(mesh), material: mesh.material, skin: isNraSkin(mesh.name) });
    });
    const instance = new THREE.InstancedMesh(mergeNraPose(baked, atlas), atlas.material, capacity);
    instance.geometry.setAttribute('nraSkinTint', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
      .setUsage(THREE.DynamicDrawUsage));
    for (const part of baked) part.geometry.dispose();
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instance.count = 0;
    instance.frustumCulled = false; instance.castShadow = false; instance.receiveShadow = true;
    root.add(instance);
    const parts = [instance];
    banks.push({ parts, count: 0 });
  }
  template.bind(null);
  let summary = { assigned: 0, near: 0, far: 0, hidden: 0, culled: 0, batches: 0 };
  let focused = null, members = [];
  function slotFor(actor, budget) {
    let slot = slots.find(slot => slot.actorId === actor.id);
    if (slot) return slot;
    slot = slots.find(slot => !slot.actorId);
    if (!slot && slots.length < budget) {
      const view = template.createView(); root.add(view.root);
      slot = { actorId: null, view }; slots.push(slot);
    }
    if (!slot) throw new Error('Uniform detail allocation exceeded its explicit budget');
    slot.actorId = actor.id; slot.view.bind(actor.id);
    return slot;
  }
  return {
    root, motionProfile: profile, excludedIds,
    async prepare(renderer) {
      for (let index = 0; index < 6; index++) {
        const view = template.createView(); root.add(view.root);
        slots.push({ actorId: null, view });
      }
      await renderer.compileAsync(scene, camera);
      for (const slot of slots) slot.view.root.visible = false;
    },
    remove(actors) {
      const ids = new Set(actors.map(actor => actor.id));
      if (focused && ids.has(focused.actorId)) focused = null;
      for (const slot of slots) if (ids.has(slot.actorId)) {
        slot.actorId = null; slot.view.bind(null);
      }
    },
    update(actors, now, controlledId, preset) {
      excludedIds.clear(); tiers.clear();
      for (const bank of banks) bank.count = 0;
      summary = { assigned: 0, near: 0, far: 0, hidden: 0, culled: 0, batches: 0 };
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
      const candidates = [], visible = [], budget = preset === 'low' ? 3 : 6, limit = preset === 'low' ? 18 : 28;
      for (const actor of actors) {
        if (!actor.nativeMotion) continue;
        if (actor.team !== 'friendly') throw new Error('Enemy identity cannot use the friendly uniform renderer');
        excludedIds.add(actor.id); summary.assigned++;
        if (actor.vehicleId || (actor.health > 0 && actor.id === controlledId) || (actor.health <= 0 && now - actor.deathTime > 12)) {
          tiers.set(actor.id, 'hidden'); summary.hidden++; continue;
        }
        sphere.center.copy(actor.position); sphere.center.y += .9;
        const distance = camera.position.distanceTo(sphere.center);
        if (!frustum.intersectsSphere(sphere)) {
          tiers.set(actor.id, 'culled'); summary.culled++; continue;
        }
        visible.push(actor);
        const existing = slots.some(slot => slot.actorId === actor.id);
        if (distance <= limit + (existing ? 3 : 0)) candidates.push({ actor, priority: distance - (existing ? 2 : 0) });
      }
      candidates.sort((a, b) => a.priority - b.priority);
      const detailed = new Set(candidates.slice(0, budget).map(candidate => candidate.actor.id));
      for (const slot of slots) if (slot.actorId && !detailed.has(slot.actorId)) { slot.actorId = null; slot.view.bind(null); }
      for (const actor of visible) {
        if (detailed.has(actor.id)) {
          const view = slotFor(actor, budget).view;
          view.update(actor, now, controlledId); tiers.set(actor.id, 'skinned'); summary.near++;
          summary.batches += view.drawBatches;
        } else {
          const pose = sampleNraMotion(actor);
          const walking = profile.walk && pose.jog <= .5;
          const phase = walking ? pose.walkTime / profile.walk.duration : pose.runTime / profile.run.duration;
          const offset = profile.walk && !walking ? phases : 0;
          const index = pose.weight > .45 ? 1 + offset + Math.round(phase * phases) % phases : 0;
          const bank = banks[index];
          if (bank.count >= capacity) throw new Error('Distant uniform instance capacity exceeded');
          orientation.setFromEuler(euler.set(0, actor.heading, actor.health > 0 ? 0 : Math.PI / 2));
          scale.set(1 + (actor.avatarAppearance?.build ?? 0) * .025, 1, 1);
          matrix.compose(actor.position, orientation, scale);
          const tint = new THREE.Color(actor.avatarAppearance?.skin ?? '#ffffff');
          for (const mesh of bank.parts) {
            mesh.setMatrixAt(bank.count, matrix);
            mesh.geometry.attributes.nraSkinTint.setXYZ(bank.count, tint.r, tint.g, tint.b);
          }
          bank.count++; tiers.set(actor.id, 'instanced'); summary.far++;
        }
      }
      for (const bank of banks) for (const mesh of bank.parts) {
        mesh.count = bank.count;
        if (bank.count) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.geometry.attributes.nraSkinTint.needsUpdate = true;
          summary.batches += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
        }
      }
      const controlled = actors.find(actor => actor.id === controlledId);
      const retainedFocus = focused && slots.find(slot => slot.actorId === focused.actorId &&
        actors.some(actor => actor.id === slot.actorId && actor.health > 0));
      focused = retainedFocus?.view ?? slots.find(slot => slot.actorId && slot.actorId !== controlledId &&
        actors.some(actor => actor.id === slot.actorId && actor.unitId === controlled?.unitId && actor.health > 0))?.view ??
        slots.find(slot => slot.actorId && actors.some(actor => actor.id === slot.actorId && actor.health > 0))?.view ?? null;
      members = actors.filter(actor => actor.nativeMotion).map(actor => ({ id: actor.id, unitId: actor.unitId,
        health: actor.health, uniform: 'nra88', helmet: true, tier: tiers.get(actor.id),
        appearance: actor.avatarAppearance ? { ...actor.avatarAppearance } : null }));
      summary.detailBudget = budget;
    },
    get issue() { return slots.find(slot => slot.actorId && slot.view.issue)?.view.issue ?? null; },
    get counts() { return { ...summary, poolSize: slots.length, poseBanks: banks.length }; },
    get snapshot() { return { ...summary, poolSize: slots.length, poseBanks: banks.length, members: members.map(member => ({ ...member })),
      views: slots.filter(slot => slot.actorId).map(slot => slot.view.snapshot) }; },
    get focusedSnapshot() { return focused?.snapshot ?? null; },
  };
}
