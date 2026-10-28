import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareNraRig } from '../src/nra-rig.js';
import { bakeMesh, createStudyPose } from '../uniform-study/skin.js';
import { createStudySurface } from '../uniform-study/surfaces.js';
import { sculptUniformPoint, fitUniformAttachmentPoint, createRemadeUniformMaps } from '../src/nra-uniform.js';
export { sculptUniformPoint } from '../src/nra-uniform.js';

const BASE = '/assets/game/nra-88/';

export function refineUniformGeometry(source, part) {
  if (!source.attributes.position || !source.attributes.normal || !source.attributes.uv || source.index) {
    throw new Error('Uniform refinement requires baked non-indexed positions, normals and UVs');
  }
  const groups = source.groups.length ? source.groups : [{ start: 0, count: source.attributes.position.count, materialIndex: 0 }];
  const pieces = groups.map(group => {
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = source.attributes[name], size = attribute.itemSize;
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(
        attribute.array.slice(group.start * size, (group.start + group.count) * size), size));
    }
    const subdivided = new TessellateModifier(.012, 5).modify(geometry);
    geometry.dispose();
    const positions = subdivided.attributes.position, normals = subdivided.attributes.normal;
    const point = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3();
    const bitangent = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0);
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index);
      normal.fromBufferAttribute(normals, index).normalize();
      tangent.crossVectors(normal, Math.abs(normal.y) > .9 ? right : up).normalize();
      bitangent.crossVectors(normal, tangent);
      const displaced = sculptUniformPoint(point, part);
      // Transform the original smooth normal through the local deformation, rather than exposing source low-poly facets.
      tangent.copy(sculptUniformPoint(point.clone().addScaledVector(tangent, .0001), part)).sub(displaced);
      bitangent.copy(sculptUniformPoint(point.clone().addScaledVector(bitangent, .0001), part)).sub(displaced);
      normal.crossVectors(tangent, bitangent).normalize();
      positions.setXYZ(index, displaced.x, displaced.y, displaced.z);
      normals.setXYZ(index, normal.x, normal.y, normal.z);
    }
    return subdivided;
  });
  const result = mergeGeometries(pieces, true);
  if (!result) throw new Error('Unable to combine refined garment panels');
  result.groups.forEach((group, index) => { group.materialIndex = groups[index].materialIndex; });
  pieces.forEach(geometry => geometry.dispose());
  result.computeBoundingBox(); result.computeBoundingSphere();
  result.userData = { sourceBased: true, geometricFolds: true, part, clothSimulation: false };
  return result;
}

export function fitUniformAttachment(source) {
  const result = source.clone(), positions = result.attributes.position, point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(source.attributes.position, index);
    const fitted = fitUniformAttachmentPoint(point);
    positions.setXYZ(index, fitted.x, fitted.y, fitted.z);
  }
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

export async function loadNraUniformStudy() {
  const response = await fetch(`${BASE}source.json`);
  if (!response.ok) throw new Error(`Uniform source manifest: HTTP ${response.status}`);
  const source = await response.json();
  if (source.permission?.basis !== 'user-reported-author-phone-consent') throw new Error('Uniform permission record missing');
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { setPath() { return this; }, load() { return new THREE.Texture(); } });
  const fbx = new FBXLoader(manager), loader = new THREE.TextureLoader();
  const [original, helmet, entries] = await Promise.all([
    fbx.loadAsync(`${BASE}character.fbx`),
    fbx.loadAsync(`${BASE}${source.helmet.file}`),
    Promise.all(Object.entries(source.textures).map(async ([id, file]) => {
      const texture = await loader.loadAsync(`${BASE}${file}`);
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
      if (id === 'eye') texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      return [id, texture];
    })),
  ]);
  const textures = new Map(entries), rig = prepareNraRig(original), pose = createStudyPose(original);
  const transform = new THREE.Matrix4().makeScale(.0095, .0095, .0095);
  transform.setPosition(0, .00003, 0);
  const baseline = new THREE.Group(), remake = new THREE.Group();
  baseline.name = 'original-88-study'; remake.name = 'remade-helmeted-nra-study';
  const cloth = createStudySurface('cloth'), leather = createStudySurface('leather'), paint = createStudySurface('paint');
  const baseMaps = createRemadeUniformMaps(textures);
  const clothIds = new Set(['body', 'pants', 'puttee']);
  const skinIds = new Set(['face', 'hand', 'eye']);
  const material = (id, refined) => {
    if (!textures.has(id)) throw new Error(`Unknown uniform material: ${id}`);
    const surface = clothIds.has(id) ? cloth : id === 'helmet' ? paint : leather;
    const details = refined && !skinIds.has(id);
    const map = refined && baseMaps.has(id) ? baseMaps.get(id) : textures.get(id);
    return new THREE.MeshStandardMaterial({
      map, side: THREE.DoubleSide,
      roughness: id === 'eye' ? .45 : !refined ? id === 'helmet' ? .7 : .9 : clothIds.has(id) ? .95 : id === 'helmet' ? .72 : .85,
      metalness: id === 'helmet' ? .2 : refined && ['metal', 'metalR'].includes(id) ? .35 : 0,
      ...(details ? { normalMap: surface.normalMap, roughnessMap: surface.roughnessMap,
        normalScale: surface.normalScale.clone().multiplyScalar(clothIds.has(id) ? .65 : .45) } : {}),
    });
  };
  let changedVertices = 0;
  for (const sourceMesh of rig.meshes) {
    const ids = source.meshMaterials[sourceMesh.name];
    if (!ids) throw new Error(`Unmapped study mesh: ${sourceMesh.name}`);
    const materials = ids.map(id => material(id, false)), newMaterials = ids.map(id => material(id, true));
    const mesh = bakeMesh(sourceMesh, transform, materials.length === 1 ? materials[0] : materials, sourceMesh.name, { pose });
    const refined = new THREE.Mesh(mesh.geometry.clone(), newMaterials.length === 1 ? newMaterials[0] : newMaterials);
    refined.name = sourceMesh.name;
    if (['衣服', '褲子'].includes(sourceMesh.name)) {
      const geometry = refineUniformGeometry(refined.geometry, sourceMesh.name === '衣服' ? 'tunic' : 'trousers');
      refined.geometry.dispose(); refined.geometry = geometry;
      changedVertices += geometry.attributes.position.count;
    } else if (['帶子', '衣服帶子', '胸繩', '胸章', '臂章'].includes(sourceMesh.name)) {
      const geometry = fitUniformAttachment(refined.geometry);
      refined.geometry.dispose(); refined.geometry = geometry;
    }
    for (const part of [mesh, refined]) {
      part.castShadow = part.receiveShadow = true;
      part.userData.equipment = ['帶子', '彈夾收納包', '腰帶', '衣服帶子', '胸繩'].includes(part.name);
    }
    baseline.add(mesh); remake.add(refined);
  }
  helmet.position.fromArray(source.helmet.position);
  const helmetMeshes = [];
  helmet.traverse(node => { if (node.isMesh) helmetMeshes.push(node); });
  if (helmetMeshes.length !== 1 || helmetMeshes[0].isSkinnedMesh) throw new Error('Helmet differs from inspected rigid source');
  const helmetMesh = helmetMeshes[0];
  helmetMesh.quaternion.fromArray(source.helmet.meshQuaternion).normalize();
  helmetMesh.scale.fromArray(source.helmet.meshScale);
  rig.canonical.get('Head').add(helmet);
  original.updateMatrixWorld(true);
  const helmetGeometry = helmetMesh.geometry.clone().applyMatrix4(
    transform.clone().multiply(helmetMesh.matrixWorld));
  for (const [root, refined] of [[baseline, false], [remake, true]]) {
    const mesh = new THREE.Mesh(helmetGeometry.clone(), material('helmet', refined));
    mesh.name = 'M1935-helmet'; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  helmetGeometry.dispose();
  original.traverse(node => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) { mat.map?.dispose(); mat.dispose(); }
    if (node.isSkinnedMesh) node.skeleton.dispose();
  });
  const unused = [cloth.map, leather.map, paint.map];
  unused.forEach(texture => texture.dispose());
  return { baseline, remake, changedVertices, source: source.source,
    permission: source.permission.basis, staticOnly: true };
}

export function disposeNraUniformStudy(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(node => {
    if (!node.isMesh) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose());
}
