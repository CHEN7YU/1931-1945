import * as THREE from 'three';
import { createNraMotion, sampleNraMotion, sampleNraPhase, syncNativeAimGoal, nativeGaitParameters, nativeTravelLean, nativePoseIntent, nativeGaitDrop } from './nra-motion.js';
import { createRifleState } from './rifle-action.js';
import { createNraAtlas, mergeNraPoseWork } from './nra-atlas.js';
import { isNraSkin } from './nra-appearance.js';
import { FIRING_POSES, ownedFiringPose } from './combat-posture.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rifleWorldModel } from './rifle-model.js';
import { CORPSE_RULES, CASUALTY_POSE_FRAMES, createCasualtyState, corpseFootprint, casualtyProgress } from './casualties.js';
import { hasBayonet } from './bayonet.js';
import { createDistantPoseGeometry, createDistantWeaponGeometry, DISTANT_WEAPON_TRIANGLE_BUDGET, useDistantPose } from './distant-pose-lod.js';
import { createDadaoState } from './dadao.js';
import { dadaoModel } from './dadao-model.js';
import { RIFLE_HAND_SAMPLES, rifleHandAction, rifleHandWeights } from './rifle-hand-action.js';
import { finishStartupWork, runStartupWork, yieldStartupTask } from './startup-work.js';
import { SIHANG_SHIELD_BANKS, sihangShieldPoseIndex, sihangShieldInstalling, sihangShieldWalkWeights } from './sihang-shield-pose.js';
import { isNativeOfficer, nativeOfficerRegions } from './officer-appearance.js';
import { nativeDischargerPresentation } from './native-weapon-presentation.js';

export function bakeNraGeometry(mesh) {
  return finishStartupWork(bakeNraGeometryWork(mesh));
}

function* bakeNraGeometryWork(mesh) {
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
    if ((index + 1) % 512 === 0) yield;
  }
  geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
  geometry.setAttribute('nativeOfficerRegion', mesh.userData.officerTeam
    ? nativeOfficerRegions(mesh, mesh.userData.officerTeam).clone()
    : new THREE.Float32BufferAttribute(new Float32Array(source.position.count), 1));
  geometry.applyMatrix4(mesh.matrixWorld); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function settledNraGeometry(source, finalFrame = false) {
  const geometry = new THREE.BufferGeometry();
  if (source.index) geometry.setIndex(source.index.clone());
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const selected = finalFrame && ['position', 'normal'].includes(name)
      ? source.morphAttributes[name]?.at(-1) : attribute;
    if (!selected) throw new Error(`Settled casualty pose lacks ${name}`);
    geometry.setAttribute(name, selected.clone());
  }
  geometry.groups = source.groups.map(group => ({ ...group }));
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  if (finalFrame) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return geometry;
}

export function createNraForceRenderer(scene, camera, template, capacity = 330, { team = 'friendly', uniform = 'nra88' } = {}) {
  return finishStartupWork(createNraForceRendererWork(scene, camera, template, capacity, { team, uniform }));
}

export function createNraForceRendererAsync(scene, camera, template, capacity = 330,
  { team = 'friendly', uniform = 'nra88', onProgress } = {}) {
  return runStartupWork(createNraForceRendererWork(scene, camera, template, capacity, { team, uniform }), { onProgress });
}

function* createNraForceRendererWork(scene, camera, template, capacity, { team, uniform }) {
  if (!['friendly', 'enemy'].includes(team)) throw new Error('Uniform renderer requires an explicit combatant team');
  const root = new THREE.Group(), matrix = new THREE.Matrix4(), orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1), euler = new THREE.Euler(), projection = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const excludedIds = new Set(), slots = [], tiers = new Map(), banks = [], weaponGroups = new Map();
  const weaponMatrix = new THREE.Matrix4(), aimPitchRotation = new THREE.Matrix4();
  let coarseIds = new Set(), lodReady = false;
  const poseLod = { preparationMs: 0, sourceTriangles: 0, triangles: 0, sourceBytes: 0, bytes: 0, maxError: 0 };
  const weaponLod = { preparationMs: 0, sourceTriangles: 0, triangles: 0, sourceBytes: 0, bytes: 0, maxError: 0 };
  const geometryBytes = geometry => (geometry.index?.array.byteLength ?? 0) + Object.values(geometry.attributes)
    .filter(attribute => !attribute.isInstancedBufferAttribute).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) +
    Object.values(geometry.morphAttributes).flat().reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
  function weaponGroupFor(key, coarse = false) {
    const groupKey = coarse ? `${key}:coarse` : key;
    if (!weaponGroups.has(groupKey) && coarse) {
      const original = weaponGroupFor(key);
      if (original.triangles <= DISTANT_WEAPON_TRIANGLE_BUDGET) return original;
      const started = performance.now();
      const parts = original.parts.map(source => {
        const geometry = createDistantWeaponGeometry(source.geometry);
        const stats = geometry.userData.distantWeaponLod;
        weaponLod.sourceTriangles += stats.sourceTriangles; weaponLod.triangles += stats.triangles;
        weaponLod.sourceBytes += geometryBytes(source.geometry); weaponLod.bytes += geometryBytes(geometry);
        weaponLod.maxError = Math.max(weaponLod.maxError, stats.error);
        const mesh = new THREE.InstancedMesh(geometry, source.material, capacity);
        mesh.name = `owned-weapon-${key}`; mesh.userData.geometryLod = 'coarse';
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
        mesh.frustumCulled = false; root.add(mesh); return mesh;
      });
      weaponLod.preparationMs += performance.now() - started;
      weaponGroups.set(groupKey, { parts, count: 0, capacity,
        triangles: parts.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0),
        sourceTriangles: original.triangles, coarse: true });
    } else if (!weaponGroups.has(groupKey)) {
      const gun = key === 'dadao' ? dadaoModel()
        : rifleWorldModel('far', createRifleState(key), { bayonet: team === 'enemy' && key === 'rifle' });
      const batches = new Map();
      gun.updateMatrixWorld(true);
      gun.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        if (!batches.has(mesh.material)) batches.set(mesh.material, []);
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        batches.get(mesh.material).push(geometry.index ? geometry.toNonIndexed() : geometry);
        if (geometry.index) geometry.dispose();
      });
      const parts = [...batches].map(([material, geometries]) => {
        const mesh = new THREE.InstancedMesh(mergeGeometries(geometries), material, capacity);
        mesh.name = `owned-weapon-${key}`;
        mesh.userData.geometryLod = 'original';
        geometries.forEach(geometry => geometry.dispose());
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
        mesh.frustumCulled = false; root.add(mesh); return mesh;
      });
      const triangles = parts.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
      weaponGroups.set(groupKey, { parts, count: 0, capacity, triangles, sourceTriangles: triangles });
    }
    return weaponGroups.get(groupKey);
  }
  scene.add(root);
  const profile = template.motionProfile;
  const sampleActor = { id: 'pose-bake', team, unitId: 'pose-bake-unit', heading: 0,
    position: new THREE.Vector3(), walkPhase: 0, health: 100, deathTime: 0, vehicleId: null,
    groundType: 'infantry', locomotion: { speed: 0 }, rifle: { ...createRifleState(), id: 'pose-bake:rifle' } };
  sampleActor.nativeMotion = createNraMotion(profile, sampleActor);
  const bankTemplate = template.createFarView?.() ?? template;
  bankTemplate.bind(sampleActor.id);
  bankTemplate.update(sampleActor, 0, null);
  const optionalAttachments = bankTemplate.optionalAttachments ?? [];
  for (const attachment of optionalAttachments) attachment.mesh.visible = false;
  const atlas = createNraAtlas(bankTemplate.root, bankTemplate.uniformMaterials, template.officerAppearance ? team : null);
  const phases = 6;
  const movingModes = profile.footCycleGait ? ['walk', 'short', 'charge', 'aim'] : profile.walk ? ['walk', 'run'] : ['run'];
  const movingBanks = 1 + phases * movingModes.length, postures = Object.keys(FIRING_POSES).filter(stance => profile[stance]);
  const baseBanks = movingBanks + postures.length, readyBanks = profile.lowReadyCarry ? 1 + postures.length : 0;
  const meleeStart = baseBanks + readyBanks, meleeBanks = team === 'enemy' ? phases + 3 : phases + 10;
  const turnStart = meleeStart + meleeBanks, turnBanks = profile.footCycleGait ? phases * 2 : 0;
  const closeStart = turnStart + turnBanks, closeBanks = team === 'enemy' ? 1 + postures.length : 0;
  const actionStart = closeStart + closeBanks;
  const actionStances = ['standing', 'crouched', 'prone'].filter(stance => stance === 'standing' || postures.includes(stance));
  const livingBanks = actionStart + actionStances.length, deathKinds = CORPSE_RULES.variants * 2;
  const deathStances = ['standing', ...['kneeling', 'prone'].filter(stance => postures.includes(stance))];
  const deathBanks = profile.footCycleGait ? deathKinds * deathStances.length : 0;
  const shieldStart = livingBanks + deathBanks;
  const shieldBanks = team === 'enemy' && uniform === 'ija1938' && template.sihangShieldPoses ? SIHANG_SHIELD_BANKS.length : 0;
  for (let bank = 0; bank < shieldStart + shieldBanks; bank++) {
    const shield = bank >= shieldStart;
    const shieldWalk = shield && bank - shieldStart < 2 && profile.footCycleGait;
    const dead = !shield && bank >= livingBanks;
    const rifleAction = !shield && !dead && bank >= actionStart;
    const deathStance = dead ? deathStances[Math.floor((bank - livingBanks) / deathKinds)] : null;
    const closing = !shield && !dead && !rifleAction && bank >= closeStart;
    const turning = !shield && !dead && !rifleAction && !closing && bank >= turnStart;
    const melee = !shield && !dead && !rifleAction && !closing && !turning && bank >= meleeStart;
    const firingBank = !shield && !dead && !rifleAction && !closing && !melee && !turning && bank >= baseBanks;
    const posture = shield ? null : rifleAction ? actionStances[bank - actionStart] === 'standing' ? null : actionStances[bank - actionStart]
      : dead && deathStance !== 'standing' ? deathStance : closing ? postures[bank - closeStart - 1] ?? null
      : dead || melee || turning ? null : firingBank ? postures[bank - baseBanks - 1] ?? null : bank >= movingBanks ? postures[bank - movingBanks] : null;
    const mode = turning ? 'idle' : melee ? bank < meleeStart + phases ? 'charge' : 'idle'
      : bank === 0 || posture || firingBank || closing || dead || rifleAction || shield ? 'idle' : movingModes[Math.floor((bank - 1) / phases)];
    if (shield) sampleActor.sihangShield = SIHANG_SHIELD_BANKS[bank - shieldStart];
    sampleActor.weaponBlocked = closing;
    sampleActor.bayonet = melee && team === 'enemy' ? { mode: mode === 'charge' ? 'charge' : 'thrust',
      extension: mode === 'charge' ? 0 : (bank - meleeStart - phases) / 2 } : null;
    const swordFrame = bank - meleeStart - phases;
    sampleActor.dadao = melee && team === 'friendly' ? { ...createDadaoState(), equipped: true,
      mode: mode === 'charge' ? 'charge' : 'cut',
      pose: mode === 'charge' || swordFrame === 0 ? { phase: 'ready', progress: 0 }
        : { phase: swordFrame <= 3 ? 'windup' : swordFrame <= 6 ? 'cut' : 'recover',
          progress: ((swordFrame - 1) % 3 + 1) / 3 } } : null;
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
    sampleActor.nativeMotion.turn = { heading: 0, weight: turning ? 1 : 0,
      angle: turning ? ((bank - turnStart) % phases) / phases * Math.PI / 3 : 0,
      direction: bank - turnStart < phases ? -1 : 1 };
    sampleActor.nativeMotion.bodyLean = mode === 'idle' ? 0 : nativeTravelLean(sampleActor.nativeMotion);
    const gait = profile.footCycleGait ? nativeGaitParameters(sampleActor.nativeMotion) : null;
    sampleActor.nativeMotion.distance = mode === 'idle' ? 0 : ((melee ? bank - meleeStart : bank - 1) % phases) / phases *
      (gait ? gait.walkStride + (gait.runStride - gait.walkStride) * gait.jog : mode === 'walk' ? profile.walkStrideMeters : profile.strideMeters);
    syncNativeAimGoal(sampleActor);
    sampleActor.health = dead ? 0 : 100;
    sampleActor.casualty = dead ? createCasualtyState(sampleActor, 0, sampleNraMotion(sampleActor),
      { variant: Math.floor(((bank - livingBanks) % deathKinds) / 2), retainGun: (bank - livingBanks) % 2 === 1 }) : null;
    const postureMorph = !dead && !rifleAction && posture === 'prone';
    const poses = [], casualtyWeapons = [], attachmentFrames = new Map();
    for (let frame = 0; frame < (shieldWalk ? 3 : rifleAction ? RIFLE_HAND_SAMPLES.length : dead ? CASUALTY_POSE_FRAMES : postureMorph ? 3 : 1); frame++) {
      if (shieldWalk) {
        sampleActor.nativeMotion.weight = frame === 0 ? 0 : 1;
        sampleActor.nativeMotion.speed = frame === 0 ? 0 : 1.75;
        sampleActor.nativeMotion.gaitCycles = frame === 2 ? .75 : .25;
        sampleActor.nativeMotion.phaseDistance = sampleActor.nativeMotion.distance;
        if (sampleActor.sihangShield.mode === 'roof') sampleActor.sihangShield = {
          ...SIHANG_SHIELD_BANKS[bank - shieldStart], handTarget: [-.3, 1.88 - nativeGaitDrop(sampleActor), 0],
        };
        syncNativeAimGoal(sampleActor);
      }
      if (postureMorph) {
        const sampled = ['prone', 'standing', profile.kneeling ? 'kneeling' : 'crouched'][frame];
        for (const pose of Object.keys(sampleActor.nativeMotion.posture))
          sampleActor.nativeMotion.posture[pose] = Number(pose === sampled);
        syncNativeAimGoal(sampleActor);
      }
      bankTemplate.update(sampleActor, dead ? frame / (CASUALTY_POSE_FRAMES - 1) * sampleActor.casualty.duration : 0, null,
        rifleAction ? RIFLE_HAND_SAMPLES[frame] : undefined);
      bankTemplate.root.updateMatrixWorld(true);
      for (const attachment of optionalAttachments) if (attachment.poseFollowing) {
        if (!attachmentFrames.has(attachment)) attachmentFrames.set(attachment, []);
        attachmentFrames.get(attachment).push(yield* bakeNraGeometryWork(attachment.mesh));
      }
      for (const attachment of optionalAttachments) attachment.mesh.visible = false;
      if (bankTemplate.issue) throw new Error(`Distant ${uniform} pose ${bank} (${mode}) is unreachable: ${bankTemplate.issue}`);
      const baked = [];
      let gunMatrix = null;
      bankTemplate.root.traverse(mesh => {
        if (mesh.userData.personalWeapon) gunMatrix = mesh.matrixWorld.clone();
      });
      const meshes = [];
      bankTemplate.root.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        for (let parent = mesh.parent; parent; parent = parent.parent) if (parent.userData.personalWeapon) {
          if (dead) casualtyWeapons.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
          return;
        }
        meshes.push(mesh);
      });
      for (const mesh of meshes) {
        baked.push({ geometry: yield* bakeNraGeometryWork(mesh), material: mesh.material,
          skin: isNraSkin(mesh.name) || mesh.userData.skinRegion === true });
      }
      if (!gunMatrix) throw new Error('Distant uniform pose lacks its owned weapon transform');
      const geometry = yield* mergeNraPoseWork(baked, atlas, { weld: !dead && !postureMorph && !rifleAction && !shieldWalk });
      for (const part of baked) part.geometry.dispose();
      poses.push({ geometry, gunMatrix });
      yield;
    }
    if (postureMorph) {
      for (const pose of Object.keys(sampleActor.nativeMotion.posture))
        sampleActor.nativeMotion.posture[pose] = Number(pose === 'prone');
      syncNativeAimGoal(sampleActor);
      bankTemplate.update(sampleActor, 0, null);
    }
    const geometry = poses[0].geometry, gunMatrix = (postureMorph ? poses[0] : poses.at(-1)).gunMatrix;
    if (dead || postureMorph || rifleAction || shieldWalk) {
      for (const pose of poses) if (pose.geometry.attributes.position.count !== geometry.attributes.position.count)
        throw new Error('Casualty morph poses must preserve their source vertex topology');
      geometry.morphAttributes.position = poses.slice(1).map(pose => pose.geometry.attributes.position);
      geometry.morphAttributes.normal = poses.slice(1).map(pose => pose.geometry.attributes.normal);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
    const instance = new THREE.InstancedMesh(geometry, atlas.material, capacity);
    if (dead || postureMorph || rifleAction || shieldWalk) instance.setMorphAt(0, { morphTargetInfluences: Array(poses.length - 1).fill(0) });
    instance.geometry.setAttribute('nraSkinTint', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
      .setUsage(THREE.DynamicDrawUsage));
    if (atlas.hasUniformVariants) instance.geometry.setAttribute('nraUniformVariant',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    if (template.officerAppearance) instance.geometry.setAttribute('nativeOfficer',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instance.count = 0;
    instance.frustumCulled = false; instance.castShadow = false; instance.receiveShadow = true;
    root.add(instance);
    const parts = [instance];
    const attachments = [];
    for (const attachment of optionalAttachments) {
      const { mesh, enabled, bake, includeBank, poseFollowing } = attachment;
      if (includeBank && !includeBank(sampleActor)) continue;
      const frames = attachmentFrames.get(attachment);
      const geometry = frames?.[0] ?? (yield* bakeNraGeometryWork(mesh));
      if (frames?.length > 1) {
        geometry.morphAttributes.position = frames.slice(1).map(frame => frame.attributes.position);
        geometry.morphAttributes.normal = frames.slice(1).map(frame => frame.attributes.normal);
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      }
      const instance = new THREE.InstancedMesh(bake ? bake(geometry, mesh) : geometry, mesh.material, capacity);
      if (frames?.length > 1) instance.setMorphAt(0, { morphTargetInfluences: Array(frames.length - 1).fill(0) });
      instance.customDepthMaterial = mesh.customDepthMaterial; instance.customDistanceMaterial = mesh.customDistanceMaterial;
      instance.name = mesh.name;
      instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instance.count = 0;
      instance.frustumCulled = false; instance.receiveShadow = true; root.add(instance);
      attachments.push({ mesh: instance, enabled, count: 0, poseFollowing });
      for (const frame of frames?.slice(1) ?? []) frame.dispose();
    }
    instance.geometry.computeBoundingBox();
    const bounds = instance.geometry.boundingBox.clone();
    const footprint = dead ? [] : null;
    if (dead) for (const pose of poses) {
      footprint.push(...corpseFootprint(pose.geometry));
      yield;
    }
    for (const geometry of casualtyWeapons) {
      geometry.computeBoundingBox(); bounds.union(geometry.boundingBox);
      footprint.push(...corpseFootprint(geometry)); geometry.dispose();
    }
    banks.push({ parts, coarseParts: [], coarseCount: 0, count: 0, capacity, attachments, gunMatrix, deathStance, postureMorph, rifleAction, shieldWalk, bounds,
      gunFrames: poses.map(pose => pose.gunMatrix),
      footprint: footprint ? Object.freeze(footprint) : null });
    for (const pose of poses.slice(1)) pose.geometry.dispose();
    yield { completed: bank + 1, total: shieldStart + shieldBanks };
  }
  bankTemplate.bind(null);
  const casualtyShapes = Array.from({ length: deathBanks ? deathKinds : 0 }, (_, kind) => {
    const selected = deathStances.map((_, stance) => banks[livingBanks + stance * deathKinds + kind]);
    const bounds = selected[0].bounds.clone(), footprint = new Map();
    for (const bank of selected) {
      bounds.union(bank.bounds);
      for (const point of bank.footprint) footprint.set(point.join(','), point);
    }
    return { bounds, footprint: Object.freeze([...footprint.values()]) };
  });
  const morphControl = { morphTargetInfluences: Array(CASUALTY_POSE_FRAMES - 1).fill(0) };
  const postureMorphControl = { morphTargetInfluences: [0, 0] };
  const rifleMorphControl = { morphTargetInfluences: Array(RIFLE_HAND_SAMPLES.length - 1).fill(0) };
  const shieldMorphControl = { morphTargetInfluences: [0, 0] };
  const gunBlend = new THREE.Matrix4(), gunPositionA = new THREE.Vector3(), gunPositionB = new THREE.Vector3();
  const gunScaleA = new THREE.Vector3(), gunScaleB = new THREE.Vector3();
  const gunRotationA = new THREE.Quaternion(), gunRotationB = new THREE.Quaternion();
  const sampledGun = (bank, elapsed, posture) => {
    if (bank.shieldWalk) {
      const weights = sihangShieldWalkWeights(posture.walkTime / profile.walk.duration, posture.weight);
      bank.gunFrames[0].decompose(gunPositionA, gunRotationA, gunScaleA);
      let total = Math.max(0, 1 - posture.weight);
      for (let frame = 1; frame <= 2; frame++) {
        const weight = weights[frame - 1];
        if (!weight) continue;
        const blend = weight / (total + weight); total += weight;
        bank.gunFrames[frame].decompose(gunPositionB, gunRotationB, gunScaleB);
        gunPositionA.lerp(gunPositionB, blend); gunRotationA.slerp(gunRotationB, blend); gunScaleA.lerp(gunScaleB, blend);
      }
      return gunBlend.compose(gunPositionA, gunRotationA, gunScaleA);
    }
    if (bank.postureMorph) {
      const knee = (posture.kneeling ?? 0) + (posture.crouched ?? 0);
      const upright = Math.max(0, 1 - knee - posture.prone);
      bank.gunFrames[0].decompose(gunPositionA, gunRotationA, gunScaleA);
      let total = posture.prone;
      for (const [frame, weight] of [[1, upright], [2, knee]]) {
        if (!weight) continue;
        const blend = weight / (total + weight); total += weight;
        bank.gunFrames[frame].decompose(gunPositionB, gunRotationB, gunScaleB);
        gunPositionA.lerp(gunPositionB, blend); gunRotationA.slerp(gunRotationB, blend); gunScaleA.lerp(gunScaleB, blend);
      }
      return gunBlend.compose(gunPositionA, gunRotationA, gunScaleA);
    }
    if (!bank.deathStance) return bank.gunMatrix;
    const phase = elapsed * (CASUALTY_POSE_FRAMES - 1);
    const frame = Math.min(CASUALTY_POSE_FRAMES - 2, Math.floor(phase)), blend = phase - frame;
    bank.gunFrames[frame].decompose(gunPositionA, gunRotationA, gunScaleA);
    bank.gunFrames[frame + 1].decompose(gunPositionB, gunRotationB, gunScaleB);
    return gunBlend.compose(gunPositionA.lerp(gunPositionB, blend),
      gunRotationA.slerp(gunRotationB, blend), gunScaleA.lerp(gunScaleB, blend));
  };
  let summary = { assigned: 0, near: 0, far: 0, coarse: 0, hidden: 0, culled: 0, batches: 0 };
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
    get appearanceResources() { return template.appearanceResources; },
    casualtyBounds(variant, retainGun) {
      const shape = casualtyShapes[variant * 2 + Number(retainGun)];
      if (!shape) throw new RangeError('Casualty bank does not exist');
      return { min: shape.bounds.min.toArray(), max: shape.bounds.max.toArray(), footprint: shape.footprint };
    },
    createGrenadeHand: template.createGrenadeHand,
    createWeaponHand: template.createWeaponHand,
    async prepare(renderer, { onProgress = () => {} } = {}) {
      for (let index = 0; index < 6; index++) {
        await yieldStartupTask();
        const view = template.createView(); root.add(view.root);
        slots.push({ actorId: null, view });
      }
      const started = performance.now();
      for (const bank of banks) {
        if (bank.rifleAction) continue;
        await yieldStartupTask();
        const source = bank.parts[0].geometry;
        const settled = bank.deathStance || bank.postureMorph || bank.shieldWalk ? settledNraGeometry(source, Boolean(bank.deathStance)) : source;
        const mesh = new THREE.InstancedMesh(await createDistantPoseGeometry(settled), atlas.material, bank.capacity);
        if (settled !== source) settled.dispose();
        mesh.name = 'distant-coarse-body';
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
        mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
        root.add(mesh); bank.coarseParts.push(mesh);
        const stats = mesh.geometry.userData.distantPoseLod;
        poseLod.sourceTriangles += stats.sourceTriangles; poseLod.triangles += stats.triangles;
        poseLod.sourceBytes += geometryBytes(bank.parts[0].geometry); poseLod.bytes += geometryBytes(mesh.geometry);
        poseLod.maxError = Math.max(poseLod.maxError, stats.error);
        onProgress({ completed: banks.indexOf(bank) + 1, total: banks.length });
      }
      poseLod.preparationMs = performance.now() - started;
      lodReady = true;
      for (const weapon of team === 'enemy' ? ['rifle', 'sniper', 'type11'] : ['rifle', 'sniper', 'zb26', 'dadao']) {
        await yieldStartupTask();
        weaponGroupFor(weapon, true);
      }
      await yieldStartupTask();
      await renderer.compileAsync(scene, camera);
      for (const slot of slots) slot.view.root.visible = false;
    },
    remove(actors) {
      const ids = new Set(actors.map(actor => actor.id));
      for (const id of ids) coarseIds.delete(id);
      if (focused && ids.has(focused.actorId)) focused = null;
      for (const slot of slots) if (ids.has(slot.actorId)) {
        slot.actorId = null; slot.view.bind(null);
      }
    },
    update(actors, now, controlledId, preset, { detailLimit = null } = {}) {
      if (detailLimit !== null && (!Number.isInteger(detailLimit) || detailLimit < 0 || detailLimit > 6))
        throw new RangeError('Invalid native presentation detail limit');
      const nextCoarseIds = new Set();
      for (const attachment of optionalAttachments) attachment.update?.(now);
      excludedIds.clear(); tiers.clear();
      for (const group of weaponGroups.values()) group.count = 0;
      for (const bank of banks) {
        bank.count = 0;
        bank.coarseCount = 0;
        for (const attachment of bank.attachments) attachment.count = 0;
      }
      summary = { assigned: 0, near: 0, far: 0, coarse: 0, hidden: 0, culled: 0, batches: 0 };
      summary.weaponGeometryTriangles = 0; summary.weaponGeometryTrianglesWithoutLod = 0;
      summary.coarseWeapons = 0;
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
      const candidates = [], visible = [], budget = Math.min(preset === 'low' ? 3 : 6, detailLimit ?? 6),
        limit = preset === 'low' ? 18 : 28;
      for (const actor of actors) {
        if (!actor.nativeMotion) continue;
        if (actor.team !== team) throw new Error(`A ${actor.team} identity cannot use the ${team} uniform renderer`);
        excludedIds.add(actor.id); summary.assigned++;
        if (actor.vehicleId || actor.id === controlledId) {
          tiers.set(actor.id, 'hidden'); summary.hidden++; continue;
        }
        sphere.center.copy(actor.position); sphere.center.y += .9;
        const distance = camera.position.distanceTo(sphere.center);
        if (!frustum.intersectsSphere(sphere)) {
          tiers.set(actor.id, 'culled'); summary.culled++; continue;
        }
        visible.push({ actor, distance });
        const existing = slots.some(slot => slot.actorId === actor.id);
        const falling = actor.casualty && now < actor.casualty.time + actor.casualty.duration;
        if (distance <= (falling ? 40 : limit) + (existing ? 3 : 0))
          candidates.push({ actor, priority: distance - (existing ? 2 : 0) + (falling ? -40 : actor.health <= 0 ? 6 : 0) });
      }
      candidates.sort((a, b) => a.priority - b.priority);
      const detailed = new Set(candidates.slice(0, budget).map(candidate => candidate.actor.id));
      for (const slot of slots) if (slot.actorId && !detailed.has(slot.actorId)) { slot.actorId = null; slot.view.bind(null); }
      for (const { actor, distance } of visible) {
        if (detailed.has(actor.id)) {
          const view = slotFor(actor, budget).view;
          view.update(actor, now, controlledId); tiers.set(actor.id, 'skinned'); summary.near++;
          summary.batches += view.drawBatches;
        } else {
          const pose = sampleNraPhase(actor);
          const walking = profile.walk && pose.jog <= .5;
          const phase = walking ? pose.walkTime / profile.walk.duration : pose.runTime / profile.run.duration;
          const offset = profile.footCycleGait ? movingModes.indexOf(pose.travelStyle) * phases : walking ? 0 : profile.walk ? phases : 0;
          const posture = actor.nativeMotion.postureTransition && postures.includes('prone')
            ? 'prone' : postures.find(name => pose[name] > .5);
          const raised = profile.lowReadyCarry && actor.nativeMotion.lowReady < .5;
          const sword = team === 'friendly' && Boolean(pose.dadao);
          const melee = actor.health > 0 && pose.upright > .999 &&
            (sword || hasBayonet(actor) && actor.bayonet && actor.bayonet.mode !== 'idle');
          const swordPose = actor.dadao?.pose;
          const swordFrame = !swordPose || ['ready', 'draw', 'stowed'].includes(swordPose.phase) ? 0
            : 1 + ['windup', 'cut', 'recover'].indexOf(swordPose.phase) * 3 +
              Math.min(2, Math.floor(swordPose.progress * 3));
          const charging = sword ? actor.dadao.mode === 'charge' : actor.bayonet?.mode === 'charge';
          const turning = actor.health > 0 && pose.upright > .999 && !melee && pose.weight <= .45 &&
            actor.nativeMotion.turn.weight > .35 && turnBanks;
          const turnPhase = ((actor.nativeMotion.turn.angle / (Math.PI / 3)) % 1 + 1) % 1;
          const dead = actor.health <= 0 && actor.casualty && deathBanks;
          const deathMotion = actor.casualty?.motion ?? pose;
          const stance = deathMotion.prone > .5 ? 'prone'
            : (deathMotion.kneeling ?? 0) + (deathMotion.crouched ?? 0) > .5 ? 'kneeling' : 'standing';
          const deathElapsed = dead ? Math.min(1, Math.max(0, (now - actor.casualty.time) / actor.casualty.duration)) : 1;
          const operation = !dead && !melee && !actor.grenades?.action && !actor.nativeMotion.postureTransition
            ? rifleHandAction(actor.rifle) : null;
          const actionStance = posture === 'prone' ? 'prone' : ['crouched', 'kneeling'].includes(posture) ? 'crouched' : 'standing';
          const shield = shieldBanks ? sihangShieldPoseIndex(actor) : -1;
          const index = dead
            ? livingBanks + Math.max(0, deathStances.indexOf(stance)) * deathKinds +
              actor.casualty.variant * 2 + Number(actor.casualty.retainGun)
            : shield >= 0 ? shieldStart + shield + (sihangShieldInstalling(actor) ? 2 : 0)
            : operation?.hand > .001 ? actionStart + Math.max(0, actionStances.indexOf(actionStance))
            : actor.weaponBlocked && closeBanks ? closeStart + (posture ? 1 + postures.indexOf(posture) : 0)
            : turning ? turnStart + (actor.nativeMotion.turn.direction > 0 ? phases : 0) + Math.round(turnPhase * phases) % phases
            : melee ? meleeStart + (charging && pose.weight > .45 ? Math.round(phase * phases) % phases
              : phases + (sword ? swordFrame : Math.round(actor.bayonet.extension * 2)))
            : posture && postures.includes(posture)
            ? raised ? baseBanks + 1 + postures.indexOf(posture) : movingBanks + postures.indexOf(posture)
            : pose.weight > .45 ? 1 + offset + Math.round(phase * phases) % phases : raised ? baseBanks : 0;
          const bank = banks[index];
          if (bank.count >= bank.capacity) {
            if (index < livingBanks || index >= shieldStart) throw new Error('Distant uniform instance capacity exceeded');
            bank.capacity *= 2;
            for (const mesh of [...bank.parts, ...bank.coarseParts]) {
              const matrices = new Float32Array(bank.capacity * 16); matrices.set(mesh.instanceMatrix.array);
              mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
              if (mesh.morphTexture) {
                const image = mesh.morphTexture.image, data = new Float32Array(image.width * bank.capacity);
                data.set(image.data); mesh.morphTexture.dispose();
                mesh.morphTexture = new THREE.DataTexture(data, image.width, bank.capacity, THREE.RedFormat, THREE.FloatType);
              }
              const colors = new Float32Array(bank.capacity * 3); colors.set(mesh.geometry.attributes.nraSkinTint.array);
              mesh.geometry.setAttribute('nraSkinTint', new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
              if (mesh.geometry.attributes.nraUniformVariant) {
                const variants = new Float32Array(bank.capacity); variants.set(mesh.geometry.attributes.nraUniformVariant.array);
                mesh.geometry.setAttribute('nraUniformVariant', new THREE.InstancedBufferAttribute(variants, 1).setUsage(THREE.DynamicDrawUsage));
              }
              if (mesh.geometry.attributes.nativeOfficer) {
                const flags = new Float32Array(bank.capacity); flags.set(mesh.geometry.attributes.nativeOfficer.array);
                mesh.geometry.setAttribute('nativeOfficer', new THREE.InstancedBufferAttribute(flags, 1).setUsage(THREE.DynamicDrawUsage));
              }
            }
            for (const attachment of bank.attachments) {
              const matrices = new Float32Array(bank.capacity * 16); matrices.set(attachment.mesh.instanceMatrix.array);
              attachment.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
              if (attachment.mesh.morphTexture) {
                const image = attachment.mesh.morphTexture.image, data = new Float32Array(image.width * bank.capacity);
                data.set(image.data); attachment.mesh.morphTexture.dispose();
                attachment.mesh.morphTexture = new THREE.DataTexture(data, image.width, bank.capacity, THREE.RedFormat, THREE.FloatType);
              }
            }
          }
          const deathProgress = actor.casualty ? casualtyProgress(actor.casualty, now) : 1;
          orientation.setFromEuler(euler.set(0, actor.heading + (actor.casualty?.yaw ?? 0) * deathProgress, actor.health > 0 || actor.casualty ? 0 : Math.PI / 2));
          scale.set(1 + (actor.avatarAppearance?.build ?? 0) * .025, 1, 1);
          matrix.compose(actor.position, orientation, scale);
          if (actor.casualty?.offset) {
            matrix.elements[12] += actor.casualty.offset.x * Math.sqrt(deathProgress);
            matrix.elements[14] += actor.casualty.offset.z * Math.sqrt(deathProgress);
          }
          const coarse = lodReady && !bank.rifleAction && !(bank.shieldWalk && pose.weight > .001) &&
            !actor.nativeMotion.postureTransition && (!dead || deathElapsed === 1) &&
            useDistantPose(camera, distance, coarseIds.has(actor.id), preset);
          const installing = sihangShieldInstalling(actor);
          const weapons = installing || nativeDischargerPresentation(actor) ? null
            : weaponGroupFor(sword ? 'dadao' : actor.rifle.model ?? 'rifle', coarse);
          if (weapons) {
            if (weapons.count >= weapons.capacity) {
              if (actor.health > 0) throw new Error('Distant weapon instance capacity exceeded');
              weapons.capacity *= 2;
              for (const mesh of weapons.parts) {
                const matrices = new Float32Array(weapons.capacity * 16); matrices.set(mesh.instanceMatrix.array);
                mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16).setUsage(THREE.DynamicDrawUsage);
              }
            }
            weaponMatrix.multiplyMatrices(matrix, sampledGun(bank, deathElapsed, pose));
            if (!sword && actor.health > 0 && Number.isFinite(actor.aimPitch) && actor.nativeMotion &&
              nativePoseIntent(actor) === 'aim') {
              const lowReady = actor.nativeMotion.lowReady ?? 0;
              weaponMatrix.multiply(aimPitchRotation.makeRotationX(actor.aimPitch * (1 - lowReady)));
            }
            for (const mesh of weapons.parts) mesh.setMatrixAt(weapons.count, weaponMatrix);
            weapons.count++;
            summary.weaponGeometryTriangles += weapons.triangles;
            summary.weaponGeometryTrianglesWithoutLod += weapons.sourceTriangles;
            if (weapons.coarse) summary.coarseWeapons++;
          }
          const tint = new THREE.Color(actor.avatarAppearance?.skin ?? '#ffffff');
          const bodyIndex = coarse ? bank.coarseCount : bank.count - bank.coarseCount;
          if (dead) {
            const phase = deathElapsed * (CASUALTY_POSE_FRAMES - 1), frame = Math.floor(phase), blend = phase - frame;
            morphControl.morphTargetInfluences.fill(0);
            if (frame > 0) morphControl.morphTargetInfluences[frame - 1] = 1 - blend;
            if (frame < CASUALTY_POSE_FRAMES - 1) morphControl.morphTargetInfluences[frame] = blend;
          }
          if (bank.postureMorph) {
            postureMorphControl.morphTargetInfluences[0] = Math.max(0, 1 - pose.prone - pose.kneeling - pose.crouched);
            postureMorphControl.morphTargetInfluences[1] = pose.kneeling + pose.crouched;
          }
          if (bank.rifleAction) rifleMorphControl.morphTargetInfluences = rifleHandWeights(operation).slice(1);
          if (bank.shieldWalk) shieldMorphControl.morphTargetInfluences = sihangShieldWalkWeights(
            profile.walk ? pose.walkTime / profile.walk.duration : phase, pose.weight);
          for (const mesh of coarse ? bank.coarseParts : bank.parts) {
            mesh.setMatrixAt(bodyIndex, matrix);
            if (dead && !coarse) mesh.setMorphAt(bodyIndex, morphControl);
            if (bank.postureMorph && !coarse) mesh.setMorphAt(bodyIndex, postureMorphControl);
            if (bank.rifleAction) mesh.setMorphAt(bodyIndex, rifleMorphControl);
            if (bank.shieldWalk && !coarse) mesh.setMorphAt(bodyIndex, shieldMorphControl);
            mesh.geometry.attributes.nraSkinTint.setXYZ(bodyIndex, tint.r, tint.g, tint.b);
            mesh.geometry.attributes.nraUniformVariant?.setX(bodyIndex, actor.avatarAppearance?.uniform === 'B' ? 1 : 0);
            mesh.geometry.attributes.nativeOfficer?.setX(bodyIndex, Number(isNativeOfficer(actor)));
          }
          if (coarse) { bank.coarseCount++; summary.coarse++; nextCoarseIds.add(actor.id); }
          for (const attachment of bank.attachments) if (attachment.enabled(actor)) {
            attachment.mesh.setMatrixAt(attachment.count, matrix);
            if (attachment.poseFollowing && attachment.mesh.morphTexture) {
              attachment.mesh.setMorphAt(attachment.count, dead ? morphControl : bank.postureMorph ? postureMorphControl
                : bank.rifleAction ? rifleMorphControl : shieldMorphControl);
            }
            attachment.count++;
          }
          bank.count++; tiers.set(actor.id, 'instanced'); summary.far++;
        }
      }
      for (const bank of banks) for (const [parts, count] of [[bank.parts, bank.count - bank.coarseCount], [bank.coarseParts, bank.coarseCount]]) for (const mesh of parts) {
        mesh.count = count;
        mesh.visible = count > 0;
        if (mesh.count) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.geometry.attributes.nraSkinTint.needsUpdate = true;
          if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
          if (mesh.geometry.attributes.nraUniformVariant) mesh.geometry.attributes.nraUniformVariant.needsUpdate = true;
          if (mesh.geometry.attributes.nativeOfficer) mesh.geometry.attributes.nativeOfficer.needsUpdate = true;
          summary.batches += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
        }
      }
      for (const group of weaponGroups.values()) for (const mesh of group.parts) {
        mesh.count = group.count;
        mesh.visible = group.count > 0;
        if (group.count) { mesh.instanceMatrix.needsUpdate = true; summary.batches++; }
      }
      for (const bank of banks) for (const attachment of bank.attachments) {
        attachment.mesh.count = attachment.count;
        attachment.mesh.visible = attachment.count > 0;
        if (attachment.count) {
          attachment.mesh.instanceMatrix.needsUpdate = true;
          if (attachment.mesh.morphTexture) attachment.mesh.morphTexture.needsUpdate = true;
          summary.batches++;
        }
      }
      const controlled = actors.find(actor => actor.id === controlledId);
      const retainedFocus = focused && slots.find(slot => slot.actorId === focused.actorId &&
        actors.some(actor => actor.id === slot.actorId && actor.health > 0));
      focused = retainedFocus?.view ?? slots.find(slot => slot.actorId && slot.actorId !== controlledId &&
        actors.some(actor => actor.id === slot.actorId && actor.unitId === controlled?.unitId && actor.health > 0))?.view ??
        slots.find(slot => slot.actorId && actors.some(actor => actor.id === slot.actorId && actor.health > 0))?.view ?? null;
      coarseIds = nextCoarseIds;
      members = actors.filter(actor => actor.nativeMotion).map(actor => ({ id: actor.id, unitId: actor.unitId,
        health: actor.health, weaponModel: actor.rifle.model ?? 'rifle', stance: actor.stance ?? 'standing', firingPose: ownedFiringPose(actor), uniform,
        uniformVariant: actor.avatarAppearance?.uniform ?? null, helmet: !isNativeOfficer(actor),
        officer: isNativeOfficer(actor), tier: tiers.get(actor.id),
        geometryLod: coarseIds.has(actor.id) ? 'coarse' : 'original',
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
    get counts() { return { ...summary, poolSize: slots.length, poseBanks: banks.length, lodReady, poseLod: { ...poseLod }, weaponLod: { ...weaponLod } }; },
    get snapshot() { return { ...summary, poolSize: slots.length, poseBanks: banks.length, lodReady, poseLod: { ...poseLod }, weaponLod: { ...weaponLod }, members: members.map(member => ({ ...member })),
      views: slots.filter(slot => slot.actorId).map(slot => slot.view.snapshot) }; },
    get focusedSnapshot() { return focused?.snapshot ?? null; },
  };
}
