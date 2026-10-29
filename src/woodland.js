import * as THREE from 'three';
import { stagingSpawns } from './battle-roster.js';
import { makeBaseSpawns } from './spawns.js';
import { japaneseArmorSpawns } from './chi-ha.js';
import { groundHeight } from './ground.js';
import { valueNoise2D } from './value-noise.js';

function seededRandom(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const WOODLAND_SPECIES = Object.freeze({
  elm: Object.freeze({ minHeight: 6, maxHeight: 10, girth: .035,
    dark: 0x3c4828, light: 0x83945c, bark: 0xe2ddd1, leafWidth: .5, leaves: 150 }),
  poplar: Object.freeze({ minHeight: 9, maxHeight: 13.5, girth: .022,
    dark: 0x465b42, light: 0x8a9e70, bark: 0xf4f3e8, leafWidth: .7, leaves: 130 }),
  willow: Object.freeze({ minHeight: 4.8, maxHeight: 8, girth: .042,
    dark: 0x556651, light: 0x8a9875, bark: 0xe2ded0, leafWidth: .15, leaves: 70 }),
});

export function woodlandLayout(buildings) {
  const random = seededRandom(84193), trees = [];
  const clearings = [...makeBaseSpawns(), ...stagingSpawns(), ...japaneseArmorSpawns()];
  for (let i = 0; i < 140 && trees.length < 30; i++) {
    const x = (i % 2 ? -1 : 1) * (82 + random() * 27), z = (random() - .5) * 230;
    if (Math.abs(z + 16) < 10 || buildings.some(house => Math.abs(x - house.x) < house.w / 2 + 5 &&
      Math.abs(z - house.z) < house.d / 2 + 5) ||
      clearings.some(point => Math.hypot(point.x - x, point.z - z) < 6) ||
      trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < 4.5)) continue;
    const species = ['elm', 'poplar', 'willow'][Math.floor(random() * 3)], profile = WOODLAND_SPECIES[species];
    const maturity = random(), age = maturity < .25 ? 'sapling' : maturity < .78 ? 'adult' : 'old';
    const height = (profile.minHeight + random() * (profile.maxHeight - profile.minHeight)) *
      (age === 'sapling' ? .38 + random() * .17 : age === 'old' ? 1.08 : 1);
    trees.push({ x, z, seed: i + 1938, species, age, height,
      radius: height * profile.girth * (age === 'old' ? 1.25 : age === 'sapling' ? .65 : 1),
      dead: trees.length % 13 === 7, sparse: random() < .18, heading: random() * Math.PI * 2 });
  }
  return trees;
}

export function woodlandTreeGeometry(tree) {
  const profile = WOODLAND_SPECIES[tree.species];
  if (!profile) throw new RangeError(`Unknown woodland species: ${tree.species}`);
  const random = seededRandom(tree.seed), bark = [], barkUV = [], barkColors = [], barkNormals = [], foliage = [], leafColors = [], leafUV = [];
  const dark = new THREE.Color(profile.dark), light = new THREE.Color(profile.light), color = new THREE.Color();
  const barkColor = new THREE.Color(profile.bark), soilColor = new THREE.Color(0x9a7753), barkTint = new THREE.Color();
  const branch = (points, radius, tipRadius) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const segments = 12, sides = Math.max(radius, tipRadius) > tree.radius * .15 ? 12 : 7;
    const frames = curve.computeFrenetFrames(segments, false);
    const point = new THREE.Vector3(), ring = [];
    for (let i = 0; i <= segments; i++) {
      curve.getPointAt(i / segments, point);
      const r = radius + (tipRadius - radius) * i / segments;
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        ring.push(point.clone().addScaledVector(frames.normals[i], Math.cos(angle) * r)
          .addScaledVector(frames.binormals[i], Math.sin(angle) * r));
      }
    }
    const length = curve.getLength(), shade = .85 + random() * .2, normal = new THREE.Vector3();
    const wraps = Math.max(1, Math.round(Math.max(radius, tipRadius) * 2 * Math.PI / .8));
    const taper = (tipRadius - radius) / length;
    for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
      for (const [r, s] of [[i, j], [i, j + 1], [i + 1, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]]) {
        const vertex = ring[r * (sides + 1) + s];
        bark.push(...vertex.toArray());
        const angle = s / sides * Math.PI * 2;
        normal.copy(frames.normals[r]).multiplyScalar(Math.cos(angle))
          .addScaledVector(frames.binormals[r], Math.sin(angle)).addScaledVector(frames.tangents[r], -taper).normalize();
        barkNormals.push(normal.x, normal.y, normal.z);
        barkUV.push(s / sides * wraps, r / segments * length / .8);
        const dirt = Math.max(0, 1 - Math.max(0, vertex.y + .035) / Math.max(.15, Math.min(.5, tree.radius * 1.8)));
        barkTint.copy(barkColor).lerp(soilColor, dirt * .85).multiplyScalar(shade * (1 - dirt * .18));
        barkColors.push(barkTint.r, barkTint.g, barkTint.b);
      }
    }
  };
  const leafCluster = (center, spread, vertical = spread * .72) => {
    if (tree.dead) return;
    const count = Math.round(profile.leaves * (tree.sparse ? .4 : 1) * (tree.age === 'sapling' ? .65 : 1));
    for (let i = 0; i < count; i++) {
      const azimuth = random() * Math.PI * 2, elevation = random() * 2 - 1, radius = Math.cbrt(random());
      const horizontal = Math.sqrt(1 - elevation * elevation) * radius;
      const origin = center.clone().add(new THREE.Vector3(Math.cos(azimuth) * horizontal * spread,
        elevation * radius * vertical, Math.sin(azimuth) * horizontal * spread * .85));
      const length = tree.species === 'willow' ? .075 + random() * .065 : .05 + random() * .055;
      const width = length * profile.leafWidth * (.85 + random() * .3);
      const rotation = tree.species === 'willow'
        ? new THREE.Euler(Math.PI / 2 + (random() - .5) * .5, random() * Math.PI * 2, (random() - .5) * .5)
        : new THREE.Euler((random() - .5) * 1.8, random() * Math.PI * 2, (random() - .5) * 1.3);
      const vertices = [
        new THREE.Vector3(0, 0, -length), new THREE.Vector3(-width * .8, 0, -length * .35),
        new THREE.Vector3(-width, 0, length * .25), new THREE.Vector3(0, -.01, length),
        new THREE.Vector3(width, 0, length * .25), new THREE.Vector3(width * .8, 0, -length * .35),
        new THREE.Vector3(0, length * .16, 0),
      ].map(point => point.applyEuler(rotation).add(origin));
      color.copy(dark).lerp(light, Math.max(0, Math.min(1, .2 + random() * .45 + elevation * .18)));
      for (const index of [6, 0, 1, 6, 1, 2, 6, 2, 3, 6, 3, 4, 6, 4, 5, 6, 5, 0]) {
        foliage.push(...vertices[index].toArray());
        const highlight = index === 6 ? 1.04 : .96;
        leafColors.push(color.r * highlight, color.g * highlight, color.b * highlight);
        leafUV.push(index / 6, index === 6 ? 1 : 0);
      }
    }
  };
  const h = tree.height, lean = tree.species === 'poplar' ? .035 : tree.species === 'willow' ? .15 : .1;
  const leanX = (random() - .5) * h * lean, leanZ = (random() - .5) * h * lean;
  const trunkAt = t => new THREE.Vector3(leanX * t * t, h * t, leanZ * t);
  const trunkTop = tree.species === 'poplar' ? .98 : tree.species === 'willow' ? .46 : .62;
  branch([trunkAt(0).setY(-.07), trunkAt(trunkTop * .35), trunkAt(trunkTop * .7), trunkAt(trunkTop)], tree.radius, tree.radius * .14);
  const roots = tree.age === 'sapling' ? 0 : tree.age === 'old' ? 5 : 3 + Math.floor(random() * 2);
  for (let i = 0; i < roots; i++) {
    const angle = i / roots * Math.PI * 2 + tree.heading + (random() - .5) * .8;
    const reach = tree.radius * (tree.age === 'old' ? 2.2 + random() * 1.2 : 1.9 + random() * .9);
    const root = new THREE.Vector3(Math.cos(angle) * reach, -.09 - tree.radius * .1, Math.sin(angle) * reach);
    const bend = root.clone().multiplyScalar(.5).setY(-.015 + tree.radius * .03);
    const collar = trunkAt(0).setY(tree.radius * (tree.age === 'old' ? .5 + random() * .3 : .3 + random() * .25));
    branch([root, bend, collar], tree.radius * .09, tree.radius * .42);
  }
  const branches = (tree.species === 'poplar' ? 11 : tree.species === 'willow' ? 6 : 8) + Math.floor(random() * 2);
  for (let i = 0; i < branches; i++) {
    const angle = tree.heading + i * 2.399 + random() * .55;
    if (tree.species === 'poplar') {
      const tier = i / (branches - 1), start = trunkAt(.18 + tier * .67);
      const reach = h * .14 * Math.sin((.12 + tier * .8) * Math.PI) * (.8 + random() * .3);
      const end = new THREE.Vector3(start.x + Math.cos(angle) * reach, Math.min(h * .97, start.y + h * .14),
        start.z + Math.sin(angle) * reach);
      const middle = start.clone().lerp(end, .5); middle.y -= h * .025;
      branch([start, middle, end], tree.radius * (.36 - tier * .2), h * .0015);
      for (const t of [.4, .75, 1]) leafCluster(start.clone().lerp(end, t), h * .05);
      continue;
    }
    if (tree.species === 'willow') {
      const start = trunkAt(.22 + random() * .22), reach = h * (.32 + random() * .13);
      const end = new THREE.Vector3(Math.cos(angle) * reach + leanX, h * (.62 + random() * .18),
        Math.sin(angle) * reach + leanZ);
      const elbow = start.clone().lerp(end, .6); elbow.y += h * .12;
      branch([start, elbow, end], tree.radius * .42, h * .004);
      const scaffold = new THREE.CatmullRomCurve3([start, elbow, end]);
      leafCluster(elbow, h * .11, h * .06);
      for (let fork = 0; fork < 4; fork++) {
        const turn = angle + (fork - 1.5) * .4, twigStart = scaffold.getPoint(.5 + fork * .16);
        const tip = twigStart.clone().add(new THREE.Vector3(Math.cos(turn) * h * .1,
          -h * (.22 + random() * .18), Math.sin(turn) * h * .1));
        tip.y = Math.max(h * .16, tip.y);
        const bend = twigStart.clone().lerp(tip, .35); bend.y += h * .07;
        const curve = new THREE.CatmullRomCurve3([twigStart, bend, tip]);
        branch([twigStart, bend, tip], h * .004, h * .0008);
        for (const t of [.15, .4, .65, .9]) leafCluster(curve.getPoint(t), h * .065, h * .1);
      }
      continue;
    }
    const start = trunkAt(.23 + i / branches * .29);
    const reach = h * (.28 + random() * .13) * (tree.age === 'old' ? 1.12 : 1);
    const end = new THREE.Vector3(Math.cos(angle) * reach + leanX, h * (.6 + random() * .24),
      Math.sin(angle) * reach + leanZ);
    const middle = start.clone().lerp(end, .55); middle.y += h * .03;
    branch([start, middle, end], tree.radius * (.45 - i / branches * .2), h * .003);
    for (let fork = 0; fork < 3; fork++) {
      const turn = angle + (fork - 1) * .8;
      const twigEnd = end.clone().add(new THREE.Vector3(Math.cos(turn) * h * (.04 + random() * .06),
        h * (.03 + random() * .07), Math.sin(turn) * h * (.04 + random() * .06)));
      const twigStart = middle.clone().lerp(end, .25 + fork * .16);
      branch([twigStart, end.clone().lerp(twigEnd, .35), twigEnd], h * .005, h * .001);
      for (const t of [.45, 1]) leafCluster(twigStart.clone().lerp(twigEnd, t), h * (.07 + random() * .025));
    }
  }
  const geometry = (positions, uv, colors, normals) => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colors) result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (normals) result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else result.computeVertexNormals();
    result.computeBoundingBox();
    return result;
  };
  return { bark: geometry(bark, barkUV, barkColors, barkNormals), foliage: tree.dead ? null : geometry(foliage, leafUV, leafColors) };
}

export function woodlandGroundContactGeometry(tree) {
  const diameter = Math.max(.6, tree.radius * 9);
  const geometry = new THREE.PlaneGeometry(diameter, diameter, 8, 8);
  geometry.rotateX(-Math.PI / 2); geometry.rotateY(tree.heading);
  geometry.translate(tree.x, 0, tree.z);
  geometry.setAttribute('uv1', geometry.attributes.uv.clone());
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, groundHeight(positions.getX(i), positions.getZ(i)) - .024);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function woodlandGroundContactMask() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), image = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = (x - 127.5) / 127.5, v = (y - 127.5) / 127.5;
    const noise = valueNoise2D(u * 4 + 19, v * 4 - 31), radius = Math.hypot(u, v);
    const edge = Math.max(0, 1 - radius * radius * (.9 + noise * .3));
    const border = Math.min(1, Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v))) * 10);
    const alpha = .88 * edge ** .65 * (.8 + noise * .2) * border;
    const i = (y * 256 + x) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = alpha * 255; image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
