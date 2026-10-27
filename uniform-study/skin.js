import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { disposeUniformStudy } from './model.js';
import { tailorStudyGarment } from './tailoring.js';

const STUDY_SCALE = .0082;
export const studyTransform = () => new THREE.Matrix4().makeScale(STUDY_SCALE, STUDY_SCALE, STUDY_SCALE).setPosition(0, .1805, -.012);

function attachmentTransform(origin, end, targetOrigin, targetEnd, stretch = true) {
  const direction = end.clone().sub(origin), targetDirection = targetEnd.clone().sub(targetOrigin);
  const ratio = stretch ? targetDirection.length() / direction.length() : 1;
  const rotation = new THREE.Quaternion().setFromUnitVectors(direction.clone().normalize(), targetDirection.normalize());
  const basis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return new THREE.Matrix4().makeTranslation(...targetOrigin.toArray())
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(rotation))
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(basis))
    .multiply(new THREE.Matrix4().makeScale(1, ratio, 1))
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(basis.clone().invert()))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
}

export function createStudyPose(model) {
  const hands = model.getObjectByName('手部');
  if (!hands?.isSkinnedMesh) throw new Error('Static appearance source is missing the inspected hand skeleton');
  const pose = new Map(), inverse = studyTransform().invert();
  for (const [side, prefix] of [[1, 'Left'], [-1, 'Right']]) {
    const landmark = name => {
      const bone = hands.skeleton.bones.find(item => item.name === `${prefix}${name}`);
      if (!bone) throw new Error(`Missing static attachment landmark: ${prefix}${name}`);
      return bone.getWorldPosition(new THREE.Vector3());
    };
    const arm = landmark('Arm'), elbow = landmark('ForeArm'), wrist = landmark('Hand'), middle = landmark('HandMiddle1');
    const targetElbow = new THREE.Vector3(side * 25.8, 117, -4);
    const targetWrist = new THREE.Vector3(side * .248, .875, .035).applyMatrix4(inverse);
    pose.set(`${prefix}Arm`, attachmentTransform(arm, elbow, arm, targetElbow));
    pose.set(`${prefix}ForeArm`, attachmentTransform(elbow, wrist, targetElbow, targetWrist));
    const handTransform = attachmentTransform(wrist, middle, targetWrist, targetWrist.clone().add(new THREE.Vector3(0, -1, .10)), false);
    for (const bone of hands.skeleton.bones) if (bone.name.startsWith(`${prefix}Hand`)) pose.set(bone.name, handTransform);
  }
  return pose;
}

function garmentShellTriangles(mesh) {
  const geometry = mesh.geometry, positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const count = geometry.index?.count ?? positions.count;
  const components = splitUV => {
    const parents = Array.from({ length: count / 3 }, (_, index) => index), owners = new Map();
    const find = id => parents[id] === id ? id : (parents[id] = find(parents[id]));
    for (let at = 0; at < count; at++) {
      const index = geometry.index ? geometry.index.getX(at) : at;
      const values = [positions.getX(index), positions.getY(index), positions.getZ(index)];
      if (splitUV) values.push(uv.getX(index), uv.getY(index));
      const key = values.map(value => Math.round(value * 10000)).join(','), triangle = Math.floor(at / 3);
      if (owners.has(key)) parents[find(triangle)] = find(owners.get(key));
      else owners.set(key, triangle);
    }
    const parts = new Map();
    for (let triangle = 0; triangle < count / 3; triangle++) {
      const id = find(triangle);
      if (!parts.has(id)) parts.set(id, []);
      parts.get(id).push(triangle);
    }
    return [...parts.values()];
  };
  // Source-specific island audit: retain torso/sleeves/cuffs and skirt, not the turned collar, breast pockets or hardware.
  const islands = components(true);
  const torso = islands.find(component => component.length === 1078);
  const sleeves = islands.filter(component => [708, 37].includes(component.length));
  const skirt = components(false).find(component => component.length === 1051);
  if (!torso || sleeves.length !== 4 || !skirt) throw new Error('Inspected garment islands changed; source-specific details cannot be safely separated');
  return { body: new Set([...torso, ...skirt]), sleeves: new Set(sleeves.flat()) };
}

function bakeMesh(mesh, transform, material, name, { side = 0, pose = new Map(), triangles = null } = {}) {
  const geometry = mesh.geometry, sourcePosition = geometry.getAttribute('position');
  const sourceNormal = geometry.getAttribute('normal'), sourceUv = geometry.getAttribute('uv');
  if (!mesh.isSkinnedMesh || !sourcePosition || !sourceNormal || !sourceUv) throw new Error(`Static skin source lacks required attributes: ${name}`);
  const positions = [], normals = [], uvs = [], point = new THREE.Vector3(), normal = new THREE.Vector3();
  const worldNormal = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const targetNormal = new THREE.Matrix3().getNormalMatrix(transform);
  const weights = geometry.getAttribute('skinWeight'), boneIndices = geometry.getAttribute('skinIndex');
  const mappings = mesh.skeleton.bones.map(bone => {
    const matrix = pose.get(bone.name);
    return matrix ? { matrix, normal: new THREE.Matrix3().getNormalMatrix(matrix) } : null;
  });
  const posedPoint = new THREE.Vector3(), posedNormal = new THREE.Vector3(), temporary = new THREE.Vector3();
  const count = geometry.index?.count ?? sourcePosition.count;
  for (let triangle = 0; triangle < count; triangle += 3) {
    if (triangles && !triangles.has(triangle / 3)) continue;
    const vertices = [];
    for (let corner = 0; corner < 3; corner++) {
      const index = geometry.index ? geometry.index.getX(triangle + corner) : triangle + corner;
      point.fromBufferAttribute(sourcePosition, index); mesh.applyBoneTransform(index, point); mesh.localToWorld(point);
      vertices.push({ index, point: point.clone() });
    }
    if (side && Math.sign(vertices.reduce((sum, vertex) => sum + vertex.point.x, 0)) !== side) continue;
    for (const vertex of vertices) {
      normal.fromBufferAttribute(sourceNormal, vertex.index).applyNormalMatrix(worldNormal);
      posedPoint.set(0, 0, 0); posedNormal.set(0, 0, 0);
      for (let influence = 0; influence < 4; influence++) {
        const weight = weights.getComponent(vertex.index, influence);
        if (weight === 0) continue;
        const mapping = mappings[boneIndices.getComponent(vertex.index, influence)];
        temporary.copy(vertex.point);
        if (mapping) temporary.applyMatrix4(mapping.matrix);
        posedPoint.addScaledVector(temporary, weight);
        temporary.copy(normal);
        if (mapping) temporary.applyNormalMatrix(mapping.normal);
        posedNormal.addScaledVector(temporary, weight);
      }
      positions.push(...posedPoint.applyMatrix4(transform).toArray());
      normals.push(...posedNormal.applyNormalMatrix(targetNormal).toArray());
      uvs.push(sourceUv.getX(vertex.index), sourceUv.getY(vertex.index));
    }
  }
  if (!positions.length) throw new Error(`Static skin bake produced no geometry: ${name}`);
  const baked = new THREE.BufferGeometry();
  baked.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  baked.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  baked.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const result = new THREE.Mesh(baked, material);
  result.name = name; result.castShadow = result.receiveShadow = true;
  return result;
}

export function bakeStudySkin(model, textures) {
  model.updateMatrixWorld(true);
  const face = model.getObjectByName('臉部'), eyes = model.getObjectByName('眼睛'), hands = model.getObjectByName('手部');
  if (!face || !eyes || !hands) throw new Error('Inspected licensed head/hand source differs from the expected character');
  const root = new THREE.Group(); root.name = 'licensed-static-head-and-hands';
  const faceMaterial = new THREE.MeshStandardMaterial({ color: 0xf2e9df, map: textures.face, roughness: .8 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xcac1b1, map: textures.eye, roughness: .38 });
  const handMaterial = new THREE.MeshStandardMaterial({ color: 0xe9d9c6, map: textures.hand, roughness: .83 });
  const headTransform = studyTransform(), pose = createStudyPose(model);
  root.add(bakeMesh(face, headTransform, faceMaterial, 'study-face'));
  root.add(bakeMesh(eyes, headTransform, eyeMaterial, 'study-eyes'));
  for (const [side, prefix] of [[1, 'left'], [-1, 'right']]) {
    root.add(bakeMesh(hands, headTransform, handMaterial, `study-${prefix}-hand`, { side, pose }));
  }
  root.userData = {
    staticBaked: true, source: '/assets/game/nra-88/source.json',
    permission: 'user-reported-author-phone-consent', isCC0: false,
    historicalPortrait: false, importedClothing: false, importedAnimations: false,
  };
  return root;
}

export function bakeStudyGarment(model) {
  model.updateMatrixWorld(true);
  const source = model.getObjectByName('衣服');
  if (!source?.isSkinnedMesh) throw new Error('Static appearance source is missing the inspected garment mesh');
  const triangles = garmentShellTriangles(source), pose = createStudyPose(model);
  const garment = bakeMesh(source, studyTransform(), new THREE.MeshStandardMaterial(), 'standing-collar-tunic', {
    pose, triangles: triangles.body,
  });
  const sleeves = bakeMesh(source, studyTransform(), garment.material, 'fitted-source-sleeves', { pose, triangles: triangles.sleeves });
  const tailored = tailorStudyGarment(garment.geometry, sleeves.geometry);
  garment.geometry.dispose(); sleeves.geometry.dispose(); garment.geometry = tailored;
  garment.userData = {
    staticBaked: true, adaptedSourceGarment: true, importedAnimations: false,
    source: '/assets/game/nra-88/source.json', isCC0: false, historicalAcceptance: false,
    sourceBodyReferenceTriangles: triangles.body.size, retainedSleeveTriangles: triangles.sleeves.size,
    removedSourceDetailTriangles: (source.geometry.index?.count ?? source.geometry.getAttribute('position').count) / 3 - triangles.body.size - triangles.sleeves.size,
    sourceCollarIncluded: false, sourceBreastPocketsIncluded: false,
    sourceBadgesIncluded: false, sourceClothingTextureIncluded: false,
    construction: 'Measured source body and refitted source sleeves, redrafted chest/standing collar and joined waist; one shared static arm/hand fit, not a new cloth simulation.',
  };
  garment.geometry.userData.hasGeometricFolds = true;
  return garment;
}

export async function loadStudyAppearance() {
  const base = '/assets/game/nra-88/';
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const loader = new THREE.TextureLoader();
  const loadTexture = async name => {
    try { return await loader.loadAsync(`${base}${name}`); }
    catch (error) { throw new Error(`Licensed static skin texture failed: ${name}`, { cause: error }); }
  };
  const modelRequest = fetch(`${base}character.fbx`).then(response => {
    if (!response.ok) throw new Error(`Licensed static skin source returned HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  const [bytes, face, eye, hand] = await Promise.all([
    modelRequest, loadTexture('face.jpg'), loadTexture('eye.png'), loadTexture('hand.jpg'),
  ]);
  for (const texture of [face, eye, hand]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
  }
  const original = new FBXLoader(manager).parse(bytes, '');
  const skin = bakeStudySkin(original, { face, eye, hand });
  const upperBody = bakeStudyGarment(original);
  original.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.map?.dispose();
  });
  disposeUniformStudy(original);
  return { skin, upperBody };
}
