import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural costume interpretation, not a scan or a claim of historical acceptance.
export const OFFICER_PROVENANCE = Object.freeze({
  author: 'Project-authored procedural geometry, woven palette and costume details',
  reference: 'User-supplied contemporary costume photographs; no face, watermark or texture copied',
  historicalAcceptance: false, sword: 'decorative-only',
});

export function officerSlot(formation) {
  if (!formation) return null;
  const count = formation.memberCount ?? formation.members?.length;
  if (!Number.isInteger(count) || count < 1) return null;
  return count <= 2 || count === 20 || /crew|pilot|vehicle|tank|plane/.test(formation.kind ?? formation.type ?? '') ? 0 : 2;
}

export function isNativeOfficer(actor) {
  return Boolean(actor && ['friendly', 'enemy'].includes(actor.team) &&
    Number.isInteger(actor.index) && actor.index === officerSlot(actor.formation));
}

const variants = new WeakMap(), regions = new WeakMap(), palettes = new Map(), accessories = new Map();
export const OFFICER_COLORS = Object.freeze({
  friendly: Object.freeze(['#52533d', '#62462f', '#20211e', '#a99565', '#786746', '#e1ded2', '#123d79', '#625e46']),
  enemy: Object.freeze(['#7d6d50', '#493b2b', '#3e3226', '#b8a06a', '#8c2926', '#e1ded2', '#b8a06a', '#948265']),
});
const colors = OFFICER_COLORS;

export function nativeOfficerHandWeights(mesh) {
  const skin = mesh.geometry.attributes, values = new Float32Array(skin.position.count);
  if (!mesh.isSkinnedMesh || !skin.skinIndex || !skin.skinWeight) return new THREE.Float32BufferAttribute(values, 1);
  for (let vertex = 0; vertex < values.length; vertex++) {
    let handWeight = 0;
    for (let slot = 0; slot < 4; slot++) {
      const bone = mesh.skeleton.bones[skin.skinIndex.getComponent(vertex, slot)];
      if (/^(Left|Right)Hand/.test(bone?.name ?? '')) handWeight += skin.skinWeight.getComponent(vertex, slot);
    }
    values[vertex] = handWeight >= .5 ? 1 : 0;
  }
  return new THREE.Float32BufferAttribute(values, 1);
}

export function createOfficerHandAppearance(mesh, { geometryOwned = false } = {}) {
  if (!mesh?.isSkinnedMesh || Array.isArray(mesh.material)) throw new Error('Officer gloves require an isolated native hand mesh');
  const geometry = geometryOwned ? mesh.geometry : mesh.geometry.clone();
  geometry.setAttribute('nativeOfficerGlove', nativeOfficerHandWeights(mesh));
  const material = mesh.material.clone(), previousCompile = mesh.material.onBeforeCompile;
  const enabled = { value: 0 };
  const gloveVertices = geometry.attributes.nativeOfficerGlove.array.reduce((sum, value) => sum + value, 0);
  material.onBeforeCompile = shader => {
    if (typeof previousCompile === 'function') previousCompile.call(material, shader);
    shader.uniforms.nativeOfficerGloves = enabled;
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float nativeOfficerGlove;\nvarying float vOfficerGlove;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOfficerGlove = nativeOfficerGlove;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float nativeOfficerGloves;\nvarying float vOfficerGlove;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (nativeOfficerGloves > 0.5 && vOfficerGlove > 0.5) {
        float gloveShade = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 2.0, 0.82, 1.05);
        diffuseColor.rgb = vec3(${new THREE.Color(colors.friendly[5]).toArray().join(',')}) * gloveShade;
      }`);
  };
  material.customProgramCacheKey = () => 'native-bone-weight-officer-gloves-v1';
  mesh.geometry = geometry; mesh.material = material;
  return {
    setOfficerAppearance(officer) {
      if (typeof officer !== 'boolean') throw new TypeError('Officer hand appearance requires a boolean');
      enabled.value = Number(officer);
    },
    get snapshot() {
      return { officer: Boolean(enabled.value), gloveVertices,
        materialId: material.uuid, geometryId: geometry.uuid, mask: 'hand-and-finger-bone-weights' };
    },
  };
}

export function createOfficerSleeveAppearance(mesh) {
  if (Array.isArray(mesh.material)) throw new Error('Officer sleeve appearance requires its isolated cloth material');
  const material = mesh.material.clone(), previousCompile = mesh.material.onBeforeCompile, enabled = { value: 0 };
  material.onBeforeCompile = shader => {
    if (typeof previousCompile === 'function') previousCompile.call(material, shader);
    shader.uniforms.nativeOfficerSleeves = enabled;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float nativeOfficerSleeves;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (nativeOfficerSleeves > 0.5) {
        float officerSleeveShade = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 4.0, 0.58, 1.28);
        diffuseColor.rgb = vec3(${new THREE.Color(colors.friendly[0]).toArray().join(',')}) * officerSleeveShade;
      }`);
  };
  material.customProgramCacheKey = () => 'native-officer-sleeve-cloth-v1';
  mesh.material = material;
  return {
    setOfficerAppearance(officer) {
      if (typeof officer !== 'boolean') throw new TypeError('Officer sleeve appearance requires a boolean');
      enabled.value = Number(officer);
    },
  };
}

export function createOfficerVisorGeometry(team = 'friendly', segments = 20) {
  if (!colors[team] || !Number.isInteger(segments) || segments < 8 || segments > 32) throw new RangeError('Invalid officer visor profile');
  const rows = 2, positions = [], uv = [], indices = [], thickness = .0025;
  for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= rows; row++) for (let at = 0; at <= segments; at++) {
    const t = at / segments, angle = (t * 2 - 1) * 1.05;
    const extension = Math.pow(Math.max(0, Math.cos((t * 2 - 1) * Math.PI / 2)), .8);
    const outward = row / rows;
    positions.push(Math.sin(angle) * (.088 + .003 * extension * outward),
      Math.sin(angle) ** 2 * .005 - extension * outward * (.012 + .004 * outward) - layer * thickness,
      -Math.cos(angle) * .086 - extension * outward * (team === 'enemy' ? .054 : .048));
    uv.push(t, outward);
  }
  const stride = segments + 1, layerSize = stride * (rows + 1);
  const quad = (a, b, c, d) => indices.push(a, b, d, b, c, d);
  for (let row = 0; row < rows; row++) for (let at = 0; at < segments; at++) {
    const a = row * stride + at;
    quad(a, a + stride, a + stride + 1, a + 1);
    quad(a + layerSize, a + layerSize + 1, a + layerSize + stride + 1, a + layerSize + stride);
  }
  for (let at = 0; at < segments; at++) {
    quad(at, at + 1, at + 1 + layerSize, at + layerSize);
    const outer = rows * stride + at;
    quad(outer, outer + layerSize, outer + layerSize + 1, outer + 1);
  }
  for (let row = 0; row < rows; row++) {
    const left = row * stride, right = left + segments;
    quad(left, left + layerSize, left + layerSize + stride, left + stride);
    quad(right, right + stride, right + stride + layerSize, right + layerSize);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.officerDetail = { kind: 'rounded-tapered-curved-visor', thickness, segments };
  return geometry;
}

export function createOfficerCapCrown(team = 'friendly') {
  if (!colors[team]) throw new RangeError('Unknown officer faction');
  const points = [[0, -.031], [.080, -.031], [.085, -.024], [.083, .005],
    [.077, .027], [.060, team === 'enemy' ? .048 : .039], [.034, team === 'enemy' ? .052 : .043], [0, team === 'enemy' ? .054 : .045]];
  const geometry = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 20);
  geometry.scale(team === 'enemy' ? 1 : 1.06, 1, team === 'enemy' ? 1.13 : 1.08);
  geometry.userData.officerDetail = { kind: 'rounded-field-cap-crown', faction: team };
  return geometry;
}

function palette(team) {
  if (!palettes.has(team)) {
    const tile = 32, width = colors[team].length * tile, bytes = new Uint8Array(width * tile * 4);
    const bases = colors[team].map(color => new THREE.Color(color).convertLinearToSRGB().toArray());
    for (let y = 0; y < tile; y++) for (let x = 0; x < width; x++) {
      const slot = Math.floor(x / tile), base = bases[slot];
      const weave = slot === 0 || slot === 7 ? ((x + y) % 3 === 0 ? .95 : 1.025) : 1;
      const grain = 1 + Math.sin(x * 13 + y * 37) * (slot === 1 || slot === 2 ? .018 : .007);
      const offset = (y * width + x) * 4;
      for (const [channel, value] of base.entries()) bytes[offset + channel] = Math.min(255, Math.round(value * 255 * weave * grain));
      bytes[offset + 3] = 255;
    }
    const texture = new THREE.DataTexture(bytes, width, tile);
    texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
    palettes.set(team, new THREE.MeshStandardMaterial({ map: texture, roughness: .95, side: THREE.DoubleSide }));
  }
  return palettes.get(team);
}

export function nativeOfficerRegions(mesh, team) {
  const regionKey = `${team}:${mesh.name}`;
  if (regions.get(mesh.geometry)?.has(regionKey)) return regions.get(mesh.geometry).get(regionKey);
  const source = mesh.geometry.attributes.position, values = new Float32Array(source.count);
  const point = new THREE.Vector3(), nra = team === 'friendly';
  const tunic = nra ? mesh.name === '衣服' : /^(near-14|far-11)-0$/.test(mesh.name);
  const helmet = nra ? /鋼盔|helmet/i.test(mesh.name) : /^(near-14-(7|11|12)|far-11-(7|8|9))$/.test(mesh.name);
  const legs = nra ? /綁腿|鞋|靴|褲/.test(mesh.name) : /^(near-14-[245]|far-11-[123])$/.test(mesh.name);
  const hands = nra ? mesh.name === '手部' : /^(near-14-10|far-11-6)$/.test(mesh.name);
  const glove = hands ? nativeOfficerHandWeights(mesh) : null;
  for (let i = 0; i < source.count; i++) {
    point.fromBufferAttribute(source, i);
    // NRA FBX bind coordinates are centimetres; IJA's baked bind vertices are metres.
    const y = nra && mesh.isSkinnedMesh ? point.clone().applyMatrix4(mesh.bindMatrix).y * .0095 : point.y;
    values[i] = helmet && (nra || y > 1.44) ? 1 : tunic ? 2 : legs ? y < .49 ? 3 : 2 : glove?.getX(i) ? 4 : 0;
  }
  const attribute = new THREE.Float32BufferAttribute(values, 1);
  if (!regions.has(mesh.geometry)) regions.set(mesh.geometry, new Map());
  regions.get(mesh.geometry).set(regionKey, attribute);
  return attribute;
}

export function officerRegionShader(shader, { instanced = false, team = 'friendly' } = {}) {
  const cloth = new THREE.Color(colors[team][0]), boot = new THREE.Color(colors[team][2]);
  shader.vertexShader = shader.vertexShader.replace('#include <common>',
    `#include <common>\nattribute float nativeOfficerRegion;\nvarying float vOfficerRegion;\n${instanced ? 'attribute float nativeOfficer;\nvarying float vOfficer;' : ''}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvOfficerRegion = nativeOfficerRegion;${instanced ? '\nvOfficer = nativeOfficer;' : ''}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
    `#include <common>\nvarying float vOfficerRegion;\n${instanced ? 'varying float vOfficer;' : ''}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
    if (${instanced ? 'vOfficer > 0.5 && ' : ''}vOfficerRegion > 0.5) {
      if (vOfficerRegion < 1.5) discard;
      float fabricShade = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 4.0, 0.58, 1.28);
      diffuseColor.rgb = vOfficerRegion < 2.5 ? vec3(${cloth.toArray().join(',')}) * fabricShade
        : vOfficerRegion < 3.5 ? vec3(${boot.toArray().join(',')}) * max(0.8, fabricShade)
        : vec3(${new THREE.Color(colors[team][5]).toArray().join(',')}) * clamp(fabricShade, 0.82, 1.05);
    }`);
}

function officerVariant(mesh, team) {
  const region = nativeOfficerRegions(mesh, team);
  if (!region.array.some(value => value !== 0)) return { geometry: mesh.geometry, material: mesh.material };
  let entries = variants.get(mesh.geometry);
  if (!entries) { entries = new Map(); variants.set(mesh.geometry, entries); }
  const key = `${team}:${mesh.material.uuid ?? mesh.material.map(m => m.uuid).join(':')}`;
  if (!entries.has(key)) {
    const geometry = mesh.geometry.clone();
    geometry.setAttribute('nativeOfficerRegion', region);
    const indices = mesh.geometry.index, count = indices?.count ?? region.count, retained = [];
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    geometry.clearGroups();
    for (const group of groups) {
      const start = retained.length;
      for (let at = group.start; at < group.start + group.count; at += 3) {
        const ids = [0, 1, 2].map(offset => indices ? indices.getX(at + offset) : at + offset);
        if (!ids.every(id => region.getX(id) === 1)) retained.push(...ids);
      }
      geometry.addGroup(start, retained.length - start, group.materialIndex);
    }
    geometry.setIndex(retained);
    const convert = material => {
      const copy = material.clone();
      copy.onBeforeCompile = shader => officerRegionShader(shader, { team });
      copy.customProgramCacheKey = () => `native-officer-${team}`;
      return copy;
    };
    entries.set(key, { geometry, material: Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material) });
  }
  return entries.get(key);
}

export function createOfficerAppearance(root, bones, meshes, team) {
  for (const part of meshes) part.userData.officerTeam = team;
  root.updateMatrixWorld(true);
  const boneList = [...bones.values()], joints = name => boneList.indexOf(bones.get(name));
  const landmark = name => root.worldToLocal(bones.get(name).getWorldPosition(new THREE.Vector3()));
  const chest = landmark('Spine2'), head = landmark('Head'), crown = landmark('HeadTop_End');
  const neck = landmark('Neck'), hips = landmark('Hips');
  const key = `${team}:${crown.y.toFixed(4)}:${chest.y.toFixed(4)}`;
  if (!accessories.has(key)) {
    const parts = [], details = [];
    let detailOffset = 0;
    const add = (geometry, center, bone, color, rotation = null, detail = null) => {
      if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
      geometry.translate(...center);
      const count = geometry.attributes.position.count;
      const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) { indices[i * 4] = joints(bone); weights[i * 4] = 1; }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const sourceUv = geometry.attributes.uv, uv = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        uv[i * 2] = (color + .10 + (sourceUv?.getX(i) ?? .5) * .8) / colors[team].length;
        uv[i * 2 + 1] = .06 + (sourceUv?.getY(i) ?? .5) * .88;
      }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const expanded = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      if (detail) details.push(Object.freeze({ name: detail, bone, color, start: detailOffset, count: expanded.attributes.position.count }));
      detailOffset += expanded.attributes.position.count; parts.push(expanded); geometry.dispose();
    };
    const box = (size, center, bone, color, rotation = null, detail = null) => add(new THREE.BoxGeometry(...size), center, bone, color, rotation, detail);
    const buckle = (center, size, bone, detail) => {
      const [width, height] = size, [x, y, z] = center;
      for (const side of [-1, 1]) {
        box([width, .004, .005], [x, y + side * height / 2, z], bone, 3);
        box([.004, height, .005], [x + side * width / 2, y, z], bone, 3);
      }
      box([width * .75, .003, .006], [x, y, z - .001], bone, 3, null, detail);
    };
    const capY = crown.y + .008, capZ = crown.z + .03, front = capZ - .074;
    add(createOfficerCapCrown(team), [head.x, capY, capZ], 'Head', 0, null, 'rounded-cap-crown');
    const band = new THREE.CylinderGeometry(.0855, .0855, team === 'enemy' ? .014 : .006, 20, 1, true);
    band.scale(team === 'enemy' ? 1 : 1.06, 1, team === 'enemy' ? 1.13 : 1.08);
    add(band, [head.x, capY - .024, capZ], 'Head', team === 'enemy' ? 4 : 7, null, 'cap-band');
    add(createOfficerVisorGeometry(team), [head.x, capY - .031, capZ], 'Head', 2, null, 'curved-visor');
    const seam = new THREE.CylinderGeometry(.086, .086, .0015, 20, 1, true);
    seam.scale(team === 'enemy' ? 1 : 1.06, 1, team === 'enemy' ? 1.13 : 1.08);
    add(seam, [head.x, capY - .017, capZ], 'Head', 7, null, 'crown-seam');
    const badge = new THREE.Shape(), rays = team === 'friendly' ? 24 : 10;
    for (let i = 0; i < rays; i++) {
      const angle = i / rays * Math.PI * 2 + Math.PI / 2, radius = i % 2 ? .006 : .014;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) badge.moveTo(x, y); else badge.lineTo(x, y);
    }
    badge.closePath();
    if (team === 'friendly') box([.032, .033, .004], [head.x, capY, front - .02], 'Head', 6);
    add(new THREE.ShapeGeometry(badge), [head.x, capY + .003, front - .024], 'Head', team === 'friendly' ? 5 : 3, null, 'faction-badge');
    const y = chest.y + .035, z = hips.z - .158;
    const collar = new THREE.CylinderGeometry(.056, .064, .043, 12, 1, true);
    collar.scale(1.1, 1, .85); add(collar, [neck.x, neck.y - .012, neck.z - .025], 'Spine2', 0);
    for (const side of [-1, 1]) {
      box([.043, .025, .006], [side * .033, neck.y - .012, neck.z - .078], 'Spine2', 4);
      for (let rank = 0; rank < 3; rank++)
        box([.025, .0025, .007], [side * .033, neck.y - .019 + rank * .007, neck.z - .083], 'Spine2', 3, null, 'collar-rank-strip');
      box([.071, .083, .006], [side * .076, y - .048, z], 'Spine2', 0);
      box([.076, .018, .008], [side * .076, y - .012, z - .004], 'Spine2', 0);
      box([.007, .007, .007], [side * .076, y - .012, z - .018], 'Spine2', 3);
      const prefix = side < 0 ? 'Left' : 'Right', shoulder = landmark(`${prefix}Shoulder`), arm = landmark(`${prefix}Arm`);
      const direction = arm.clone().sub(shoulder), strap = new THREE.BoxGeometry(Math.max(.07, direction.length()), .006, .026);
      strap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize()));
      const center = shoulder.clone().lerp(arm, .52); center.y += .012; center.z -= .014;
      add(strap, center.toArray(), `${prefix}Shoulder`, 0, null, 'shoulder-strap');
      box([.008, .004, .008], [center.x, center.y + .005, center.z], `${prefix}Shoulder`, 3, null, 'shoulder-button');
    }
    if (team === 'friendly') {
      box([.057, .024, .003], [-.073, y + .033, z - .009], 'Spine2', 5, null, 'white-chest-cloth');
      for (let stitch = 0; stitch < 3; stitch++)
        box([.039, .0015, .001], [-.073, y + .025 + stitch * .007, z - .011], 'Spine2', 7);
    }
    for (let i = 0; i < 5; i++) box([.009, .009, .007], [0, y + .026 - i * .048, z - .009], 'Spine2', 3);
    const sash = new THREE.BoxGeometry(.026, .32, .006);
    add(sash, [.01, y - .035, z - .026], 'Spine2', 1, new THREE.Euler(0, 0, -.58), 'diagonal-leather-strap');
    buckle([.035, y - .072, z - .035], [.030, .025], 'Spine2', 'strap-buckle');
    const belt = new THREE.CylinderGeometry(.146, .146, .039, 20, 1, true);
    belt.scale(1.12, 1, .70); add(belt, [hips.x, hips.y + .125, hips.z], 'Hips', 1, null, 'waist-belt');
    buckle([0, hips.y + .125, hips.z - .112], [.037, .041], 'Hips', 'waist-buckle');
    box([.025, .047, .010], [.053, hips.y + .125, hips.z - .105], 'Hips', 1, null, 'belt-keeper');
    for (const side of ['Left', 'Right']) {
      const knee = landmark(`${side}Leg`), foot = landmark(`${side}Foot`);
      const boot = new THREE.CylinderGeometry(.049, .043, Math.max(.15, knee.y - foot.y - .055), 10, 1, true);
      add(boot, [foot.x, (knee.y + foot.y) / 2 - .025, foot.z], `${side}Leg`, 2);
    }
    if (team === 'enemy') {
      box([.068, .140, .031], [.178, hips.y + .017, hips.z - .043], 'Hips', 1, new THREE.Euler(0, 0, -.12), 'officer-holster');
      box([.076, .032, .035], [.180, hips.y + .077, hips.z - .045], 'Hips', 1);
      box([.009, .009, .007], [.180, hips.y + .070, hips.z - .066], 'Hips', 3);
      box([.018, .52, .024], [.19, hips.y - .15, hips.z + .012], 'Hips', 2, new THREE.Euler(0, 0, -.15));
      box([.085, .012, .045], [.145, hips.y + .125, hips.z + .014], 'Hips', 3);
      box([.018, .105, .022], [.145, hips.y + .18, hips.z + .014], 'Hips', 1);
    }
    const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.userData.officerProvenance = OFFICER_PROVENANCE;
    geometry.userData.officerParts = Object.freeze(details);
    accessories.set(key, geometry);
  }
  const skeleton = new THREE.Skeleton(boneList, boneList.map(bone => bone.matrixWorld.clone().invert().multiply(root.matrixWorld)));
  const mesh = new THREE.SkinnedMesh(accessories.get(key), palette(team));
  mesh.name = `native-${team}-officer-insignia`; mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true; mesh.bind(skeleton, new THREE.Matrix4());
  root.add(mesh); mesh.visible = false;
  const originals = new Map();
  let enabled = false;
  return {
    mesh,
    attachment: { mesh, enabled: isNativeOfficer, poseFollowing: true },
    restore() {
      for (const [part, original] of originals) { part.geometry = original.geometry; part.material = original.material; }
      originals.clear(); mesh.visible = false; enabled = false;
    },
    apply(actor) {
      enabled = isNativeOfficer(actor); mesh.visible = enabled;
      if (!enabled) return;
      for (const part of meshes) {
        originals.set(part, { geometry: part.geometry, material: part.material });
        const variant = officerVariant(part, team);
        part.geometry = variant.geometry; part.material = variant.material;
      }
    },
    get snapshot() {
      return { officer: enabled, slotPolicy: 'original-index', team, helmetReplaced: enabled,
        badge: team === 'friendly' ? 'ROC-white-sun' : 'gold-star-red-band',
        decorativeSword: enabled && team === 'enemy', triangles: mesh.geometry.attributes.position.count / 3,
        submissions: enabled ? 1 : 0, sharedAccessoryGeometries: accessories.size,
        sharedAccessoryMaterials: palettes.size, paletteBytes: colors[team].length * 32 * 32 * 4,
        details: mesh.geometry.userData.officerParts.map(part => part.name), gloves: enabled,
        historicalAcceptance: false };
    },
  };
}
