import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { createUniformStudy, disposeUniformStudy } from './model.js';
import { createStudyPose, studyTransform, loadStudyAppearance } from './skin.js';
import { createStudySurface } from './surfaces.js';
import { fitIjaProportions } from './proportions.js';

export function createIjaSkeleton(source, canonical) {
  const pose = createStudyPose(source), transform = studyTransform(), worlds = new Map(), bones = new Map();
  for (const [name, original] of canonical) {
    const matrix = original.matrixWorld.clone();
    if (pose.has(name)) matrix.premultiply(pose.get(name));
    matrix.premultiply(transform);
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);
    for (const [prefix, side] of [['Left', 1], ['Right', -1]]) {
      if (name === `${prefix}UpLeg`) position.set(side * .097, .98, -.026);
      if (name === `${prefix}Leg`) position.set(side * .102, .50, 0);
      if (name === `${prefix}Foot`) position.set(side * .102, .14, -.015);
      if (name.startsWith(`${prefix}Toe`)) {
        const toe = canonical.get(`${prefix}ToeBase`).getWorldPosition(new THREE.Vector3());
        position.copy(original.getWorldPosition(new THREE.Vector3()).sub(toe).multiplyScalar(.0082))
          .add(new THREE.Vector3(side * .102, .025, .11));
      }
    }
    worlds.set(name, new THREE.Matrix4().compose(position, rotation.normalize(), new THREE.Vector3(.0082, .0082, .0082)));
    const bone = new THREE.Bone(); bone.name = name; bones.set(name, bone);
  }
  const root = new THREE.Group(); root.name = 'ija-1938';
  for (const [name, original] of canonical) {
    const parent = bones.get(original.parent.name), bone = bones.get(name);
    (parent ?? root).add(bone);
    const local = worlds.get(name).clone();
    if (parent) local.premultiply(worlds.get(parent.name).clone().invert());
    local.decompose(bone.position, bone.quaternion, bone.scale);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([...bones.values()]); skeleton.calculateInverses();
  return { root, skeleton, bones };
}

function weightReference(mesh, skeleton, canonical) {
  const positions = mesh.geometry.attributes.position, indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const names = new Map(skeleton.bones.map((bone, index) => [bone.name, index]));
  const mappings = mesh.skeleton.bones.map(bone => new THREE.Matrix4().multiplyMatrices(
    skeleton.bones[names.get(bone.name)].matrixWorld, canonical.get(bone.name).matrixWorld.clone().invert()));
  const buckets = new Map(), unique = new Set(), cell = .035, point = new THREE.Vector3(), fitted = new THREE.Vector3(), temp = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index); mesh.applyBoneTransform(index, point); mesh.localToWorld(point); fitted.set(0, 0, 0);
    const influences = [];
    for (let slot = 0; slot < 4; slot++) {
      const weight = weights.getComponent(index, slot), boneIndex = indices.getComponent(index, slot);
      if (!weight) continue;
      fitted.addScaledVector(temp.copy(point).applyMatrix4(mappings[boneIndex]), weight);
      influences.push([names.get(mesh.skeleton.bones[boneIndex].name), weight]);
    }
    const key = fitted.toArray().map(value => Math.round(value * 100000)).join(',');
    if (unique.has(key)) continue;
    unique.add(key);
    const bucket = fitted.toArray().map(value => Math.floor(value / cell)).join(',');
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push({ point: fitted.clone(), influences });
  }
  return (point, allowedBones = null) => {
    const center = point.toArray().map(value => Math.floor(value / cell));
    let candidates = [];
    for (let radius = 1; radius <= 5 && candidates.length < 4; radius++) {
      candidates = [];
      for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) for (let z = -radius; z <= radius; z++) {
        for (const item of buckets.get(`${center[0] + x},${center[1] + y},${center[2] + z}`) ?? []) {
          if (allowedBones && !item.influences.some(([bone, weight]) => weight > 0 && allowedBones.has(bone))) continue;
          candidates.push({ ...item, distance: item.point.distanceToSquared(point) });
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    if (!candidates.length || candidates[0].distance > .15 ** 2) throw new Error(`Skin transfer has no nearby ${mesh.name} surface: ${point.toArray()}`);
    const combined = new Map();
    for (const item of candidates.slice(0, 4)) for (const [bone, weight] of item.influences) {
      if (allowedBones && !allowedBones.has(bone)) continue;
      combined.set(bone, (combined.get(bone) ?? 0) + weight / Math.max(1e-9, item.distance));
    }
    const selected = [...combined].sort((a, b) => b[1] - a[1]).slice(0, 4), total = selected.reduce((sum, item) => sum + item[1], 0);
    if (!(total > 0)) throw new Error(`Skin transfer has no permitted influences for ${mesh.name}`);
    return selected.map(([bone, weight]) => [bone, weight / total]);
  };
}

function retargetClips(data, canonical, bones) {
  return ['idle', 'walk', 'run'].map(mode => {
    const original = THREE.AnimationClip.parse(data[mode]), tracks = [];
    for (const track of original.tracks) {
      const match = track.name.match(/^\.bones\[([^\]]+)\]\.(quaternion|position)$/);
      if (!match) throw new Error(`Unsupported native animation channel: ${track.name}`);
      const [, name, property] = match;
      if (/(?:Left|Right)(?:Arm|ForeArm|Hand)/.test(name)) continue;
      const source = canonical.get(name), target = bones.get(name), values = [];
      if (property === 'quaternion') {
        const offset = target.quaternion.clone().multiply(source.quaternion.clone().invert());
        for (let at = 0; at < track.values.length; at += 4) values.push(...new THREE.Quaternion().fromArray(track.values, at).premultiply(offset).normalize().toArray());
        tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, track.times, values));
      } else if (name === 'Hips') {
        const basis = new THREE.Matrix3().setFromMatrix4(source.parent.matrixWorld);
        for (let at = 0; at < track.values.length; at += 3) {
          values.push(...new THREE.Vector3().fromArray(track.values, at).sub(source.position).applyMatrix3(basis)
            .multiplyScalar(.0082).add(target.position).toArray());
        }
        tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, track.times, values));
      }
    }
    return new THREE.AnimationClip(mode, original.duration, tracks);
  });
}

export async function buildIjaAsset() {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const [source, appearance, animationData] = await Promise.all([
    new FBXLoader(manager).loadAsync('/assets/game/nra-88/character.fbx'), loadStudyAppearance(),
    fetch('/assets/game/nra-88/animations.json').then(response => {
      if (!response.ok) throw new Error(`Native motion source: HTTP ${response.status}`);
      return response.json();
    }),
  ]);
  const { canonical } = prepareNraRig(source), rig = createIjaSkeleton(source, canonical);
  const study = createUniformStudy({ upperBody: appearance.upperBody, textures: {
    cloth: createStudySurface('cloth'), leather: createStudySurface('leather'), paint: createStudySurface('paint'),
  } });
  study.groups.head.add(appearance.skin); study.root.updateMatrixWorld(true);
  const references = {
    cloth: weightReference(source.getObjectByName('衣服'), rig.skeleton, canonical),
    legs: weightReference(source.getObjectByName('褲子'), rig.skeleton, canonical),
    face: weightReference(source.getObjectByName('臉部'), rig.skeleton, canonical),
    hands: weightReference(source.getObjectByName('手部'), rig.skeleton, canonical),
  };
  const boneIndex = name => {
    const index = rig.skeleton.bones.findIndex(bone => bone.name === name);
    if (index < 0) throw new Error(`Missing Japanese character attachment: ${name}`);
    return index;
  };
  // Nearby lowered sleeves must not donate arm weights to the torso or pelvis weights to a cuff.
  const torsoLevels = [['Hips', 1.09], ['Spine', 1.16], ['Spine1', 1.24], ['Spine2', 1.37], ['Neck', 1.465]]
    .map(([name, y]) => ({ bone: boneIndex(name), y }));
  const sleeveBones = Object.fromEntries(['Left', 'Right'].map(side =>
    [side, new Set(['Shoulder', 'Arm', 'ForeArm', 'Hand'].map(part => boneIndex(`${side}${part}`)))]));
  const torsoWeights = point => {
    if (point.y <= torsoLevels[0].y) return [[torsoLevels[0].bone, 1]];
    for (let index = 1; index < torsoLevels.length; index++) {
      const lower = torsoLevels[index - 1], upper = torsoLevels[index];
      if (point.y > upper.y) continue;
      const weight = THREE.MathUtils.smoothstep(point.y, lower.y, upper.y);
      return [[lower.bone, 1 - weight], [upper.bone, weight]];
    }
    return [[torsoLevels.at(-1).bone, 1]];
  };
  const garment = study.root.getObjectByName('standing-collar-tunic').geometry;
  const vertexKey = point => point.toArray().map(value => Math.round(value * 100000)).join(',');
  const sleeveVertices = new Set(), panelVertices = new Set();
  for (let index = 0; index < garment.attributes.position.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(garment.attributes.position, index);
    if (index < garment.userData.bodyTriangleCount * 3) panelVertices.add(vertexKey(point));
    else if (index < (garment.userData.bodyTriangleCount + garment.userData.sleeveTriangleCount) * 3) sleeveVertices.add(vertexKey(point));
  }
  const sections = new Map();
  for (const key of panelVertices) {
    const [x, y, z] = key.split(',').map(value => Number(value) / 100000);
    if (y < 1.10 || y > 1.415) continue;
    if (!sections.has(y)) sections.set(y, []);
    const angle = (Math.atan2(x, z + .026) + Math.PI * 2) % (Math.PI * 2);
    sections.get(y).push({ angle, radius: Math.hypot(x, z + .026) });
  }
  const rings = [...sections].sort((a, b) => a[0] - b[0])
    .map(([y, points]) => ({ y, points: points.sort((a, b) => a.angle - b.angle) }));
  if (rings.length < 3 || rings.some(ring => ring.points.length < 32)) throw new Error('Garment armholes require measured torso sections');
  const ringRadius = (ring, angle) => {
    const index = ring.points.findIndex(point => point.angle >= angle);
    const lower = index <= 0 ? { ...ring.points.at(-1), angle: ring.points.at(-1).angle - (index === 0 ? Math.PI * 2 : 0) } : ring.points[index - 1];
    const upper = index < 0 ? { ...ring.points[0], angle: ring.points[0].angle + Math.PI * 2 } : ring.points[index];
    return THREE.MathUtils.lerp(lower.radius, upper.radius, (angle - lower.angle) / Math.max(1e-9, upper.angle - lower.angle));
  };
  const sleeveWeights = (point, side) => {
    const arm = references.cloth(point, sleeveBones[side]);
    if (point.y <= 1.10) return arm;
    const angle = (Math.atan2(point.x, point.z + .026) + Math.PI * 2) % (Math.PI * 2);
    const at = rings.findIndex(ring => ring.y >= point.y);
    const upper = rings[at < 0 ? rings.length - 1 : at], lower = rings[Math.max(0, at < 0 ? rings.length - 1 : at - 1)];
    const radius = THREE.MathUtils.lerp(ringRadius(lower, angle), ringRadius(upper, angle),
      THREE.MathUtils.clamp((point.y - lower.y) / Math.max(1e-9, upper.y - lower.y), 0, 1));
    const blend = (1 - THREE.MathUtils.smoothstep(Math.hypot(point.x, point.z + .026) - radius, .004, .065)) *
      THREE.MathUtils.smoothstep(point.y, 1.10, 1.40);
    const combined = new Map(arm.map(([bone, weight]) => [bone, weight * (1 - blend)]));
    for (const [bone, weight] of torsoWeights(point)) combined.set(bone, (combined.get(bone) ?? 0) + weight * blend);
    const selected = [...combined].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = selected.reduce((sum, [, weight]) => sum + weight, 0);
    return selected.map(([bone, weight]) => [bone, weight / total]);
  };
  const modifier = new SimplifyModifier(), levels = {};
  for (const level of ['near', 'far']) {
    const group = new THREE.Group(); group.name = level; rig.root.add(group);
    const merged = new Map();
    study.root.traverse(node => {
      if (!node.isMesh) return;
      if (level === 'far' && (node.geometry.type === 'TubeGeometry' || /button|branch-position|fastener|buckle-opening/.test(node.name))) return;
      let geometry;
      if (node.geometry.type === 'TubeGeometry') {
        const { path, radius, tubularSegments } = node.geometry.parameters;
        geometry = new THREE.TubeGeometry(path, Math.min(tubularSegments, node.name === 'puttee-wrap-edge' ? 128 : 32), radius, 3, false);
      } else geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      const dense = /standing-collar|trouser-leg|study-.*hand|study-face/.test(node.name);
      const fraction = dense ? level === 'far' ? .18 : .60 : 1;
      if (fraction < 1 && geometry.attributes.position.count > 180) {
        const welded = mergeVertices(geometry), reduced = modifier.modify(welded, Math.floor(welded.attributes.position.count * (1 - fraction)));
        geometry.dispose(); welded.dispose(); geometry = reduced;
      }
      if (!geometry.attributes.normal || !geometry.attributes.uv || !geometry.attributes.position.count) throw new Error(`Invalid production geometry: ${node.name}`);
      const positions = geometry.attributes.position, indices = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4), point = new THREE.Vector3();
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        let influences;
        const side = point.x > 0 ? 'Left' : 'Right';
        if (node.name === 'study-face') influences = references.face(point);
        else if (/hand$/.test(node.name)) influences = references.hands(point);
        else if (node.parent === study.groups.helmet || node.name === 'study-eyes') influences = [[boneIndex('Head'), 1]];
        else if (node.name === 'trouser-leg') influences = references.legs(point);
        else if (/puttee/.test(node.name)) influences = [[boneIndex(`${side}Leg`), 1]];
        else if (/boot/.test(node.name)) influences = [[boneIndex(`${side}Foot`), 1]];
        else {
          let parent = node.parent;
          while (parent && parent !== study.groups.equipment && parent !== study.groups.uniform) parent = parent.parent;
          if (parent === study.groups.equipment && !/shoulder-strap|sling/.test(node.name)) influences = [[boneIndex('Hips'), 1]];
          else if (node.name === 'standing-collar-tunic' && sleeveVertices.has(vertexKey(point)) && !panelVertices.has(vertexKey(point))) {
            influences = sleeveWeights(point, side);
          } else influences = torsoWeights(point);
        }
        influences.forEach(([bone, weight], slot) => { indices[index * 4 + slot] = bone; weights[index * 4 + slot] = weight; });
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const expanded = geometry.index ? geometry.toNonIndexed() : geometry.clone(); geometry.dispose();
      const material = node.material;
      if (!merged.has(material)) merged.set(material, []);
      merged.get(material).push(expanded);
    });
    let triangles = 0;
    for (const [material, parts] of merged) {
      const combined = mergeGeometries(parts);
      if (!combined) throw new Error('Japanese production meshes could not be merged');
      const geometry = mergeVertices(combined);
      combined.dispose(); parts.forEach(part => part.dispose());
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.name = `${level}-${merged.size}-${group.children.length}`; mesh.frustumCulled = false;
      mesh.userData.skinRegion = [study.groups.head.getObjectByName('study-face')?.material,
        study.groups.head.getObjectByName('study-left-hand')?.material].includes(material);
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); mesh.bind(rig.skeleton, new THREE.Matrix4());
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    }
    levels[level] = { triangles, batches: group.children.length };
  }
  const clips = retargetClips(animationData, canonical, rig.bones);
  fitIjaProportions(rig.root, rig.skeleton, clips);
  const converted = new Map();
  rig.root.traverse(node => {
    if (!node.isMesh) return;
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      const texture = node.material[key];
      if (!texture?.isDataTexture) continue;
      if (!converted.has(texture)) {
        const { width, height, data } = texture.image, canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Production texture baking requires a 2D canvas');
        context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
        const baked = new THREE.CanvasTexture(canvas);
        baked.colorSpace = texture.colorSpace; baked.wrapS = texture.wrapS; baked.wrapT = texture.wrapT;
        baked.repeat.copy(texture.repeat); baked.offset.copy(texture.offset); baked.flipY = texture.flipY;
        converted.set(texture, baked);
      }
      node.material[key] = converted.get(texture);
    }
  });
  rig.root.updateMatrixWorld(true);
  const binary = await new GLTFExporter().parseAsync(rig.root, { binary: true, animations: clips, onlyVisible: false });
  const result = { binary, levels, motion: animationData.motion, proportions: rig.root.userData.proportions };
  disposeUniformStudy(study.root); disposeUniformStudy(source);
  return result;
}
