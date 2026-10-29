import * as THREE from 'three';
import { createNraMotion, sampleNraMotion, syncNativeAimGoal, nativeGaitParameters, nativeTravelLean } from './nra-motion.js';
import { createRifleState } from './rifle-action.js';
import { createNraAtlas, mergeNraPose } from './nra-atlas.js';
import { isNraSkin } from './nra-appearance.js';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rifleWorldModel } from './rifle-model.js';
import { CORPSE_RULES, createCasualtyState, corpseFootprint } from './casualties.js';

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

export function createNraForceRenderer(scene, camera, template, capacity = 330, { team = 'friendly', uniform = 'nra88' } = {}) {
  if (!['friendly', 'enemy'].includes(team)) throw new Error('Uniform renderer requires an explicit combatant team');
  const root = new THREE.Group(), matrix = new THREE.Matrix4(), orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1), euler = new THREE.Euler(), projection = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const excludedIds = new Set(), slots = [], tiers = new Map(), banks = [], weaponGroups = new Map();
  const weaponMatrix = new THREE.Matrix4();
  function weaponGroupFor(key) {
    if (!weaponGroups.has(key)) {
      const gun = rifleWorldModel('far', createRifleState(key)), batches = new Map();
      gun.updateMatrixWorld(true);
      gun.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        if (!batches.has(mesh.material)) batches.set(mesh.material, []);
        batches.get(mesh.material).push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      });
      const parts = [...batches].map(([material, geometries]) => {
        const mesh = new THREE.InstancedMesh(mergeGeometries(geometries), material, capacity);
        mesh.name = `owned-weapon-${key}`;
        geometries.forEach(geometry => geometry.dispose());
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
        mesh.frustumCulled = false; root.add(mesh); return mesh;
      });
      weaponGroups.set(key, { parts, count: 0, capacity });
    }
    return weaponGroups.get(key);
  }
  scene.add(root);
  const profile = template.motionProfile;
  const sampleActor = { id: 'pose-bake', team, unitId: 'pose-bake-unit', heading: 0,
    position: new THREE.Vector3(), walkPhase: 0, health: 100, deathTime: 0, vehicleId: null,
    locomotion: { speed: 0 }, rifle: { ...createRifleState(), id: 'pose-bake:rifle' } };
  sampleActor.nativeMotion = createNraMotion(profile, sampleActor);
  const bankTemplate = template.createFarView?.() ?? template;
  bankTemplate.bind(sampleActor.id);
  bankTemplate.update(sampleActor, 0, null);
  const optionalAttachments = bankTemplate.optionalAttachments ?? [];
  for (const attachment of optionalAttachments) attachment.mesh.visible = false;
  const atlas = createNraAtlas(bankTemplate.root, bankTemplate.uniformMaterials);
  const phases = 6;
  const movingModes = profile.footCycleGait ? ['walk', 'short', 'charge', 'aim'] : profile.walk ? ['walk', 'run'] : ['run'];
  const movingBanks = 1 + phases * movingModes.length, postures = Object.keys(FIRING_POSES).filter(stance => profile[stance]);
  const baseBanks = movingBanks + postures.length, readyBanks = profile.lowReadyCarry ? 1 + postures.length : 0;
  const livingBanks = baseBanks + readyBanks, deathBanks = profile.footCycleGait ? CORPSE_RULES.variants * 2 : 0;
  for (let bank = 0; bank < livingBanks + deathBanks; bank++) {
    const dead = bank >= livingBanks;
    const firingBank = !dead && bank >= baseBanks;
    const posture = dead ? null : firingBank ? postures[bank - baseBanks - 1] ?? null : bank >= movingBanks ? postures[bank - movingBanks] : null;
    const mode = bank === 0 || posture || firingBank || dead ? 'idle' : movingModes[Math.floor((bank - 1) / phases)];
    const ready = firingBank || mode === 'aim';
    sampleActor.rifleReady = ready;
    if (profile.lowReadyCarry) sampleActor.nativeMotion.lowReady = ready ? 0 : 1;
    sampleActor.nativeMotion.cheekWeight = profile.headAim && ready ? 1 : 0;
    sampleActor.nativeMotion.posture = Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, pose === posture ? 1 : 0]));
    sampleActor.nativeMotion.weight = mode === 'idle' ? 0 : 1;
    sampleActor.nativeMotion.speed = mode === 'charge' ? 4.8 : ['short', 'run'].includes(mode) ? 3.15 : mode === 'walk' ? 1.75 : mode === 'aim' ? 1.1 : 0;
    sampleActor.nativeMotion.gaitCharge = mode === 'charge' ? 1 : 0;
    sampleActor.nativeMotion.gaitAim = mode === 'aim' ? 1 : 0;
    sampleActor.nativeMotion.aim = mode === 'aim' ? 1 : 0;
    sampleActor.nativeMotion.bodyLean = mode === 'idle' ? 0 : nativeTravelLean(sampleActor.nativeMotion);
    const gait = profile.footCycleGait ? nativeGaitParameters(sampleActor.nativeMotion) : null;
    sampleActor.nativeMotion.distance = mode === 'idle' ? 0 : ((bank - 1) % phases) / phases *
      (gait ? gait.walkStride + (gait.runStride - gait.walkStride) * gait.jog : mode === 'walk' ? profile.walkStrideMeters : profile.strideMeters);
    syncNativeAimGoal(sampleActor);
    sampleActor.health = dead ? 0 : 100;
    sampleActor.casualty = dead ? createCasualtyState(sampleActor, 0, sampleNraMotion(sampleActor),
      { variant: Math.floor((bank - livingBanks) / 2), retainGun: (bank - livingBanks) % 2 === 1 }) : null;
    bankTemplate.update(sampleActor, dead ? 2 : 0, null);
    for (const attachment of optionalAttachments) attachment.mesh.visible = false;
    if (bankTemplate.issue) throw new Error(`Distant uniform pose is unreachable: ${bankTemplate.issue}`);
    const baked = [];
    let gunMatrix = null;
    bankTemplate.root.traverse(mesh => {
      if (mesh.userData.personalWeapon) gunMatrix = mesh.matrixWorld.clone();
    });
    bankTemplate.root.traverseVisible(mesh => {
      if (!mesh.isMesh) return;
      for (let parent = mesh.parent; parent; parent = parent.parent) if (parent.userData.personalWeapon) return;
      baked.push({ geometry: bakeNraGeometry(mesh), material: mesh.material, skin: isNraSkin(mesh.name) || mesh.userData.skinRegion === true });
    });
    if (!gunMatrix) throw new Error('Distant uniform pose lacks its owned weapon transform');
    const instance = new THREE.InstancedMesh(mergeNraPose(baked, atlas), atlas.material, capacity);
    instance.geometry.setAttribute('nraSkinTint', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
      .setUsage(THREE.DynamicDrawUsage));
    if (atlas.hasUniformVariants) instance.geometry.setAttribute('nraUniformVariant',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    for (const part of baked) part.geometry.dispose();
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instance.count = 0;
    instance.frustumCulled = false; instance.castShadow = false; instance.receiveShadow = true;
    root.add(instance);
    const parts = [instance];
    const attachments = optionalAttachments.map(({ mesh, enabled, bake }) => {
      const geometry = bakeNraGeometry(mesh);
      const instance = new THREE.InstancedMesh(bake ? bake(geometry, mesh) : geometry, mesh.material, capacity);
      instance.customDepthMaterial = mesh.customDepthMaterial; instance.customDistanceMaterial = mesh.customDistanceMaterial;
      instance.name = mesh.name;
      instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instance.count = 0;
      instance.frustumCulled = false; instance.receiveShadow = true; root.add(instance);
      return { mesh: instance, enabled, count: 0 };
    });
    instance.geometry.computeBoundingBox();
    banks.push({ parts, count: 0, capacity, attachments, gunMatrix, bounds: instance.geometry.boundingBox.clone(),
      footprint: dead ? corpseFootprint(instance.geometry) : null });
  }
  bankTemplate.bind(null);
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
    casualtyBounds(variant, retainGun) {
      const bounds = banks[livingBanks + variant * 2 + Number(retainGun)]?.bounds;
      if (!bounds) throw new RangeError('Casualty bank does not exist');
      return { min: bounds.min.toArray(), max: bounds.max.toArray(),
        footprint: banks[livingBanks + variant * 2 + Number(retainGun)].footprint };
    },
    createGrenadeHand: template.createGrenadeHand,
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
      for (const attachment of optionalAttachments) attachment.update?.(now);
      excludedIds.clear(); tiers.clear();
      for (const group of weaponGroups.values()) group.count = 0;
      for (const bank of banks) {
        bank.count = 0;
        for (const attachment of bank.attachments) attachment.count = 0;
      }
      summary = { assigned: 0, near: 0, far: 0, hidden: 0, culled: 0, batches: 0 };
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
      const candidates = [], visible = [], budget = preset === 'low' ? 3 : 6, limit = preset === 'low' ? 18 : 28;
      for (const actor of actors) {
        if (!actor.nativeMotion) continue;
        if (actor.team !== team) throw new Error(`A ${actor.team} identity cannot use the ${team} uniform renderer`);
        excludedIds.add(actor.id); summary.assigned++;
        if (actor.vehicleId || (actor.health > 0 && actor.id === controlledId)) {
          tiers.set(actor.id, 'hidden'); summary.hidden++; continue;
        }
        sphere.center.copy(actor.position); sphere.center.y += .9;
        const distance = camera.position.distanceTo(sphere.center);
        if (!frustum.intersectsSphere(sphere)) {
          tiers.set(actor.id, 'culled'); summary.culled++; continue;
        }
        visible.push(actor);
        const existing = slots.some(slot => slot.actorId === actor.id);
        if (distance <= limit + (existing ? 3 : 0)) candidates.push({ actor, priority: distance - (existing ? 2 : 0) + (actor.health <= 0 ? 6 : 0) });
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
          const pose = sampleNraMotion(actor, false);
          const walking = profile.walk && pose.jog <= .5;
          const phase = walking ? pose.walkTime / profile.walk.duration : pose.runTime / profile.run.duration;
          const offset = profile.footCycleGait ? movingModes.indexOf(pose.travelStyle) * phases : walking ? 0 : profile.walk ? phases : 0;
          const posture = postures.find(name => pose[name] > .5);
          const raised = profile.lowReadyCarry && actor.nativeMotion.lowReady < .5;
          const index = actor.casualty?.wallLimited ? 0 : actor.health <= 0 && actor.casualty && deathBanks
            ? livingBanks + actor.casualty.variant * 2 + Number(actor.casualty.retainGun)
            : posture && postures.includes(posture)
            ? raised ? baseBanks + 1 + postures.indexOf(posture) : movingBanks + postures.indexOf(posture)
            : pose.weight > .45 ? 1 + offset + Math.round(phase * phases) % phases : raised ? baseBanks : 0;
          const bank = banks[index];
          if (bank.count >= bank.capacity) {
            if (index < livingBanks) throw new Error('Distant uniform instance capacity exceeded');
            bank.capacity *= 2;
            for (const mesh of bank.parts) {
              const matrices = new Float32Array(bank.capacity * 16); matrices.set(mesh.instanceMatrix.array);
              mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
              const colors = new Float32Array(bank.capacity * 3); colors.set(mesh.geometry.attributes.nraSkinTint.array);
              mesh.geometry.setAttribute('nraSkinTint', new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
              if (mesh.geometry.attributes.nraUniformVariant) {
                const variants = new Float32Array(bank.capacity); variants.set(mesh.geometry.attributes.nraUniformVariant.array);
                mesh.geometry.setAttribute('nraUniformVariant', new THREE.InstancedBufferAttribute(variants, 1).setUsage(THREE.DynamicDrawUsage));
              }
            }
            for (const attachment of bank.attachments) {
              const matrices = new Float32Array(bank.capacity * 16); matrices.set(attachment.mesh.instanceMatrix.array);
              attachment.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
            }
          }
          orientation.setFromEuler(euler.set(0, actor.heading + (actor.casualty?.yaw ?? 0), actor.health > 0 || actor.casualty ? 0 : Math.PI / 2));
          scale.set(1 + (actor.avatarAppearance?.build ?? 0) * .025, 1, 1);
          matrix.compose(actor.position, orientation, scale);
          if (actor.casualty?.offset) {
            matrix.elements[12] += actor.casualty.offset.x; matrix.elements[14] += actor.casualty.offset.z;
          }
          const weapons = weaponGroupFor(actor.rifle.model ?? 'rifle');
          if (weapons.count >= weapons.capacity) {
            if (actor.health > 0) throw new Error('Distant weapon instance capacity exceeded');
            weapons.capacity *= 2;
            for (const mesh of weapons.parts) {
              const matrices = new Float32Array(weapons.capacity * 16); matrices.set(mesh.instanceMatrix.array);
              mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
            }
          }
          weaponMatrix.multiplyMatrices(matrix, bank.gunMatrix);
          for (const mesh of weapons.parts) mesh.setMatrixAt(weapons.count, weaponMatrix);
          weapons.count++;
          const tint = new THREE.Color(actor.avatarAppearance?.skin ?? '#ffffff');
          for (const mesh of bank.parts) {
            mesh.setMatrixAt(bank.count, matrix);
            mesh.geometry.attributes.nraSkinTint.setXYZ(bank.count, tint.r, tint.g, tint.b);
            mesh.geometry.attributes.nraUniformVariant?.setX(bank.count, actor.avatarAppearance?.uniform === 'B' ? 1 : 0);
          }
          for (const attachment of bank.attachments) if (attachment.enabled(actor)) {
            attachment.mesh.setMatrixAt(attachment.count++, matrix);
          }
          bank.count++; tiers.set(actor.id, 'instanced'); summary.far++;
        }
      }
      for (const bank of banks) for (const mesh of bank.parts) {
        mesh.count = bank.count;
        if (bank.count) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.geometry.attributes.nraSkinTint.needsUpdate = true;
          if (mesh.geometry.attributes.nraUniformVariant) mesh.geometry.attributes.nraUniformVariant.needsUpdate = true;
          summary.batches += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
        }
      }
      for (const group of weaponGroups.values()) for (const mesh of group.parts) {
        mesh.count = group.count;
        if (group.count) { mesh.instanceMatrix.needsUpdate = true; summary.batches++; }
      }
      for (const bank of banks) for (const attachment of bank.attachments) {
        attachment.mesh.count = attachment.count;
        if (attachment.count) { attachment.mesh.instanceMatrix.needsUpdate = true; summary.batches++; }
      }
      const controlled = actors.find(actor => actor.id === controlledId);
      const retainedFocus = focused && slots.find(slot => slot.actorId === focused.actorId &&
        actors.some(actor => actor.id === slot.actorId && actor.health > 0));
      focused = retainedFocus?.view ?? slots.find(slot => slot.actorId && slot.actorId !== controlledId &&
        actors.some(actor => actor.id === slot.actorId && actor.unitId === controlled?.unitId && actor.health > 0))?.view ??
        slots.find(slot => slot.actorId && actors.some(actor => actor.id === slot.actorId && actor.health > 0))?.view ?? null;
      members = actors.filter(actor => actor.nativeMotion).map(actor => ({ id: actor.id, unitId: actor.unitId,
        health: actor.health, weaponModel: actor.rifle.model ?? 'rifle', stance: actor.stance ?? 'standing', firingPose: ownedFiringPose(actor), uniform,
        uniformVariant: actor.avatarAppearance?.uniform ?? null, helmet: true, tier: tiers.get(actor.id),
        motionSpeed: actor.nativeMotion.speed, motionWeight: actor.nativeMotion.weight,
        travelStyle: actor.casualty?.motion?.travelStyle ?? (profile.footCycleGait
          ? nativeGaitParameters(actor.nativeMotion).style : actor.nativeMotion.speed > 2.55 ? 'run' : 'walk'),
        casualty: actor.casualty ? { variant: actor.casualty.variant, retainGun: actor.casualty.retainGun, time: actor.casualty.time } : null,
        appearance: actor.avatarAppearance ? { ...actor.avatarAppearance } : null }));
      summary.detailBudget = budget;
    },
    sampleAnatomy(actor, now) {
      if (typeof template.sampleAnatomy !== 'function') throw new Error('Character factory lacks an anatomical pose sampler');
      return template.sampleAnatomy(actor, now);
    },
    get issue() { return slots.find(slot => slot.actorId && slot.view.issue)?.view.issue ?? null; },
    get counts() { return { ...summary, poolSize: slots.length, poseBanks: banks.length }; },
    get snapshot() { return { ...summary, poolSize: slots.length, poseBanks: banks.length, members: members.map(member => ({ ...member })),
      views: slots.filter(slot => slot.actorId).map(slot => slot.view.snapshot) }; },
    get focusedSnapshot() { return focused?.snapshot ?? null; },
  };
}
