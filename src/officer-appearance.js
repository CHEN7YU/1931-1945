import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural costume interpretation, not a scan or a claim of historical acceptance.
export const OFFICER_PROVENANCE = Object.freeze({
  author: 'Project-authored procedural geometry and solid palette',
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
const colors = {
  friendly: ['#596342', '#523727', '#161916', '#b79a49', '#861f20', '#f5f1df', '#123d79'],
  enemy: ['#77734b', '#583c27', '#463025', '#c5a253', '#8c2926', '#f3f0df', '#c5a253'],
};

function palette(team) {
  if (!palettes.has(team)) {
    const bytes = new Uint8Array(colors[team].flatMap(color => {
      const c = new THREE.Color(color).convertLinearToSRGB();
      return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255];
    }));
    const texture = new THREE.DataTexture(bytes, colors[team].length, 1);
    texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    palettes.set(team, new THREE.MeshStandardMaterial({ map: texture, roughness: .87, side: THREE.DoubleSide }));
  }
  return palettes.get(team);
}

export function nativeOfficerRegions(mesh, team) {
  if (regions.has(mesh.geometry)) return regions.get(mesh.geometry);
  const source = mesh.geometry.attributes.position, values = new Float32Array(source.count);
  const point = new THREE.Vector3(), nra = team === 'friendly';
  const tunic = nra ? mesh.name === '衣服' : /^(near-14|far-11)-0$/.test(mesh.name);
  const helmet = nra ? /鋼盔|helmet/i.test(mesh.name) : /^(near-14-(7|11|12)|far-11-(7|8|9))$/.test(mesh.name);
  const legs = nra ? /綁腿|鞋|靴|褲/.test(mesh.name) : /^(near-14-[245]|far-11-[123])$/.test(mesh.name);
  const hands = !nra && /^(near-14-10|far-11-6)$/.test(mesh.name);
  for (let i = 0; i < source.count; i++) {
    point.fromBufferAttribute(source, i);
    // NRA FBX bind coordinates are centimetres; IJA's baked bind vertices are metres.
    const y = nra && mesh.isSkinnedMesh ? point.clone().applyMatrix4(mesh.bindMatrix).y * .0095 : point.y;
    values[i] = helmet && (nra || y > 1.44) ? 1 : tunic ? 2 : legs && y < .49 ? 3 : hands ? 4 : 0;
  }
  const attribute = new THREE.Float32BufferAttribute(values, 1);
  regions.set(mesh.geometry, attribute);
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
      diffuseColor.rgb = vOfficerRegion < 2.5 ? vec3(${cloth.toArray().join(',')})
        : vOfficerRegion < 3.5 ? vec3(${boot.toArray().join(',')}) : vec3(0.88, 0.86, 0.80);
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
    const parts = [];
    const add = (geometry, center, bone, color, rotation = null) => {
      if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
      geometry.translate(...center);
      const count = geometry.attributes.position.count;
      const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) { indices[i * 4] = joints(bone); weights[i * 4] = 1; }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const uv = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) { uv[i * 2] = (color + .5) / colors[team].length; uv[i * 2 + 1] = .5; }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); parts.push(geometry.toNonIndexed()); geometry.dispose();
    };
    const box = (size, center, bone, color, rotation) => add(new THREE.BoxGeometry(...size), center, bone, color, rotation);
    const capY = crown.y + .008, capZ = crown.z + .03, front = capZ - .074;
    const cap = new THREE.CylinderGeometry(.078, .085, .064, 16);
    cap.scale(1.05, 1, 1.15); add(cap, [head.x, capY, capZ], 'Head', 0);
    const band = new THREE.CylinderGeometry(.086, .086, .017, 16);
    band.scale(1.05, 1, 1.15); add(band, [head.x, capY - .029, capZ], 'Head', team === 'enemy' ? 4 : 0);
    box([.145, .012, .068], [head.x, capY - .032, front - .046], 'Head', 2, new THREE.Euler(-.12, 0, 0));
    const badge = new THREE.Shape(), rays = team === 'friendly' ? 24 : 10;
    for (let i = 0; i < rays; i++) {
      const angle = i / rays * Math.PI * 2 + Math.PI / 2, radius = i % 2 ? .006 : .014;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) badge.moveTo(x, y); else badge.lineTo(x, y);
    }
    badge.closePath();
    if (team === 'friendly') box([.032, .033, .004], [head.x, capY, front - .02], 'Head', 6);
    add(new THREE.ShapeGeometry(badge), [head.x, capY, front - .024], 'Head', team === 'friendly' ? 5 : 3);
    const y = chest.y + .035, z = hips.z - .158;
    const collar = new THREE.CylinderGeometry(.056, .064, .043, 12, 1, true);
    collar.scale(1.1, 1, .85); add(collar, [neck.x, neck.y - .012, neck.z - .025], 'Spine2', 0);
    for (const side of [-1, 1]) {
      box([.045, .025, .008], [side * .033, neck.y - .012, neck.z - .078], 'Spine2', 4);
      box([.029, .005, .009], [side * .033, neck.y - .012, neck.z - .084], 'Spine2', 3);
      box([.071, .083, .012], [side * .076, y - .048, z], 'Spine2', 0);
      box([.076, .018, .016], [side * .076, y - .012, z - .007], 'Spine2', 0);
    }
    for (let i = 0; i < 5; i++) box([.009, .009, .007], [0, y + .026 - i * .048, z - .009], 'Spine2', 3);
    const sash = new THREE.BoxGeometry(.034, .32, .012);
    add(sash, [.01, y - .035, z - .026], 'Spine2', 1, new THREE.Euler(0, 0, -.58));
    const belt = new THREE.CylinderGeometry(.148, .148, .035, 16, 1, true);
    belt.scale(1.12, 1, .70); add(belt, [hips.x, hips.y + .125, hips.z], 'Hips', 1);
    box([.04, .033, .012], [0, hips.y + .125, hips.z - .109], 'Hips', 3);
    for (const side of ['Left', 'Right']) {
      const knee = landmark(`${side}Leg`), foot = landmark(`${side}Foot`);
      const boot = new THREE.CylinderGeometry(.056, .045, Math.max(.15, knee.y - foot.y - .035), 10, 1, true);
      add(boot, [foot.x, (knee.y + foot.y) / 2 - .025, foot.z], `${side}Leg`, 2);
    }
    if (team === 'enemy') {
      box([.018, .52, .024], [.19, hips.y - .15, hips.z + .012], 'Hips', 2, new THREE.Euler(0, 0, -.15));
      box([.085, .012, .045], [.145, hips.y + .125, hips.z + .014], 'Hips', 3);
      box([.018, .105, .022], [.145, hips.y + .18, hips.z + .014], 'Hips', 1);
    }
    const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.userData.officerProvenance = OFFICER_PROVENANCE;
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
        sharedAccessoryMaterials: palettes.size, historicalAcceptance: false };
    },
  };
}
