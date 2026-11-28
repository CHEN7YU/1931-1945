import * as THREE from 'three';
import { createStudySurface } from './uniform-surfaces.js';

const bell = (value, center, width) => Math.exp(-(((value - center) / width) ** 2));
const clamp = THREE.MathUtils.clamp;

export const uniformReferenceTransform = () => new THREE.Matrix4().makeScale(.0082, .0082, .0082).setPosition(0, .1805, -.012);

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

export function createUniformReferencePose(model) {
  const hands = model.getObjectByName('手部');
  if (!hands?.isSkinnedMesh) throw new Error('Uniform reference requires the inspected hand skeleton');
  const pose = new Map(), inverse = uniformReferenceTransform().invert();
  for (const [side, prefix] of [[1, 'Left'], [-1, 'Right']]) {
    const landmark = name => {
      const bone = hands.skeleton.bones.find(item => item.name === `${prefix}${name}`);
      if (!bone) throw new Error(`Missing uniform attachment landmark: ${prefix}${name}`);
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

export function sculptUniformPoint(point, part) {
  const { x, y, z } = point, result = point.clone();
  if (part === 'tunic') {
    const side = Math.abs(x), angle = Math.atan2(x, z + .035);
    const torso = 1 - THREE.MathUtils.smoothstep(side, .19, .23);
    const front = Math.max(0, Math.cos(angle));
    const waist = 1.135 + .035 * Math.abs(Math.sin(angle)) + .008 * Math.sin(angle * 3);
    const ease = .0055 * bell(y, 1.21, .075) + .002 * bell(y, .98, .06);
    const folds = .005 * (bell(y, waist, .013) - .55 * bell(y, waist + .025, .017));
    const underarm = .0038 * Math.abs(Math.sin(angle)) *
      Math.sin((y - 1.24) * 62 + Math.abs(angle) * 1.3) * bell(y, 1.255, .055);
    const strapX = -.11 + (1.39 - y) * .53;
    const pressure = -.002 * bell(x, strapX, .014) * front * bell(y, 1.27, .12);
    const offset = (ease + folds + underarm + pressure) * torso *
      (1 - THREE.MathUtils.smoothstep(y, 1.37, 1.43));
    result.x += Math.sin(angle) * offset;
    result.z += Math.cos(angle) * offset;
    const sleeve = THREE.MathUtils.smoothstep(side, .205, .245);
    const sleeveAngle = Math.atan2(x - Math.sign(x) * .255, z + .027);
    const elbow = .0035 * Math.sin((y - 1.12) * 92 + sleeveAngle * 1.6) * bell(y, 1.12, .043);
    const cuff = .0025 * Math.sin((y - .88) * 110 + sleeveAngle) * bell(y, .88, .028);
    result.x += Math.sin(sleeveAngle) * (elbow + cuff) * sleeve;
    result.z += Math.cos(sleeveAngle) * (elbow + cuff) * sleeve;
  } else if (part === 'trousers') {
    const angle = Math.atan2(x - Math.sign(x) * .105, z + .025);
    const rear = Math.max(0, -Math.cos(angle));
    const knee = .004 * Math.sin((y - .53) * 78 + angle * 1.5) * bell(y, .53, .048) * rear;
    const puttee = .0045 * Math.sin((y - .405) * 100 + angle * 1.2) * bell(y, .405, .034);
    const seat = .003 * Math.sin(angle * 2 + y * 24) * bell(y, .80, .07);
    const offset = (knee + puttee + seat) * THREE.MathUtils.smoothstep(y, .32, .39);
    result.x += Math.sin(angle) * offset;
    result.z += Math.cos(angle) * offset;
  } else throw new Error(`Unknown uniform sculpture: ${part}`);
  return result;
}

export function fitUniformAttachmentPoint(point) {
  const fitted = sculptUniformPoint(point, 'tunic');
  const outward = new THREE.Vector3(point.x, 0, point.z + .035).normalize();
  return fitted.addScaledVector(outward, .0015 * (1 - THREE.MathUtils.smoothstep(point.y, 1.40, 1.47)));
}

export function fabricAlbedo(source, rgb, selective = false) {
  const canvas = document.createElement('canvas'), image = source.image;
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Fabric texture processing requires a 2D canvas');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const [r, g, b] = pixels.data.subarray(index, index + 3);
    if (selective && !(g > r * 1.015 && g > b * 1.08)) continue;
    const luminance = (.2126 * r + .7152 * g + .0722 * b) / 255;
    const shade = clamp(.64 + .36 * luminance / .43, .64, 1.15);
    for (let channel = 0; channel < 3; channel++) pixels.data[index + channel] = Math.round(rgb[channel] * shade);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

export function createRemadeUniformMaps(textures, { blueFieldCap = false } = {}) {
  return new Map([
    ['body', fabricAlbedo(textures.get('body'), blueFieldCap ? [74, 81, 88] : [112, 117, 97], true)],
    ['pants', fabricAlbedo(textures.get('pants'), blueFieldCap ? [74, 81, 88] : [106, 112, 94], true)],
    ['puttee', fabricAlbedo(textures.get('puttee'), blueFieldCap ? [74, 81, 88] : [119, 113, 93])],
    ['pouch', fabricAlbedo(textures.get('pouch'), [128, 121, 96], true)],
  ]);
}

export function createRemadeUniformMaterials(materialIds, textures, { blueFieldCap = false } = {}) {
  const maps = createRemadeUniformMaps(textures, { blueFieldCap }), clothIds = new Set(['body', 'pants', 'puttee']);
  const cloth = createStudySurface('cloth'), leather = createStudySurface('leather'), paint = createStudySurface('paint');
  const variants = new Map();
  for (const [original, id] of materialIds) {
    if (['face', 'hand', 'eye'].includes(id)) { variants.set(original, original); continue; }
    const surface = clothIds.has(id) ? cloth : id === 'helmet' ? paint : leather;
    const material = original.clone();
    material.map = maps.get(id) ?? original.map;
    material.roughness = clothIds.has(id) ? .95 : id === 'helmet' ? .72 : .85;
    material.metalness = id === 'helmet' ? .2 : ['metal', 'metalR'].includes(id) ? .35 : 0;
    material.normalMap = surface.normalMap; material.roughnessMap = surface.roughnessMap;
    material.normalScale.copy(surface.normalScale).multiplyScalar(clothIds.has(id) ? .65 : .45);
    variants.set(original, material);
  }
  for (const surface of [cloth, leather, paint]) surface.map.dispose();
  return variants;
}

const attachmentNames = new Set(['帶子', '衣服帶子', '胸繩', '胸章', '臂章']);

export function createRemadeUniformGeometry(mesh, referencePose) {
  const part = mesh.name === '衣服' ? 'tunic' : mesh.name === '褲子' ? 'trousers' : null;
  if (!part && !attachmentNames.has(mesh.name)) return mesh.geometry;
  const geometry = mesh.geometry.clone(), attributes = mesh.geometry.attributes;
  const identity = new THREE.Matrix4(), scale = new THREE.Matrix4().makeScale(.0095, .0095, .0095);
  scale.setPosition(0, .00003, 0);
  const palettes = mesh.skeleton.bones.map((bone, index) => ({
    pose: referencePose.get(bone.name) ?? identity,
    skin: mesh.bindMatrixInverse.clone().multiply(bone.matrixWorld).multiply(mesh.skeleton.boneInverses[index]).multiply(mesh.bindMatrix),
  }));
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0);
  const deform = part ? point => sculptUniformPoint(point, part) : fitUniformAttachmentPoint;
  const skin = new THREE.Matrix4(), pose = new THREE.Matrix4(), matrix = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3(), inverseNormal = new THREE.Matrix3();
  for (let index = 0; index < attributes.position.count; index++) {
    skin.elements.fill(0); pose.elements.fill(0);
    for (let influence = 0; influence < 4; influence++) {
      const weight = attributes.skinWeight.getComponent(index, influence);
      if (!weight) continue;
      const palette = palettes[attributes.skinIndex.getComponent(index, influence)];
      for (let at = 0; at < 16; at++) {
        skin.elements[at] += palette.skin.elements[at] * weight;
        pose.elements[at] += palette.pose.elements[at] * weight;
      }
    }
    // Sculpt in the approved neutral reference, then return to the original bind space; the live rig is unchanged.
    matrix.copy(scale).multiply(pose).multiply(mesh.matrixWorld).multiply(skin);
    if (Math.abs(matrix.determinant()) < 1e-12) throw new Error(`Singular uniform bind transform: ${mesh.name}`);
    inverse.copy(matrix).invert();
    normalMatrix.getNormalMatrix(matrix); inverseNormal.getNormalMatrix(inverse);
    point.fromBufferAttribute(attributes.position, index).applyMatrix4(matrix);
    normal.fromBufferAttribute(attributes.normal, index).applyNormalMatrix(normalMatrix);
    tangent.crossVectors(normal, Math.abs(normal.y) > .9 ? right : up).normalize();
    bitangent.crossVectors(normal, tangent);
    const displaced = deform(point);
    tangent.copy(deform(point.clone().addScaledVector(tangent, .0001))).sub(displaced);
    bitangent.copy(deform(point.clone().addScaledVector(bitangent, .0001))).sub(displaced);
    normal.crossVectors(tangent, bitangent).normalize().applyNormalMatrix(inverseNormal);
    displaced.applyMatrix4(inverse);
    geometry.attributes.position.setXYZ(index, displaced.x, displaced.y, displaced.z);
    geometry.attributes.normal.setXYZ(index, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { ...mesh.geometry.userData, uniformVariant: 'B' };
  return geometry;
}
